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

// Tavus shapes the face's expression from what it says and this prompt
// (no emotion flag exists, docs 2026-10-21). The expression follows Q's
// words; it never performs a feeling the words do not carry.
const FACE_PROMPT = [
  "You are the face and voice of Q, the AI investment analyst inside Capital Q, in a video call.",
  "Say exactly the text you are given and nothing else.",
  "If you are given no text, stay silent.",
  "Let your face follow the words: warm when welcoming someone or thanking them, interested and attentive while someone is speaking or asking, calm and serious about risks, gaps or anything uncertain, plainly pleased when the words report good news.",
  "Never exaggerate, and never show a feeling the words do not carry.",
].join(" ");

/** Spoken by the provider before the greeting, every call. */
const FACE_DISCLOSURE = {
  spoken: "Hello, I'm Q, the AI investment analyst inside Capital Q.",
  shown: "AI presenter · Capital Q",
} as const;

const firstName = (name: string) => name.trim().split(/\s+/u)[0] ?? "";

/**
 * What the face says once it is in the call, after the disclosure (who Q
 * is): why it is here and for whom, from the booking both sides already
 * see. Code-written, no model; Q never claims more than the booking says.
 */
export function meetingFaceGreeting(booking: {
  readonly organiserName: string | null;
  readonly purpose: string | null;
}): string {
  const organiser = firstName(
    (booking.organiserName ?? "").replace(/[^\p{L}\p{M}' .-]/gu, ""),
  );
  const purpose = (booking.purpose ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/u, "");
  const who =
    organiser === ""
      ? "This call was booked on Capital Q, and I've been asked to join"
      : `${organiser} booked this call on Capital Q and asked me to join`;
  const about =
    purpose === "" || purpose.length > 120 ? "" : ` about ${purpose}`;
  return `${who}${about}. I'll keep notes for both sides and answer questions from what this call shares. Just say "Q" when you need me.`;
}

export type MeetingFaceEndReason =
  "CALL_ENDED" | "TIME_LIMIT" | "REMOVED" | "PROVIDER_FAILED" | "RESTARTED";

/** What the meeting host runtime uses. None of it throws or blocks the call. */
export type MeetingFacePort = {
  /** Q is in the call: send the face too, if allowed. Idempotent. */
  readonly start: (meetingId: string) => void;
  /** The face has a room in the call: Q's lines go to it. */
  readonly live: (meetingId: string) => boolean;
  /**
   * One of Q's lines, already decided by the host. `more` (2026-10-20): the
   * first sentence of an answer still being written; the face starts saying
   * it, and the rest follows in the same turn (`say` again, or `finish`).
   */
  readonly say: (meetingId: string, text: string, more?: boolean) => void;
  /** The answer whose first sentence was said with `more` has no more. */
  readonly finish?: (meetingId: string) => void;
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
  ) => Promise<MeetingBridgeResult>;
  /**
   * Ends rooms this process does not hold: every open one at boot (the
   * sessions lived in the process that stopped), else only those past
   * their end.
   */
  readonly sweep: (options?: { readonly atBoot?: boolean }) => Promise<void>;
  readonly settled: (meetingId: string) => Promise<void>;
  /**
   * CAMERA mode: the face's private room, for the note-taker's camera page
   * only, while the face is live; null otherwise.
   */
  readonly room: (meetingId: string) => MeetingFaceRoom | null;
};

export type MeetingFaceRoom = {
  readonly url: string;
  readonly token: string;
};

/**
 * MEET: the face joins Google Meet as its own participant (Tavus
 * `meeting_url`). CAMERA (owner decision 2026-10-21): the face lives in a
 * private Tavus room that the Recall note-taker shows as its camera, so
 * the call has one Q, under Capital Q's own signed-in name.
 */
export type MeetingFaceMode = "MEET" | "CAMERA";

export function meetingFaceModeFrom(raw: string | undefined): MeetingFaceMode {
  return raw?.trim().toLowerCase() === "camera" ? "CAMERA" : "MEET";
}

/** The face is sent this long before the call starts, not earlier. */
export const MEETING_FACE_LEAD_MS = 60_000;

/**
 * The bridge's answer to one of the face's turns. STREAM (2026-10-20): the
 * first sentence now, the rest of the same answer as it is decided.
 */
export type MeetingBridgeResult =
  | BridgeResult
  | {
      readonly kind: "STREAM";
      readonly first: string;
      readonly rest: AsyncIterable<string>;
    };

/** The longest the face's turn waits for the rest of a streamed answer. */
const STREAM_REST_WAIT_MS = 10_000;

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
    /** As the booking shows it to both sides; for the face's greeting. */
    readonly organiserName?: string | null;
    readonly purpose?: string | null;
    readonly startsAt?: Date | null;
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
  waiter: ((text: string | null, more: boolean) => void) | null;
  /** An answer being said in parts: what is left, and whether more comes. */
  stream: {
    readonly parts: string[];
    open: boolean;
    wake: (() => void) | null;
  } | null;
  /** When the host last began an answer; a turn waits for it. */
  expectedAt: number;
  /** Wakes a turn waiting to learn whether the host is answering. */
  expecting: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  room: MeetingFaceRoom | null;
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
  readonly mode?: MeetingFaceMode;
  readonly logger?: Logger;
}): MeetingFaceService {
  const now = dependencies.now ?? (() => Date.now());
  const waitMs = dependencies.answerWaitMs ?? 12_000;
  // The call's words reach the host through the note-taker a moment after
  // the face's own turn ends; this long is given to see an answer begin.
  // 2026-10-21 (live meeting): 1.5 s was shorter than captions plus the
  // host's hold, so a follow-up's answer missed its turn and waited for
  // someone to speak again (5-10 s late, or never). Waiting is silent.
  const expectGraceMs = dependencies.expectGraceMs ?? 5_000;
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
  const mode = dependencies.mode ?? "MEET";
  /** A start waiting for the call's time: called to go now, or to drop it. */
  const early = new Map<string, (go: boolean) => void>();

  function forget(session: Session): void {
    if (session.timer !== null) clearTimeout(session.timer);
    session.waiter?.(null, false);
    session.waiter = null;
    closeStream(session);
    byMeeting.delete(session.meetingId);
    byId.delete(session.id);
  }

  /** A streamed answer is complete (or abandoned): its turn ends. */
  function closeStream(session: Session): void {
    const stream = session.stream;
    if (stream === null) return;
    stream.open = false;
    stream.wake?.();
  }

  /** The rest of a streamed answer, part by part, as the host decides it. */
  async function* restOf(
    session: Session,
    stream: NonNullable<Session["stream"]>,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    try {
      for (;;) {
        const part = stream.parts.shift();
        if (part !== undefined) {
          yield part;
          continue;
        }
        if (!stream.open || signal.aborted) return;
        const woke = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), STREAM_REST_WAIT_MS);
          timer.unref();
          stream.wake = () => {
            clearTimeout(timer);
            resolve(true);
          };
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve(false);
            },
            { once: true },
          );
        });
        stream.wake = null;
        if (!woke && stream.parts.length === 0) return;
      }
    } finally {
      stream.open = false;
      if (session.stream === stream) session.stream = null;
    }
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
    // 2026-10-21: Q's note-taker joins minutes early; the face (paid time,
    // and a bounded length) is sent a minute before the start, or at once
    // when start is called again (someone is already in the call).
    const wait =
      (meeting.startsAt?.getTime() ?? 0) - MEETING_FACE_LEAD_MS - now();
    if (wait > 0) {
      const go = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(true), wait);
        timer.unref();
        early.set(meetingId, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      early.delete(meetingId);
      if (!go) return;
    }
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
      room: null,
      lines: [],
      waiter: null,
      stream: null,
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
        disclosure: FACE_DISCLOSURE,
        layers: {
          llm: {
            model: "capital-q-meeting",
            base_url: `${base}${dependencies.bridgePath(id)}`,
            api_key: token,
            speculative_inference: false,
          },
          perception: { perception_model: "off" },
        },
        // A meeting identity only when the face joins Meet itself.
        ...(mode === "MEET"
          ? {
              conferencing: {
                username: `cq-q-${randomBytes(6).toString("hex")}`,
                allowlist: NO_EMAIL_INVITES,
              },
            }
          : {}),
      });
      session.palId = palId;
      // Recorded before the paid call: from here the time counts.
      await store.requested(id, palId, new Date(now()));
      if (ended()) throw new TavusError("ended", 499);
      const greeting = meetingFaceGreeting({
        organiserName: meeting.organiserName ?? null,
        purpose: meeting.purpose ?? null,
      });
      let conversation: { readonly conversationId: string };
      if (mode === "CAMERA") {
        const room = await client.createMeetingRoom({
          palId,
          faceId,
          name: MEETING_FACE_NAME,
          maxCallSeconds: dependencies.maxSeconds,
          greeting,
        });
        session.conversationId = room.conversationId;
        if (room.conversationUrl === null || room.meetingToken === null) {
          throw new TavusError("meeting room", 502);
        }
        session.room = { url: room.conversationUrl, token: room.meetingToken };
        conversation = room;
      } else {
        conversation = await client.joinMeeting({
          palId,
          faceId,
          name: MEETING_FACE_NAME,
          meetingUrl: meeting.meetLink,
          maxCallSeconds: dependencies.maxSeconds,
          greeting,
        });
      }
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
    // The call ended before the face was sent: it never is.
    early.get(meetingId)?.(false);
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
      // Started again while waiting for the call's time: someone is here.
      early.get(meetingId)?.(true);
      if (!on || byMeeting.has(meetingId) || starting.has(meetingId)) return;
      const run = begin(meetingId)
        .catch((error: unknown) => {
          logger?.warn({ err: error, meetingId }, "meeting face start failed");
        })
        .finally(() => starting.delete(meetingId));
      starting.set(meetingId, run);
    },
    live: (meetingId) => byMeeting.get(meetingId)?.state === "LIVE",
    // Waiting for the call's time is not "being sent": Q's voice does not
    // hold its lines for a face that will come only at the start.
    starting: (meetingId) =>
      (starting.has(meetingId) && !early.has(meetingId)) ||
      byMeeting.get(meetingId)?.state === "STARTING",
    expect: (meetingId) => {
      const session = byMeeting.get(meetingId);
      if (session?.state !== "LIVE") return;
      session.expectedAt = now();
      session.expecting?.();
    },
    say: (meetingId, text, more = false) => {
      const session = byMeeting.get(meetingId);
      if (session?.state !== "LIVE") return;
      // The rest of an answer whose first sentence the face is saying.
      if (session.stream?.open === true) {
        session.stream.parts.push(text);
        if (!more) session.stream.open = false;
        session.stream.wake?.();
        return;
      }
      if (session.waiter !== null) {
        const waiter = session.waiter;
        session.waiter = null;
        waiter(text, more);
        return;
      }
      session.lines.push({ text, at: now() });
      if (session.lines.length > 4) session.lines.shift();
      session.expecting?.();
    },
    finish: (meetingId) => {
      const session = byMeeting.get(meetingId);
      if (session !== undefined) closeStream(session);
    },
    end,
    settled: async (meetingId) => {
      await starting.get(meetingId);
    },
    room: (meetingId) => {
      const session = byMeeting.get(meetingId);
      return session?.state === "LIVE" ? session.room : null;
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
      // Words from the call are data: they only decide whether to wait.
      // Q's name, or the host already answering (a conversation's
      // follow-up never names Q: owner 2026-10-18).
      const expected = () => now() - session.expectedAt <= waitMs;
      const pending = freshLines(session);
      if (pending !== null) {
        if (!addressedToQ(userLines.at(-1) ?? "") && !expected()) {
          return { kind: "LINE", text: pending };
        }
        // 2026-10-21: a line said while nobody was speaking (a greeting,
        // a late answer) used to take this turn, and the answer to what was
        // just asked waited for the turn after. Both go in this one turn.
        session.waiter?.(null, false);
        closeStream(session);
        const stream: NonNullable<Session["stream"]> = {
          parts: [],
          open: true,
          wake: null,
        };
        session.stream = stream;
        return {
          kind: "STREAM",
          first: pending,
          rest: restOf(session, stream, signal),
        };
      }
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
      session.waiter?.(null, false);
      // A streamed answer from an earlier turn is over: this turn is new.
      closeStream(session);
      let streaming = false;
      const text = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          if (session.waiter === settle) session.waiter = null;
          resolve(null);
        }, waitMs);
        timer.unref();
        const settle = (value: string | null, more = false) => {
          clearTimeout(timer);
          if (value !== null && more) {
            streaming = true;
            session.stream = { parts: [], open: true, wake: null };
          }
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
        if (streaming) closeStream(session);
        session.lines.push({ text, at: now() });
        return { kind: "SILENT" };
      }
      const stream = session.stream;
      if (streaming && stream !== null) {
        return {
          kind: "STREAM",
          first: text,
          rest: restOf(session, stream, signal),
        };
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
          purpose: string | null;
          organiser_name: string | null;
          starts_at: Date | null;
        }[]
      >`
        select m.tenant_id, m.organiser_user_id, m.meet_link, m.purpose,
               m.starts_at,
               (select p.display_name
                  from communication.meeting_participants p
                 where p.meeting_id = m.id and p.user_id = m.organiser_user_id
                 limit 1) as organiser_name
          from communication.meetings m
         where m.id = ${meetingId} and m.status = 'SCHEDULED'
         limit 1`;
      const row = rows[0];
      if (row === undefined || row.meet_link === null) return null;
      return {
        tenantId: row.tenant_id,
        organiserUserId: row.organiser_user_id,
        meetLink: row.meet_link,
        organiserName: row.organiser_name,
        purpose: row.purpose,
        startsAt: row.starts_at,
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
