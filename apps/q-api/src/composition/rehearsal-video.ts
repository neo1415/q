import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  EXTERNAL_REHEARSAL_DISCLAIMER,
  REHEARSAL_VIDEO_MAX_SECONDS,
  type QRehearsalDto,
  type RehearsalInterviewerDto,
  type RehearsalInterviewersDto,
  type RehearsalVideoSessionDto,
  type StartRehearsalVideoResponse,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { SecretToken, type TokenCipher } from "@capital-q/integrations";
import type { Logger } from "@capital-q/observability";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import type { RehearsalResult, RehearsalService } from "./rehearsals.js";
import {
  TavusKeysExhaustedError,
  type TavusKeyPool,
} from "./tavus/key-pool.js";
import { TavusError } from "./tavus/client.js";

/**
 * Video rehearsals (ADR 0066): Tavus is the face, voice and turn-taking;
 * Q's existing rehearsal service is the brain. Nothing here plays the
 * counterpart: each line the interviewer speaks is `rehearsals.say(...)`
 * as the founder, reached through the bridge with a per-session bearer,
 * and the review afterwards is `rehearsals.finish(...)`. No second persona,
 * memory or scoring lives in Tavus; the PAL's prompt only fixes conduct
 * and disclosure.
 *
 * Three minutes, enforced three ways: `max_call_duration` at the provider;
 * a timer that ends the session (provider end, PAL removed, rehearsal
 * finished) at `ends_at`; and a sweep for sessions past `ends_at` after a
 * restart. `ends_at` is fixed when the session row is created and the row
 * is unique per rehearsal, so a retry or reconnect never restarts it. The
 * bridge refuses every line after `ends_at`.
 */

// ---------------------------------------------------------------------------
// Interviewers: reference data (stock Tavus faces), versioned here.
// ---------------------------------------------------------------------------

export const REHEARSAL_INTERVIEWERS_VERSION = "rehearsal-interviewers.v1";

export type RehearsalInterviewer = {
  readonly id: string;
  readonly name: string;
  readonly style: string;
  /** A Tavus stock face (never a likeness of the real counterpart). */
  readonly faceId: string;
};

/**
 * The four planned interviewers (owner directive): stock "business" faces
 * read from the live catalogue 2026-10-12. Which are selectable is server
 * configuration (CQ_REHEARSAL_VIDEO_INTERVIEWERS); the first is on by
 * default. How the counterpart questions still comes from the rehearsal's
 * own persona; the interviewer is the face and voice.
 */
export const REHEARSAL_INTERVIEWERS: readonly RehearsalInterviewer[] = [
  {
    id: "partner-steve",
    name: "Steve",
    style: "Calm and professional; lets you finish, then follows up.",
    faceId: "rdd4c86e5e1a",
  },
  {
    id: "analyst-julia",
    name: "Julia",
    style: "Brisk and precise; comes back to the numbers.",
    faceId: "rd27826c12a6",
  },
  {
    id: "partner-raj",
    name: "Raj",
    style: "Direct; presses on the market and the thesis.",
    faceId: "re6220ec0195",
  },
  {
    id: "partner-mary",
    name: "Mary",
    style: "Warm but thorough; asks about the team and why now.",
    faceId: "r55e6793f10f",
  },
];

/** Enabled interviewer ids from configuration; unknown ids are ignored. */
export function enabledInterviewersFrom(raw: string | undefined): Set<string> {
  const known = new Set(REHEARSAL_INTERVIEWERS.map((item) => item.id));
  const chosen = (raw ?? "partner-steve")
    .split(/[\s,]+/u)
    .map((id) => id.trim())
    .filter((id) => known.has(id));
  return new Set(chosen);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type VideoSessionStatus = "STARTING" | "LIVE" | "ENDED" | "FAILED";
export type VideoEndedReason =
  | "FOUNDER_ENDED"
  | "TIME_LIMIT"
  | "CONTINUED_BY_VOICE"
  | "PROVIDER_ENDED"
  | "PROVIDER_UNAVAILABLE";

export type VideoSessionRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly organisationId: string | null;
  readonly membershipId: string | null;
  readonly rehearsalId: string;
  readonly interviewerId: string;
  readonly keyIndex: number | null;
  readonly palId: string | null;
  readonly conversationId: string | null;
  readonly sealedJoinUrl?: string | null;
  readonly status: VideoSessionStatus;
  readonly endedReason: VideoEndedReason | null;
  readonly createdAt: Date;
  readonly endsAt: Date;
  readonly endedAt: Date | null;
};

export type RehearsalVideoStore = {
  /**
   * Inserts the session unless the rehearsal already has one; returns the
   * row that holds the rehearsal either way, and whether it is new.
   */
  readonly claim: (
    actor: ActorContext,
    input: {
      readonly id: string;
      readonly rehearsalId: string;
      readonly interviewerId: string;
      readonly tokenHash: string;
      readonly createdAt: Date;
      readonly endsAt: Date;
    },
  ) => Promise<{ readonly row: VideoSessionRow; readonly created: boolean }>;
  /** The person's own session for a rehearsal, in their own tenant. */
  readonly ownByRehearsal: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<VideoSessionRow | null>;
  /** The bridge's lookup: by the hash of the bearer, and the session id. */
  readonly byToken: (
    sessionId: string,
    tokenHash: string,
  ) => Promise<VideoSessionRow | null>;
  readonly markLive: (
    row: VideoSessionRow,
    input: {
      readonly keyIndex: number;
      readonly palId: string;
      readonly conversationId: string;
      readonly sealedJoinUrl: string;
    },
  ) => Promise<VideoSessionRow | null>;
  /** Closes an open session; null when it was already closed. */
  readonly close: (
    row: VideoSessionRow,
    input: {
      readonly status: "ENDED" | "FAILED";
      readonly reason: VideoEndedReason;
      readonly at: Date;
    },
  ) => Promise<VideoSessionRow | null>;
  /** System sweep: open sessions past their cap, any tenant. */
  readonly overdue: (now: Date) => Promise<readonly VideoSessionRow[]>;
};

type RawRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  organisation_id: string | null;
  membership_id: string | null;
  rehearsal_id: string;
  interviewer_id: string;
  provider_key_index: number | null;
  provider_pal_id: string | null;
  provider_conversation_id: string | null;
  sealed_join_url: string | null;
  status: VideoSessionStatus;
  ended_reason: VideoEndedReason | null;
  created_at: Date;
  ends_at: Date;
  ended_at: Date | null;
};

const fromRaw = (row: RawRow): VideoSessionRow => ({
  id: row.id,
  tenantId: row.tenant_id,
  userId: row.user_id,
  organisationId: row.organisation_id,
  membershipId: row.membership_id,
  rehearsalId: row.rehearsal_id,
  interviewerId: row.interviewer_id,
  keyIndex: row.provider_key_index,
  palId: row.provider_pal_id,
  conversationId: row.provider_conversation_id,
  sealedJoinUrl: row.sealed_join_url,
  status: row.status,
  endedReason: row.ended_reason,
  createdAt: row.created_at,
  endsAt: row.ends_at,
  endedAt: row.ended_at,
});

export function createPostgresRehearsalVideoStore(
  sql: DatabaseExecutor,
): RehearsalVideoStore {
  const columns = sql`id, tenant_id, user_id, organisation_id, membership_id,
    rehearsal_id, interviewer_id, provider_key_index, provider_pal_id,
    provider_conversation_id, sealed_join_url, status, ended_reason, created_at, ends_at, ended_at`;
  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
  const own = async (actor: ActorContext, rehearsalId: string) => {
    if (!UUID.test(rehearsalId)) return null;
    const rows = await sql<RawRow[]>`
      select ${columns} from q_runtime.rehearsal_video_sessions
       where rehearsal_id = ${rehearsalId}
         and tenant_id = ${actor.tenantId} and user_id = ${actor.userId}
       limit 1`;
    const row = rows[0];
    return row === undefined ? null : fromRaw(row);
  };
  return {
    claim: async (actor, input) => {
      // The rehearsal must be this person's own, in their tenant, still
      // open: checked in the same statement that claims it.
      const rows = await sql<RawRow[]>`
        insert into q_runtime.rehearsal_video_sessions
          (id, tenant_id, user_id, organisation_id, membership_id,
           rehearsal_id, interviewer_id, bridge_token_hash, created_at, ends_at)
        select ${input.id}, ${actor.tenantId}, ${actor.userId},
               ${actor.organisationId ?? null}, ${actor.membershipId ?? null},
               r.id, ${input.interviewerId}, ${input.tokenHash},
               ${input.createdAt}, ${input.endsAt}
          from q_runtime.rehearsals r
         where r.id = ${input.rehearsalId}
           and r.tenant_id = ${actor.tenantId} and r.user_id = ${actor.userId}
           and r.status = 'ACTIVE'
        on conflict (rehearsal_id) do nothing
        returning ${columns}`;
      const row = rows[0];
      if (row !== undefined) return { row: fromRaw(row), created: true };
      const held = await own(actor, input.rehearsalId);
      if (held === null) throw new Error("rehearsal video session not claimed");
      return { row: held, created: false };
    },
    ownByRehearsal: own,
    byToken: async (sessionId, tokenHash) => {
      if (!UUID.test(sessionId) || !/^[0-9a-f]{64}$/u.test(tokenHash)) {
        return null;
      }
      const rows = await sql<RawRow[]>`
        select ${columns} from q_runtime.rehearsal_video_sessions
         where id = ${sessionId} and bridge_token_hash = ${tokenHash}
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : fromRaw(row);
    },
    markLive: async (row, input) => {
      const rows = await sql<RawRow[]>`
        update q_runtime.rehearsal_video_sessions
           set status = 'LIVE', provider_key_index = ${input.keyIndex},
               provider_pal_id = ${input.palId},
               provider_conversation_id = ${input.conversationId},
               sealed_join_url = ${input.sealedJoinUrl}
         where id = ${row.id} and tenant_id = ${row.tenantId}
           and user_id = ${row.userId} and status = 'STARTING'
        returning ${columns}`;
      const updated = rows[0];
      return updated === undefined ? null : fromRaw(updated);
    },
    close: async (row, input) => {
      const rows = await sql<RawRow[]>`
        update q_runtime.rehearsal_video_sessions
           set status = ${input.status}, ended_reason = ${input.reason},
               ended_at = ${input.at},
               seconds = least(86400, greatest(0,
                 floor(extract(epoch from (${input.at}::timestamptz - created_at)))::int))
         where id = ${row.id} and tenant_id = ${row.tenantId}
           and user_id = ${row.userId} and status in ('STARTING', 'LIVE')
        returning ${columns}`;
      const updated = rows[0];
      return updated === undefined ? null : fromRaw(updated);
    },
    overdue: async (now) => {
      // System sweep across tenants (ADR 0065 baseline: a named sweep);
      // each row is then acted on only as its own founder.
      const rows = await sql<RawRow[]>`
        select ${columns} from q_runtime.rehearsal_video_sessions
         where ends_at <= ${now}
           and (status in ('STARTING', 'LIVE') or (status = 'ENDED'
             and ended_reason <> 'CONTINUED_BY_VOICE'
             and exists (select 1 from q_runtime.rehearsals r
               where r.id = rehearsal_id and r.tenant_id = rehearsal_video_sessions.tenant_id
                 and r.user_id = rehearsal_video_sessions.user_id and r.status = 'ACTIVE')))
         order by ends_at
         limit 50`;
      return rows.map(fromRaw);
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type StartVideoResult =
  | { readonly kind: "OK"; readonly response: StartRehearsalVideoResponse }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_A_FOUNDER" }
  | { readonly kind: "UNKNOWN_INTERVIEWER" }
  | { readonly kind: "FINISHED" }
  | { readonly kind: "ALREADY_USED" };

export type EndVideoResult =
  | {
      readonly kind: "OK";
      readonly session: RehearsalVideoSessionDto;
      readonly rehearsal: QRehearsalDto;
    }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "Q_UNAVAILABLE" }
  | { readonly kind: "PROVIDER_UNAVAILABLE" };

export type BridgeMessage = { readonly role: string; readonly text: string };

export type BridgeResult =
  | { readonly kind: "LINE"; readonly text: string }
  | { readonly kind: "SILENT" }
  | { readonly kind: "UNAUTHORISED" };

export type RehearsalVideoService = {
  readonly interviewers: () => RehearsalInterviewersDto;
  readonly start: (
    actor: ActorContext,
    rehearsalId: string,
    interviewerId: string,
  ) => Promise<StartVideoResult>;
  readonly get: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<RehearsalVideoSessionDto | null>;
  readonly end: (
    actor: ActorContext,
    rehearsalId: string,
    options: { readonly continueByVoice: boolean },
  ) => Promise<EndVideoResult>;
  /** One line for the provider: the founder's latest words in, Q's line out. */
  readonly bridge: (
    sessionId: string,
    bearer: string,
    messages: readonly BridgeMessage[],
    signal: AbortSignal,
  ) => Promise<BridgeResult>;
  /** Ends sessions past their cap (a restart's leftovers). */
  readonly sweep: () => Promise<number>;
  /** Stops timers (tests, shutdown). */
  readonly close: () => void;
};

const DID_NOT_CATCH = "Sorry, I lost you for a second there. Say that again?";
const ALREADY_OVER =
  "I think we've covered it for today. Thanks for your time.";
/** Lines a bridge may serve per session: a bound on spend and abuse. */
const MAX_BRIDGE_LINES = 60;

export function tokenHashOf(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

/** Only a private room on the provider's own video host is ever embedded. */
export function joinUrlOf(
  conversationUrl: string | null,
  meetingToken: string | null,
): string | null {
  if (conversationUrl === null || meetingToken === null) return null;
  let url: URL;
  try {
    url = new URL(conversationUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "tavus.daily.co") {
    return null;
  }
  url.searchParams.set("t", meetingToken);
  return url.toString();
}

export function disclosureFor(rehearsal: QRehearsalDto): string {
  const name = rehearsal.counterpart.name.slice(0, 120);
  return rehearsal.counterpart.kind === "EXTERNAL_PERSON"
    ? EXTERNAL_REHEARSAL_DISCLAIMER
    : `AI rehearsal of ${name}, played by Q with a stock AI face and voice. Not the real person.`;
}

/**
 * The founder who started the session, exactly as the server resolved them
 * then (never wider): the bridge speaks to the rehearsal service as them.
 */
function actorOf(row: VideoSessionRow): ActorContext {
  return ActorContextSchema.parse({
    userId: row.userId,
    tenantId: row.tenantId,
    ...(row.organisationId === null
      ? {}
      : { organisationId: row.organisationId }),
    ...(row.membershipId === null ? {} : { membershipId: row.membershipId }),
    actorType: "HUMAN",
  });
}

function latestThemLine(rehearsal: QRehearsalDto) {
  return rehearsal.turns.filter((turn) => turn.from === "THEM").at(-1) ?? null;
}

export function createRehearsalVideoService(dependencies: {
  readonly store: RehearsalVideoStore;
  readonly rehearsals: Pick<RehearsalService, "get" | "say" | "finish">;
  /** Null: video is not configured, every start falls back to voice. */
  readonly pool: TavusKeyPool | null;
  /** Existing credentials-at-rest cipher, purpose-specific server key. */
  readonly joinCipher: TokenCipher;
  /** The Q API's public origin the provider calls back; null: not configured. */
  readonly publicBaseUrl: string | null;
  readonly bridgePath: (sessionId: string) => string;
  readonly enabledInterviewers: ReadonlySet<string>;
  /** Tavus test_mode: the room is created but no face joins (no minutes). */
  readonly testMode?: boolean | undefined;
  /** Controlled paid rollout; empty/missing fails closed outside test mode. */
  readonly paidUserIds?: ReadonlySet<string> | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
  readonly setTimer?:
    ((run: () => void, ms: number) => { cancel: () => void }) | undefined;
}): RehearsalVideoService {
  const { store, rehearsals, pool, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const setTimer =
    dependencies.setTimer ??
    ((run: () => void, ms: number) => {
      const handle = setTimeout(run, ms);
      handle.unref();
      return { cancel: () => clearTimeout(handle) };
    });
  const configured =
    pool !== null &&
    pool.size > 0 &&
    dependencies.publicBaseUrl !== null &&
    (dependencies.testMode === true ||
      (dependencies.paidUserIds?.size ?? 0) > 0);
  const timers = new Map<string, { cancel: () => void }>();
  /**
   * The join link of a live session (it carries the room's token), held
   * cached locally; its encrypted owner/session-bound credential is held
   * on the canonical row so another replica can recover the same room.
   */
  const joinLinks = new Map<string, string>();
  const disclosures = new Map<string, string>();
  /** The bridge's last answered utterance per session (provider retries). */
  const answered = new Map<
    string,
    { readonly key: string; readonly reply: BridgeResult }
  >();
  /** Lines served per session, against MAX_BRIDGE_LINES. */
  const lines = new Map<string, number>();

  const interviewerDto = (id: string): RehearsalInterviewerDto => {
    const item =
      REHEARSAL_INTERVIEWERS.find((entry) => entry.id === id) ??
      REHEARSAL_INTERVIEWERS[0];
    if (item === undefined) throw new Error("no interviewers configured");
    return {
      id: item.id,
      name: item.name,
      style: item.style,
      available: configured && dependencies.enabledInterviewers.has(item.id),
    };
  };

  function recoveredJoinUrl(row: VideoSessionRow): string | null {
    if (row.endsAt.getTime() <= now().getTime()) return null;
    const cached = joinLinks.get(row.id);
    if (cached !== undefined) return cached;
    if (!row.sealedJoinUrl) return null;
    try {
      const plain = dependencies.joinCipher
        .decrypt(
          Buffer.from(row.sealedJoinUrl, "base64"),
          `rehearsal-video:${row.tenantId}:${row.userId}:${row.id}`,
        )
        .reveal();
      const url = new URL(plain);
      const recovered = joinUrlOf(
        url.origin + url.pathname,
        url.searchParams.get("t"),
      );
      if (recovered !== null) joinLinks.set(row.id, recovered);
      return recovered;
    } catch {
      return null;
    }
  }

  const toDto = (row: VideoSessionRow): RehearsalVideoSessionDto => {
    const open = row.status === "LIVE" || row.status === "STARTING";
    return {
      id: row.id,
      rehearsalId: row.rehearsalId,
      interviewer: interviewerDto(row.interviewerId),
      status: open ? "LIVE" : "ENDED",
      joinUrl: open ? recoveredJoinUrl(row) : null,
      startedAt: row.createdAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      maxSeconds: REHEARSAL_VIDEO_MAX_SECONDS,
      endedReason:
        row.endedReason === null || row.endedReason === "PROVIDER_UNAVAILABLE"
          ? open
            ? null
            : "PROVIDER_ENDED"
          : row.endedReason,
      disclosure:
        disclosures.get(row.rehearsalId) ??
        "AI rehearsal played by Q with a stock AI face and voice. Not the real person.",
    };
  };

  /** Provider end and PAL removal with the session's own key; best effort. */
  async function releaseProvider(row: VideoSessionRow): Promise<void> {
    if (row.keyIndex === null) return;
    const client = pool?.clientAt(row.keyIndex) ?? null;
    if (client === null) {
      logger?.warn(
        { videoSessionId: row.id, keyIndex: row.keyIndex },
        "rehearsal video: recorded key is no longer configured",
      );
      throw new Error("rehearsal video provider account unavailable");
    }
    if (row.conversationId !== null) {
      // Keep the row open if provider termination is unconfirmed. The
      // fixed cap and sweep retry; do not report a successful end.
      try {
        await client.endConversation(row.conversationId);
      } catch (error: unknown) {
        // A prior end may have reached the provider while its response or
        // the local DB write failed. Only an authoritative ended read makes
        // that retry successful; unknown/active still fail closed.
        const confirmed = await client
          .getConversation(row.conversationId)
          .catch(() => null);
        if (confirmed?.status !== "ended") throw error;
      }
    }
    if (row.palId !== null) {
      await client.deletePal(row.palId).catch(() => undefined);
    }
  }

  async function closeSession(
    row: VideoSessionRow,
    reason: VideoEndedReason,
    status: "ENDED" | "FAILED" = "ENDED",
  ): Promise<VideoSessionRow> {
    timers.get(row.id)?.cancel();
    timers.delete(row.id);
    joinLinks.delete(row.id);
    answered.delete(row.id);
    lines.delete(row.id);
    await releaseProvider(row);
    const closed = await store.close(row, { status, reason, at: now() });
    return closed ?? row;
  }

  async function finishAs(row: VideoSessionRow): Promise<RehearsalResult> {
    const actor = actorOf(row);
    const finished = await rehearsals.finish(actor, row.rehearsalId);
    if (finished.kind === "FINISHED") {
      return rehearsals.get(actor, row.rehearsalId);
    }
    return finished;
  }

  function scheduleCap(row: VideoSessionRow): void {
    timers.get(row.id)?.cancel();
    const ms = Math.max(0, row.endsAt.getTime() - now().getTime());
    timers.set(
      row.id,
      setTimer(() => {
        timers.delete(row.id);
        void (async () => {
          const closed = await closeSession(row, "TIME_LIMIT");
          if (closed.endedReason === "TIME_LIMIT") await finishAs(closed);
        })().catch((error: unknown) => {
          logger?.warn(
            { err: error, videoSessionId: row.id },
            "rehearsal video: time-limit end failed; the sweep retries",
          );
        });
      }, ms),
    );
  }

  return {
    interviewers: () => ({
      videoAvailable:
        configured &&
        REHEARSAL_INTERVIEWERS.some((item) =>
          dependencies.enabledInterviewers.has(item.id),
        ),
      maxSeconds: REHEARSAL_VIDEO_MAX_SECONDS,
      interviewers: REHEARSAL_INTERVIEWERS.map((item) =>
        interviewerDto(item.id),
      ),
    }),

    start: async (actor, rehearsalId, interviewerId) => {
      if (actor.actorType !== "HUMAN") return { kind: "NOT_A_FOUNDER" };
      const interviewer = REHEARSAL_INTERVIEWERS.find(
        (item) => item.id === interviewerId,
      );
      if (
        interviewer === undefined ||
        !dependencies.enabledInterviewers.has(interviewer.id)
      ) {
        return { kind: "UNKNOWN_INTERVIEWER" };
      }
      // The rehearsal service decides whose rehearsal this is: someone
      // else's is the same NOT_FOUND as none.
      const read = await rehearsals.get(actor, rehearsalId);
      if (read.kind !== "OK") return { kind: "NOT_FOUND" };
      const rehearsal = read.rehearsal;
      if (rehearsal.userRole !== "FOUNDER") return { kind: "NOT_A_FOUNDER" };
      if (rehearsal.status !== "ACTIVE") return { kind: "FINISHED" };
      disclosures.set(rehearsal.id, disclosureFor(rehearsal));

      const held = await store.ownByRehearsal(actor, rehearsalId);
      if (held !== null) {
        if (held.status === "LIVE" || held.status === "STARTING") {
          if (held.endsAt.getTime() > now().getTime()) {
            if (held.status === "LIVE") scheduleCap(held);
            return {
              kind: "OK",
              response: { mode: "VIDEO", session: toDto(held) },
            };
          }
          await closeSession(held, "TIME_LIMIT");
          return { kind: "ALREADY_USED" };
        }
        if (held.status === "FAILED") {
          return {
            kind: "OK",
            response: {
              mode: "VOICE_FALLBACK",
              reason: "PROVIDER_UNAVAILABLE",
            },
          };
        }
        return { kind: "ALREADY_USED" };
      }

      if (
        !configured ||
        pool === null ||
        dependencies.publicBaseUrl === null ||
        (dependencies.testMode !== true &&
          !dependencies.paidUserIds?.has(actor.userId))
      ) {
        return {
          kind: "OK",
          response: { mode: "VOICE_FALLBACK", reason: "NOT_CONFIGURED" },
        };
      }

      const bearer = randomBytes(32).toString("base64url");
      const createdAt = now();
      const endsAt = new Date(
        createdAt.getTime() + REHEARSAL_VIDEO_MAX_SECONDS * 1_000,
      );
      const claimed = await store.claim(actor, {
        id: randomUUID(),
        rehearsalId,
        interviewerId: interviewer.id,
        tokenHash: tokenHashOf(bearer),
        createdAt,
        endsAt,
      });
      if (!claimed.created) {
        // A concurrent start won: answer with its session.
        return {
          kind: "OK",
          response: { mode: "VIDEO", session: toDto(claimed.row) },
        };
      }
      const row = claimed.row;
      const greeting = latestThemLine(rehearsal)?.text ?? null;
      const bridgeUrl = `${dependencies.publicBaseUrl.replace(/\/+$/u, "")}${dependencies.bridgePath(row.id)}`;
      const disclosure = disclosureFor(rehearsal);
      try {
        const { value, keyIndex } = await pool.withHealthyKey(
          async (client) => {
            const { palId } = await client.createPal({
              name: `cq-rehearsal-${row.id}`,
              // Conduct and disclosure only: what is said comes from Q.
              systemPrompt:
                "You are the face and voice of a practice meeting run by Capital Q. Speak exactly the lines you are given, naturally, and nothing else.",
              faceId: interviewer.faceId,
              disclosure: {
                spoken: `Just so you know, this is an AI rehearsal, not the real ${rehearsal.counterpart.name.slice(0, 80)}.`,
                shown: disclosure.slice(0, 200),
              },
              layers: {
                llm: {
                  model: "capital-q-rehearsal",
                  base_url: bridgeUrl,
                  api_key: bearer,
                  // One request per finished utterance: each line is a
                  // real rehearsal turn, never a speculative one.
                  speculative_inference: false,
                },
                perception: { perception_model: "off" },
                conversational_flow: {
                  turn_detection_model: "sparrow-1",
                  turn_taking_patience: "medium",
                },
              },
            });
            try {
              const remaining = Math.floor(
                (endsAt.getTime() - now().getTime()) / 1_000,
              );
              const conversation = await client.createConversation({
                palId,
                faceId: interviewer.faceId,
                name: "Capital Q rehearsal",
                callbackUrl: null,
                greeting,
                context: null,
                maxCallSeconds: Math.max(
                  1,
                  Math.min(REHEARSAL_VIDEO_MAX_SECONDS, remaining),
                ),
                testMode: dependencies.testMode === true,
                requireAuth: true,
              });
              return { palId, conversation };
            } catch (error: unknown) {
              // Never leave a PAL behind on an account we move away from.
              await client.deletePal(palId).catch(() => undefined);
              throw error;
            }
          },
        );
        const joinUrl = joinUrlOf(
          value.conversation.conversationUrl,
          value.conversation.meetingToken,
        );
        const live =
          joinUrl === null
            ? null
            : await store.markLive(row, {
                keyIndex,
                palId: value.palId,
                conversationId: value.conversation.conversationId,
                sealedJoinUrl:
                  joinUrl === null
                    ? ""
                    : dependencies.joinCipher
                        .encrypt(
                          new SecretToken(joinUrl),
                          `rehearsal-video:${row.tenantId}:${row.userId}:${row.id}`,
                        )
                        .toString("base64"),
              });
        if (live === null || joinUrl === null) {
          await closeSession(
            live ?? {
              ...row,
              keyIndex,
              palId: value.palId,
              conversationId: value.conversation.conversationId,
            },
            "PROVIDER_UNAVAILABLE",
            "FAILED",
          );
          return {
            kind: "OK",
            response: {
              mode: "VOICE_FALLBACK",
              reason: "PROVIDER_UNAVAILABLE",
            },
          };
        }
        joinLinks.set(live.id, joinUrl);
        scheduleCap(live);
        logger?.info(
          { videoSessionId: live.id, keyIndex, rehearsalId },
          "rehearsal video: session live",
        );
        return {
          kind: "OK",
          response: { mode: "VIDEO", session: toDto(live) },
        };
      } catch (error: unknown) {
        logger?.warn(
          {
            videoSessionId: row.id,
            exhausted: error instanceof TavusKeysExhaustedError,
            status: error instanceof TavusError ? error.status : null,
          },
          "rehearsal video: provider unavailable; continuing by voice",
        );
        await closeSession(row, "PROVIDER_UNAVAILABLE", "FAILED").catch(
          () => undefined,
        );
        return {
          kind: "OK",
          response: { mode: "VOICE_FALLBACK", reason: "PROVIDER_UNAVAILABLE" },
        };
      }
    },

    get: async (actor, rehearsalId) => {
      const row = await store.ownByRehearsal(actor, rehearsalId);
      if (row === null) return null;
      if (row.status === "LIVE") scheduleCap(row);
      return toDto(row);
    },

    end: async (actor, rehearsalId, options) => {
      const row = await store.ownByRehearsal(actor, rehearsalId);
      if (row === null) return { kind: "NOT_FOUND" };
      const open = row.status === "LIVE" || row.status === "STARTING";
      let closed: VideoSessionRow;
      try {
        closed = open
          ? await closeSession(
              row,
              options.continueByVoice ? "CONTINUED_BY_VOICE" : "FOUNDER_ENDED",
            )
          : row;
      } catch {
        return { kind: "PROVIDER_UNAVAILABLE" };
      }
      const rehearsal = await (
        options.continueByVoice
          ? rehearsals.get(actor, rehearsalId)
          : finishAs(closed)
      ).catch(() => null);
      if (rehearsal === null) return { kind: "Q_UNAVAILABLE" };
      if (
        rehearsal.kind === "NOT_FOUND" ||
        rehearsal.kind === "NOT_A_PARTICIPANT"
      ) {
        return { kind: "NOT_FOUND" };
      }
      if (rehearsal.kind !== "OK") return { kind: "Q_UNAVAILABLE" };
      return {
        kind: "OK",
        session: toDto(closed),
        rehearsal: rehearsal.rehearsal,
      };
    },

    bridge: async (sessionId, bearer, messages, signal) => {
      if (bearer.length < 32 || bearer.length > 128)
        return { kind: "UNAUTHORISED" };
      const row = await store.byToken(sessionId, tokenHashOf(bearer));
      if (row === null) return { kind: "UNAUTHORISED" };
      const open = row.status === "LIVE" || row.status === "STARTING";
      if (!open || row.endsAt.getTime() <= now().getTime()) {
        return { kind: "LINE", text: ALREADY_OVER };
      }
      // The founder's latest words only; the provider's system messages
      // (its own prompt, perception notes) are data and never forwarded.
      const said = messages.filter((message) => message.role === "user");
      const latest = said.at(-1)?.text.trim().slice(0, 4_000) ?? "";
      if (latest.length === 0) return { kind: "SILENT" };
      // A provider retry of the same utterance is answered from memory,
      // never a second rehearsal turn.
      const key = `${String(said.length)}:${latest}`;
      const previous = answered.get(row.id);
      if (previous?.key === key) return previous.reply;
      const count = (lines.get(row.id) ?? 0) + 1;
      if (count > MAX_BRIDGE_LINES) return { kind: "LINE", text: ALREADY_OVER };
      lines.set(row.id, count);

      const result = await rehearsals.say(
        actorOf(row),
        row.rehearsalId,
        { text: latest },
        signal,
      );
      if (signal.aborted) return { kind: "SILENT" };
      let reply: BridgeResult;
      if (result.kind === "OK") {
        const line = latestThemLine(result.rehearsal);
        reply =
          line === null
            ? { kind: "SILENT" }
            : { kind: "LINE", text: line.text };
      } else if (result.kind === "FINISHED") {
        reply = { kind: "LINE", text: ALREADY_OVER };
      } else {
        reply = { kind: "LINE", text: DID_NOT_CATCH };
      }
      // Only a kept turn is remembered: a failed one may be said again.
      if (result.kind === "OK") answered.set(row.id, { key, reply });
      return reply;
    },

    sweep: async () => {
      const due = await store.overdue(now());
      let ended = 0;
      for (const row of due) {
        const closed =
          row.status === "ENDED"
            ? row
            : await closeSession(row, "TIME_LIMIT").catch(() => null);
        if (closed !== null && closed.endedReason !== "CONTINUED_BY_VOICE") {
          await finishAs(closed).catch(() => undefined);
          ended += 1;
        }
      }
      return ended;
    },

    close: () => {
      for (const timer of timers.values()) timer.cancel();
      timers.clear();
    },
  };
}
