import {
  isEnglish,
  languageChannels,
  languageInfo,
} from "@capital-q/q-core/language";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  EXTERNAL_REHEARSAL_DISCLAIMER,
  REHEARSAL_VIDEO_MAX_SECONDS,
  type QLanguagePreference,
  type QRehearsalDto,
  type RehearsalInterviewerDto,
  type RehearsalInterviewersDto,
  type RehearsalVideoSessionDto,
  type StartRehearsalVideoResponse,
  type VideoAllowanceDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  SecretToken,
  tavusParticipantLabel,
  type TokenCipher,
} from "@capital-q/integrations";
import type { Logger } from "@capital-q/observability";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import type { RehearsalResult, RehearsalService } from "./rehearsals.js";
import {
  TavusKeysExhaustedError,
  type TavusKeyPool,
} from "./tavus/key-pool.js";
import { TavusError, type TavusPalLayers } from "./tavus/client.js";

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
  /** The face's presented gender, so a persona voice matches the face. */
  readonly voice: "MALE" | "FEMALE";
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
    voice: "MALE",
  },
  {
    id: "analyst-julia",
    name: "Julia",
    style: "Brisk and precise; comes back to the numbers.",
    // 2026-10-23: rd27826c12a6 is not in Tavus's stock face model map
    // (Phoenix-3 or retired: no expression). "Julia - Casual" on Phoenix-4.
    faceId: "raf6459c9b82",
    voice: "FEMALE",
  },
  {
    id: "partner-raj",
    name: "Raj",
    style: "Direct; presses on the market and the thesis.",
    faceId: "re6220ec0195",
    voice: "MALE",
  },
  {
    id: "partner-mary",
    name: "Mary",
    style: "Warm but thorough; asks about the team and why now.",
    faceId: "r55e6793f10f",
    voice: "FEMALE",
  },
];

/**
 * The face's own conduct (owner 2026-10-23: a face with emotion). What is
 * said comes from Q; a Phoenix-4 face shows emotion shaped by the words
 * and this prompt. As the meeting face's rule, for a counterpart who can
 * also push back.
 */
export const REHEARSAL_FACE_PROMPT = [
  "You are the face and voice of a practice meeting run by Capital Q.",
  "Speak exactly the lines you are given, naturally, and nothing else.",
  "Let your face follow the words: warm when greeting or pleased, attentive while they answer, sceptical when you question a claim, impatient or stern when you press or push back, plainly pleased at a strong answer.",
  "Never exaggerate, and never show a feeling the words do not carry.",
].join(" ");

/** Presentation only: reuse the authorized Q persona, never infer a likeness. */
export function selectRehearsalInterviewer(
  rehearsal: Pick<QRehearsalDto, "persona" | "counterpart">,
  enabled: ReadonlySet<string>,
): RehearsalInterviewer | undefined {
  const style = rehearsal.persona.style.toLowerCase();
  const preferred = /\b(numbers|precise|analytical|metrics|brisk)\b/u.test(
    style,
  )
    ? "analyst-julia"
    : /\b(direct|challenging|sceptical|skeptical|thesis)\b/u.test(style)
      ? "partner-raj"
      : /\b(warm|supportive|team|empathetic)\b/u.test(style)
        ? "partner-mary"
        : "partner-steve";
  return (
    REHEARSAL_INTERVIEWERS.find(
      (item) => item.id === preferred && enabled.has(item.id),
    ) ?? REHEARSAL_INTERVIEWERS.find((item) => enabled.has(item.id))
  );
}

/** Enabled interviewer ids from configuration; unknown ids are ignored. */
export function enabledInterviewersFrom(raw: string | undefined): Set<string> {
  const known = new Set(REHEARSAL_INTERVIEWERS.map((item) => item.id));
  const chosen = (raw ?? "partner-steve")
    .split(/[\s,]+/u)
    .map((id) => id.trim())
    .filter((id) => known.has(id));
  return new Set(chosen);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Who may have a video Rehearsal (owner, 2026-10-15/16: Tavus for every
 * eligible account). Every account is admitted by default; what bounds the
 * spend is the database on every reservation (5 shared sessions a person a
 * week, 180 s each, the monthly safeguard, concurrency), plus the fresh
 * canonical membership check on every turn. The paid-user list no longer
 * decides eligibility; CQ_TAVUS_ALL_ACCOUNTS=false is the explicit switch
 * back to list-only admission (an incident brake, not the default).
 */
export function videoAdmissionFrom(env: {
  readonly CQ_TAVUS_ALL_ACCOUNTS?: string | undefined;
  readonly CQ_TAVUS_PAID_USER_IDS?: string | undefined;
}): { readonly allAccounts: boolean; readonly paidUserIds: Set<string> } {
  return {
    allAccounts: env.CQ_TAVUS_ALL_ACCOUNTS?.trim() !== "false",
    paidUserIds: new Set(
      (env.CQ_TAVUS_PAID_USER_IDS ?? "")
        .split(/[\s,]+/u)
        .filter((id) => UUID.test(id)),
    ),
  };
}

/**
 * The room's spoken disclosure where a hand-written line exists (trusted
 * product copy, by primary subtag); any other language hears the English
 * line. `{name}` is who Q plays.
 */
const REHEARSAL_DISCLOSURES: Readonly<Record<string, string>> = {
  ar: "للعلم، هذا تدريب بالذكاء الاصطناعي، وليس {name} الحقيقي.",
};

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
  readonly providerRequestStartedAt?: Date | null;
  readonly providerRequestResolvedAt?: Date | null;
  readonly status: VideoSessionStatus;
  readonly endedReason: VideoEndedReason | null;
  readonly createdAt: Date;
  readonly endsAt: Date;
  readonly endedAt: Date | null;
  /** The provider answered and the room is joinable. */
  readonly roomReadyAt?: Date | null;
  /** The interviewer is in the room and the 180 s are running. */
  readonly liveAt?: Date | null;
};

/** Seconds the interviewer has to join before the clock starts anyway. */
export const REHEARSAL_VIDEO_JOIN_GRACE_SECONDS = 30;

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
      /** SHA-256 of the secret in the provider's callback URL. */
      readonly eventsTokenHash: string;
      readonly createdAt: Date;
      readonly endsAt: Date;
    },
  ) => Promise<{ readonly row: VideoSessionRow; readonly created: boolean }>;
  /**
   * The person's shared weekly video allowance (GateQ + Rehearsals). The
   * database enforces it when a session row is inserted (migration
   * 20261226150000); this read is only for telling them what is left.
   */
  readonly allowance: (
    actor: ActorContext,
  ) => Promise<VideoAllowanceDto | null>;
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
  readonly markProviderRequest: (
    row: VideoSessionRow,
    input: {
      readonly keyIndex: number;
      readonly palId: string;
      readonly at: Date;
    },
  ) => Promise<VideoSessionRow | null>;
  readonly resolveProviderRequest: (
    row: VideoSessionRow,
    at: Date,
  ) => Promise<VideoSessionRow | null>;
  /**
   * The interviewer is in the room: 180 s from now (at most ready + grace),
   * once. Null when not live, already running, or past its end.
   */
  readonly markInRoom: (
    row: VideoSessionRow,
  ) => Promise<VideoSessionRow | null>;
  /** The provider callback's lookup: the session id and its secret's hash. */
  readonly byEventsToken: (
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
  provider_request_started_at: Date | null;
  provider_request_resolved_at: Date | null;
  status: VideoSessionStatus;
  ended_reason: VideoEndedReason | null;
  created_at: Date;
  ends_at: Date;
  ended_at: Date | null;
  room_ready_at: Date | null;
  live_at: Date | null;
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
  providerRequestStartedAt: row.provider_request_started_at,
  providerRequestResolvedAt: row.provider_request_resolved_at,
  status: row.status,
  endedReason: row.ended_reason,
  createdAt: row.created_at,
  endsAt: row.ends_at,
  endedAt: row.ended_at,
  roomReadyAt: row.room_ready_at,
  liveAt: row.live_at,
});

export function createPostgresRehearsalVideoStore(
  sql: DatabaseExecutor,
): RehearsalVideoStore {
  const columns = sql`id, tenant_id, user_id, organisation_id, membership_id,
    rehearsal_id, interviewer_id, provider_key_index, provider_pal_id,
    provider_conversation_id, sealed_join_url, provider_request_started_at, provider_request_resolved_at, status, ended_reason, created_at, ends_at, ended_at, room_ready_at, live_at`;
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
           rehearsal_id, interviewer_id, bridge_token_hash, events_token_hash, created_at, ends_at)
        select ${input.id}, ${actor.tenantId}, ${actor.userId},
               ${actor.organisationId ?? null}, ${actor.membershipId ?? null},
               r.id, ${input.interviewerId}, ${input.tokenHash}, ${input.eventsTokenHash},
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
    allowance: async (actor) => {
      const rows = await sql<
        { weekly_sessions: number; remaining: number; resets_at: Date }[]
      >`select weekly_sessions, remaining, resets_at
          from billing.video_allowance_status(${`user:${actor.userId}`})`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            weeklySessions: Number(row.weekly_sessions),
            remaining: Number(row.remaining),
            resetsAt: new Date(row.resets_at).toISOString(),
          };
    },
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
    markProviderRequest: async (row, input) => {
      const rows = await sql<RawRow[]>`
        update q_runtime.rehearsal_video_sessions set provider_key_index=${input.keyIndex},provider_pal_id=${input.palId},provider_request_started_at=${input.at}
        where id=${row.id} and tenant_id=${row.tenantId} and user_id=${row.userId} and status='STARTING' and provider_request_started_at is null and ends_at>${input.at}
        returning ${columns}`;
      return rows[0] === undefined ? null : fromRaw(rows[0]);
    },
    resolveProviderRequest: async (row, at) => {
      const rows = await sql<RawRow[]>`
        update q_runtime.rehearsal_video_sessions set provider_request_resolved_at=coalesce(provider_request_resolved_at,${at})
        where id=${row.id} and tenant_id=${row.tenantId} and user_id=${row.userId} and provider_request_started_at is not null returning ${columns}`;
      return rows[0] === undefined ? null : fromRaw(rows[0]);
    },
    markLive: async (row, input) => {
      // Joinable, clock not started: the provisional end is the hard stop,
      // ready + 30 s join grace + 180 s (migration 20261227150000).
      const rows = await sql<RawRow[]>`
        update q_runtime.rehearsal_video_sessions
           set status = 'LIVE', provider_key_index = ${input.keyIndex},
               provider_pal_id = ${input.palId},
               provider_conversation_id = ${input.conversationId},
               sealed_join_url = ${input.sealedJoinUrl},
               -- One instant for both: the guard accepts exactly this stop.
               room_ready_at = now(),
               ends_at = now() + interval '210 seconds'
         where id = ${row.id} and tenant_id = ${row.tenantId}
           and user_id = ${row.userId} and status = 'STARTING'
        returning ${columns}`;
      const updated = rows[0];
      return updated === undefined ? null : fromRaw(updated);
    },
    markInRoom: async (row) => {
      // The interviewer is in the room: 180 s from now, never later than
      // the grace allows, so the end only ever moves earlier. Once.
      const rows = await sql<RawRow[]>`
        update q_runtime.rehearsal_video_sessions
           set live_at = greatest(room_ready_at, least(now(), room_ready_at + interval '30 seconds')),
               ends_at = greatest(room_ready_at, least(now(), room_ready_at + interval '30 seconds'))
                         + interval '180 seconds'
         where id = ${row.id} and tenant_id = ${row.tenantId}
           and user_id = ${row.userId} and status = 'LIVE' and live_at is null
           and room_ready_at is not null and ends_at > now()
        returning ${columns}`;
      const updated = rows[0];
      return updated === undefined ? null : fromRaw(updated);
    },
    byEventsToken: async (sessionId, tokenHash) => {
      if (!UUID.test(sessionId) || !/^[0-9a-f]{64}$/u.test(tokenHash)) {
        return null;
      }
      const rows = await sql<RawRow[]>`
        select ${columns} from q_runtime.rehearsal_video_sessions
         where id = ${sessionId} and events_token_hash = ${tokenHash}
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : fromRaw(row);
    },
    close: async (row, input) => {
      const rows = await sql<RawRow[]>`
        update q_runtime.rehearsal_video_sessions
           set status = ${input.status}, ended_reason = ${input.reason},
               ended_at = ${input.at},
               -- What the provider can bill: from asking it for the room
               -- (never our own earlier setup), rounded up, never under.
               seconds = least(86400, greatest(0,
                 ceil(extract(epoch from (${input.at}::timestamptz
                   - coalesce(provider_request_started_at, created_at))))::int))
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
           and (status in ('STARTING', 'LIVE') or (provider_request_started_at is not null and provider_request_resolved_at is null) or (status = 'ENDED'
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
  readonly interviewers: (
    actor: ActorContext,
  ) => Promise<RehearsalInterviewersDto>;
  /** Canonical finish entry: confirms physical video close before review. */
  readonly finish: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<RehearsalResult | { readonly kind: "PROVIDER_UNAVAILABLE" }>;
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
  /**
   * One room event from the provider's callback. The secret proves the
   * session; only "the replica joined" means anything, and it can only
   * start the clock (the end moves earlier, never later).
   */
  readonly providerEvent: (input: {
    readonly sessionId: string;
    readonly token: string;
    readonly eventType: string;
    readonly conversationId: string | null;
  }) => Promise<"ACCEPTED" | "UNKNOWN_SESSION">;
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

/**
 * Tavus probes a custom LLM when a PAL is created by sending this one line
 * as the first user message and expecting a fixed answer. It is the
 * provider's own check, never something the person said: answering it
 * through the interview recorded it as a turn (production rehearsal,
 * 2026-10-13) and Q replied to it as an evasion. Only a lone first message
 * matches, so a person who repeats the sentence mid-call is heard as usual.
 */
export const TAVUS_CONNECTIVITY_REPLY =
  "Custom LLM configuration test successful.";

export function isTavusConnectivityCheck(
  userMessages: readonly string[],
): boolean {
  return (
    userMessages.length === 1 &&
    (userMessages[0] ?? "")
      .trim()
      .startsWith(
        "This is an automated connectivity check sent during custom LLM configuration.",
      )
  );
}

/** The interviewer's name on their tile in the room, e.g. "Steve, Fund One". */
/**
 * The name on Q's tile: who Q plays (lead 2026-10-16), never the stock
 * face's own name ("Steve"). The persona has no canonical person name yet,
 * so the counterpart Q plays is the label until it does.
 */
export function rehearsalParticipantName(
  counterpart: string,
  person?: string | null,
): string {
  return tavusParticipantLabel({ surface: "REHEARSAL", counterpart, person });
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
  /** Fresh canonical account/membership admission for every provider turn. */
  readonly stillAllowed: (actor: ActorContext) => Promise<boolean>;
  /** The Q API's public origin the provider calls back; null: not configured. */
  readonly publicBaseUrl: string | null;
  readonly bridgePath: (sessionId: string) => string;
  /** Where the provider reports room events for a session. */
  readonly eventsPath: (sessionId: string) => string;
  readonly enabledInterviewers: ReadonlySet<string>;
  /**
   * REHEARSE: the face speaks in the persona's ElevenLabs voice (Tavus TTS
   * layer) instead of the face's stock voice. Composed only behind
   * CQ_REHEARSAL_VIDEO_PERSONA_VOICE; absent keeps the stock voice. The
   * gender is the face's, so the voice matches what the founder sees.
   * UNVERIFIED LIVE: no paid room has run with it.
   */
  readonly ttsVoice?:
    | ((
        actor: ActorContext,
        rehearsalId: string,
        voice: "MALE" | "FEMALE",
      ) => Promise<NonNullable<TavusPalLayers["tts"]> | null>)
    | undefined;
  /**
   * Any language: the founder's chosen language for Q. The room runs in it
   * first when Tavus lists it (`languages`); the lines themselves come from
   * Q, already in their language.
   */
  readonly languageOf?:
    ((actor: ActorContext) => Promise<QLanguagePreference>) | undefined;
  /** Tavus test_mode: the room is created but no face joins (no minutes). */
  readonly testMode?: boolean | undefined;
  /** Canonical profile admission for test and paid rooms; empty fails closed. */
  readonly paidUserIds?: ReadonlySet<string> | undefined;
  /** Explicit wider funding authorization; durable DB allowance still applies. */
  readonly allAccounts?: boolean | undefined;
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
    (dependencies.allAccounts === true ||
      (dependencies.paidUserIds?.size ?? 0) > 0);
  const admittedAccount = (actor: ActorContext) =>
    dependencies.allAccounts === true ||
    dependencies.paidUserIds?.has(actor.userId) === true;
  const timers = new Map<string, { cancel: () => void }>();
  // Allocation IDs survive a failed LIVE write for compensating cleanup in
  // this process. They are not a durable allocation checkpoint across crashes.
  const allocations = new Map<string, VideoSessionRow>();
  // Serialize turns in this replica: overlapping retries see the completed
  // reply, and different turns cannot overwrite the same transcript snapshot.
  // This does not provide distributed or restart-safe idempotency.
  const bridgeTails = new Map<string, Promise<void>>();

  async function serialBridge(
    sessionId: string,
    run: () => Promise<BridgeResult>,
  ): Promise<BridgeResult> {
    const previous = bridgeTails.get(sessionId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridgeTails.set(sessionId, tail);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (bridgeTails.get(sessionId) === tail) bridgeTails.delete(sessionId);
    }
  }
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
      liveAt: row.liveAt?.toISOString() ?? null,
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
    if (
      row.conversationId === null &&
      row.providerRequestStartedAt != null &&
      row.providerRequestResolvedAt == null
    ) {
      if (row.palId === null)
        throw new Error("rehearsal video allocation is unconfirmed");
      const rooms = await client.findConversationsForPal(row.palId);
      // Absence cannot prove a timed-out create won't still complete.
      if (rooms.length === 0)
        throw new Error("rehearsal video allocation is unconfirmed");
      for (const room of rooms) {
        if (room.status !== "ended")
          await client.endConversation(room.conversationId);
        const confirmed = await client.getConversation(room.conversationId);
        if (confirmed?.status !== "ended")
          throw new Error("rehearsal video end is unconfirmed");
      }
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
    await releaseProvider(allocations.get(row.id) ?? row);
    const resolved = await store.resolveProviderRequest(row, now());
    const closed = await store.close(resolved ?? row, {
      status,
      reason,
      at: now(),
    });
    allocations.delete(row.id);
    return closed ?? resolved ?? row;
  }

  async function finishAs(row: VideoSessionRow): Promise<RehearsalResult> {
    const actor = actorOf(row);
    if (!(await dependencies.stillAllowed(actor).catch(() => false)))
      return { kind: "NOT_A_PARTICIPANT" };
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
          const compensating = allocations.has(row.id);
          const closed = await closeSession(
            row,
            compensating ? "PROVIDER_UNAVAILABLE" : "TIME_LIMIT",
            compensating ? "FAILED" : "ENDED",
          );
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

  /** Start the 180 s now if not started; reschedules the cap timer. */
  async function inRoom(row: VideoSessionRow): Promise<VideoSessionRow> {
    if (row.status !== "LIVE" || row.liveAt != null || row.roomReadyAt == null)
      return row;
    const started = await store.markInRoom(row);
    if (started === null) return row;
    scheduleCap(started);
    return started;
  }

  async function canRecover(actor: ActorContext, row: VideoSessionRow) {
    return (
      actor.actorType === "HUMAN" &&
      actor.userId === row.userId &&
      actor.tenantId === row.tenantId &&
      (actor.organisationId ?? null) === row.organisationId &&
      (actor.membershipId ?? null) === row.membershipId &&
      (await dependencies.stillAllowed(actorOf(row)).catch(() => false))
    );
  }

  async function endAs(
    actor: ActorContext,
    rehearsalId: string,
    options: { readonly continueByVoice: boolean },
  ): Promise<EndVideoResult> {
    const row = await store.ownByRehearsal(actor, rehearsalId);
    if (row === null || !(await canRecover(actor, row)))
      return { kind: "NOT_FOUND" };
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
  }

  return {
    interviewers: async (actor) => {
      const admitted =
        configured &&
        dependencies.testMode !== true &&
        actor.actorType === "HUMAN" &&
        admittedAccount(actor) &&
        (await dependencies.stillAllowed(actor).catch(() => false));
      // Wording and the offer only; a failed read never blocks the voice room.
      const allowance = admitted
        ? await store.allowance(actor).catch(() => null)
        : null;
      const offered =
        admitted && (allowance === null || allowance.remaining > 0);
      return {
        videoAvailable:
          offered &&
          REHEARSAL_INTERVIEWERS.some((item) =>
            dependencies.enabledInterviewers.has(item.id),
          ),
        maxSeconds: REHEARSAL_VIDEO_MAX_SECONDS,
        interviewers: REHEARSAL_INTERVIEWERS.map((item) => ({
          ...interviewerDto(item.id),
          available: offered && dependencies.enabledInterviewers.has(item.id),
        })),
        allowance,
      };
    },

    finish: async (actor, rehearsalId) => {
      const row = await store.ownByRehearsal(actor, rehearsalId);
      if (row === null) return rehearsals.finish(actor, rehearsalId);
      if (!(await canRecover(actor, row))) return { kind: "NOT_FOUND" };
      if (row.endedReason === "CONTINUED_BY_VOICE")
        return rehearsals.finish(actor, rehearsalId);
      const result = await endAs(actor, rehearsalId, {
        continueByVoice: false,
      });
      return result.kind === "OK"
        ? { kind: "OK", rehearsal: result.rehearsal }
        : result;
    },

    start: async (actor, rehearsalId, interviewerId) => {
      if (actor.actorType !== "HUMAN") return { kind: "NOT_A_FOUNDER" };
      const read = await rehearsals.get(actor, rehearsalId);
      if (read.kind !== "OK") return { kind: "NOT_FOUND" };
      const rehearsal = read.rehearsal;
      const interviewer =
        interviewerId === "q-selected"
          ? selectRehearsalInterviewer(
              rehearsal,
              dependencies.enabledInterviewers,
            )
          : REHEARSAL_INTERVIEWERS.find((item) => item.id === interviewerId);
      if (
        interviewer === undefined ||
        !dependencies.enabledInterviewers.has(interviewer.id)
      ) {
        return { kind: "UNKNOWN_INTERVIEWER" };
      }
      // The rehearsal service decides whose rehearsal this is: someone
      // else's is the same NOT_FOUND as none.
      if (rehearsal.status !== "ACTIVE") return { kind: "FINISHED" };
      if (!(await dependencies.stillAllowed(actor).catch(() => false)))
        return { kind: "NOT_FOUND" };
      disclosures.set(rehearsal.id, disclosureFor(rehearsal));

      const held = await store.ownByRehearsal(actor, rehearsalId);
      if (held !== null) {
        if (!(await canRecover(actor, held))) return { kind: "NOT_FOUND" };
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
        !admittedAccount(actor)
      ) {
        return {
          kind: "OK",
          response: { mode: "VOICE_FALLBACK", reason: "NOT_CONFIGURED" },
        };
      }

      // Any language: the room runs in the founder's chosen language when
      // Tavus lists it (q-core capability table), English understood; one
      // it does not list opens no face room at all (voice instead).
      const chosen = await (
        dependencies.languageOf?.(actor) ?? Promise.resolve("AUTO")
      ).catch(() => "AUTO");
      const roomLanguage =
        chosen === "AUTO" || isEnglish(chosen) ? null : chosen;
      const videoPlan =
        roomLanguage === null ? null : languageChannels(roomLanguage).video;
      if (roomLanguage !== null && videoPlan === null) {
        return {
          kind: "OK",
          response: { mode: "VOICE_FALLBACK", reason: "LANGUAGE_UNAVAILABLE" },
        };
      }
      const spokenDisclosure =
        roomLanguage === null
          ? undefined
          : REHEARSAL_DISCLOSURES[languageInfo(roomLanguage)?.primary ?? ""];
      const bearer = randomBytes(32).toString("base64url");
      const eventsToken = randomBytes(32).toString("base64url");
      const createdAt = now();
      const endsAt = new Date(
        createdAt.getTime() + REHEARSAL_VIDEO_MAX_SECONDS * 1_000,
      );
      let claimed: Awaited<ReturnType<RehearsalVideoStore["claim"]>>;
      try {
        claimed = await store.claim(actor, {
          id: randomUUID(),
          rehearsalId,
          interviewerId: interviewer.id,
          tokenHash: tokenHashOf(bearer),
          eventsTokenHash: tokenHashOf(eventsToken),
          createdAt,
          endsAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // The shared weekly allowance and the account's monthly safeguard
        // are enforced by the database on insert, like the lifetime cap.
        const reason =
          message === "CQ_VIDEO_ALLOWANCE_EXHAUSTED" ||
          message === "CQ_VIDEO_WEEKLY_ALLOWANCE_EXHAUSTED"
            ? ("ALLOWANCE_EXHAUSTED" as const)
            : message === "CQ_VIDEO_CONCURRENCY_LIMIT"
              ? ("CONCURRENCY_LIMIT" as const)
              : message === "CQ_VIDEO_GLOBAL_CAP"
                ? ("PROVIDER_UNAVAILABLE" as const)
                : null;
        if (reason === null) throw error;
        return {
          kind: "OK",
          response: { mode: "VOICE_FALLBACK", reason },
        };
      }
      if (!claimed.created) {
        // A concurrent start won: answer with its session.
        return {
          kind: "OK",
          response: { mode: "VIDEO", session: toDto(claimed.row) },
        };
      }
      const row = claimed.row;
      const greeting = latestThemLine(rehearsal)?.text ?? null;
      const publicBase = dependencies.publicBaseUrl.replace(/\/+$/u, "");
      const bridgeUrl = `${publicBase}${dependencies.bridgePath(row.id)}`;
      const eventsUrl = `${publicBase}${dependencies.eventsPath(row.id)}/${encodeURIComponent(eventsToken)}`;
      const disclosure = disclosureFor(rehearsal);
      // Read before the room is asked for; a failed read keeps the face's
      // own voice rather than holding the room.
      const tts =
        dependencies.ttsVoice === undefined
          ? null
          : await dependencies
              .ttsVoice(actor, rehearsal.id, interviewer.voice)
              .catch(() => null);
      try {
        const { value, keyIndex } = await pool.withHealthyKey(
          async (client, providerKeyIndex) => {
            const { palId } = await client.createPal({
              // The provider shows the PAL's name on Q's tile: who Q plays
              // ("Harbourline Cargo (Q rehearsal)"), never the face's name.
              name: rehearsalParticipantName(rehearsal.counterpart.name),
              // Conduct and disclosure only: what is said comes from Q.
              systemPrompt: REHEARSAL_FACE_PROMPT,
              faceId: interviewer.faceId,
              disclosure: {
                spoken: (
                  spokenDisclosure ??
                  "Just so you know, this is an AI rehearsal, not the real {name}."
                ).replace("{name}", rehearsal.counterpart.name.slice(0, 80)),
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
                ...(tts === null ? {} : { tts }),
                perception: { perception_model: "off" },
                conversational_flow: {
                  turn_detection_model: "sparrow-2",
                  turn_taking_patience: "medium",
                },
              },
            });
            let requested: VideoSessionRow | null = null;
            try {
              const remaining = Math.floor(
                (endsAt.getTime() - now().getTime()) / 1_000,
              );
              if (remaining < 1)
                throw new TavusError("conversation duration", 408);
              requested = await store.markProviderRequest(row, {
                keyIndex: providerKeyIndex,
                palId,
                at: now(),
              });
              if (requested === null)
                throw new Error("rehearsal video allocation checkpoint failed");
              allocations.set(row.id, requested);
              const conversation = await client.createConversation({
                palId,
                faceId: interviewer.faceId,
                // Traceable on the provider's side, not shown to the founder.
                name: `cq-rehearsal-${row.id}`,
                // Room events: the replica joining starts the founder's
                // 180 s (live run 22c3cc68: the face came 17 s after the
                // room). The secret is stored only as a hash and can only
                // start this session's clock within its grace.
                callbackUrl: eventsUrl,
                greeting,
                context: null,
                // The clock waits up to the join grace for the interviewer,
                // so the provider's own stop is cap + grace.
                maxCallSeconds: REHEARSAL_VIDEO_MAX_SECONDS,
                joinGraceSeconds: REHEARSAL_VIDEO_JOIN_GRACE_SECONDS,
                testMode: dependencies.testMode === true,
                requireAuth: true,
                // Their language first, English understood: people mix both.
                ...(videoPlan === null
                  ? {}
                  : { languages: [...videoPlan.languages] }),
              });
              return { palId, conversation };
            } catch (error: unknown) {
              const refused =
                error instanceof TavusError &&
                [400, 401, 402, 403, 404, 422, 429].includes(error.status);
              if (requested === null || refused) {
                if (requested !== null) {
                  const resolved = await store.resolveProviderRequest(
                    requested,
                    now(),
                  );
                  if (resolved !== null) allocations.set(row.id, resolved);
                }
                if (requested === null)
                  await client.deletePal(palId).catch(() => undefined);
              }
              throw error;
            }
          },
        );
        const allocated: VideoSessionRow = {
          ...(allocations.get(row.id) ?? row),
          keyIndex,
          palId: value.palId,
          conversationId: value.conversation.conversationId,
        };
        allocations.set(row.id, allocated);
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
        allocations.delete(live.id);
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
          async () => {
            // No private join URL has been issued: Q may continue by voice,
            // while the unresolved paid reservation remains occupied.
            const known = allocations.get(row.id);
            if (known?.conversationId != null) {
              scheduleCap(known);
              return;
            }
            const failed = await store.close(row, {
              status: "FAILED",
              reason: "PROVIDER_UNAVAILABLE",
              at: now(),
            });
            const allocated = failed ?? allocations.get(row.id);
            if (allocated !== undefined) {
              allocations.set(row.id, allocated);
              scheduleCap(allocated);
            }
          },
        );
        return {
          kind: "OK",
          response: { mode: "VOICE_FALLBACK", reason: "PROVIDER_UNAVAILABLE" },
        };
      }
    },

    get: async (actor, rehearsalId) => {
      const row = await store.ownByRehearsal(actor, rehearsalId);
      if (row === null || !(await canRecover(actor, row))) return null;
      // An unissued join can fall back on the same canonical rehearsal.
      // Uncertain paid reservations remain occupied independently of the
      // user-facing failure; known live calls retain confirmed-end recovery.
      if (row.status === "FAILED") return null;
      if (
        row.status === "STARTING" &&
        row.sealedJoinUrl == null &&
        now().getTime() - row.createdAt.getTime() >= 60_000
      ) {
        try {
          await closeSession(row, "PROVIDER_UNAVAILABLE", "FAILED");
        } catch {
          const failed = await store.close(row, {
            status: "FAILED",
            reason: "PROVIDER_UNAVAILABLE",
            at: now(),
          });
          if (failed !== null) {
            allocations.set(row.id, failed);
            scheduleCap(failed);
          }
        }
        return null;
      }
      if (row.status === "LIVE") scheduleCap(row);
      return toDto(row);
    },

    end: endAs,

    bridge: async (sessionId, bearer, messages, signal) =>
      serialBridge(sessionId, async () => {
        // Admission is checked after waiting, including identical retries.
        if (bearer.length < 32 || bearer.length > 128)
          return { kind: "UNAUTHORISED" };
        const row = await store.byToken(sessionId, tokenHashOf(bearer));
        if (
          row === null ||
          !(await dependencies.stillAllowed(actorOf(row)).catch(() => false))
        )
          return { kind: "UNAUTHORISED" };
        const open = row.status === "LIVE" || row.status === "STARTING";
        if (!open || row.endsAt.getTime() <= now().getTime()) {
          return { kind: "LINE", text: ALREADY_OVER };
        }
        // The provider asked for a line, so the interviewer is in the room:
        // the clock runs whether or not its joined event arrived first.
        const current = await inRoom(row).catch(() => row);
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
        if (count > MAX_BRIDGE_LINES)
          return { kind: "LINE", text: ALREADY_OVER };
        lines.set(row.id, count);

        if (signal.aborted) return { kind: "SILENT" };
        const started = performance.now();
        const remainingMs = current.endsAt.getTime() - now().getTime();
        const within = AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.max(1, remainingMs)),
        ]);
        const result = await rehearsals.say(
          actorOf(row),
          row.rehearsalId,
          { text: latest },
          within,
          { closingSoon: remainingMs <= 30_000 },
        );
        logger?.info(
          {
            qTurnMs: Math.round(performance.now() - started),
            remainingMs,
            resultKind: result.kind,
          },
          "rehearsal video: Q bridge timing",
        );
        if (within.aborted || current.endsAt.getTime() <= now().getTime())
          return { kind: "SILENT" };
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
      }),

    providerEvent: async (input) => {
      if (input.token.length < 32 || input.token.length > 128)
        return "UNKNOWN_SESSION";
      const row = await store.byEventsToken(
        input.sessionId,
        tokenHashOf(input.token),
      );
      if (row === null) return "UNKNOWN_SESSION";
      if (
        input.eventType === "system.replica_joined" &&
        (input.conversationId === null ||
          input.conversationId === row.conversationId)
      )
        await inRoom(row);
      return "ACCEPTED";
    },

    sweep: async () => {
      const due = await store.overdue(now());
      let ended = 0;
      for (const row of due) {
        const compensating = allocations.has(row.id);
        const closed =
          row.status === "ENDED"
            ? row
            : await closeSession(
                row,
                compensating ? "PROVIDER_UNAVAILABLE" : "TIME_LIMIT",
                compensating ? "FAILED" : "ENDED",
              ).catch(() => null);
        if (
          closed !== null &&
          closed.status !== "FAILED" &&
          closed.endedReason !== "CONTINUED_BY_VOICE"
        ) {
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
