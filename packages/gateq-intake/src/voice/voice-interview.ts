import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import type {
  ApplicantTurnResult,
  ConversationService,
} from "../application/conversation-service.js";
import type { IntakeService } from "../application/intake-service.js";
import { IntakeRefusedError } from "../contracts/index.js";

/**
 * The GateQ voice-only interview, server side (directive 2026-11-14 item
 * 4, slice 1). The speech provider is only ears, turn-taking and a voice:
 * every line it hears comes back through a per-line bridge that calls the
 * SAME `conversation.turn(...)` with the applicant's own (sealed) guest
 * credential and `channel: "voice"`, so turns, facts, corrections,
 * contradictions and coverage land exactly as a typed turn's would, in the
 * one interview store. Typing is always the fallback into that interview.
 *
 * Mirrors the video interview's gating (video-interview.ts): off unless
 * switched on; a per-application session allowance and a concurrency cap,
 * both enforced under the application row lock; one clock per session,
 * capped by the paid-run cap (180 s by default) and never moved; the
 * bridge refuses every line after `endsAt`; a sweep closes what is left.
 *
 * Unlike a video room there is nothing for the provider to tear down: the
 * line is the browser's socket, opened with a short-lived token. So a
 * reconnect returns the same session and clock with a fresh line bearer
 * (the previous bearer stops working), and a provider failure while
 * opening never spends the applicant's allowance (no paid audio flowed).
 */

export type GateqVoiceConfig = {
  /** Off by default: no line is ever opened unless switched on. */
  readonly enabled: boolean;
  readonly maxSeconds: number;
  readonly paidRunCapSeconds: number;
  readonly perApplication: number;
  readonly concurrency: number;
};

export const GATEQ_VOICE_DEFAULTS: GateqVoiceConfig = {
  enabled: false,
  maxSeconds: 900,
  paidRunCapSeconds: 180,
  perApplication: 3,
  concurrency: 4,
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
export function gateqVoiceConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): GateqVoiceConfig {
  return {
    enabled: env["CQ_GATEQ_VOICE_INTERVIEW"] === "1",
    maxSeconds: positiveInt(env["CQ_GATEQ_VOICE_MAX_SECONDS"], 900, 3600),
    paidRunCapSeconds: positiveInt(
      env["CQ_GATEQ_VOICE_PAID_RUN_CAP_SECONDS"],
      180,
      3600,
    ),
    perApplication: positiveInt(env["CQ_GATEQ_VOICE_PER_APPLICATION"], 3, 10),
    concurrency: positiveInt(env["CQ_GATEQ_VOICE_CONCURRENCY"], 4, 50),
  };
}

/** The seconds a new session may last: the smaller of the two caps. */
export function effectiveVoiceSeconds(config: GateqVoiceConfig): number {
  return Math.min(config.maxSeconds, config.paidRunCapSeconds);
}

export type GateqVoiceEndedReason =
  | "APPLICANT_ENDED"
  | "CONTINUED_BY_TYPING"
  | "TIME_LIMIT"
  | "PROVIDER_FAILED"
  | "SWEPT";

export type GateqVoiceSessionRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly status: "LIVE" | "ENDED";
  readonly endedReason: GateqVoiceEndedReason | null;
  readonly guestCredentialSealed: string;
  /** SHA-256 of the current line's bearer; a reconnect replaces it. */
  readonly bridgeTokenHash: string;
  readonly maxSeconds: number;
  readonly createdAt: string;
  readonly endsAt: string;
};

export type GateqVoiceUnavailableReason =
  | "NOT_OFFERED"
  | "SUBMITTED"
  | "APPLICATION_SESSIONS_USED"
  | "BUSY"
  | "PROVIDER_UNAVAILABLE";

export type GateqVoiceSessionStore = {
  /**
   * Reserve a session under the application's row lock and a global
   * lock. Returns the open session for the application instead of a new
   * one (its line bearer replaced). Refuses with ALLOWANCE when the
   * application used its sessions, CONCURRENCY when too many are open.
   * The tenant is part of the key: a guest's tenant must match the row's.
   */
  readonly reserve: (input: {
    readonly id: string;
    readonly tenantId: string;
    readonly applicationId: string;
    readonly bridgeTokenHash: string;
    readonly guestCredentialSealed: string;
    /** Recorded on a new row; absent is the slice-1 default, DEEPGRAM. */
    readonly provider?: GateqVoiceProviderCode | undefined;
    readonly maxSeconds: number;
    readonly perApplication: number;
    readonly concurrency: number;
  }) => Promise<
    | { readonly kind: "CREATED"; readonly row: GateqVoiceSessionRow }
    | { readonly kind: "EXISTING"; readonly row: GateqVoiceSessionRow }
    | { readonly kind: "ALLOWANCE" }
    | { readonly kind: "CONCURRENCY" }
  >;
  readonly end: (input: {
    readonly id: string;
    readonly reason: GateqVoiceEndedReason;
  }) => Promise<GateqVoiceSessionRow | null>;
  readonly openForApplication: (input: {
    readonly applicationId: string;
    readonly tenantId: string;
  }) => Promise<GateqVoiceSessionRow | null>;
  /** Sessions that spent this application's allowance (not provider failures). */
  readonly countForApplication: (input: {
    readonly applicationId: string;
    readonly tenantId: string;
  }) => Promise<number>;
  readonly byBridgeTokenHash: (
    hash: string,
  ) => Promise<GateqVoiceSessionRow | null>;
  /** Open sessions whose end has passed, for the sweep. */
  readonly expired: (limit: number) => Promise<readonly GateqVoiceSessionRow[]>;
};

/**
 * The speech provider adapter (v2, owner directive 2026-11-14 "GateQ
 * voice reuses the existing voice providers"): never a raw SDK or key in
 * domain code, and never a brain. Two shapes, by how the provider reaches
 * the canonical interviewer:
 *
 * - DIAL_BACK (ElevenLabs Speech Engine, Q's own voice; the default): the
 *   provider issues one short-lived browser credential for one
 *   conversation and later dials this server back with nothing but that
 *   conversation's id. The line bearer is derived from the id under a
 *   server secret, so the line survives a restart and needs no new column.
 * - THINK_ENDPOINT (Deepgram Voice Agent; an optional fallback, only when
 *   explicitly configured): the provider calls the bridge URL under this
 *   line's bearer with every heard line.
 */
export type GateqThinkEndpointVoiceProvider = {
  readonly kind?: "THINK_ENDPOINT" | undefined;
  readonly openLine: (input: {
    readonly sessionId: string;
    /** Q's opening (or the question it last asked, on a resume). */
    readonly greeting: string;
    readonly bridge: { readonly path: string; readonly bearer: string };
    readonly locale?: string | undefined;
  }) => Promise<{
    readonly provider: "deepgram";
    readonly token: string;
    readonly agent: Readonly<Record<string, unknown>>;
  }>;
};

export type GateqDialBackVoiceProvider = {
  readonly kind: "DIAL_BACK";
  readonly name: "elevenlabs";
  /** One browser credential for one new provider conversation; never a key. */
  readonly issueLine: (input: {
    readonly locale?: string | undefined;
  }) => Promise<{
    readonly providerConversationId: string;
    readonly token: string;
  }>;
};

export type GateqVoiceProvider =
  GateqThinkEndpointVoiceProvider | GateqDialBackVoiceProvider;

/** Which provider a session's row records. */
export type GateqVoiceProviderCode = "DEEPGRAM" | "ELEVENLABS";

export type GateqVoiceSealer = {
  readonly seal: (plain: string) => string;
  readonly open: (sealed: string) => string;
};

export type GateqVoiceRefusal =
  | "DISABLED"
  | "ALLOWANCE_EXHAUSTED"
  | "CONCURRENCY_LIMIT"
  | "PROVIDER_UNAVAILABLE";

export class GateqVoiceRefusedError extends Error {
  readonly reason: GateqVoiceRefusal;
  constructor(reason: GateqVoiceRefusal) {
    super(`GateQ voice interview refused: ${reason}`);
    this.name = "GateqVoiceRefusedError";
    this.reason = reason;
  }
}

export type GateqVoiceSessionView = {
  readonly id: string;
  readonly status: GateqVoiceSessionRow["status"];
  readonly endsAt: string;
  readonly maxSeconds: number;
  readonly endedReason: GateqVoiceEndedReason | null;
};

export type GateqVoiceLine =
  | {
      readonly provider: "elevenlabs";
      readonly token: string;
      /** Q's opening as this server composed it; the provider speaks it first. */
      readonly firstMessage: string;
    }
  | {
      readonly provider: "deepgram";
      readonly token: string;
      readonly agent: Readonly<Record<string, unknown>>;
    };

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Conversation ids are the provider's; bounded before they touch a hash. */
const PROVIDER_CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/u;

/**
 * The line bearer of a dial-back conversation: HMAC of the provider's
 * conversation id under a server secret. Never sent to the browser or the
 * provider; only its SHA-256 is stored, as for every line.
 */
export function dialBackBearer(
  lineSecret: string,
  providerConversationId: string,
): string {
  return createHmac("sha256", lineSecret)
    .update(`gateq-voice-line.v1:${providerConversationId}`)
    .digest("base64url");
}

export type BridgeTurnResult =
  | { readonly kind: "REPLY"; readonly reply: string }
  | { readonly kind: "CLOSED" }
  | { readonly kind: "UNKNOWN_SESSION" };

/** What the bridge speaks when a turn failed: the line was not recorded. */
export const GATEQ_VOICE_RETRY_LINE =
  "Sorry, I lost that for a second. Could you say it again?";
/** What the bridge speaks after the session's time is up. */
export const GATEQ_VOICE_CLOSED_LINE =
  "We're out of time on this call. Everything you said is saved; you can carry on by typing.";

export function createGateqVoiceInterview(deps: {
  readonly config: GateqVoiceConfig;
  readonly store: GateqVoiceSessionStore;
  readonly provider: GateqVoiceProvider | null;
  readonly sealer: GateqVoiceSealer;
  readonly intake: Pick<IntakeService, "authorise" | "assertInterviewReady">;
  readonly conversation: Pick<ConversationService, "turn" | "openingFor">;
  readonly bridgePath: string;
  /**
   * The server secret dial-back line bearers are derived under (at least
   * 32 characters). Without one a dial-back provider is not offered.
   */
  readonly lineSecret?: string | undefined;
  readonly now?: (() => number) | undefined;
}) {
  const now = deps.now ?? (() => Date.now());
  const lineSecret =
    deps.lineSecret !== undefined && deps.lineSecret.length >= 32
      ? deps.lineSecret
      : null;
  const provider =
    deps.provider?.kind === "DIAL_BACK" && lineSecret === null
      ? null
      : deps.provider;
  const offered = deps.config.enabled && provider !== null;
  const view = (row: GateqVoiceSessionRow): GateqVoiceSessionView => ({
    id: row.id,
    status:
      row.status === "LIVE" && Date.parse(row.endsAt) <= now()
        ? "ENDED"
        : row.status,
    endsAt: row.endsAt,
    maxSeconds: row.maxSeconds,
    endedReason:
      row.status === "LIVE" && Date.parse(row.endsAt) <= now()
        ? "TIME_LIMIT"
        : row.endedReason,
  });
  const keyOf = (guest: {
    readonly application: { readonly id: string; readonly tenantId: string };
  }) => ({
    applicationId: guest.application.id,
    tenantId: guest.application.tenantId,
  });

  const availability = async (
    token: string,
  ): Promise<{
    readonly available: boolean;
    readonly reason: GateqVoiceUnavailableReason | null;
    readonly remaining: number;
  }> => {
    // Authorised first: an unknown credential is a 404 whether or not
    // voice is switched on, so the offer never leaks to a stranger.
    const guest = await deps.intake.authorise(token);
    if (!offered)
      return { available: false, reason: "NOT_OFFERED", remaining: 0 };
    if (guest.application.status === "SUBMITTED")
      return { available: false, reason: "SUBMITTED", remaining: 0 };
    const [used, open] = await Promise.all([
      deps.store.countForApplication(keyOf(guest)),
      deps.store.openForApplication(keyOf(guest)),
    ]);
    const remaining = Math.max(0, deps.config.perApplication - used);
    // An open session can always be rejoined (same clock, new line).
    return remaining === 0 && open === null
      ? { available: false, reason: "APPLICATION_SESSIONS_USED", remaining }
      : { available: true, reason: null, remaining };
  };

  /**
   * One heard line from the provider. The bearer proves the line; the
   * applicant's own sealed credential authorises the canonical turn, so
   * the bridge can never reach wider than that application. The line's
   * bearer and the provider's utterance index make a redelivered line the
   * same turn, and a reconnected line a new one.
   */
  const bridgeTurn = async (input: {
    readonly bearer: string;
    readonly utterance: string;
    readonly utteranceId: string;
    readonly correlationId: string;
  }): Promise<BridgeTurnResult> => {
    if (input.bearer.length < 32) return { kind: "UNKNOWN_SESSION" };
    const hash = sha256(input.bearer);
    const row = await deps.store.byBridgeTokenHash(hash);
    if (row === null) return { kind: "UNKNOWN_SESSION" };
    if (row.status !== "LIVE" || Date.parse(row.endsAt) <= now())
      return { kind: "CLOSED" };
    const text = input.utterance.trim().slice(0, 4000);
    if (text === "") return { kind: "REPLY", reply: "" };
    const id = sha256(`${row.id}:${hash}:${input.utteranceId}`).slice(0, 40);
    const result: ApplicantTurnResult = await deps.conversation.turn({
      token: deps.sealer.open(row.guestCredentialSealed),
      message: text,
      clientTurnId: `voice-${id}`,
      channel: "voice",
      correlationId: input.correlationId,
    });
    return { kind: "REPLY", reply: result.reply };
  };

  const dialBackBearerOf = (providerConversationId: string): string | null =>
    lineSecret === null ||
    provider?.kind !== "DIAL_BACK" ||
    !PROVIDER_CONVERSATION_ID.test(providerConversationId)
      ? null
      : dialBackBearer(lineSecret, providerConversationId);

  return {
    perApplication: deps.config.perApplication,
    availability,

    current: async (token: string): Promise<GateqVoiceSessionView | null> => {
      const guest = await deps.intake.authorise(token);
      if (!offered) return null;
      const row = await deps.store.openForApplication(keyOf(guest));
      return row === null ? null : view(row);
    },

    /**
     * Open (or reopen) the applicant's voice line. Returns the session and
     * the one-time line credential for the browser.
     */
    start: async (input: {
      readonly token: string;
      readonly correlationId: string;
      readonly locale?: string | undefined;
    }): Promise<{
      readonly session: GateqVoiceSessionView;
      readonly line: GateqVoiceLine;
    }> => {
      const guest = await deps.intake.authorise(input.token);
      if (!deps.config.enabled || provider === null)
        throw new GateqVoiceRefusedError("DISABLED");
      if (guest.application.status === "SUBMITTED")
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      // Contact confirmation and recovery rules are the typed interview's.
      await deps.intake.assertInterviewReady(input.token);
      // A dial-back provider issues its conversation first: the line bearer
      // is derived from that conversation's id. An issued credential nobody
      // connects with costs nothing, and a failure here spends no allowance.
      let issued: {
        readonly providerConversationId: string;
        readonly token: string;
      } | null = null;
      if (provider.kind === "DIAL_BACK") {
        try {
          issued = await provider.issueLine(
            input.locale === undefined ? {} : { locale: input.locale },
          );
        } catch {
          throw new GateqVoiceRefusedError("PROVIDER_UNAVAILABLE");
        }
        if (
          !PROVIDER_CONVERSATION_ID.test(issued.providerConversationId) ||
          issued.token.length === 0
        )
          throw new GateqVoiceRefusedError("PROVIDER_UNAVAILABLE");
      }
      const bearer =
        issued !== null && lineSecret !== null
          ? dialBackBearer(lineSecret, issued.providerConversationId)
          : randomBytes(32).toString("base64url");
      const reserved = await deps.store.reserve({
        id: randomUUID(),
        ...keyOf(guest),
        bridgeTokenHash: sha256(bearer),
        guestCredentialSealed: deps.sealer.seal(input.token),
        provider: provider.kind === "DIAL_BACK" ? "ELEVENLABS" : "DEEPGRAM",
        maxSeconds: effectiveVoiceSeconds(deps.config),
        perApplication: deps.config.perApplication,
        concurrency: deps.config.concurrency,
      });
      if (reserved.kind === "ALLOWANCE")
        throw new GateqVoiceRefusedError("ALLOWANCE_EXHAUSTED");
      if (reserved.kind === "CONCURRENCY")
        throw new GateqVoiceRefusedError("CONCURRENCY_LIMIT");
      const row = reserved.row;
      try {
        // Q's natural opening, or (resume) the question it last asked; the
        // provider speaks it first and the transcript already holds it.
        const greeting = await deps.conversation.openingFor({
          token: input.token,
          channel: "voice",
          correlationId: input.correlationId,
          ...(input.locale === undefined ? {} : { locale: input.locale }),
        });
        if (issued !== null)
          return {
            session: view(row),
            line: {
              provider: "elevenlabs",
              token: issued.token,
              firstMessage: greeting.slice(0, 1000),
            },
          };
        if (provider.kind === "DIAL_BACK")
          throw new GateqVoiceRefusedError("PROVIDER_UNAVAILABLE");
        const line = await provider.openLine({
          sessionId: row.id,
          greeting,
          bridge: { path: deps.bridgePath, bearer },
          ...(input.locale === undefined ? {} : { locale: input.locale }),
        });
        return {
          session: view(row),
          line: {
            provider: line.provider,
            token: line.token,
            agent: line.agent,
          },
        };
      } catch {
        // No audio flowed, so the allowance is not spent: a new session's
        // row is closed as PROVIDER_FAILED (not counted). A reopened one
        // keeps its clock; the applicant carries on by typing either way.
        if (reserved.kind === "CREATED")
          await deps.store
            .end({ id: row.id, reason: "PROVIDER_FAILED" })
            .catch(() => null);
        throw new GateqVoiceRefusedError("PROVIDER_UNAVAILABLE");
      }
    },

    end: async (input: {
      readonly token: string;
      readonly continueByTyping: boolean;
    }): Promise<GateqVoiceSessionView | null> => {
      const guest = await deps.intake.authorise(input.token);
      if (!offered) return null;
      const row = await deps.store.openForApplication(keyOf(guest));
      if (row === null) return null;
      const ended = await deps.store.end({
        id: row.id,
        reason: input.continueByTyping
          ? "CONTINUED_BY_TYPING"
          : "APPLICANT_ENDED",
      });
      return ended === null ? null : view(ended);
    },

    /** Whether a bearer names a line at all (before a stream opens). */
    knowsLine: async (bearer: string): Promise<boolean> =>
      bearer.length >= 32 &&
      (await deps.store.byBridgeTokenHash(sha256(bearer))) !== null,

    bridgeTurn,

    /**
     * A dial-back provider connected for a conversation: whether it names
     * a live line this server issued. Anything else is closed unanswered.
     */
    dialBackOpened: async (
      providerConversationId: string,
    ): Promise<boolean> => {
      const bearer = dialBackBearerOf(providerConversationId);
      if (bearer === null) return false;
      const row = await deps.store.byBridgeTokenHash(sha256(bearer));
      return (
        row !== null && row.status === "LIVE" && Date.parse(row.endsAt) > now()
      );
    },

    /**
     * One heard line from a dial-back provider, by its conversation id:
     * the SAME bridge turn as the think endpoint's, under the derived
     * bearer. `utteranceIndex` is the line's place among the person's
     * lines in the conversation, so a re-sent transcript is the same turn.
     */
    dialBackTurn: async (input: {
      readonly providerConversationId: string;
      readonly utterance: string;
      readonly utteranceIndex: number;
      readonly correlationId: string;
    }): Promise<BridgeTurnResult> => {
      const bearer = dialBackBearerOf(input.providerConversationId);
      if (bearer === null) return { kind: "UNKNOWN_SESSION" };
      return bridgeTurn({
        bearer,
        utterance: input.utterance,
        utteranceId: `dial-${String(input.utteranceIndex)}`,
        correlationId: input.correlationId,
      });
    },

    /** Ends sessions past their end; safe to run on every replica. */
    sweep: async (limit = 20): Promise<{ ended: number; failed: number }> => {
      let ended = 0;
      let failed = 0;
      for (const row of await deps.store.expired(limit)) {
        try {
          await deps.store.end({ id: row.id, reason: "TIME_LIMIT" });
          ended++;
        } catch {
          failed++;
        }
      }
      return { ended, failed };
    },
  };
}

export type GateqVoiceInterview = ReturnType<typeof createGateqVoiceInterview>;
