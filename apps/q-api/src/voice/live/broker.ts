import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  QClientActionIntentSchema,
  QRunIdSchema,
  QVoiceDestinationSchema,
  sensitivityWithin,
  type ModelSensitivity,
  type QVoiceLiveTrial,
} from "@capital-q/contracts";
import type { ArrivalSnapshot } from "@capital-q/contracts";
import type { ModelUsageRepository } from "@capital-q/model-gateway";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  PERSONAL_BOOTSTRAP_TENANT_ID,
  type ActorContext,
} from "@capital-q/security";
import type { SpokenFacts } from "@capital-q/q-core";
import { parseNameCorrection } from "@capital-q/q-core/names";

import type {
  ConversationLine,
  OnboardingConversation,
} from "../onboarding-conversation.js";
import type { ExternalRehearsalLatency } from "../../composition/external-rehearsal-latency.js";
import type { VoiceSessionBinding } from "../bindings.js";
import { askQFactsOutput, forRealtime } from "../duplex/broker.js";
import type { DuplexSpendLedger } from "../duplex/spend.js";
import type { DuplexTranscriptStore } from "../duplex/transcript.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "../provider.js";
import {
  GPT_LIVE_USD_PER_SECOND,
  LiveProviderError,
  OBSERVER_ATTACH_TIMEOUT_MS,
  type LiveVoiceProvider,
} from "../providers/gpt-live.js";
import {
  APPROVAL_QUESTION,
  settledTurn,
  type VoiceTurnHandler,
} from "../turn.js";
import type { LiveConfig } from "./config.js";
import type {
  LiveDelegationRequest,
  LiveDelegationResult,
  LiveMove,
  LiveOpenResult,
  LiveTranscriptReport,
  LiveUsageReport,
} from "./contracts.js";
import {
  arrivalLines,
  liveContextPackage,
  referentsOf,
  REFERENTS_MAX,
  type LiveContextFacts,
} from "./context.js";
import { heardRequest, spokenWords, UNHEARD_COMMENTARY } from "./heard.js";
import type { PronunciationStore } from "./pronunciations.js";
import { livePrompt } from "./prompt.js";
import type { LiveTrialClaimStore } from "./trial-claim.js";
import {
  createSpeechMeter,
  speechSignalOf,
  withHint,
  type LiveTrialUsageStore,
  type SpeechMeter,
} from "./trial.js";

/** The exchange since the previous delegation that Q Brain is shown. */
const LEAD_TURNS_MAX = 6;
const LEAD_TURN_MAX_CHARS = 600;

/**
 * The turns the person and the voice exchanged since the previous
 * delegation, before this request (a clarifying question and its answer,
 * the voice saying back what it understood): shown to Q Brain before the
 * request, so a fragment ("especially across FinTech") is read with what
 * it answers. Transcriber markers and empty turns are dropped; the
 * request's own words, at the end of the window, are not repeated.
 */
export function leadTurns(
  context: LiveDelegationRequest["context"],
  request: string,
): VoiceTranscriptTurn[] {
  const turns = (context ?? [])
    .map((turn) => ({
      role: turn.role === "q" ? ("agent" as const) : ("user" as const),
      content: spokenWords(turn.text).slice(0, LEAD_TURN_MAX_CHARS),
    }))
    .filter((turn) => turn.content.length > 0);
  const asked = spokenWords(request);
  while (turns.length > 0) {
    const last = turns[turns.length - 1];
    if (last?.role !== "user" || !asked.includes(last.content)) break;
    turns.pop();
  }
  return turns.slice(-LEAD_TURNS_MAX);
}

/**
 * The screen move a run recorded on the turn board, when it is a route
 * move the router will give a receipt for: a NAVIGATE destination, or an
 * OPEN_RECORD_PAGE / OPEN_SETUP / OPEN_SETTINGS action. A data-room
 * document opens in the viewer where they are (no route, no receipt), so
 * it is not a move the voice waits on (C's review of 4f1c2219).
 */
export function liveMoveOf(board: {
  readonly navigate: unknown;
  readonly clientAction?: unknown;
  readonly clientActions?: readonly unknown[] | undefined;
}): LiveMove | null {
  const actions =
    board.clientActions !== undefined && board.clientActions.length > 0
      ? board.clientActions
      : board.clientAction === undefined || board.clientAction === null
        ? []
        : [board.clientAction];
  let action: LiveMove["action"] = null;
  for (const raw of actions) {
    const parsed = QClientActionIntentSchema.safeParse(raw);
    if (!parsed.success) continue;
    const one = parsed.data;
    if (
      (one.kind === "OPEN_RECORD_PAGE" && one.page !== "DATA_ROOM_DOCUMENT") ||
      one.kind === "OPEN_SETUP" ||
      one.kind === "OPEN_SETTINGS"
    ) {
      // The screen performs them in order: the last one is where it lands.
      action = one;
    }
  }
  const destination = QVoiceDestinationSchema.safeParse(board.navigate);
  const navigate = destination.success ? destination.data : null;
  return navigate === null && action === null ? null : { navigate, action };
}

/**
 * The GPT-Live line (workstream V). GPT-Live is the voice; Q Brain is the
 * authority. Each delegation the voice makes is answered by ONE run of the
 * same voice turn handler the standard and duplex lines use, so Q's
 * conversation, cards (by run), navigation, approvals and Work happen
 * exactly as they do there. The voice only ever receives what that run
 * verified, to say in its own words.
 */

export type LiveRefusal =
  | "OFF"
  | "REHEARSAL"
  | "CAP_REACHED"
  | "LEDGER_UNAVAILABLE"
  | "DENIED"
  | "INELIGIBLE"
  | "PROVIDER_UNAVAILABLE"
  /**
   * The provider refused for quota or rate (429; 2026-10-09 the account
   * ran out of credit). Every OpenAI voice line shares it, so the client
   * skips the duplex line and goes straight to the standard voice.
   */
  | "PROVIDER_QUOTA"
  /**
   * The person's live-voice trial allowance is used up (429). A LIVE-only
   * trial binding permits no unmetered fallback.
   */
  | "TRIAL_SPENT"
  | "TRIAL_IN_USE";

export type LiveOpenOutcome =
  | { readonly kind: "OPEN"; readonly result: LiveOpenResult }
  | { readonly kind: "REFUSED"; readonly reason: LiveRefusal };

type Delegation = {
  readonly id: string;
  readonly request: string;
  readonly controller: AbortController;
  result: Promise<Omit<LiveDelegationResult, "stale">>;
  settled: boolean;
  /**
   * The first verified words the run said, once it has said some and has
   * neither held code-built facts nor moved the screen; null if the run
   * ended without that. Settles at most once.
   */
  first: Promise<string | null>;
  /** What was handed to the voice early; null until then. */
  partialSent: string | null;
  /** Everything the run said and the facts it held, when it ended. */
  ended: { readonly said: string; readonly facts: SpokenFacts | null } | null;
};

type LiveLine = {
  readonly voiceSessionId: string;
  /** The provider's session (GPT-Live), ended from here if left open. */
  readonly providerSessionId: string;
  /** Re-bound once, when the person's first organisation is created (ownLine). */
  actor: ActorContext;
  binding: VoiceSessionBinding;
  /** An onboarding conversation Q holds itself (see onboardingConversation). */
  readonly conversational: boolean;
  readonly openedAt: number;
  lastActivityAt: number;
  /** What Q was asked and verified on this line, oldest first (authority). */
  readonly history: VoiceTranscriptTurn[];
  readonly delegations: Map<string, Delegation>;
  /** The newest delegation; older results are returned stale. */
  latest: string | null;
  recordedSeconds: number;
  finalReported: boolean;
  /**
   * Delegations run one after another on a line, never over each other.
   * The voice turn handler supersedes (cancels) the run a line is waiting
   * on when a new turn starts; on GPT-Live the person's nudges ("still
   * waiting…") arrive as new delegations, and the founder's live test lost
   * a 25 s answer that way (2026-10-09). Queued, every answer lands.
   */
  tail: Promise<unknown>;
  /** Names Q said on this line, most recent first (the context package). */
  referents: string[];
  /**
   * Set on a persona line (a rehearsal with a researched external person):
   * the voice plays the prepared persona with no tools, nothing is
   * delegated, and its transcript is kept as the rehearsal's turns.
   */
  rehearsalId?: string | undefined;
  /** Q owns the dialogue; audio delegates through the existing rehearsal turn handler. */
  qBackedRehearsal?: boolean;
  /** Set on a trial person's line: its allowance and speech meter. */
  trial?: TrialLine | undefined;
};

/** A trial line's allowance accounting (trial.ts). */
type TrialLine = {
  readonly claimId: string;
  closing: Promise<boolean> | null;
  /** Only a server sideband session.closed event establishes this. */
  providerTerminated: boolean;
  readonly allowanceSeconds: number;
  /** The person's seconds on every other session, as last read. */
  othersSeconds: number;
  readonly meter: SpeechMeter;
  observer: {
    readonly stop: () => void;
    readonly ready?: Promise<boolean>;
  } | null;
  /**
   * Observation was lost here. The line ends immediately and its claim
   * stays held: unknown audio cannot be refunded or guessed as silence.
   */
  lostAt: number | null;
  /** What the meter had measured when the sideband was lost, ms. */
  lostBaseMs: number;
  /** The browser's own count (only ever raises the charge). */
  hintSeconds: number | undefined;
  persisting: Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
  ticks: number;
  spent: boolean;
  /** When the line ended: nothing after it is charged. */
  stoppedAt: number | null;
};

export type LiveBroker = {
  readonly enabled: boolean;
  readonly maxSessionMs: number;
  readonly open: (input: {
    readonly binding: VoiceSessionBinding;
    readonly sdp: string;
    readonly briefingOpening?: boolean | undefined;
    readonly firstName?: string | undefined;
    readonly locale?: string | undefined;
    /** What Q's backend can do for them, for the delegation policy. */
    readonly role?: "founder" | "investor" | undefined;
    /** Names this person is likely to say (their records, counterparts). */
    readonly names?: readonly string[] | undefined;
  }) => Promise<LiveOpenOutcome>;
  /** Null when there is no such line for this person. */
  readonly delegate: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly delegation: LiveDelegationRequest;
  }) => Promise<LiveDelegationResult | null>;
  /** True only once the run has actually stopped. Null: no such line. */
  readonly cancel: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly delegationId: string;
  }) => Promise<boolean | null>;
  readonly usage: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly report: LiveUsageReport;
  }) => Promise<{
    recordedSeconds: number;
    remainingMs: number;
    capReached?: boolean;
    trial?: QVoiceLiveTrial;
    trialSpent?: boolean;
  } | null>;
  /** Whether this person has a live-voice trial (config, no read). */
  readonly isTrialUser: (userId: string) => boolean;
  /**
   * This person's trial and what is left of it; null when they have no
   * trial. Throws when usage is unreadable or an account claim is held.
   */
  readonly trialFor: (actor: ActorContext) => Promise<QVoiceLiveTrial | null>;
  readonly end: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly reason: string;
  }) => boolean;
  /** Final transcript segments of the line; null: no such line of theirs. */
  readonly transcript: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly report: LiveTranscriptReport;
  }) => Promise<number | null>;
  readonly size: () => number;
};

export type LiveBrokerDependencies = {
  readonly config: LiveConfig;
  readonly provider: LiveVoiceProvider | undefined;
  readonly firewall: ContextFirewallPort;
  readonly turn: VoiceTurnHandler;
  readonly spend: DuplexSpendLedger;
  readonly usage: ModelUsageRepository;
  /** OpenAI is UNREVIEWED: PUBLIC unless the deployment is synthetic. */
  readonly providerCeiling: ModelSensitivity;
  readonly syntheticDemo: boolean;
  readonly logger: Logger;
  /**
   * An authorized rehearsal audio mode: a prepared external persona or
   * Q-backed dialogue. Absent or null refuses; trial owners never switch
   * to an unmetered alternative provider.
   */
  readonly rehearsalLine?:
    | {
        readonly prepare: (
          actor: ActorContext,
          rehearsalId: string,
          hints: {
            readonly firstName?: string | undefined;
            readonly locale?: string | undefined;
          },
        ) => Promise<{
          readonly instructions: string;
          readonly qBacked?: boolean;
        } | null>;
        readonly record: (
          actor: ActorContext,
          rehearsalId: string,
          segments: LiveTranscriptReport["segments"],
        ) => Promise<number | null>;
        readonly latency?: ExternalRehearsalLatency | undefined;
      }
    | undefined;
  readonly now?: (() => number) | undefined;
  /**
   * The trial's persisted use (q_runtime.voice_live_trial_usage). Absent,
   * a trial person's line is refused: their use could not be counted.
   */
  readonly trialUsage?: LiveTrialUsageStore | undefined;
  readonly trialClaims?: LiveTrialClaimStore | undefined;
  /**
   * q_runtime.voice_line_turns (A's duplex write path): both sides of the
   * line, routed 'live', so what GPT-Live said can be audited.
   */
  readonly transcripts?: Pick<DuplexTranscriptStore, "record"> | undefined;
  /**
   * Owner 2026-10-27: an onboarding line is a conversation Q holds itself;
   * this keeps what is said in the onboarding thread and saves it from the
   * transcript. Absent: the guided interview (every answer delegated).
   */
  readonly onboardingConversation?:
    | Pick<OnboardingConversation, "brief" | "heard" | "ended" | "settle">
    | undefined;
  /**
   * Part 6: the person's approved background (side, organisation, declared
   * mandate or company card facts), for the call's context package.
   */
  readonly contextFor?:
    ((actor: ActorContext) => Promise<LiveContextFacts | null>) | undefined;
  /**
   * W1: what Q told them on arrival, for the call's context package (the
   * same snapshot the welcome and Q's turns are given).
   */
  readonly arrivalFor?:
    ((actor: ActorContext) => Promise<ArrivalSnapshot | null>) | undefined;
  /**
   * W3: verified and user-corrected name pronunciations. Read into the
   * call's context as a hint list; a spoken correction ("it's pronounced
   * KISH-ta") is stored for this person.
   */
  readonly pronunciations?:
    Pick<PronunciationStore, "hintsFor" | "recordCorrection"> | undefined;
  /**
   * W5: one compact line per prepared public research entity (name, kind,
   * one line, stable id), read from memory: no database, no web.
   */
  readonly preparedEntityLines?: (() => readonly string[]) | undefined;
  /**
   * The voice turn board (what the turn handler recorded for the line):
   * read after a run, so the delegation's result says whether the run
   * moved the screen, and the client follows it before the voice speaks.
   */
  readonly board?:
    | {
        readonly read: (voiceSessionId: string) => {
          readonly sequence: number;
          readonly navigate: unknown;
          readonly clientAction?: unknown;
          readonly clientActions?: readonly unknown[] | undefined;
        };
      }
    | undefined;
};

const HISTORY_MAX = 24;
const SPOKEN_MAX = 6_000;
/** Creating a WebRTC session bills this much up front (OpenAI docs). */
const MIN_BILLED_SECONDS = 15;
/** An unreported line is estimated at wall-clock, at most this past the cap. */
const GRACE_MS = 30_000;
/** How often lines are checked for expiry and inactivity (on a timer). */
export const LIVE_SWEEP_MS = 30_000;
/**
 * No request from the browser for this long past the idle window (no usage,
 * transcript, delegation): the browser is gone (a killed tab, a connect
 * that failed after /open). A live call posts its transcript every few
 * seconds of speech, and the browser itself closes after `idleMs` silence.
 */
export const LIVE_INACTIVE_GRACE_MS = 2 * 60 * 1000;
/** A trial line checks its allowance this often (and on every signal). */
export const TRIAL_TICK_MS = 1_000;
/** ... and saves its use every this many ticks (and when it ends). */
export const TRIAL_PERSIST_TICKS = 5;

/** Q's run, collected: what it said, or the facts of a code-built answer. */
function collector(
  id: string,
  /** Called once, with the first words, while the run is still going. */
  onFirstWords?: (said: string, facts: SpokenFacts | null) => void,
): {
  readonly speaker: VoiceSpeaker;
  readonly said: () => string;
  readonly held: () => SpokenFacts | null;
} {
  let text = "";
  let held: SpokenFacts | null = null;
  let announced = false;
  const add = (part: string) => {
    const trimmed = part.trim();
    if (trimmed.length === 0 || text.length >= SPOKEN_MAX) return;
    text = text.length === 0 ? trimmed : `${text} ${trimmed}`;
    if (!announced) {
      announced = true;
      onFirstWords?.(text, held);
    }
  };
  return {
    speaker: {
      providerConversationId: id,
      isOpen: true,
      speak: async (response) => {
        if (typeof response === "string") add(response);
        else for await (const part of response) add(part);
      },
      close: () => undefined,
      // Nothing is heard until the run is done: the voice says it.
      deferred: true,
      // ADR 0062's silence ladder is not used: GPT-Live keeps the
      // conversation going itself; progress goes as quiet context.
      narrate: () => undefined,
      facts: (facts) => {
        held = facts;
      },
    },
    said: () => text.slice(0, SPOKEN_MAX),
    held: () => held,
  };
}

export const LIVE_SPEAK_GUIDE =
  "Verified by Q's backend. Say it in your own words, as an analyst would: the point first, then what separates the options. Never read it out as a list, never add names or numbers that are not here.";

/** What one run verified, as content for `session.commentary.append`. */
/**
 * The voice turn's SPOKEN output for the live line (founder 2026-10-09:
 * "Spheros thanked you and said the rest is on your screen"): what the
 * duplex line would say -- the facts' own spoken line and the names it
 * must say -- never the written answer. An attention item's note quotes
 * the counterpart's message ("They wrote: …"); it is never handed to the
 * voice, which paraphrased it. Other kinds keep their item details (fit,
 * strengths, unknowns) for follow-ups; none of those quote anyone.
 */
function spokenCommentary(facts: SpokenFacts, context: string): string {
  const say = `Say this in your own words: ${JSON.stringify(facts.fallback)}.`;
  const names =
    facts.mustSay.length === 0
      ? ""
      : ` Mention each of: ${JSON.stringify(facts.mustSay)}.`;
  const next =
    facts.next === null ? "" : ` You may offer: ${JSON.stringify(facts.next)}.`;
  if (facts.kind === "ATTENTION") {
    return `${LIVE_SPEAK_GUIDE} ${context} ${say}${names}${next} Never quote anyone's message.`;
  }
  return `${LIVE_SPEAK_GUIDE} ${context} ${say}${names}${next} Details for follow-up questions: ${JSON.stringify(askQFactsOutput(facts))}`;
}

/** The start of an answer, handed to the voice while the run goes on. */
export function partialCommentary(request: string, words: string): string {
  const { say } = forRealtime(words);
  return `${LIVE_SPEAK_GUIDE} They asked: ${JSON.stringify(request.slice(0, 300))}. Q's backend has begun answering and the rest follows in a moment: say this much in your own words now, and do not close or ask whether they want more yet: ${JSON.stringify(say)}`;
}

/**
 * What the voice still has to say once its start was handed over early:
 * the rest of the words (never the start again), or the run's own facts
 * and flags when it ended differently from how it began.
 */
function restOf(
  running: Pick<Delegation, "request" | "partialSent" | "ended">,
  result: Omit<LiveDelegationResult, "stale">,
): Omit<LiveDelegationResult, "stale"> {
  const ended = running.ended;
  const sent = running.partialSent ?? "";
  if (ended === null) return result;
  const already =
    "You have already said the start of this answer; say only what follows, continuing naturally, never repeating it. ";
  if (ended.facts !== null) {
    return {
      ...result,
      commentary:
        result.commentary === null ? null : `${already}${result.commentary}`,
    };
  }
  const rest = ended.said.startsWith(sent)
    ? ended.said.slice(sent.length).trim()
    : ended.said;
  const commentary = commentaryFor({
    request: running.request,
    facts: null,
    said: rest,
    approvalPending: result.approvalPending,
  });
  return {
    ...result,
    commentary: commentary === null ? null : `${already}${commentary}`,
  };
}

export function commentaryFor(input: {
  readonly request: string;
  readonly facts: SpokenFacts | null;
  readonly said: string;
  readonly approvalPending: boolean;
}): string | null {
  const asked = `They asked: ${JSON.stringify(input.request.slice(0, 300))}.`;
  const approval = input.approvalPending
    ? " Q prepared an action that waits for their approval on screen: say it is ready for them to approve; never say it is done."
    : "";
  if (input.facts !== null) {
    return spokenCommentary(input.facts, `${asked}${approval}`);
  }
  const { say } = forRealtime(input.said);
  const words = input.approvalPending
    ? say.replace(APPROVAL_QUESTION, "").trim()
    : say;
  if (words.length === 0)
    return input.approvalPending ? `${asked}${approval}` : null;
  return `${LIVE_SPEAK_GUIDE} ${asked}${approval} Q's answer: ${JSON.stringify(words)}`;
}

/** The onboarding conversation a line carries, or null for any other line. */
function conversationLineOf(
  actor: ActorContext,
  binding: VoiceSessionBinding,
): ConversationLine | null {
  const onboarding = binding.thread.onboarding;
  if (onboarding === undefined) return null;
  return {
    voiceSessionId: binding.voiceSessionId,
    actor,
    accessToken: binding.accessToken,
    onboarding: {
      sessionId: onboarding.sessionId,
      journeyType: onboarding.journeyType,
    },
  };
}

export function createLiveBroker(deps: LiveBrokerDependencies): LiveBroker {
  const { config, provider, firewall, turn, spend, logger } = deps;
  const now = deps.now ?? Date.now;
  const lines = new Map<string, LiveLine>();
  // A failed write leaves speech unaccounted for; this process must not
  // reopen that owner on a stale persisted balance.
  const failedTrialWrites = new Set<string>();
  const trialOwner = (actor: ActorContext) => actor.userId;
  const enabled = config.enabled && provider !== undefined;

  const pastCap = (line: LiveLine, at: number) =>
    at - line.openedAt > config.maxSessionMs;

  /** Billed seconds onto the shared realtime ledger, once each. */
  const record = async (line: LiveLine, seconds: number) => {
    const delta = Math.max(0, Math.floor(seconds) - line.recordedSeconds);
    if (delta === 0 || provider === undefined) return;
    line.recordedSeconds += delta;
    try {
      await deps.usage.record({
        tenantId: line.actor.tenantId,
        userId: line.actor.userId,
        qRunId: undefined,
        taskClass: "REALTIME_VOICE",
        providerId: provider.providerId,
        modelId: provider.modelId,
        routingPolicyId: undefined,
        attempt: 1,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        costUsd: delta * GPT_LIVE_USD_PER_SECOND,
        costBasis: "ESTIMATED",
        success: true,
        errorCode: undefined,
        correlationId: `live_${line.voiceSessionId}`,
        purpose: "VOICE_REALTIME",
      });
    } catch (error: unknown) {
      logger.warn({ err: error }, "live voice usage could not be recorded");
    }
  };

  // --- The trial (trial.ts) -------------------------------------------------

  const trialAllowance = (userId: string) =>
    config.trial.get(userId.toLowerCase());

  /** This trial line's charge so far, seconds. */
  const trialLineSeconds = (line: LiveLine, at: number): number => {
    const trial = line.trial;
    if (trial === undefined) return 0;
    // Nothing after the line ended counts.
    const until = Math.min(at, trial.stoppedAt ?? at);
    const ms =
      trial.lostAt === null ? trial.meter.measuredMs(until) : trial.lostBaseMs;
    return withHint(
      ms / 1000,
      trial.hintSeconds,
      (until - line.openedAt) / 1000,
    );
  };

  const trialRemaining = (line: LiveLine, at: number): number => {
    const trial = line.trial;
    if (trial === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(
      0,
      trial.allowanceSeconds - trial.othersSeconds - trialLineSeconds(line, at),
    );
  };

  /**
   * The line's charge into Postgres (only ever raised), one write at a
   * time, and every other session of theirs read back: a second device's
   * use reaches this line within one persist.
   */
  const persistTrial = (line: LiveLine): Promise<void> => {
    const trial = line.trial;
    const store = deps.trialUsage;
    if (
      trial === undefined ||
      store === undefined ||
      failedTrialWrites.has(trialOwner(line.actor))
    )
      return Promise.resolve();
    trial.persisting = trial.persisting.then(async () => {
      const seconds = trialLineSeconds(line, now());
      try {
        const total = await store.record({
          actor: line.actor,
          providerSessionId: line.providerSessionId,
          voiceSessionId: line.voiceSessionId,
          seconds,
        });
        trial.othersSeconds = Math.max(0, total - seconds);
      } catch (error: unknown) {
        failedTrialWrites.add(trialOwner(line.actor));
        logger.warn({ err: error }, "live voice trial use could not be saved");
        if (lines.get(line.voiceSessionId) === line)
          forget(line, "trial_ledger_unavailable");
      }
    });
    return trial.persisting;
  };

  /** Past the allowance: the line ends now (its provider session too). */
  const checkTrial = (line: LiveLine) => {
    const trial = line.trial;
    if (trial === undefined || trial.spent) return;
    if (trialRemaining(line, now()) > 0) return;
    trial.spent = true;
    logger.info(
      { qVoiceSessionId: line.voiceSessionId },
      "live voice trial allowance used up: line ended",
    );
    if (lines.get(line.voiceSessionId) === line) forget(line, "trial_spent");
  };

  const startTrial = (line: LiveLine) => {
    const trial = line.trial;
    if (trial === undefined) return;
    const lose = () => {
      if (trial.lostAt !== null || trial.providerTerminated) return;
      const at = now();
      trial.lostBaseMs = trial.meter.measuredMs(at);
      trial.lostAt = at;
      logger.warn(
        { qVoiceSessionId: line.voiceSessionId },
        "live voice trial meter lost: ending unmeasured line",
      );
      if (lines.get(line.voiceSessionId) === line)
        forget(line, "trial_meter_unavailable");
    };
    if (provider?.observeSession === undefined) {
      lose();
    } else {
      trial.observer = provider.observeSession(line.providerSessionId, {
        onEvent: (event) => {
          if (trial.stoppedAt !== null) return;
          const signal = speechSignalOf(event);
          if (signal === null) return;
          trial.meter.signal(signal, now());
          if (signal.kind === "closed") {
            trial.providerTerminated = true;
            trial.stoppedAt = now();
            if (lines.get(line.voiceSessionId) === line)
              forget(line, "provider_closed");
            return;
          }
          checkTrial(line);
        },
        onLost: lose,
      });
    }
    if (lines.get(line.voiceSessionId) !== line) {
      trial.observer?.stop();
      trial.observer = null;
      return;
    }
    trial.timer = setInterval(() => {
      trial.ticks += 1;
      checkTrial(line);
      if (!trial.spent && trial.ticks % TRIAL_PERSIST_TICKS === 0)
        void persistTrial(line);
    }, TRIAL_TICK_MS);
    trial.timer.unref();
  };

  const stopTrial = (line: LiveLine) => {
    const trial = line.trial;
    if (trial === undefined) return;
    if (trial.timer !== null) clearInterval(trial.timer);
    trial.timer = null;
    const at = trial.stoppedAt ?? now();
    // Freeze only after provider termination (or uncertainty retaining the claim).
    trial.meter.signal({ kind: "closed" }, at);
    trial.stoppedAt = at;
    trial.observer?.stop();
    trial.observer = null;
    void persistTrial(line);
  };

  const forget = (line: LiveLine, reason: string) => {
    lines.delete(line.voiceSessionId);
    // Whatever was said last is kept and read once more, on the server:
    // the person closing the tab loses nothing already heard.
    if (line.conversational) {
      const conversationLine = conversationLineOf(line.actor, line.binding);
      if (conversationLine !== null) {
        void deps.onboardingConversation
          ?.ended(conversationLine)
          .catch((error: unknown) => {
            logger.warn(
              { err: error, qVoiceSessionId: line.voiceSessionId },
              "onboarding conversation could not be kept at the line's end",
            );
          });
      }
    }
    // Logical removal prevents new work, but the provider can still speak
    // while its asynchronous shutdown is in flight. Keep observation alive
    // until termination is confirmed; otherwise the final ledger is incomplete.
    if (line.trial?.timer != null) clearInterval(line.trial.timer);
    if (line.trial !== undefined) line.trial.timer = null;
    for (const delegation of line.delegations.values()) {
      if (!delegation.settled) delegation.controller.abort();
    }
    // A line that never sent its final usage is billed at wall-clock, up
    // to the cap: unknown spend is not zero spend.
    if (!line.finalReported) {
      const elapsed = Math.min(
        now() - line.openedAt,
        config.maxSessionMs + GRACE_MS,
      );
      void record(line, Math.max(MIN_BILLED_SECONDS, elapsed / 1000));
    }
    logger.info(
      {
        qVoiceSessionId: line.voiceSessionId,
        reason,
        delegations: line.delegations.size,
        recordedSeconds: line.recordedSeconds,
      },
      "live voice line ended",
    );
    // The provider session is ended from here too, unless its browser saw
    // it close (final usage): a superseded, expired, abandoned or failed
    // line never keeps billing because its browser did not close it.
    if (!line.finalReported || line.trial !== undefined) {
      const closing = (
        line.trial?.providerTerminated === true
          ? Promise.resolve(true)
          : (provider?.closeSession?.(line.providerSessionId) ??
            Promise.resolve(false))
      )
        .then(async (confirmed) => {
          logger.info(
            { qVoiceSessionId: line.voiceSessionId, reason, confirmed },
            "live voice provider session closed from the server",
          );
          const trial = line.trial;
          if (trial === undefined) return confirmed;
          stopTrial(line);
          await trial.persisting;
          if (
            !confirmed ||
            trial.lostAt !== null ||
            failedTrialWrites.has(trialOwner(line.actor)) ||
            deps.trialClaims === undefined
          )
            return false;
          // Match numeric(9,2) canonical usage rounding before releasing.
          const finalSeconds =
            Math.round(trialLineSeconds(line, now()) * 100) / 100;
          return deps.trialClaims.release({
            actor: line.actor,
            claimId: trial.claimId,
            providerSessionId: line.providerSessionId,
            finalSeconds,
            providerTerminated: true,
          });
        })
        .catch((error: unknown) => {
          stopTrial(line);
          logger.warn({ err: error }, "live voice trial claim remains held");
          return false;
        });
      if (line.trial !== undefined) line.trial.closing = closing;
    }
  };

  const sweep = () => {
    const at = now();
    for (const line of [...lines.values()]) {
      if (at - line.openedAt > config.maxSessionMs + GRACE_MS) {
        forget(line, "expired");
      } else if (
        at - line.lastActivityAt >
        config.idleMs + LIVE_INACTIVE_GRACE_MS
      ) {
        forget(line, "inactive");
      }
    }
  };
  // On a timer too, not only on this person's next request: a line whose
  // browser is gone is ended (and its provider session closed) in time.
  const sweeper = setInterval(sweep, LIVE_SWEEP_MS);
  sweeper.unref();

  const ownLine = (actor: ActorContext, voiceSessionId: string) => {
    sweep();
    const line = lines.get(voiceSessionId);
    if (line === undefined || line.actor.userId !== actor.userId) return null;
    if (line.actor.tenantId === actor.tenantId) return line;
    // Onboarding creates the person's first organisation mid-call: the line
    // was opened under the personal bootstrap tenant (which holds nothing of
    // anyone's), and the same person now acts in their new organisation.
    // Only that one move is followed; a line opened inside one organisation
    // never carries over into another (its context was read for that one).
    if (
      line.actor.tenantId === PERSONAL_BOOTSTRAP_TENANT_ID &&
      actor.organisationId !== undefined
    ) {
      line.actor = actor;
      line.binding = { ...line.binding, actor };
      return line;
    }
    return null;
  };

  /**
   * W3: "it's pronounced X" / "the name is spelled Y" said on the line is
   * kept for this person under the name it is about (named in the
   * sentence, else the one Q said last). It is their word, stored as
   * theirs; nothing is inferred when no name can be tied to it.
   */
  const learnCorrection = async (line: LiveLine, said: string) => {
    const store = deps.pronunciations;
    if (store === undefined) return;
    const correction = parseNameCorrection(spokenWords(said));
    if (correction === null) return;
    const name = correction.name ?? line.referents[0] ?? null;
    if (name === null) return;
    try {
      await store.recordCorrection({
        actor: line.actor,
        name,
        kind: correction.kind,
        value: correction.value,
      });
    } catch (error: unknown) {
      logger.warn({ err: error }, "name correction could not be stored");
    }
  };

  const reserved = () => {
    let total = 0;
    for (const line of lines.values()) {
      total += Math.max(
        0,
        config.sessionReserveUsd -
          line.recordedSeconds * GPT_LIVE_USD_PER_SECOND,
      );
    }
    return total;
  };

  /** ONE run of Q Brain for one delegation. */
  const runQ = (
    line: LiveLine,
    id: string,
    request: string,
    lead: readonly VoiceTranscriptTurn[] = [],
  ): Delegation => {
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const before = line.tail;
    let sequenceBefore = 0;
    let releaseFirst: (words: string | null) => void = () => undefined;
    const first = new Promise<string | null>((resolve) => {
      releaseFirst = resolve;
    });
    const speaker = collector(`live_${line.voiceSessionId}`, (said, facts) => {
      // Early only for plain words the model wrote: code-built facts are
      // said from the whole run, an approval question ends the answer, and
      // a screen move is followed before the voice speaks at all.
      const moved =
        (deps.board?.read(line.voiceSessionId).sequence ?? 0) > sequenceBefore;
      if (facts !== null || moved || said.includes(APPROVAL_QUESTION)) return;
      releaseFirst(said);
    });
    const asked: VoiceTranscriptTurn = { role: "user", content: request };
    const startedAt = now();
    const delegation: Delegation = {
      id,
      request,
      controller,
      settled: false,
      first,
      partialSent: null,
      ended: null,
      result: Promise.resolve({
        delegationId: id,
        commentary: null,
        approvalPending: false,
        failed: true,
      }),
    };
    delegation.result = (async () => {
      try {
        // After the delegation before it on this line, whatever its end.
        await before.catch(() => undefined);
        if (controller.signal.aborted) {
          return {
            delegationId: id,
            commentary: null,
            approvalPending: false,
            failed: true,
          };
        }
        deadline = setTimeout(() => {
          controller.abort();
        }, config.delegationDeadlineMs);
        sequenceBefore = deps.board?.read(line.voiceSessionId).sequence ?? 0;
        const outcome = await turn(
          line.binding,
          // GPT-Live already ended their turn: never held as unfinished.
          settledTurn([...line.history, ...lead, asked]),
          controller.signal,
          speaker.speaker,
        );
        if (controller.signal.aborted || outcome.kind === "INTERRUPTED") {
          return {
            delegationId: id,
            commentary: controller.signal.aborted
              ? "That request did not come back from Q's backend. Say plainly it didn't come through and offer to try it again; never invent it."
              : null,
            approvalPending: false,
            failed: true,
          };
        }
        const said = speaker.said();
        const facts = speaker.held();
        delegation.ended = { said, facts };
        const approvalPending = said.endsWith(APPROVAL_QUESTION);
        const commentary =
          line.qBackedRehearsal === true
            ? `Speak this Q-generated counterpart line exactly, without additions: ${JSON.stringify(said)}`
            : commentaryFor({ request, facts, said, approvalPending });
        line.history.push(...lead, asked);
        line.referents = [
          ...referentsOf(facts?.mustSay),
          ...line.referents,
        ].slice(0, REFERENTS_MAX);
        const kept = facts?.fallback ?? said;
        if (kept.length > 0)
          line.history.push({ role: "agent", content: kept });
        line.history.splice(0, Math.max(0, line.history.length - HISTORY_MAX));
        // The run moved the screen (a NAVIGATE or OPEN_RECORD_PAGE intent
        // on its turn): the client follows it, and waits for the router's
        // receipt, before the voice says anything about it.
        const after = deps.board?.read(line.voiceSessionId);
        const move =
          after !== undefined && after.sequence > sequenceBefore
            ? liveMoveOf(after)
            : null;
        return {
          delegationId: id,
          commentary,
          approvalPending,
          failed: false,
          ...(move !== null ? { move } : {}),
        };
      } catch (error: unknown) {
        logger.warn(
          { err: error, qVoiceSessionId: line.voiceSessionId },
          "live delegation failed",
        );
        return {
          delegationId: id,
          commentary:
            "Q's backend could not complete that. Say so plainly and offer to try again; do not invent an answer.",
          approvalPending: false,
          failed: true,
        };
      } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        delegation.settled = true;
        // No early words came: whoever waits for them stops waiting.
        releaseFirst(null);
        logger.info(
          {
            qVoiceSessionId: line.voiceSessionId,
            ms: now() - startedAt,
            aborted: controller.signal.aborted,
          },
          "live delegation answered",
        );
      }
    })();
    line.tail = delegation.result;
    return delegation;
  };

  return {
    enabled,
    maxSessionMs: config.maxSessionMs,
    size: () => {
      sweep();
      return lines.size;
    },

    open: async ({
      binding,
      sdp,
      briefingOpening,
      firstName,
      locale,
      role,
      names,
    }) => {
      if (!enabled || provider === undefined)
        return { kind: "REFUSED", reason: "OFF" };
      // Rehearsals must have an authorized prepared audio mode: a public
      // external persona, or Q-backed dialogue on the canonical rehearsal.
      let persona: {
        readonly instructions: string;
        readonly qBacked?: boolean;
      } | null = null;
      const rehearsal = binding.thread.rehearsal;
      if (rehearsal !== undefined) {
        persona =
          deps.rehearsalLine === undefined
            ? null
            : await deps.rehearsalLine
                .prepare(binding.actor, rehearsal.rehearsalId, {
                  firstName,
                  locale,
                })
                .catch(() => null);
        if (persona === null) return { kind: "REFUSED", reason: "REHEARSAL" };
      }
      const { actor } = binding;
      // The trial: a person with an allowance opens a line only while some
      // of it is left; their use is read from Postgres (any device, any
      // instance). An unreadable use refuses: unknown is not unused.
      const allowance = trialAllowance(actor.userId);
      let carried: Pick<LiveLine, "history" | "referents"> | null = null;
      let trialUsed = 0;
      if (allowance !== undefined) {
        // Stop and durably flush this process's old line BEFORE reading its
        // balance. Reading first allowed an immediate reconnect to reuse it.
        for (const line of [...lines.values()]) {
          if (line.actor.userId !== actor.userId) continue;
          if (line.voiceSessionId === binding.voiceSessionId)
            carried = { history: line.history, referents: line.referents };
          forget(line, "replaced");
          await line.trial?.closing;
          await line.trial?.persisting;
        }
        if (failedTrialWrites.has(trialOwner(actor)))
          return { kind: "REFUSED", reason: "LEDGER_UNAVAILABLE" };
        if (
          deps.trialUsage === undefined ||
          deps.trialClaims === undefined ||
          provider.observeSession === undefined ||
          provider.closeSession === undefined
        )
          return { kind: "REFUSED", reason: "LEDGER_UNAVAILABLE" };
        try {
          trialUsed = await deps.trialUsage.usedSeconds(actor);
        } catch (error: unknown) {
          logger.warn({ err: error }, "live voice trial use unreadable");
          return { kind: "REFUSED", reason: "LEDGER_UNAVAILABLE" };
        }
        if (trialUsed >= allowance)
          return { kind: "REFUSED", reason: "TRIAL_SPENT" };
      }
      sweep();
      // One live line per person: a new one replaces what was open. A
      // renewal of the same call (same voice session) keeps what Q was
      // asked and said, and the names discussed.
      for (const line of [...lines.values()]) {
        if (line.actor.userId !== actor.userId) continue;
        if (line.voiceSessionId === binding.voiceSessionId) {
          carried = { history: line.history, referents: line.referents };
        }
        forget(line, "replaced");
      }
      let spent: number;
      try {
        spent = await spend.spentTodayUsd(new Date(now()));
      } catch (error: unknown) {
        logger.warn({ err: error }, "live voice spend ledger unreadable");
        return { kind: "REFUSED", reason: "LEDGER_UNAVAILABLE" };
      }
      if (spent + reserved() + config.sessionReserveUsd > config.dailyCapUsd) {
        return { kind: "REFUSED", reason: "CAP_REACHED" };
      }
      // The Context Firewall before any model hears a word: the plan says
      // what this line may carry, and the provider must be cleared for it.
      const decision = await firewall.plan({
        actor,
        runId: QRunIdSchema.parse(randomUUID()),
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
        capability: "ANSWER",
        subjects: binding.thread.subjects ?? [],
        ...(binding.thread.screen === undefined
          ? {}
          : { screen: binding.thread.screen }),
      });
      if (decision.outcome === "DENIED")
        return { kind: "REFUSED", reason: "DENIED" };
      if (
        !sensitivityWithin(
          decision.plan.maxSensitivity,
          deps.providerCeiling,
        ) &&
        !deps.syntheticDemo
      ) {
        return { kind: "REFUSED", reason: "INELIGIBLE" };
      }
      let trialClaim: {
        readonly claimId: string;
        readonly remainingSeconds: number;
      } | null = null;
      if (allowance !== undefined) {
        try {
          trialClaim =
            (await deps.trialClaims?.claim({
              actor,
              allowanceSeconds: allowance,
              voiceSessionId: binding.voiceSessionId,
            })) ?? null;
        } catch (error: unknown) {
          logger.warn({ err: error }, "live voice trial claim unavailable");
          return { kind: "REFUSED", reason: "LEDGER_UNAVAILABLE" };
        }
        if (trialClaim === null)
          return { kind: "REFUSED", reason: "TRIAL_IN_USE" };
        trialUsed = allowance - trialClaim.remainingSeconds;
      }
      // Owner 2026-10-27: an onboarding call is a conversation Q holds from
      // the setup's checklist; with no checklist it stays the guided one.
      const conversationLine = conversationLineOf(actor, binding);
      const interview =
        persona !== null ||
        conversationLine === null ||
        deps.onboardingConversation === undefined
          ? null
          : await deps.onboardingConversation.brief(conversationLine);
      let created;
      try {
        created = await provider.createWebRtcSession({
          config: {
            instructions:
              persona !== null
                ? persona.instructions
                : livePrompt({
                    firstName,
                    locale,
                    briefingOpening,
                    role,
                    names,
                    guided:
                      binding.thread.onboarding !== undefined ||
                      binding.thread.welcome === true,
                    ...(interview === null ? {} : { interview }),
                  }),
            voice: config.voices[binding.voice],
          },
          sdp,
        });
      } catch (error: unknown) {
        // An explicit provider rejection proves no session was created. A
        // timeout, parse error or server error is ambiguous: retain the claim.
        if (
          trialClaim !== null &&
          error instanceof LiveProviderError &&
          error.status !== null &&
          [400, 401, 403, 404, 422, 429].includes(error.status)
        ) {
          await deps.trialClaims
            ?.release({
              actor,
              claimId: trialClaim.claimId,
              providerSessionId: null,
              finalSeconds: 0,
              providerTerminated: true,
            })
            .catch((releaseError: unknown) => {
              logger.warn(
                { err: releaseError },
                "rejected provider trial claim remains held",
              );
            });
        }
        logger.warn({ err: error }, "live voice session not created");
        return {
          kind: "REFUSED",
          reason:
            error instanceof LiveProviderError && error.status === 429
              ? "PROVIDER_QUOTA"
              : "PROVIDER_UNAVAILABLE",
        };
      }
      const at = now();
      const line: LiveLine = {
        voiceSessionId: binding.voiceSessionId,
        providerSessionId: created.sessionId,
        actor,
        binding,
        conversational: interview !== null,
        openedAt: at,
        lastActivityAt: at,
        history: carried === null ? [] : [...carried.history],
        delegations: new Map(),
        latest: null,
        recordedSeconds: 0,
        finalReported: false,
        tail: Promise.resolve(),
        referents: carried === null ? [] : [...carried.referents],
        ...(persona === null || rehearsal === undefined
          ? {}
          : persona.qBacked === true
            ? { qBackedRehearsal: true }
            : { rehearsalId: rehearsal.rehearsalId }),
        ...(allowance === undefined || trialClaim === null
          ? {}
          : {
              trial: {
                claimId: trialClaim.claimId,
                closing: null,
                providerTerminated: false,
                allowanceSeconds: allowance,
                othersSeconds: trialUsed,
                meter: createSpeechMeter({ authoritativeOpen: true }),
                observer: null,
                lostAt: null,
                lostBaseMs: 0,
                hintSeconds: undefined,
                persisting: Promise.resolve(),
                timer: null,
                ticks: 0,
                spent: false,
                stoppedAt: null,
              },
            }),
      };
      lines.set(binding.voiceSessionId, line);
      startTrial(line);
      if (line.trial !== undefined) {
        // A provider handle alone proves nothing: never return usable SDP
        // until the server can actually observe speech. Bound even an
        // adapter whose readiness promise never settles.
        let attachTimer: ReturnType<typeof setTimeout> | undefined;
        const attached = await Promise.race([
          line.trial.observer?.ready?.catch(() => false) ??
            Promise.resolve(false),
          new Promise<boolean>((resolve) => {
            attachTimer = setTimeout(
              () => resolve(false),
              OBSERVER_ATTACH_TIMEOUT_MS,
            );
          }),
        ]);
        clearTimeout(attachTimer);
        if (!attached || lines.get(binding.voiceSessionId) !== line) {
          if (lines.get(binding.voiceSessionId) === line) {
            line.trial.lostAt = now();
            line.trial.lostBaseMs = line.trial.meter.measuredMs(now());
            forget(line, "trial_observer_not_ready");
          }
          return { kind: "REFUSED", reason: "LEDGER_UNAVAILABLE" };
        }
      }
      // Part 6: the background note for this session (and its renewals).
      // A persona line gets none: its prepared context is the whole of what
      // it may use, and no record of the founder's rides in on the side.
      let facts: LiveContextFacts | null = null;
      let arrival: string[] = [];
      try {
        // A rehearsal persona line carries the persona only: no Q
        // background, no arrival briefing.
        if (persona === null) {
          const [read, snapshot] = await Promise.all([
            deps.contextFor?.(actor) ?? Promise.resolve(null),
            deps.arrivalFor?.(actor).catch(() => null) ?? Promise.resolve(null),
          ]);
          facts = read ?? null;
          arrival = arrivalLines(snapshot);
        } else {
          facts = null;
        }
      } catch (error: unknown) {
        // A failed read costs the call its background, never the call.
        logger.warn({ err: error }, "live voice context could not be read");
      }
      let pronunciations: readonly string[] = [];
      try {
        pronunciations = (await deps.pronunciations?.hintsFor(actor)) ?? [];
      } catch (error: unknown) {
        // A failed read costs the call its hints, never the call.
        logger.warn({ err: error }, "live voice pronunciations unreadable");
      }
      const context = liveContextPackage({
        firstName,
        role,
        facts,
        referents: carried?.referents ?? [],
        arrival,
        pronunciations,
        preparedEntities: deps.preparedEntityLines?.() ?? [],
      });
      // Context/hint reads are asynchronous. The observer may have failed
      // while they were in flight; a closed trial must never escape as OPEN.
      if (
        line.trial !== undefined &&
        lines.get(binding.voiceSessionId) !== line
      )
        return { kind: "REFUSED", reason: "LEDGER_UNAVAILABLE" };
      logger.info(
        { qVoiceSessionId: binding.voiceSessionId, model: created.model },
        "live voice line opened",
      );
      return {
        kind: "OPEN",
        result: {
          voiceSessionId: binding.voiceSessionId,
          ...(binding.sessionToken === undefined
            ? {}
            : { sessionToken: binding.sessionToken }),
          sdp: created.sdp,
          provider: "openai",
          model: created.model,
          maxSessionMs: config.maxSessionMs,
          idleMs: config.idleMs,
          context,
          ...(allowance === undefined
            ? {}
            : {
                trial: {
                  allowanceSeconds: allowance,
                  remainingSeconds: Math.floor(
                    Math.max(0, allowance - trialUsed),
                  ),
                },
              }),
        },
      };
    },

    delegate: async ({ actor, voiceSessionId, delegation }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      const at = now();
      line.lastActivityAt = at;
      if (pastCap(line, at)) {
        return {
          delegationId: delegation.delegationId,
          commentary: null,
          stale: false,
          approvalPending: false,
          failed: true,
          ended: true,
        };
      }
      // A persona line delegates nothing: no Q run, no tool, no search. The
      // voice is told there is nothing to add and carries on in character.
      if (line.rehearsalId !== undefined) {
        return {
          delegationId: delegation.delegationId,
          commentary: null,
          stale: false,
          approvalPending: false,
          failed: false,
        };
      }
      // An onboarding conversation: Q holds it, and the backend's part is
      // to save what was heard and say what is actually on the record.
      const conversationLine = line.conversational
        ? conversationLineOf(line.actor, line.binding)
        : null;
      if (
        conversationLine !== null &&
        deps.onboardingConversation !== undefined
      ) {
        try {
          const settled = await deps.onboardingConversation.settle(
            conversationLine,
            spokenWords(delegation.request).slice(0, 2_000),
          );
          return {
            delegationId: delegation.delegationId,
            commentary: settled.commentary,
            stale: false,
            approvalPending: false,
            failed: false,
            ...(settled.leave === true ? { leave: true as const } : {}),
          };
        } catch (error: unknown) {
          logger.warn(
            { err: error, qVoiceSessionId: line.voiceSessionId },
            "onboarding conversation could not be settled",
          );
          return {
            delegationId: delegation.delegationId,
            commentary:
              "Capital Q could not read their record back just now. Say plainly you couldn't check it this moment, that what they said is kept, and carry on.",
            stale: false,
            approvalPending: false,
            failed: true,
          };
        }
      }
      // One delegation id, one run: a repeat joins the run in flight.
      let running = line.delegations.get(delegation.delegationId);
      if (running === undefined) {
        const request = spokenWords(delegation.request).slice(0, 2_000);
        // Nothing usable was heard ("(inaudible)", empty, filler): no Q
        // run is created; the voice checks with the person instead.
        if (!heardRequest(request)) {
          logger.info(
            { qVoiceSessionId: line.voiceSessionId },
            "live delegation had no usable words: no Q run",
          );
          return {
            delegationId: delegation.delegationId,
            commentary: UNHEARD_COMMENTARY,
            stale: false,
            approvalPending: false,
            failed: false,
            unheard: true,
          };
        }
        running = runQ(
          line,
          delegation.delegationId,
          request,
          leadTurns(delegation.context, request),
        );
        line.delegations.set(delegation.delegationId, running);
        line.latest = delegation.delegationId;
      }
      // The first verified words, before the run ends, for a client that
      // asked for them. They go once; the same id asked again is the rest.
      if (delegation.early === true && running.partialSent === null) {
        const words = await running.first;
        if (words !== null && running.partialSent === null) {
          running.partialSent = words;
          return {
            delegationId: delegation.delegationId,
            commentary:
              line.qBackedRehearsal === true
                ? `Speak this Q-generated counterpart line exactly, without additions: ${JSON.stringify(words)}`
                : partialCommentary(running.request, words),
            stale: line.latest !== delegation.delegationId,
            approvalPending: false,
            failed: false,
            partial: true,
          };
        }
      }
      const result = await running.result;
      const stale = line.latest !== delegation.delegationId;
      if (running.partialSent !== null && !result.failed) {
        return { ...restOf(running, result), stale };
      }
      return { ...result, stale };
    },

    cancel: async ({ actor, voiceSessionId, delegationId }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      const running = line.delegations.get(delegationId);
      if (running === undefined) return false;
      if (running.settled) return false;
      running.controller.abort();
      // Confirmed only once the run has actually let go.
      await running.result;
      return true;
    },

    transcript: async ({ actor, voiceSessionId, report }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      line.lastActivityAt = now();
      if (line.rehearsalId !== undefined) {
        const timings = report.timings;
        if (timings?.firstAudioMs !== undefined) {
          deps.rehearsalLine?.latency?.record(
            "first_audio_ms",
            timings.firstAudioMs,
          );
        }
        for (const ms of timings?.turnLatencyMs ?? []) {
          deps.rehearsalLine?.latency?.record("turn_latency_ms", ms);
        }
        // The rehearsal keeps the words as its turns, for the evaluation.
        return (
          (await deps.rehearsalLine?.record(
            line.actor,
            line.rehearsalId,
            report.segments,
          )) ?? 0
        );
      }
      if (line.conversational) {
        const conversationLine = conversationLineOf(line.actor, line.binding);
        if (conversationLine !== null) {
          deps.onboardingConversation?.heard(conversationLine, report.segments);
        }
      }
      const store = deps.transcripts;
      if (store === undefined) return 0;
      const at = now();
      let recorded = 0;
      // In order, one at a time: the segments are one conversation.
      for (const segment of report.segments) {
        try {
          await store.record({
            actor: line.actor,
            voiceSessionId: line.voiceSessionId,
            conversationId: line.binding.thread.conversationId ?? null,
            role: segment.role,
            content: segment.text,
            routed: "live",
            // The browser's clock is input: never before the line, never ahead.
            spokenAt: new Date(
              Math.min(at, Math.max(line.openedAt, segment.at)),
            ),
          });
          recorded += 1;
          if (segment.role === "USER") {
            await learnCorrection(line, segment.text);
          }
        } catch (error: unknown) {
          logger.warn(
            { err: error, qVoiceSessionId: line.voiceSessionId },
            "live voice transcript could not be stored",
          );
        }
      }
      return recorded;
    },

    usage: async ({ actor, voiceSessionId, report }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      line.lastActivityAt = now();
      await record(
        line,
        report.final === true
          ? Math.max(MIN_BILLED_SECONDS, report.seconds)
          : report.seconds,
      );
      if (report.final === true) line.finalReported = true;
      // The trial: the browser's count may raise the charge, never lower
      // it (trialLineSeconds bounds it by the line's wall-clock length).
      const trial = line.trial;
      if (trial !== undefined) {
        if (report.speechSeconds !== undefined) {
          trial.hintSeconds = Math.max(
            trial.hintSeconds ?? 0,
            report.speechSeconds,
          );
        }
        checkTrial(line);
      }
      // The daily cap holds during a line too, not only at its start: past
      // it the client closes (its seconds are already on today's ledger).
      let capReached = false;
      if (report.final !== true) {
        try {
          const spent = await spend.spentTodayUsd(new Date(now()));
          capReached = spent >= config.dailyCapUsd;
        } catch (error: unknown) {
          // Unknown spend is not zero spend: the line closes.
          logger.warn({ err: error }, "live voice spend ledger unreadable");
          capReached = true;
        }
      }
      const trialSpent = trial?.spent === true;
      return {
        recordedSeconds: line.recordedSeconds,
        remainingMs:
          capReached || trialSpent
            ? 0
            : Math.max(0, config.maxSessionMs - (now() - line.openedAt)),
        ...(capReached ? { capReached: true } : {}),
        ...(trial === undefined
          ? {}
          : {
              trial: {
                allowanceSeconds: trial.allowanceSeconds,
                remainingSeconds: Math.floor(trialRemaining(line, now())),
              },
            }),
        ...(trialSpent ? { trialSpent: true } : {}),
      };
    },

    isTrialUser: (userId) => trialAllowance(userId) !== undefined,

    trialFor: async (actor) => {
      const allowance = trialAllowance(actor.userId);
      if (allowance === undefined) return null;
      if (deps.trialUsage === undefined)
        throw new Error("live voice trial use is not stored here");
      const used = await deps.trialUsage.usedSeconds(actor);
      if (
        used < allowance &&
        (deps.trialClaims === undefined || (await deps.trialClaims.held(actor)))
      )
        throw new Error(
          "live voice trial unavailable while another claim is held",
        );
      return {
        allowanceSeconds: allowance,
        remainingSeconds: Math.floor(Math.max(0, allowance - used)),
      };
    },

    end: ({ actor, voiceSessionId, reason }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return false;
      forget(line, reason);
      return true;
    },
  };
}
