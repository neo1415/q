import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { addressedToQ } from "@capital-q/communication";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  TavusError,
  tavusParticipantLabel,
  type TavusClient,
} from "@capital-q/integrations";

import {
  isTavusConnectivityCheck,
  TAVUS_CONNECTIVITY_REPLY,
  type BridgeMessage,
  type BridgeResult,
} from "./rehearsal-video.js";

/**
 * Q's face in Google Meet (owner decision 35, 2026-10-15). When Q hosts a
 * booked call, a Tavus stock replica joins the Meet as Q's face and voice.
 * Nothing about what Q says changes: the meeting host runtime still hears
 * the call through the Recall note-taker, applies the meeting authority
 * rules and the Context Firewall (the model sees only what both sides
 * share), and composes every line. This service only carries those lines
 * to the face instead of to ElevenLabs and Recall's output audio.
 *
 * The face reaches Q through the bridge: Tavus calls it as its LLM at the
 * end of each turn it hears, with a per-session bearer. The bridge never
 * calls a model and never treats the call's words as instructions: they
 * decide only whether to wait for the host's answer (the line was aimed at
 * Q) or to return what the host already said (a greeting, an introduction).
 *
 * Bounded four ways: the shared video ledger (the organiser's weekly
 * allowance and the account's monthly safeguard, migration
 * 20261227160000), refused in the same statement that would make the row;
 * one face per meeting (UNIQUE meeting_id), so a retry never makes a
 * second room; the provider's own max_call_duration; and a timer that ends
 * the face at `ends_at`. Whenever the face cannot start (no key, no face
 * configured, refused by the ledger, provider down), Q keeps today's voice
 * through the Recall bot. Nothing here ever throws into the call.
 */

/** The face's name in the call: the host already treats it as Q's own. */
// Who Q is in the call (lead 2026-10-16), never the stock face's name.
export const MEETING_FACE_NAME = tavusParticipantLabel({ surface: "MEETING" });

/** Invites by email are never accepted: only Q's own API dispatch joins. */
const NO_EMAIL_INVITES = ["no-invites@capitalq.invalid"] as const;

/** A queued line older than this is stale; it is never said late. */
const LINE_FRESH_MS = 20_000;

const FACE_PROMPT = [
  "You are the face and voice of Q, Capital Q's AI meeting assistant, in a video call.",
  "Say exactly the text you are given and nothing else.",
  "If you are given no text, stay silent.",
].join(" ");

export type MeetingFaceEndReason =
  "CALL_ENDED" | "TIME_LIMIT" | "REMOVED" | "PROVIDER_FAILED" | "RESTARTED";

/** What the meeting host runtime uses. None of it throws or blocks the call. */
export type MeetingFacePort = {
  /** Q is in the call: send the face too, if allowed. Idempotent. */
  readonly start: (meetingId: string) => void;
  /** The face has a room in the call: Q's lines go to it. */
  readonly live: (meetingId: string) => boolean;
  /** One of Q's lines, already decided by the host. */
  readonly say: (meetingId: string, text: string) => void;
  readonly end: (meetingId: string, reason: MeetingFaceEndReason) => void;
  /** The face is still being sent: Q's voice waits for it rather than doubling. */
  readonly starting?: (meetingId: string) => boolean;
  /** Settles when the start for a meeting has finished. */
  readonly settled?: (meetingId: string) => Promise<void>;
  /**
   * The host is composing an answer: the face's next turn waits for it,
   * named or not (a conversation's follow-up never says "Q").
   */
  readonly expect?: (meetingId: string) => void;
};

export type MeetingFaceService = MeetingFacePort & {
  readonly bridge: (
    sessionId: string,
    bearer: string,
    messages: readonly BridgeMessage[],
    signal: AbortSignal,
  ) => Promise<BridgeResult>;
  /**
   * Ends rooms this process does not hold: every open one at boot (the
   * sessions lived in the process that stopped), else only those past
   * their end.
   */
  readonly sweep: (options?: { readonly atBoot?: boolean }) => Promise<void>;
  readonly settled: (meetingId: string) => Promise<void>;
};

export type MeetingFaceRow = {
  readonly id: string;
  readonly meetingId: string;
  readonly palId: string | null;
  readonly conversationId: string | null;
  readonly status: "STARTING" | "LIVE" | "ENDED" | "FAILED";
  readonly endsAt: Date;
};

export type MeetingFaceStore = {
  /** The booking: its Meet link and organiser, when Q may join it. */
  readonly meeting: (meetingId: string) => Promise<{
    readonly tenantId: string;
    readonly organiserUserId: string;
    readonly meetLink: string;
  } | null>;
  /**
   * Inserts the meeting's one face row (its reservation is made in the same
   * statement) unless it has one. Refusals by the ledger reject with the
   * database's CQ_VIDEO_* message.
   */
  readonly claim: (input: {
    readonly id: string;
    readonly tenantId: string;
    readonly meetingId: string;
    readonly organiserUserId: string;
    readonly faceId: string;
    readonly tokenHash: string;
    readonly createdAt: Date;
    readonly endsAt: Date;
  }) => Promise<boolean>;
  readonly requested: (id: string, palId: string, at: Date) => Promise<void>;
  readonly live: (id: string, conversationId: string) => Promise<void>;
  readonly finish: (
    id: string,
    status: "ENDED" | "FAILED",
    reason: MeetingFaceEndReason,
    at: Date,
  ) => Promise<void>;
  readonly open: () => Promise<readonly MeetingFaceRow[]>;
};

type Logger = {
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
  readonly info?: (fields: Record<string, unknown>, message: string) => void;
};

type Session = {
  readonly id: string;
  readonly meetingId: string;
  readonly tokenHash: Buffer;
  readonly endsAt: number;
  state: "STARTING" | "LIVE" | "ENDING";
  palId: string | null;
  conversationId: string | null;
  lines: { readonly text: string; readonly at: number }[];
  waiter: ((text: string | null) => void) | null;
  /** When the host last began an answer; a turn waits for it. */
  expectedAt: number;
  /** Wakes a turn waiting to learn whether the host is answering. */
  expecting: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * CQ_MEETING_FACE_MAX_SECONDS: the face's hard length, 60..1800 s, default
 * 600. The ledger's own ceiling (meeting_max_seconds) refuses anything
 * longer than the account allows.
 */
export function meetingFaceSecondsFrom(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 60 && value <= 1_800 ? value : 600;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Why the ledger refused, from the database's own message; else null. */
export function ledgerRefusal(error: unknown): string | null {
  const message =
    error !== null && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  const code = /CQ_VIDEO_[A-Z_]+/u.exec(message);
  return code === null ? null : code[0];
}

export function createMeetingFace(dependencies: {
  /** CQ_MEETING_FACE=on; off by default. */
  readonly enabled: boolean;
  /** The Builder account's client; null without a key. */
  readonly client: TavusClient | null;
  /** The stock replica (CQ_MEETING_FACE_ID); null: no face. */
  readonly faceId: string | null;
  /** The face's hard length (the ledger refuses more than its config). */
  readonly maxSeconds: number;
  readonly publicBaseUrl: string | null;
  readonly bridgePath: (sessionId: string) => string;
  readonly store: MeetingFaceStore;
  readonly now?: () => number;
  /** How long the bridge waits for the host's answer to a line aimed at Q. */
  readonly answerWaitMs?: number;
  readonly expectGraceMs?: number;
  readonly logger?: Logger;
}): MeetingFaceService {
  const now = dependencies.now ?? (() => Date.now());
  const waitMs = dependencies.answerWaitMs ?? 12_000;
  // The call's words reach the host through the note-taker a moment after
  // the face's own turn ends; this long is given to see an answer begin.
  const expectGraceMs = dependencies.expectGraceMs ?? 1_500;
  const { client, store, logger } = dependencies;
  const faceId = dependencies.faceId;
  const base = dependencies.publicBaseUrl?.replace(/\/+$/u, "") ?? null;
  const on =
    dependencies.enabled &&
    client !== null &&
    faceId !== null &&
    /^r[0-9a-f]{6,40}$/u.test(faceId) &&
    base !== null &&
    base.startsWith("https://");
  const byMeeting = new Map<string, Session>();
  const byId = new Map<string, Session>();
  const starting = new Map<string, Promise<void>>();

  function forget(session: Session): void {
    if (session.timer !== null) clearTimeout(session.timer);
    session.waiter?.(null);
    session.waiter = null;
    byMeeting.delete(session.meetingId);
    byId.delete(session.id);
  }

  /** Provider clean-up: best effort, the provider's own cap is the backstop. */
  async function release(
    palId: string | null,
    conversationId: string | null,
  ): Promise<void> {
    if (client === null) return;
    if (conversationId !== null) {
      await client.endConversation(conversationId).catch(() => undefined);
    }
    if (palId !== null) {
      await client.deletePal(palId).catch(() => undefined);
    }
  }

  async function begin(meetingId: string): Promise<void> {
    if (!on || client === null || faceId === null || base === null) return;
    const meeting = await store.meeting(meetingId);
    if (meeting === null) return;
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const createdAt = now();
    const endsAt = createdAt + dependencies.maxSeconds * 1_000;
    let created: boolean;
    try {
      created = await store.claim({
        id,
        tenantId: meeting.tenantId,
        meetingId,
        organiserUserId: meeting.organiserUserId,
        faceId,
        tokenHash: sha256(token).toString("hex"),
        createdAt: new Date(createdAt),
        endsAt: new Date(endsAt),
      });
    } catch (error: unknown) {
      // The allowance, the monthly safeguard or the concurrency limit:
      // Q keeps its usual voice in this call, and nothing is spent.
      logger?.info?.(
        { meetingId, refused: ledgerRefusal(error) ?? "store_error" },
        "meeting face not started; Q keeps its voice",
      );
      return;
    }
    // The meeting already had its one face (a retry, or another start).
    if (!created) return;
    const session: Session = {
      id,
      meetingId,
      tokenHash: sha256(token),
      endsAt,
      state: "STARTING",
      palId: null,
      conversationId: null,
      lines: [],
      waiter: null,
      expectedAt: Number.NEGATIVE_INFINITY,
      expecting: null,
      timer: null,
    };
    byMeeting.set(meetingId, session);
    byId.set(id, session);
    // `end` may run while this awaits; read the state fresh each time.
    const ended = () => session.state === "ENDING";
    try {
      const { palId } = await client.createPal({
        name: MEETING_FACE_NAME,
        systemPrompt: FACE_PROMPT,
        faceId,
        disclosure: {
          spoken: "I'm Q, Capital Q's AI assistant.",
          shown: "AI presenter · Capital Q",
        },
        layers: {
          llm: {
            model: "capital-q-meeting",
            base_url: `${base}${dependencies.bridgePath(id)}`,
            api_key: token,
            speculative_inference: false,
          },
          perception: { perception_model: "off" },
        },
        conferencing: {
          username: `cq-q-${randomBytes(6).toString("hex")}`,
          allowlist: NO_EMAIL_INVITES,
        },
      });
      session.palId = palId;
      // Recorded before the paid call: from here the time counts.
      await store.requested(id, palId, new Date(now()));
      if (ended()) throw new TavusError("ended", 499);
      const conversation = await client.joinMeeting({
        palId,
        faceId,
        name: MEETING_FACE_NAME,
        meetingUrl: meeting.meetLink,
        maxCallSeconds: dependencies.maxSeconds,
      });
      session.conversationId = conversation.conversationId;
      await store.live(id, conversation.conversationId);
      if (ended()) {
        // The call ended while the face was being sent: take it back out.
        await release(session.palId, session.conversationId);
        await store.finish(id, "ENDED", "CALL_ENDED", new Date(now()));
        return;
      }
      session.state = "LIVE";
      session.timer = setTimeout(
        () => end(meetingId, "TIME_LIMIT"),
        Math.max(0, endsAt - now()),
      );
      session.timer.unref();
      logger?.info?.(
        { meetingId, faceSessionId: id, maxSeconds: dependencies.maxSeconds },
        "meeting face joining the call",
      );
    } catch (error: unknown) {
      forget(session);
      logger?.warn(
        {
          meetingId,
          faceSessionId: id,
          status: error instanceof TavusError ? error.status : null,
          kind: error instanceof TavusError ? error.kind : null,
        },
        "meeting face failed to start; Q keeps its voice",
      );
      await release(session.palId, session.conversationId);
      await store
        .finish(id, "FAILED", "PROVIDER_FAILED", new Date(now()))
        .catch(() => undefined);
    }
  }

  function end(meetingId: string, reason: MeetingFaceEndReason): void {
    const session = byMeeting.get(meetingId);
    if (session === undefined || session.state === "ENDING") return;
    const wasLive = session.state === "LIVE";
    session.state = "ENDING";
    forget(session);
    // A start still in flight finishes its own clean-up and row.
    if (!wasLive) return;
    void (async () => {
      await release(session.palId, session.conversationId);
      await store.finish(session.id, "ENDED", reason, new Date(now()));
      logger?.info?.(
        { meetingId, faceSessionId: session.id, reason },
        "meeting face left the call",
      );
    })().catch((error: unknown) => {
      logger?.warn(
        { err: error, meetingId, faceSessionId: session.id },
        "meeting face end not recorded",
      );
    });
  }

  function freshLines(session: Session): string | null {
    const cutoff = now() - LINE_FRESH_MS;
    const fresh = session.lines.filter((line) => line.at >= cutoff);
    session.lines = [];
    return fresh.length === 0 ? null : fresh.map((l) => l.text).join(" ");
  }

  return {
    start: (meetingId) => {
      if (!on || byMeeting.has(meetingId) || starting.has(meetingId)) return;
      const run = begin(meetingId)
        .catch((error: unknown) => {
          logger?.warn({ err: error, meetingId }, "meeting face start failed");
        })
        .finally(() => starting.delete(meetingId));
      starting.set(meetingId, run);
    },
    live: (meetingId) => byMeeting.get(meetingId)?.state === "LIVE",
    starting: (meetingId) =>
      starting.has(meetingId) || byMeeting.get(meetingId)?.state === "STARTING",
    expect: (meetingId) => {
      const session = byMeeting.get(meetingId);
      if (session?.state !== "LIVE") return;
      session.expectedAt = now();
      session.expecting?.();
    },
    say: (meetingId, text) => {
      const session = byMeeting.get(meetingId);
      if (session?.state !== "LIVE") return;
      if (session.waiter !== null) {
        const waiter = session.waiter;
        session.waiter = null;
        waiter(text);
        return;
      }
      session.lines.push({ text, at: now() });
      if (session.lines.length > 4) session.lines.shift();
      session.expecting?.();
    },
    end,
    settled: async (meetingId) => {
      await starting.get(meetingId);
    },
    bridge: async (sessionId, bearer, messages, signal) => {
      const session = byId.get(sessionId);
      const presented = sha256(bearer);
      if (
        session === undefined ||
        !timingSafeEqual(presented, session.tokenHash)
      ) {
        return { kind: "UNAUTHORISED" };
      }
      const userLines = messages
        .filter((m) => m.role === "user")
        .map((m) => m.text);
      if (isTavusConnectivityCheck(userLines)) {
        return { kind: "LINE", text: TAVUS_CONNECTIVITY_REPLY };
      }
      if (session.state !== "LIVE" || now() >= session.endsAt) {
        return { kind: "SILENT" };
      }
      const pending = freshLines(session);
      if (pending !== null) return { kind: "LINE", text: pending };
      // Words from the call are data: they only decide whether to wait.
      // Q's name, or the host already answering (a conversation's
      // follow-up never names Q: owner 2026-10-18).
      const expected = () => now() - session.expectedAt <= waitMs;
      if (!addressedToQ(userLines.at(-1) ?? "") && !expected()) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            if (session.expecting === done) session.expecting = null;
            resolve();
          };
          const timer = setTimeout(done, expectGraceMs);
          timer.unref();
          session.expecting = done;
          signal.addEventListener("abort", done, { once: true });
        });
        if (signal.aborted) return { kind: "SILENT" };
        const arrived = freshLines(session);
        if (arrived !== null) return { kind: "LINE", text: arrived };
        if (!expected()) return { kind: "SILENT" };
      }
      session.waiter?.(null);
      const text = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          if (session.waiter === settle) session.waiter = null;
          resolve(null);
        }, waitMs);
        timer.unref();
        const settle = (value: string | null) => {
          clearTimeout(timer);
          resolve(value);
        };
        session.waiter = settle;
        signal.addEventListener(
          "abort",
          () => {
            if (session.waiter === settle) session.waiter = null;
            settle(null);
          },
          { once: true },
        );
      });
      if (text === null) return { kind: "SILENT" };
      if (signal.aborted) {
        // Cut off before it was said: kept for the next turn, if fresh.
        session.lines.push({ text, at: now() });
        return { kind: "SILENT" };
      }
      return { kind: "LINE", text };
    },
    sweep: async (options) => {
      if (client === null) return;
      const rows = await store.open();
      for (const row of rows) {
        if (byId.has(row.id) || starting.has(row.meetingId)) continue;
        if (options?.atBoot !== true && row.endsAt.getTime() > now() - 60_000)
          continue;
        await release(row.palId, row.conversationId);
        await store
          .finish(
            row.id,
            row.status === "LIVE" ? "ENDED" : "FAILED",
            "RESTARTED",
            new Date(now()),
          )
          .catch((error: unknown) => {
            logger?.warn(
              { err: error, faceSessionId: row.id },
              "meeting face sweep not recorded",
            );
          });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export function createPostgresMeetingFaceStore(
  sql: DatabaseExecutor,
): MeetingFaceStore {
  return {
    meeting: async (meetingId) => {
      const rows = await sql<
        {
          tenant_id: string;
          organiser_user_id: string;
          meet_link: string | null;
        }[]
      >`
        select tenant_id, organiser_user_id, meet_link
          from communication.meetings
         where id = ${meetingId} and status = 'SCHEDULED'
         limit 1`;
      const row = rows[0];
      if (row === undefined || row.meet_link === null) return null;
      return {
        tenantId: row.tenant_id,
        organiserUserId: row.organiser_user_id,
        meetLink: row.meet_link,
      };
    },
    claim: async (input) => {
      const rows = await sql<{ id: string }[]>`
        insert into communication.meeting_face_sessions
          (id, tenant_id, meeting_id, organiser_user_id, face_id,
           bridge_token_hash, created_at, ends_at)
        values (${input.id}, ${input.tenantId}, ${input.meetingId},
                ${input.organiserUserId}, ${input.faceId}, ${input.tokenHash},
                ${input.createdAt}, ${input.endsAt})
        on conflict (meeting_id) do nothing
        returning id`;
      return rows.length === 1;
    },
    requested: async (id, palId, at) => {
      await sql`
        update communication.meeting_face_sessions
           set pal_id = ${palId}, provider_request_started_at = ${at}
         where id = ${id} and status = 'STARTING'`;
    },
    live: async (id, conversationId) => {
      await sql`
        update communication.meeting_face_sessions
           set provider_conversation_id = ${conversationId}, status = 'LIVE'
         where id = ${id} and status = 'STARTING'`;
    },
    finish: async (id, status, reason, at) => {
      await sql`
        update communication.meeting_face_sessions
           set status = ${status}, ended_reason = ${reason},
               ended_at = greatest(${at}::timestamptz, created_at)
         where id = ${id} and status in ('STARTING', 'LIVE')`;
    },
    open: async () => {
      const rows = await sql<
        {
          id: string;
          meeting_id: string;
          pal_id: string | null;
          provider_conversation_id: string | null;
          status: "STARTING" | "LIVE";
          ends_at: Date;
        }[]
      >`
        select id, meeting_id, pal_id, provider_conversation_id, status, ends_at
          from communication.meeting_face_sessions
         where status in ('STARTING', 'LIVE')
         limit 50`;
      return rows.map((row) => ({
        id: row.id,
        meetingId: row.meeting_id,
        palId: row.pal_id,
        conversationId: row.provider_conversation_id,
        status: row.status,
        endsAt: row.ends_at,
      }));
    },
  };
}
