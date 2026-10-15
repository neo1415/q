import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  ApplicantTurnResult,
  ConversationService,
} from "../application/conversation-service.js";
import type { IntakeService } from "../application/intake-service.js";
import { IntakeRefusedError } from "../contracts/index.js";

/**
 * The GateQ video interview, server side (directive C3; lead decision
 * 2026-10-15). The provider (Tavus) is only the face, voice and turn-
 * taking: every line its interviewer speaks is the SAME canonical GateQ
 * conversation's reply, reached through a per-session bridge that calls
 * `conversation.turn(...)` with the applicant's own credential. So turns,
 * facts and disclosure lineage land exactly as a typed turn's would, and
 * typing is always the fallback into the same interview.
 *
 * Limits are configuration (defaults approved by the lead):
 *   maxSeconds 480 (8 minutes) · perApplication 2 · concurrency 2 ·
 *   paidRunCapSeconds 180, the existing hard cap for our own paid test
 *   runs, which stays the effective ceiling until the owner raises it.
 * The clock (live run 2026-10-15, migration 20261227150000): when the
 * provider answers, the room is joinable and its end is provisional, ready
 * + a 30 s join grace + the cap, which is also the hard stop. The cap then
 * runs from the moment Q is in the room (the provider's replica-joined
 * callback, or Q's first heard line, whichever comes first), so the end
 * only ever moves earlier and never past the stop. A retry or reconnect
 * returns the same session and clock. The provider's own
 * max_call_duration (cap + grace), a sweep for sessions past ends_at, and
 * the bridge refusing every line after ends_at enforce the deadline.
 */

/** Seconds the interviewer has to join before the clock starts anyway. */
export const GATEQ_VIDEO_JOIN_GRACE_SECONDS = 30;

export type GateqVideoConfig = {
  /** Off by default: no room is ever created unless switched on. */
  readonly enabled: boolean;
  readonly maxSeconds: number;
  readonly paidRunCapSeconds: number;
  readonly perApplication: number;
  readonly concurrency: number;
  /** Provider test mode: a room is created, no face joins, nothing billed. */
  readonly testMode: boolean;
};

export const GATEQ_VIDEO_DEFAULTS: GateqVideoConfig = {
  enabled: false,
  maxSeconds: 480,
  paidRunCapSeconds: 180,
  // Lead 2026-10-15: a second go within the person's weekly allowance.
  perApplication: 2,
  concurrency: 2,
  testMode: true,
};

const positiveInt = (
  raw: string | undefined,
  fallback: number,
  max: number,
) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : fallback;
};

/** From environment names; anything malformed keeps the safe default. */
export function gateqVideoConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): GateqVideoConfig {
  return {
    enabled: env["CQ_GATEQ_VIDEO_INTERVIEW"] === "1",
    maxSeconds: positiveInt(env["CQ_GATEQ_VIDEO_MAX_SECONDS"], 480, 3600),
    paidRunCapSeconds: positiveInt(
      env["CQ_GATEQ_VIDEO_PAID_RUN_CAP_SECONDS"],
      180,
      3600,
    ),
    perApplication: positiveInt(env["CQ_GATEQ_VIDEO_PER_APPLICATION"], 2, 10),
    concurrency: positiveInt(env["CQ_GATEQ_VIDEO_CONCURRENCY"], 2, 50),
    // Paid only when explicitly false, like CQ_TAVUS_TEST_MODE.
    testMode: env["CQ_GATEQ_VIDEO_TEST_MODE"] !== "false",
  };
}

/** The seconds a new session may last: the smaller of the two caps. */
export function effectiveMaxSeconds(config: GateqVideoConfig): number {
  return Math.min(config.maxSeconds, config.paidRunCapSeconds);
}

export type GateqVideoSessionRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly status: "STARTING" | "LIVE" | "ENDED";
  readonly endedReason:
    | "APPLICANT_ENDED"
    | "CONTINUED_BY_TYPING"
    | "TIME_LIMIT"
    | "PROVIDER_FAILED"
    | "SWEPT"
    | null;
  readonly providerConversationId: string | null;
  readonly joinUrlSealed: string | null;
  readonly guestCredentialSealed: string;
  readonly maxSeconds: number;
  readonly createdAt: string;
  readonly endsAt: string;
  /** The provider answered and the room is joinable; null before. */
  readonly roomReadyAt: string | null;
  /** Q is in the room and the cap is running; null before. */
  readonly liveAt: string | null;
};

/** Why video is not offered right now; typing is always offered. */
export type GateqVideoUnavailableReason =
  | "NOT_OFFERED"
  | "SUBMITTED"
  | "APPLICATION_SESSIONS_USED"
  | "WEEKLY_ALLOWANCE_USED";

export type GateqVideoAllowance = {
  readonly weeklySessions: number;
  readonly remaining: number;
  readonly resetsAt: string;
};

export type GateqVideoSessionStore = {
  /**
   * Reserve a session under the application's row lock and a global lock:
   * refuses with ALLOWANCE when the application already used its sessions
   * and CONCURRENCY when too many sessions are open. Returns an existing
   * open session for the application instead of creating another.
   */
  readonly reserve: (input: {
    readonly id: string;
    readonly tenantId: string;
    readonly applicationId: string;
    readonly bridgeTokenHash: string;
    /** SHA-256 of the secret in the provider's callback URL. */
    readonly eventsTokenHash: string;
    readonly guestCredentialSealed: string;
    readonly maxSeconds: number;
    readonly perApplication: number;
    readonly concurrency: number;
  }) => Promise<
    | { readonly kind: "CREATED"; readonly row: GateqVideoSessionRow }
    | { readonly kind: "EXISTING"; readonly row: GateqVideoSessionRow }
    | { readonly kind: "ALLOWANCE" }
    | { readonly kind: "CONCURRENCY" }
    /** The person's shared weekly allowance (GateQ + Rehearsals) is spent. */
    | { readonly kind: "WEEKLY_ALLOWANCE" }
    /** The provider account's monthly safeguard would be exceeded. */
    | { readonly kind: "PLATFORM_LIMIT" }
  >;
  /** The applying person's shared weekly video allowance, if known. */
  readonly allowanceFor: (input: {
    readonly applicationId: string;
    readonly tenantId: string;
  }) => Promise<GateqVideoAllowance | null>;
  /**
   * The room is joinable: the session goes LIVE with its provisional end
   * (ready + join grace + cap, the hard stop) and no clock yet. Returns the
   * live row, or null when it was no longer starting.
   */
  readonly markLive: (input: {
    readonly id: string;
    readonly providerConversationId: string;
    readonly joinUrlSealed: string | null;
  }) => Promise<GateqVideoSessionRow | null>;
  /**
   * Q is in the room: the cap runs from now (at most ready + grace), once.
   * Null when the session is not live, already running, or past its end.
   */
  readonly markInRoom: (id: string) => Promise<GateqVideoSessionRow | null>;
  readonly byEventsTokenHash: (
    hash: string,
  ) => Promise<GateqVideoSessionRow | null>;
  readonly end: (input: {
    readonly id: string;
    readonly reason: NonNullable<GateqVideoSessionRow["endedReason"]>;
    /** A room the provider made that was never marked live; recorded once. */
    readonly providerConversationId?: string | null;
  }) => Promise<GateqVideoSessionRow | null>;
  readonly openForApplication: (
    applicationId: string,
  ) => Promise<GateqVideoSessionRow | null>;
  /** Sessions this application has ever had (its allowance used). */
  readonly countForApplication: (applicationId: string) => Promise<number>;
  readonly byBridgeTokenHash: (
    hash: string,
  ) => Promise<GateqVideoSessionRow | null>;
  /** Open sessions whose end has passed, for the sweep. */
  readonly expired: (limit: number) => Promise<readonly GateqVideoSessionRow[]>;
};

/** The provider adapter (VideoProvider): never a raw SDK in domain code. */
export type GateqVideoProvider = {
  readonly createRoom: (input: {
    readonly sessionId: string;
    readonly maxSeconds: number;
    readonly testMode: boolean;
    /** Q's natural opening, from the canonical interview. */
    readonly greeting: string;
    /** Where the provider sends each heard line, and the bearer it presents. */
    readonly bridge: { readonly path: string; readonly bearer: string };
    /** Added to the provider's own cap for the interviewer to join. */
    readonly joinGraceSeconds: number;
    /** Where the provider reports room events; the token is the proof. */
    readonly events: { readonly path: string; readonly token: string };
  }) => Promise<{
    readonly conversationId: string;
    readonly joinUrl: string | null;
  }>;
  readonly endRoom: (conversationId: string) => Promise<void>;
};

export type GateqVideoSealer = {
  readonly seal: (plain: string) => string;
  readonly open: (sealed: string) => string;
};

export type GateqVideoRefusal =
  | "DISABLED"
  | "ALLOWANCE_EXHAUSTED"
  | "CONCURRENCY_LIMIT"
  | "PROVIDER_UNAVAILABLE";

export class GateqVideoRefusedError extends Error {
  readonly reason: GateqVideoRefusal;
  constructor(reason: GateqVideoRefusal) {
    super(`GateQ video interview refused: ${reason}`);
    this.name = "GateqVideoRefusedError";
    this.reason = reason;
  }
}

export type GateqVideoSessionView = {
  readonly id: string;
  readonly status: GateqVideoSessionRow["status"];
  readonly joinUrl: string | null;
  readonly endsAt: string;
  /** When Q joined and the cap began; null while Q is still joining. */
  readonly liveAt: string | null;
  readonly maxSeconds: number;
  readonly endedReason: GateqVideoSessionRow["endedReason"];
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function createGateqVideoInterview(deps: {
  readonly config: GateqVideoConfig;
  readonly store: GateqVideoSessionStore;
  readonly provider: GateqVideoProvider | null;
  readonly sealer: GateqVideoSealer;
  readonly intake: Pick<IntakeService, "authorise" | "assertInterviewReady">;
  readonly conversation: Pick<ConversationService, "turn" | "openingFor">;
  readonly bridgePath: string;
  readonly eventsPath: string;
  readonly now?: (() => number) | undefined;
}) {
  const now = deps.now ?? (() => Date.now());
  const view = (row: GateqVideoSessionRow): GateqVideoSessionView => ({
    id: row.id,
    status: row.status,
    joinUrl:
      row.status === "LIVE" &&
      row.joinUrlSealed !== null &&
      Date.parse(row.endsAt) > now()
        ? deps.sealer.open(row.joinUrlSealed)
        : null,
    endsAt: row.endsAt,
    liveAt: row.liveAt,
    maxSeconds: row.maxSeconds,
    endedReason: row.endedReason,
  });

  /** Start the cap now if it has not started; the row as it then stands. */
  const inRoom = async (
    row: GateqVideoSessionRow,
  ): Promise<GateqVideoSessionRow> => {
    if (row.status !== "LIVE" || row.liveAt !== null) return row;
    return (await deps.store.markInRoom(row.id)) ?? row;
  };

  const endRow = async (
    row: GateqVideoSessionRow,
    reason: NonNullable<GateqVideoSessionRow["endedReason"]>,
  ) => {
    // Provider first: an open paid room is the costly failure. A failed
    // end leaves the row open for the sweep to retry, never forgotten.
    if (row.providerConversationId !== null && deps.provider !== null)
      await deps.provider.endRoom(row.providerConversationId);
    return deps.store.end({ id: row.id, reason });
  };

  /**
   * Whether this applicant may start, and if not, why (so the person is
   * told plainly rather than finding the offer gone).
   */
  const availability = async (
    token: string,
  ): Promise<{
    readonly available: boolean;
    readonly reason: GateqVideoUnavailableReason | null;
  }> => {
    if (!deps.config.enabled || deps.provider === null)
      return { available: false, reason: "NOT_OFFERED" };
    const guest = await deps.intake.authorise(token);
    if (guest.application.status === "SUBMITTED")
      return { available: false, reason: "SUBMITTED" };
    // Live 2026-10-15: the offer stayed up after the allowance was spent,
    // so the button led only to a refusal. A used allowance is no offer.
    if (
      (await deps.store.countForApplication(guest.application.id)) >=
      deps.config.perApplication
    )
      return { available: false, reason: "APPLICATION_SESSIONS_USED" };
    const allowance = await deps.store.allowanceFor({
      applicationId: guest.application.id,
      tenantId: guest.application.tenantId,
    });
    return allowance === null || allowance.remaining > 0
      ? { available: true, reason: null }
      : { available: false, reason: "WEEKLY_ALLOWANCE_USED" };
  };

  return {
    /** Sessions one application may have, for the offer's wording. */
    perApplication: deps.config.perApplication,
    availability,
    /** Whether this applicant may start (the lobby's question). */
    available: async (token: string): Promise<boolean> =>
      (await availability(token)).available,

    /** The person's shared weekly video allowance, for the offer's wording. */
    allowance: async (token: string): Promise<GateqVideoAllowance | null> => {
      if (!deps.config.enabled || deps.provider === null) return null;
      const guest = await deps.intake.authorise(token);
      return deps.store.allowanceFor({
        applicationId: guest.application.id,
        tenantId: guest.application.tenantId,
      });
    },

    start: async (input: {
      readonly token: string;
      readonly correlationId: string;
    }): Promise<GateqVideoSessionView> => {
      if (!deps.config.enabled || deps.provider === null)
        throw new GateqVideoRefusedError("DISABLED");
      const guest = await deps.intake.authorise(input.token);
      if (guest.application.status === "SUBMITTED")
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      // Contact confirmation and recovery rules are the typed interview's.
      await deps.intake.assertInterviewReady(input.token);
      const bearer = randomBytes(32).toString("base64url");
      const eventsToken = randomBytes(32).toString("base64url");
      const reserved = await deps.store.reserve({
        id: randomUUID(),
        tenantId: guest.application.tenantId,
        applicationId: guest.application.id,
        bridgeTokenHash: sha256(bearer),
        eventsTokenHash: sha256(eventsToken),
        guestCredentialSealed: deps.sealer.seal(input.token),
        maxSeconds: effectiveMaxSeconds(deps.config),
        perApplication: deps.config.perApplication,
        concurrency: deps.config.concurrency,
      });
      if (reserved.kind === "ALLOWANCE")
        throw new GateqVideoRefusedError("ALLOWANCE_EXHAUSTED");
      if (reserved.kind === "CONCURRENCY")
        throw new GateqVideoRefusedError("CONCURRENCY_LIMIT");
      if (reserved.kind === "WEEKLY_ALLOWANCE")
        throw new GateqVideoRefusedError("ALLOWANCE_EXHAUSTED");
      // The account's monthly safeguard: fail closed, typing carries on.
      if (reserved.kind === "PLATFORM_LIMIT")
        throw new GateqVideoRefusedError("PROVIDER_UNAVAILABLE");
      // A reconnect or retry: the same session and clock, never a new room.
      if (reserved.kind === "EXISTING") return view(reserved.row);
      const row = reserved.row;
      // Set once the provider has made a room: from then on it may be billed.
      let createdConversationId: string | null = null;
      try {
        const greeting = await deps.conversation.openingFor({
          token: input.token,
          channel: "voice",
          correlationId: input.correlationId,
        });
        const room = await deps.provider.createRoom({
          sessionId: row.id,
          maxSeconds: row.maxSeconds,
          testMode: deps.config.testMode,
          greeting,
          bridge: { path: deps.bridgePath, bearer },
          joinGraceSeconds: GATEQ_VIDEO_JOIN_GRACE_SECONDS,
          events: { path: deps.eventsPath, token: eventsToken },
        });
        createdConversationId = room.conversationId;
        const joinUrlSealed =
          room.joinUrl === null ? null : deps.sealer.seal(room.joinUrl);
        const live = await deps.store.markLive({
          id: row.id,
          providerConversationId: room.conversationId,
          joinUrlSealed,
        });
        if (live === null) throw new Error("video session no longer starting");
        return view(live);
      } catch {
        // The allowance is spent by the attempt (no retry-to-mint), the
        // row is closed, and the applicant carries on by typing. A room the
        // provider made before saving failed is ended, and its id recorded
        // on the closed row, so the usage ledger counts it in full rather
        // than releasing it: the ledger must never under-count billing.
        if (createdConversationId !== null)
          await deps.provider
            .endRoom(createdConversationId)
            .catch(() => undefined);
        await deps.store
          .end({
            id: row.id,
            reason: "PROVIDER_FAILED",
            providerConversationId: createdConversationId,
          })
          .catch(() => null);
        throw new GateqVideoRefusedError("PROVIDER_UNAVAILABLE");
      }
    },

    current: async (token: string): Promise<GateqVideoSessionView | null> => {
      const guest = await deps.intake.authorise(token);
      const row = await deps.store.openForApplication(guest.application.id);
      return row === null ? null : view(row);
    },

    end: async (input: {
      readonly token: string;
      readonly continueByTyping: boolean;
    }): Promise<GateqVideoSessionView | null> => {
      const guest = await deps.intake.authorise(input.token);
      const row = await deps.store.openForApplication(guest.application.id);
      if (row === null) return null;
      const ended = await endRow(
        row,
        input.continueByTyping ? "CONTINUED_BY_TYPING" : "APPLICANT_ENDED",
      );
      return ended === null ? null : view(ended);
    },

    /**
     * One heard line from the provider. The bearer proves the session;
     * the applicant's own sealed credential authorises the canonical turn,
     * so the bridge can never reach wider than that application. The
     * provider's utterance id makes a redelivered line the same turn.
     */
    bridgeTurn: async (input: {
      readonly bearer: string;
      readonly utterance: string;
      readonly utteranceId: string;
      readonly correlationId: string;
    }): Promise<
      | { readonly kind: "REPLY"; readonly reply: string }
      | { readonly kind: "CLOSED" }
      | { readonly kind: "UNKNOWN_SESSION" }
    > => {
      if (input.bearer.length < 32) return { kind: "UNKNOWN_SESSION" };
      const row = await deps.store.byBridgeTokenHash(sha256(input.bearer));
      if (row === null) return { kind: "UNKNOWN_SESSION" };
      if (row.status !== "LIVE" || Date.parse(row.endsAt) <= now())
        return { kind: "CLOSED" };
      // Q heard a line, so Q is in the room: the clock runs, whether or
      // not the provider's joined event arrived first.
      await inRoom(row).catch(() => row);
      const text = input.utterance.trim().slice(0, 4000);
      if (text === "") return { kind: "REPLY", reply: "" };
      const id = sha256(`${row.id}:${input.utteranceId}`).slice(0, 40);
      const result: ApplicantTurnResult = await deps.conversation.turn({
        token: deps.sealer.open(row.guestCredentialSealed),
        message: text,
        clientTurnId: `video-${id}`,
        channel: "voice",
        correlationId: input.correlationId,
      });
      return { kind: "REPLY", reply: result.reply };
    },

    /**
     * One room event from the provider (its callback). The token in the
     * callback URL proves the session; only "the replica joined" means
     * anything, and it can only start the clock (the end moves earlier,
     * never later). Everything else is acknowledged and ignored.
     */
    providerEvent: async (input: {
      readonly token: string;
      readonly eventType: string;
      readonly conversationId: string | null;
    }): Promise<
      | { readonly kind: "ACCEPTED"; readonly liveAt: string | null }
      | { readonly kind: "UNKNOWN_SESSION" }
    > => {
      if (input.token.length < 32) return { kind: "UNKNOWN_SESSION" };
      const row = await deps.store.byEventsTokenHash(sha256(input.token));
      if (row === null) return { kind: "UNKNOWN_SESSION" };
      if (
        input.eventType !== "system.replica_joined" ||
        (input.conversationId !== null &&
          input.conversationId !== row.providerConversationId)
      )
        return { kind: "ACCEPTED", liveAt: row.liveAt };
      const after = await inRoom(row);
      return { kind: "ACCEPTED", liveAt: after.liveAt };
    },

    /** Ends sessions past their end; safe to run on every replica. */
    sweep: async (limit = 20): Promise<{ ended: number; failed: number }> => {
      let ended = 0;
      let failed = 0;
      for (const row of await deps.store.expired(limit)) {
        try {
          await endRow(row, row.status === "STARTING" ? "SWEPT" : "TIME_LIMIT");
          ended++;
        } catch {
          failed++;
        }
      }
      return { ended, failed };
    },
  };
}

export type GateqVideoInterview = ReturnType<typeof createGateqVideoInterview>;
