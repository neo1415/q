import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  Q_VOICE_LISTENING_DEFAULT,
  type QFailureClass,
  type QTurnDisposition,
  QRunIdSchema,
  type QSilenceBeat,
  type QVoiceDuplexHeard,
  type QVoiceDuplexHeardResult,
  type QVoiceDuplexListening,
  type QVoiceDuplexNarrationResult,
  type QVoiceDuplexCredential,
  type QVoiceDuplexLineStats,
  type QVoiceDuplexRejoin,
  type QVoiceDuplexRejoinResult,
  type QVoiceDuplexSaid,
  type QVoiceDuplexToolCall,
  type QVoiceDuplexToolResult,
  type QVoiceDuplexTurnReport,
  type QVoiceDuplexUsageReport,
  type QVoiceDuplexUsageResult,
} from "@capital-q/contracts";
import type {
  RealtimeMintRequest,
  RealtimeVoiceGateway,
} from "@capital-q/model-gateway/realtime";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import type {
  ContextFirewallPort,
  QOfferedTool,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

import { factsForVoice, type SpokenFacts } from "@capital-q/q-core";

import type { VoiceSessionBinding } from "../bindings.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "../provider.js";
import { withoutWrittenLaugh } from "../providers/speech-markup.js";
import { sentences, withoutStageDirections } from "../speech.js";
import {
  APPROVAL_QUESTION,
  settledTurn,
  type VoiceTurnHandler,
} from "../turn.js";
import type { DuplexConfig } from "./config.js";
import {
  ASK_Q_TOOL_NAME,
  DECIDE_CARD_TOOL_NAME,
  BACKCHANNEL_INSTRUCTIONS,
  BRIDGE_INSTRUCTIONS,
  duplexInstructions,
  duplexTools,
  SET_LISTENING_TOOL_NAME,
} from "./instructions.js";
import {
  isListeningChange,
  nextListeningLevel,
  type DuplexListeningStore,
} from "./listening.js";
import { routeDuplexTurn, routedAs, type DuplexRoutedAs } from "./routing.js";
import type { DuplexSideband } from "./sideband.js";
import type { DuplexSpendLedger } from "./spend.js";
import type { DuplexTranscriptStore } from "./transcript.js";

/**
 * The full-duplex voice broker (DUPLEX; flag CQ_VOICE_REALTIME, off by
 * default).
 *
 * Order, every time a line opens: the actor was resolved by the route's
 * hook; the flag, then the daily cap (fail closed when the ledger cannot
 * be read), then the Context Firewall plans the line exactly as it plans a
 * Q answer (capability ANSWER, the thread's subjects and screen). Only
 * then are tools chosen (the Tool Registry's offer for that plan: ask_q
 * and read-only tools) and only then does the Model Gateway mint a client
 * secret. Anything short of a minted secret is a FALLBACK: the caller
 * carries on with the standard voice line and the person never notices.
 *
 * While the line is open, every function call the model proposes comes
 * back here and runs through the same pipeline a typed turn's tools do:
 * ask_q is one spoken turn on the standard turn handler (so approvals are
 * cards on screen and a spoken yes is the same decision a tap records);
 * any other name runs through the Tool Registry's executor, which offers,
 * validates, authorises and bounds it. The model never acts directly.
 *
 * Usage arrives per response from the browser. It is priced by the
 * gateway and written to the ledger, and the cap is re-read after each:
 * reaching it ends the line with one sentence. The browser is not trusted
 * to report: an open line holds a reservation against the cap until it
 * ends, a line past its maximum length or idle window is refused here,
 * and each response is bounded by a per-response output cap set in the
 * minted session.
 */

export const DUPLEX_CAP_NOTICE =
  "I've reached today's limit for live voice, so I'm switching to my standard voice.";

/** How long past its limits a line may still report before it is gone. */
const GRACE_MS = 60_000;
const ASK_Q_MAX_CHARS = 2_000;

/**
 * voiceq-63 (founder, live 2026-10-04): "when I laugh it does something
 * like 'ha', or it says 'chuckles'". The realtime model says the text it is
 * given, so a laugh written into Q's answer ("Ha!") or a stage direction
 * reached the person as a word. What it is told to say carries neither;
 * the amusement travels as a delivery note it voices and never says.
 */
const AMUSED_DELIVERY =
  "amused: let a light, natural laugh into your voice before the words; never say a laugh word or describe it";

export function forRealtime(said: string): {
  readonly say: string;
  readonly amused: boolean;
} {
  let amused = false;
  const parts = sentences(withoutStageDirections(said)).flatMap((sentence) => {
    const rest = withoutWrittenLaugh(sentence);
    if (rest !== sentence) amused = true;
    return rest.length === 0 ? [] : [rest];
  });
  return { say: parts.join(" "), amused };
}
const SPOKEN_MAX = 6_000;

/** What the voice says when an ask_q passed its deadline (A8). */
export const ASK_Q_TOO_LONG =
  "That one is taking longer than I want to keep you waiting. Ask me again, or ask for a smaller piece and I'll build up.";

type AskQResult = {
  readonly output: string;
  readonly approvalPending: boolean;
  readonly silent?: boolean;
  readonly disposition: QTurnDisposition;
  readonly failure?: QFailureClass;
};

/**
 * The turn, or null once the signal aborts: a turn handler that does not
 * honour its signal (a stuck provider call) no longer holds the relay.
 */
function turnUntil<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | null> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.resolve(null);
  }
  return new Promise<T | null>((resolve, reject) => {
    const stop = () => {
      resolve(null);
    };
    signal.addEventListener("abort", stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        if (signal.aborted) resolve(null);
        else reject(error instanceof Error ? error : new Error("turn failed"));
      },
    );
  });
}

/**
 * What ask_q returns for a code-built answer (founder live 2026-10-08):
 * the facts to say in the voice's own words, what must be said, the open
 * door, and a line built from the same facts as an example of their
 * content (never to be read out).
 */
export function askQFactsOutput(
  facts: SpokenFacts,
): Readonly<Record<string, unknown>> {
  return {
    ok: true,
    speakInYourOwnWords: true,
    facts: factsForVoice(facts),
    mustSay: facts.mustSay,
    ...(facts.next === null ? {} : { next: facts.next }),
    example: facts.fallback,
  };
}

export type DuplexFallbackReason =
  | "OFF"
  | "REHEARSAL"
  | "CAP_REACHED"
  | "LEDGER_UNAVAILABLE"
  | "DENIED"
  | "TOOLS_UNAVAILABLE"
  | "MINT_UNAVAILABLE";

export type DuplexOpenResult =
  | { readonly kind: "DUPLEX"; readonly credential: QVoiceDuplexCredential }
  | { readonly kind: "FALLBACK"; readonly reason: DuplexFallbackReason };

type DuplexLine = {
  readonly voiceSessionId: string;
  readonly actor: ActorContext;
  readonly binding: VoiceSessionBinding;
  readonly context: QToolExecutionContext;
  readonly direct: ReadonlySet<string>;
  /** Reset by a rejoin: each realtime call gets the full length. */
  openedAt: number;
  /** What was minted, so a rejoin mints the same session (I1). */
  readonly mint: RealtimeMintRequest;
  readonly listeningCredential: QVoiceDuplexListening | undefined;
  rejoins: number;
  lastActivityAt: number;
  spentUsd: number;
  readonly seen: Set<string>;
  /** BACKCHANNEL: whether this line listens like a person. */
  readonly listening: boolean;
  /** Reports by kind, for the end-of-line log. */
  readonly kinds: Record<string, number>;
  /**
   * What was asked of Q and said back on this line, oldest first, bounded
   * (voiceq-63). Each ask_q is a new utterance after Q's last reply: live
   * 2026-10-04 every request went to the turn as a one-line transcript, so
   * all of them had one utterance ref, and each new request marked every
   * earlier one on the line, with its answer, as superseded: Q lost what
   * it had just said and prepared, and spoken replies were read without
   * their context.
   */
  readonly history: VoiceTranscriptTurn[];
  /**
   * ADR 0062: the silence ladder's beats while an ask_q works, numbered,
   * for the browser to voice out of band; the newest few only.
   */
  readonly narration: { sequence: number; beat: QSilenceBeat }[];
  narrationSequence: number;
  /** ask_q calls working now; the narration poll ends when none are. */
  asking: number;
  /** Wakes a waiting narration poll. */
  readonly listeners: Set<() => void>;
  /** Q leads this line (welcome, interview): every turn is Q's. */
  readonly guided: boolean;
  /**
   * VOICE-BRAIN: the turn being answered now. Opened when the person's
   * turn is heard (or ask_q is called without one), closed when the voice
   * has said its reply. `asked`: Q's pipeline answered it.
   */
  turn: {
    readonly routed: DuplexRoutedAs;
    readonly words: string;
    asked: boolean;
  } | null;
  /** Q's last answer asked for their yes: their reply is Q's to take. */
  awaitingApproval: boolean;
  /** A3: Q's last spoken words asked them something. */
  qAsked: boolean;
};

/** How long a narration poll is held open when nothing is said. */
const NARRATION_HOLD_MS = 12_000;
const NARRATION_KEPT = 8;

/**
 * The transcriber's bias. Every routed turn is acted on from its
 * transcript, so it is told the language (the device's, English by
 * default: unpinned, an accented "find anything that needs my attention"
 * came back as "Fidiani inanituma attention", live 2026-10-08) and the
 * words this person is likely to say. Names are data for the recogniser,
 * never instructions; each is bounded and the list is capped.
 */
const TRANSCRIPTION_VOCABULARY = [
  "Capital Q",
  "Q",
  "Discover",
  "Explore",
  "data room",
  "pitch deck",
  "one-pager",
  "raise",
  "investors",
  "founders",
  "mandate",
  "diligence",
  "briefing",
  "relationships",
] as const;
const TRANSCRIPTION_NAMES_MAX = 40;

export function transcriptionHintFor(input: {
  readonly locale?: string | undefined;
  readonly vocabulary?: readonly string[] | undefined;
}): { readonly language: string; readonly prompt: string } {
  const language = /^[a-z]{2}\b/i.exec(input.locale ?? "")?.[0];
  const names = [
    ...new Set(
      (input.vocabulary ?? [])
        .map((name) => name.replace(/\s+/g, " ").trim().slice(0, 60))
        .filter((name) => name.length > 1),
    ),
  ].slice(0, TRANSCRIPTION_NAMES_MAX);
  return {
    language: language?.toLowerCase() ?? "en",
    prompt: `A person talking to Q, their investment analyst, on Capital Q, for example: "Find anything that needs my attention." "Open their pitch deck." Words and names: ${[...names, ...TRANSCRIPTION_VOCABULARY].join(", ")}.`,
  };
}

/** The turns of a line the next ask_q carries. */
const LINE_HISTORY_MAX = 12;

export type DuplexBroker = {
  readonly enabled: boolean;
  readonly open: (input: {
    readonly binding: VoiceSessionBinding;
    readonly firstMessage?: string | undefined;
    readonly locale?: string | undefined;
    /** Names this person is likely to say, for the transcriber. */
    readonly vocabulary?: readonly string[] | undefined;
  }) => Promise<DuplexOpenResult>;
  /** Null when there is no such line for this person (or it has ended). */
  readonly tool: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly call: QVoiceDuplexToolCall;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QVoiceDuplexToolResult | null>;
  readonly usage: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly report: QVoiceDuplexUsageReport;
  }) => Promise<QVoiceDuplexUsageResult | null>;
  /**
   * I1: a fresh realtime call for a line that dropped or reached its
   * length, so the conversation carries on instead of falling back. Null
   * when there is no such line; no credential when the cap or the
   * provider says no.
   */
  readonly rejoin: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly cause: QVoiceDuplexRejoin["cause"];
  }) => Promise<QVoiceDuplexRejoinResult | null>;
  readonly end: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly reason: string;
    readonly cause?: string | undefined;
    readonly stats?: QVoiceDuplexLineStats | undefined;
  }) => boolean;
  /**
   * ADR 0062: beats after `after`, waiting up to a hold for the next one
   * while an ask_q works. Null when there is no such line for this person.
   */
  readonly narration: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly after: number;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QVoiceDuplexNarrationResult | null>;
  /**
   * VOICE-BRAIN: one finished turn of the person's, as transcribed. The
   * server decides who answers it: for a substantive turn it runs ask_q
   * itself and returns the result for the voice to say. Null when there
   * is no such line for this person.
   */
  readonly heard: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly heard: QVoiceDuplexHeard;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QVoiceDuplexHeardResult | null>;
  /** VOICE-BRAIN: what the voice said in one response (transcript, Q side). */
  readonly said: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly said: QVoiceDuplexSaid;
  }) => boolean;
  /** Open lines, for tests and the startup log. */
  readonly size: () => number;
  /**
   * A11 (C-16): a line this instance does not hold (a deploy, a restart,
   * another replica), rebuilt from its binding as restored from the sealed
   * token: the same plan, tools and session, no new realtime call (the
   * browser's call never depended on this process). False when it cannot
   * be: duplex off, a rehearsal, someone else's binding, a denied plan.
   */
  readonly adopt: (input: {
    readonly actor: ActorContext;
    readonly binding: VoiceSessionBinding;
  }) => Promise<boolean>;
  /** RECOVERY A4: one turn's disposition and timings, logged. */
  readonly outcome: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly report: QVoiceDuplexTurnReport;
  }) => boolean;
  /** A8 SIDEBAND: the call's id; attached only when the sideband is on. */
  readonly attach: (input: {
    readonly actor: ActorContext;
    readonly voiceSessionId: string;
    readonly callId: string;
  }) => boolean;
};

export type DuplexBrokerDependencies = {
  readonly config: DuplexConfig;
  readonly gateway: RealtimeVoiceGateway;
  readonly firewall: ContextFirewallPort;
  readonly tools: QToolPort;
  readonly turn: VoiceTurnHandler;
  readonly spend: DuplexSpendLedger;
  readonly logger: Logger;
  /** BACKCHANNEL: the person's remembered listening level. */
  readonly listening?: DuplexListeningStore | undefined;
  /** VOICE-BRAIN: the line's transcript, both sides (server-only). */
  readonly transcript?: DuplexTranscriptStore | undefined;
  readonly now?: (() => number) | undefined;
  /**
   * A8 SIDEBAND: builds the server's connection to a call from the
   * broker's own usage recorder. Used only when config.sideband is on.
   */
  readonly sideband?:
    | ((
        onUsage: (
          voiceSessionId: string,
          report: QVoiceDuplexUsageReport,
        ) => void,
      ) => DuplexSideband)
    | undefined;
};

/** A speaker that keeps what Q would have said, for the model to say. */
function collectingSpeaker(
  id: string,
  narrate?: (beat: QSilenceBeat) => void,
): VoiceSpeaker & {
  readonly said: () => string;
  /** The facts of a code-built answer, for the voice to say itself. */
  readonly heldFacts: () => SpokenFacts | null;
} {
  let text = "";
  let held: SpokenFacts | null = null;
  const add = (part: string) => {
    if (text.length >= SPOKEN_MAX) return;
    const trimmed = part.trim();
    if (trimmed.length === 0) return;
    text = text.length === 0 ? trimmed : `${text} ${trimmed}`;
  };
  return {
    providerConversationId: id,
    isOpen: true,
    speak: async (response) => {
      if (typeof response === "string") {
        add(response);
        return;
      }
      for await (const part of response) add(part);
    },
    close: () => undefined,
    // ADR 0062: the ladder's beats go to the browser, never into `said`.
    narrate,
    // Nothing collected here is heard until ask_q returns.
    deferred: true,
    // Founder live 2026-10-08: the realtime model read code templates
    // aloud. It is a conversational voice; it gets the facts and speaks.
    facts: (facts) => {
      held = facts;
    },
    said: () => text.slice(0, SPOKEN_MAX),
    heldFacts: () => held,
  };
}

function parseArguments(raw: string): Record<string, unknown> | null {
  if (raw.trim().length === 0) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const output = (value: unknown, approvalPending = false) => ({
  output: JSON.stringify(value),
  approvalPending,
});

const QUOTE_MAX = 400;

/**
 * What the voice must never say on its own (founder live 2026-10-08: "it
 * says it can't open files"). Q can open, read and show their documents;
 * a voice that claims otherwise answered without Q. Detected and logged:
 * the routing is the enforcement, this is the alarm.
 */
const CLAIMED_INABILITY = [
  /\bi\s*(?:can(?:'|’)?t|cannot|can\s+not)\s+(?:open|read|see|access|view|show|look\s+at|pull\s+up|get\s+to)\b/i,
  /\bi\s*(?:am|'m|’m)\s+(?:not\s+able|unable)\s+to\b/i,
  /\bi\s+(?:do\s+not|don(?:'|’)?t)\s+have\s+(?:access|the\s+ability|any\s+(?:access|information|data|way))\b/i,
  /\bas\s+an\s+ai\b/i,
];

export function claimsInability(said: string): boolean {
  return CLAIMED_INABILITY.some((pattern) => pattern.test(said));
}

/**
 * Asking leave instead of doing the task (founder live 2026-10-08: "are
 * you ready?", "sound good?" while the strategy never came). The realtime
 * provider gives no hook between a response's text and its audio, so this
 * is the transcript audit: logged per response, kept with the turn.
 */
const STALLS = [
  /\b(?:are\s+you\s+)?ready\s*\?/i,
  /\bsound(?:s)?\s+good\s*\?/i,
  /\bshall\s+(?:i|we)\b/i,
  /\b(?:do\s+you\s+)?want\s+me\s+to\s+(?:go\s+ahead|start|begin|proceed)\b/i,
  /\bwould\s+you\s+like\s+me\s+to\s+(?:go\s+ahead|start|begin|proceed|walk\s+you)\b/i,
  /\b(?:should|can)\s+i\s+(?:go\s+ahead|start|begin|proceed)\b/i,
  /\blet\s+me\s+know\s+when\s+you(?:'|’)?re\s+ready\b/i,
];

export function stallsForPermission(said: string): boolean {
  return STALLS.some((pattern) => pattern.test(said));
}

export function createDuplexBroker(
  dependencies: DuplexBrokerDependencies,
): DuplexBroker {
  const { config, gateway, firewall, tools, turn, spend, logger } =
    dependencies;
  const now = dependencies.now ?? Date.now;
  const lines = new Map<string, DuplexLine>();
  const enabled = config.enabled && gateway.enabled;
  // A8: built once; usage it sees lands on the same ledger as the
  // browser's reports, counted once per response.
  const sideband: DuplexSideband | undefined =
    config.sideband && dependencies.sideband !== undefined
      ? dependencies.sideband((voiceSessionId, report) => {
          const line = lines.get(voiceSessionId);
          if (line !== undefined) void record(line, report);
        })
      : undefined;

  const expired = (line: DuplexLine, at: number) =>
    at - line.openedAt > config.maxSessionMs + GRACE_MS ||
    at - line.lastActivityAt > config.idleMs + GRACE_MS;

  const forget = (voiceSessionId: string) => {
    lines.delete(voiceSessionId);
    sideband?.detach(voiceSessionId);
  };

  const sweep = () => {
    const at = now();
    for (const [id, line] of lines) if (expired(line, at)) forget(id);
  };

  /** What open lines still hold against today's cap. */
  const reserved = (except?: string) => {
    let total = 0;
    for (const line of lines.values()) {
      if (line.voiceSessionId === except) continue;
      total += Math.max(0, config.sessionReserveUsd - line.spentUsd);
    }
    return total;
  };

  const ownLine = (actor: ActorContext, voiceSessionId: string) => {
    sweep();
    const line = lines.get(voiceSessionId);
    if (
      line === undefined ||
      line.actor.userId !== actor.userId ||
      line.actor.tenantId !== actor.tenantId
    ) {
      return null;
    }
    return line;
  };

  /**
   * One response's usage on the line's ledger, once per response id
   * (the browser's report and the sideband's are the same response).
   * False when it could not be recorded: spend that cannot be recorded
   * cannot be capped, so the line stops.
   */
  const record = async (
    line: DuplexLine,
    report: QVoiceDuplexUsageReport,
  ): Promise<boolean> => {
    if (line.seen.has(report.responseId)) return true;
    line.seen.add(report.responseId);
    const { responseId: _responseId, kind, ...usage } = report;
    const counted = kind ?? "RESPONSE";
    line.kinds[counted] = (line.kinds[counted] ?? 0) + 1;
    try {
      line.spentUsd += await gateway.record({
        usage,
        kind: counted,
        attribution: {
          tenantId: line.actor.tenantId,
          userId: line.actor.userId,
          correlationId: `rt_${line.voiceSessionId}`,
        },
      });
      return true;
    } catch (error: unknown) {
      logger.warn({ err: error }, "duplex usage could not be recorded");
      forget(line.voiceSessionId);
      return false;
    }
  };

  const fallback = (reason: DuplexFallbackReason): DuplexOpenResult => {
    logger.info({ reason }, "duplex voice fell back to the standard line");
    return { kind: "FALLBACK", reason };
  };

  /**
   * One spoken turn on the standard handler: the same seam, the same Q
   * run, the same tools, approvals and conduct.
   */
  const askQ = async (
    line: DuplexLine,
    request: string,
    abort: AbortSignal,
  ): Promise<AskQResult> => {
    const voiceSessionId = line.voiceSessionId;
    const wake = () => {
      for (const listener of line.listeners) listener();
    };
    const speaker = collectingSpeaker(`rt_${voiceSessionId}`, (beat) => {
      if (beat.kind === "TONE") return;
      line.narrationSequence += 1;
      line.narration.push({ sequence: line.narrationSequence, beat });
      line.narration.splice(
        0,
        Math.max(0, line.narration.length - NARRATION_KEPT),
      );
      wake();
    });
    // Each ask_q's beats start fresh; the numbering carries on.
    line.narration.length = 0;
    line.asking += 1;
    // RECOVERY A8 (C-08): one deadline per ask_q. The turn's own signal
    // aborts when the caller lets go or the deadline passes, whichever is
    // first; before, a stuck run held "Thinking" and the relay forever.
    const deadline = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      deadline.abort();
    }, config.askDeadlineMs);
    const onAbort = () => {
      deadline.abort();
    };
    if (abort.aborted) deadline.abort();
    else abort.addEventListener("abort", onAbort, { once: true });
    const startedAt = now();
    try {
      const asked: VoiceTranscriptTurn = {
        role: "user",
        content: request.slice(0, ASK_Q_MAX_CHARS),
      };
      const outcome = await turnUntil(
        turn(
          line.binding,
          // The realtime turn detector already ended their turn: never
          // held for sounding unfinished.
          settledTurn([...line.history, asked]),
          deadline.signal,
          speaker,
        ),
        deadline.signal,
      );
      const said = speaker.said();
      // What was asked stays on the line's record either way; what Q
      // said, only when it was said.
      line.history.push(asked);
      if (
        outcome !== null &&
        outcome.kind !== "INTERRUPTED" &&
        !deadline.signal.aborted &&
        said !== ""
      ) {
        line.history.push({ role: "agent", content: said });
      }
      line.history.splice(
        0,
        Math.max(0, line.history.length - LINE_HISTORY_MAX),
      );
      if (timedOut) {
        line.awaitingApproval = false;
        logger.warn(
          { qVoiceSessionId: voiceSessionId, ms: now() - startedAt },
          "duplex ask_q passed its deadline",
        );
        return {
          ...output({ ok: false, error: ASK_Q_TOO_LONG }),
          disposition: "FAILED",
          failure: "TIMEOUT",
        };
      }
      if (
        outcome === null ||
        outcome.kind === "INTERRUPTED" ||
        deadline.signal.aborted
      ) {
        return {
          ...output({ ok: false, interrupted: true }),
          disposition: "CANCELLED",
        };
      }
      const facts = speaker.heldFacts();
      if (facts !== null) {
        line.awaitingApproval = false;
        return { ...output(askQFactsOutput(facts)), disposition: "ANSWERED" };
      }
      const { say, amused } = forRealtime(said);
      if (say.length === 0) {
        line.awaitingApproval = false;
        // Q chose to say nothing (the room, not them): IGNORED, which the
        // browser shows instead of a silent "Listening".
        return {
          ...output({ ok: true, say: "" }, false),
          silent: true,
          disposition: "IGNORED",
        };
      }
      const approvalPending = said.endsWith(APPROVAL_QUESTION);
      line.awaitingApproval = approvalPending;
      return {
        ...output(
          amused
            ? { ok: true, say, delivery: AMUSED_DELIVERY }
            : { ok: true, say },
          approvalPending,
        ),
        disposition:
          approvalPending ||
          (outcome.kind === "SPOKEN" && outcome.path === "MOVE")
            ? "ACTED"
            : "ANSWERED",
      };
    } catch (error: unknown) {
      logger.warn(
        { err: error, qVoiceSessionId: voiceSessionId },
        "duplex ask_q turn failed",
      );
      return {
        ...output({
          ok: false,
          error: "That didn't go through on my side.",
        }),
        disposition: "FAILED",
        failure: "TOOL_FAILED",
      };
    } finally {
      clearTimeout(timer);
      abort.removeEventListener("abort", onAbort);
      line.asking -= 1;
      wake();
    }
  };

  /** Written beside the line, never in its way: a lost row is logged. */
  const keep = (
    line: DuplexLine,
    role: "USER" | "Q",
    content: string,
    routed: DuplexRoutedAs,
    extra: {
      readonly typed?: boolean;
      readonly providerRef?: string | null;
    } = {},
  ) => {
    const store = dependencies.transcript;
    if (store === undefined) return;
    void store
      .record({
        actor: line.actor,
        voiceSessionId: line.voiceSessionId,
        conversationId: line.binding.thread.conversationId ?? null,
        role,
        content,
        routed,
        typed: extra.typed,
        providerRef: extra.providerRef,
        spokenAt: new Date(now()),
      })
      .catch((error: unknown) => {
        logger.warn(
          { err: error, qVoiceSessionId: line.voiceSessionId },
          "duplex transcript turn not kept",
        );
      });
  };

  const openTurn = (
    line: DuplexLine,
    words: string,
    routed: DuplexRoutedAs,
    typed: boolean,
    providerRef: string | null = null,
  ) => {
    line.turn = { routed, words, asked: false };
    keep(line, "USER", words, routed, { typed, providerRef });
    logger.info(
      {
        qVoiceSessionId: line.voiceSessionId,
        routed,
        words: words.split(/\s+/).filter((w) => w.length > 0).length,
        typed,
      },
      "duplex user turn routed",
    );
  };

  /**
   * Everything a line is before its realtime call exists: the Context
   * Firewall's plan, the tool offer, the listening level and the session
   * the call is minted with. Shared by `open` and by `adopt` (A11), which
   * rebuilds the line on another instance without minting a new call.
   */
  const prepare = async (
    binding: VoiceSessionBinding,
    input: {
      readonly firstMessage?: string | undefined;
      readonly locale?: string | undefined;
      readonly vocabulary?: readonly string[] | undefined;
    },
  ): Promise<
    | { readonly kind: "FALLBACK"; readonly reason: DuplexFallbackReason }
    | {
        readonly kind: "READY";
        readonly mint: RealtimeMintRequest;
        readonly listening: QVoiceDuplexListening | undefined;
        readonly direct: readonly QOfferedTool[];
        readonly line: (at: number) => DuplexLine;
      }
  > => {
    const { actor } = binding;
    const { firstMessage, locale, vocabulary } = input;
    const refuse = (reason: DuplexFallbackReason) =>
      ({ kind: "FALLBACK", reason }) as const;
    // The Context Firewall before anything a model sees: the same plan a
    // Q answer gets for this person, thread and screen.
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.parse(createCorrelationId());
    const decision = await firewall.plan({
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      subjects: binding.thread.subjects ?? [],
      ...(binding.thread.screen === undefined
        ? {}
        : { screen: binding.thread.screen }),
    });
    if (decision.outcome === "DENIED") return refuse("DENIED");
    const context: QToolExecutionContext = {
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      plan: decision.plan,
    };

    // Only what the registry offers this plan, and of that only reads.
    let offered: readonly QOfferedTool[];
    try {
      offered = await tools.offer(context);
    } catch (error: unknown) {
      logger.warn({ err: error }, "duplex tool offer failed");
      return refuse("TOOLS_UNAVAILABLE");
    }
    const direct = offered
      .filter((tool) => tool.classification === "READ_ONLY")
      .slice(0, config.maxDirectTools);

    // BACKCHANNEL: the person's remembered level. A read that fails
    // costs the line its memory, never the line: the default applies.
    const listens = config.backchannel;
    let listening: QVoiceDuplexListening | undefined;
    if (listens) {
      let remembered = null;
      try {
        remembered = (await dependencies.listening?.read(actor)) ?? null;
      } catch (error: unknown) {
        logger.warn({ err: error }, "duplex listening level unreadable");
      }
      listening = {
        level: remembered?.level ?? Q_VOICE_LISTENING_DEFAULT,
        setAt:
          remembered === null ? null : new Date(remembered.setAt).toISOString(),
        backchannelInstructions: BACKCHANNEL_INSTRUCTIONS,
        bridgeInstructions: BRIDGE_INSTRUCTIONS,
      };
    }

    const guided =
      binding.thread.welcome === true ||
      binding.thread.onboarding !== undefined;
    const mint: RealtimeMintRequest = {
      instructions: duplexInstructions({
        firstMessage,
        locale,
        listening: listens,
        guided,
      }),
      tools: duplexTools(
        // Every line answers through ask_q alone (founder 2026-10-06):
        // with read tools of its own the voice model answered around Q,
        // so the mandate, the answer cards and page navigation (which
        // only Q's run holds) never reached the person.
        [],
        { listening: listens },
      ),
      voice: binding.voice,
      maxOutputTokens: config.maxOutputTokens,
      secretTtlSeconds: config.secretTtlSeconds,
      speechSpeed: config.speechSpeed,
      // VOICE-BRAIN: the model never answers a turn by itself; every
      // turn is transcribed and the server decides who answers it.
      ...(config.routeTurns ? { routeTurns: true, transcribeInput: true } : {}),
      ...(listens
        ? {
            transcribeInput: true,
            turnEagerness:
              listening?.level === "OFF"
                ? ("HIGH" as const)
                : ("AUTO" as const),
          }
        : {}),
      transcriptionHint: transcriptionHintFor({ locale, vocabulary }),
      sensitivity: decision.plan.maxSensitivity,
      attribution: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        correlationId,
      },
    };
    const line = (at: number): DuplexLine => ({
      voiceSessionId: binding.voiceSessionId,
      actor,
      binding,
      context,
      direct: new Set(direct.map((tool) => tool.definition.name)),
      openedAt: at,
      mint,
      listeningCredential: listening,
      rejoins: 0,
      lastActivityAt: at,
      spentUsd: 0,
      seen: new Set(),
      listening: listens,
      kinds: {},
      history: [],
      narration: [],
      narrationSequence: 0,
      asking: 0,
      listeners: new Set(),
      guided,
      turn: null,
      awaitingApproval: false,
      qAsked: false,
    });
    return { kind: "READY", mint, listening, direct, line };
  };

  return {
    enabled,
    size: () => {
      sweep();
      return lines.size;
    },

    open: async ({ binding, firstMessage, locale, vocabulary }) => {
      if (!enabled) return { kind: "FALLBACK", reason: "OFF" };
      // A rehearsal line speaks only as the person Q plays; never duplex.
      if (binding.thread.rehearsal !== undefined) return fallback("REHEARSAL");
      const { actor } = binding;
      sweep();
      // One duplex line per person: a new one replaces what was open.
      for (const [id, line] of lines) {
        if (line.actor.userId === actor.userId) forget(id);
      }

      let spent: number;
      try {
        spent = await spend.spentTodayUsd(new Date(now()));
      } catch (error: unknown) {
        // Unknown spend is not zero spend: fail closed.
        logger.warn({ err: error }, "duplex spend ledger unreadable");
        return fallback("LEDGER_UNAVAILABLE");
      }
      if (spent + reserved() + config.sessionReserveUsd > config.dailyCapUsd) {
        return fallback("CAP_REACHED");
      }

      const prepared = await prepare(binding, {
        firstMessage,
        locale,
        vocabulary,
      });
      if (prepared.kind === "FALLBACK") return fallback(prepared.reason);
      const { mint, listening, direct } = prepared;
      const minted = await gateway.mint(mint);
      if (minted.status !== "MINTED") return fallback("MINT_UNAVAILABLE");

      lines.set(binding.voiceSessionId, prepared.line(now()));
      logger.info(
        {
          qVoiceSessionId: binding.voiceSessionId,
          directTools: direct.length,
        },
        "duplex voice line minted",
      );
      return {
        kind: "DUPLEX",
        credential: {
          clientSecret: minted.grant.clientSecret,
          callsUrl: minted.grant.callsUrl,
          expiresAt: minted.grant.expiresAt.toISOString(),
          maxSessionMs: config.maxSessionMs,
          idleMs: config.idleMs,
          ...(listening === undefined ? {} : { listening }),
          ...(config.routeTurns ? { routeTurns: true } : {}),
        },
      };
    },

    heard: async ({ actor, voiceSessionId, heard, signal }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      line.lastActivityAt = now();
      const words = heard.transcript.trim().slice(0, ASK_Q_MAX_CHARS);
      const route =
        words.length === 0
          ? "SMALLTALK"
          : routeDuplexTurn(words, {
              guided: line.guided,
              awaitingApproval: line.awaitingApproval,
              cardInFocus: heard.cardInFocus === true,
              answeringQ: line.qAsked,
            });
      if (words.length > 0) {
        openTurn(
          line,
          words,
          routedAs(route),
          heard.typed === true,
          heard.itemId,
        );
      }
      if (route !== "ASK_Q") return { route };
      if (line.turn !== null) line.turn.asked = true;
      const heardAt = now();
      const result = await askQ(
        line,
        words,
        signal ?? new AbortController().signal,
      );
      const callId = `cq_${randomUUID().replace(/-/g, "")}`;
      const args = JSON.stringify({ request: words });
      // A8 SIDEBAND: the answer goes on the call from here, at once; the
      // browser only learns it was delivered. Never a silent or cancelled
      // turn, and never one the person has spoken over since.
      const delivered =
        sideband !== undefined &&
        result.silent !== true &&
        result.disposition !== "CANCELLED" &&
        sideband.deliver(voiceSessionId, {
          callId,
          arguments: args,
          output: result.output,
          since: heardAt,
        });
      return {
        route: "ASK_Q",
        // The browser records this call on the line, then its output, so
        // the voice says Q's answer as the reply to their turn.
        callId,
        arguments: args,
        output: result.output,
        ...(delivered ? { delivered: "SERVER" as const } : {}),
        approvalPending: result.approvalPending,
        ...(result.silent === true ? { silent: true } : {}),
        disposition: result.disposition,
        ...(result.failure === undefined ? {} : { failure: result.failure }),
      };
    },

    said: ({ actor, voiceSessionId, said }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return false;
      line.lastActivityAt = now();
      const text = said.text.trim();
      if (text.length === 0) return true;
      const current = line.turn;
      const routed: DuplexRoutedAs =
        current === null
          ? "model_only"
          : current.asked
            ? "ask_q"
            : current.routed;
      keep(line, "Q", text, routed, { providerRef: said.responseId });
      line.qAsked = /\?["'”’)\]]*$/u.test(text);
      if (routed !== "ask_q" && claimsInability(text)) {
        logger.warn(
          { qVoiceSessionId: voiceSessionId, routed },
          "duplex voice claimed an inability without Q",
        );
      }
      if (stallsForPermission(text)) {
        logger.warn(
          { qVoiceSessionId: voiceSessionId, routed },
          "duplex voice asked leave instead of doing the task",
        );
      }
      if (current !== null && routed !== "ask_q") {
        // Q's next ask_q reads this exchange, and so do the history and
        // Q's recall: it is part of the conversation.
        line.history.push(
          { role: "user", content: current.words },
          { role: "agent", content: text.slice(0, SPOKEN_MAX) },
        );
        line.history.splice(
          0,
          Math.max(0, line.history.length - LINE_HISTORY_MAX),
        );
        const conversationId = line.binding.thread.conversationId;
        const store = dependencies.transcript;
        if (conversationId !== undefined && store !== undefined) {
          void store
            .mirror({
              actor,
              conversationId,
              messages: [
                { role: "USER", content: current.words },
                { role: "Q", content: text },
              ],
            })
            .catch((error: unknown) => {
              logger.warn(
                { err: error, qVoiceSessionId: voiceSessionId },
                "duplex model-only turn not mirrored",
              );
            });
        }
      }
      line.turn = null;
      return true;
    },

    tool: async ({ actor, voiceSessionId, call, signal }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      line.lastActivityAt = now();
      const args = parseArguments(call.arguments);
      if (args === null) {
        return output({ ok: false, error: "The arguments were not valid." });
      }
      const abort = signal ?? new AbortController().signal;

      if (call.name === ASK_Q_TOOL_NAME) {
        const request = args.request;
        if (typeof request !== "string" || request.trim().length === 0) {
          return output({ ok: false, error: "Nothing was asked." });
        }
        // The model passed the turn to Q itself (a card reply that was
        // not one, small talk that was not, a turn heard without words).
        if (line.turn === null) {
          openTurn(
            line,
            request.trim().slice(0, ASK_Q_MAX_CHARS),
            "ask_q",
            false,
          );
        }
        if (line.turn !== null) line.turn.asked = true;
        return askQ(line, request, abort);
      }

      if (call.name === SET_LISTENING_TOOL_NAME && line.listening) {
        // BACKCHANNEL: the level is resolved here, deterministically, and
        // applied on the line at once; it is remembered only through the
        // memory Write Gate, whose quote check reads the provider's
        // transcript of the person, not the model's words.
        const change = args.change;
        if (!isListeningChange(change)) {
          return output({ ok: false, error: "That is not a change I know." });
        }
        const current = call.listening ?? Q_VOICE_LISTENING_DEFAULT;
        const level = nextListeningLevel(current, change);
        const quote =
          typeof args.quote === "string"
            ? args.quote.trim().slice(0, QUOTE_MAX)
            : "";
        let remembered = false;
        if (dependencies.listening !== undefined && quote.length >= 3) {
          try {
            remembered = await dependencies.listening.remember({
              actor,
              level,
              quote,
              heard: call.heard ?? [],
            });
          } catch (error: unknown) {
            logger.warn({ err: error }, "duplex listening level not kept");
          }
        }
        logger.info(
          { qVoiceSessionId: voiceSessionId, level, remembered },
          "duplex listening level changed",
        );
        return {
          ...output({
            ok: true,
            level,
            remembered,
            say: "Acknowledge it once, in a few words, then carry on.",
          }),
          listening: level,
        };
      }

      // The card tool is answered in the browser, where the card is; one
      // that reaches here had no card in focus to decide.
      if (call.name === DECIDE_CARD_TOOL_NAME) {
        return output({
          ok: false,
          error:
            "No card is in focus on their screen. Pass their words to ask_q instead.",
        });
      }

      // Anything else must be a tool this line was offered, and runs only
      // through the registry's pipeline (validate, authorise, bound).
      if (!line.direct.has(call.name)) {
        return output({
          ok: false,
          error: "That tool is not available in this conversation.",
        });
      }
      const outcome = await tools.execute(
        { callId: call.callId, name: call.name, arguments: args },
        { ...line.context, signal: abort },
      );
      return output(
        outcome.result.ok
          ? { ok: true, data: outcome.result.data }
          : { ok: false, error: outcome.result.error.safeMessage },
      );
    },

    usage: async ({ actor, voiceSessionId, report }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      const at = now();
      line.lastActivityAt = at;
      if (!(await record(line, report))) return { continue: false };
      if (at - line.openedAt >= config.maxSessionMs) {
        // Kept (I1): the browser rejoins this line with a fresh call; an
        // abandoned one is swept GRACE_MS past its length.
        return { continue: false };
      }
      let spent: number;
      try {
        spent = await spend.spentTodayUsd(new Date(at));
      } catch {
        forget(voiceSessionId);
        return { continue: false };
      }
      if (spent >= config.dailyCapUsd) {
        forget(voiceSessionId);
        logger.info({ spentUsd: spent }, "duplex daily cap reached");
        return { continue: false, notice: DUPLEX_CAP_NOTICE };
      }
      return { continue: true };
    },

    narration: async ({ actor, voiceSessionId, after, signal }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      const ready = () => line.narration.filter((n) => n.sequence > after);
      if (ready().length === 0 && line.asking > 0 && signal?.aborted !== true) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            line.listeners.delete(done);
            signal?.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, NARRATION_HOLD_MS);
          line.listeners.add(done);
          signal?.addEventListener("abort", done, { once: true });
        });
      }
      return {
        beats: ready().map(({ sequence, beat }) => ({ sequence, beat })),
        idle: line.asking === 0,
      };
    },

    rejoin: async ({ actor, voiceSessionId, cause }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return null;
      let spent: number;
      try {
        spent = await spend.spentTodayUsd(new Date(now()));
      } catch (error: unknown) {
        logger.warn({ err: error }, "duplex spend ledger unreadable");
        forget(voiceSessionId);
        return {};
      }
      // This line's own reservation is already inside `reserved()`.
      if (
        spent >= config.dailyCapUsd ||
        spent + reserved() > config.dailyCapUsd
      ) {
        forget(voiceSessionId);
        logger.info({ spentUsd: spent, cause }, "duplex daily cap reached");
        return { notice: DUPLEX_CAP_NOTICE };
      }
      const minted = await gateway.mint(line.mint);
      if (minted.status !== "MINTED") {
        logger.warn(
          { qVoiceSessionId: voiceSessionId, cause },
          "duplex voice rejoin could not mint",
        );
        forget(voiceSessionId);
        return {};
      }
      const at = now();
      line.openedAt = at;
      line.lastActivityAt = at;
      line.rejoins += 1;
      logger.info(
        { qVoiceSessionId: voiceSessionId, cause, rejoins: line.rejoins },
        "duplex voice line rejoined",
      );
      return {
        credential: {
          clientSecret: minted.grant.clientSecret,
          callsUrl: minted.grant.callsUrl,
          expiresAt: minted.grant.expiresAt.toISOString(),
          maxSessionMs: config.maxSessionMs,
          idleMs: config.idleMs,
          ...(line.listeningCredential === undefined
            ? {}
            : { listening: line.listeningCredential }),
          ...(line.mint.routeTurns === true ? { routeTurns: true } : {}),
        },
      };
    },

    adopt: async ({ actor, binding }) => {
      if (!enabled || binding.thread.rehearsal !== undefined) return false;
      // The sealed token names the person; only that person may adopt it.
      if (
        binding.actor.userId !== actor.userId ||
        binding.actor.tenantId !== actor.tenantId
      ) {
        return false;
      }
      sweep();
      if (lines.has(binding.voiceSessionId)) return true;
      const prepared = await prepare(binding, {});
      if (prepared.kind === "FALLBACK") {
        logger.info(
          {
            qVoiceSessionId: binding.voiceSessionId,
            reason: prepared.reason,
          },
          "duplex voice line not adopted",
        );
        return false;
      }
      // One duplex line per person, as on open.
      for (const [id, held] of lines) {
        if (held.actor.userId === actor.userId) forget(id);
      }
      lines.set(binding.voiceSessionId, prepared.line(now()));
      logger.info(
        { qVoiceSessionId: binding.voiceSessionId },
        "duplex voice line adopted",
      );
      return true;
    },

    outcome: ({ actor, voiceSessionId, report }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return false;
      line.lastActivityAt = now();
      // Ids and milliseconds only: never the person's words.
      logger.info(
        { qVoiceSessionId: voiceSessionId, ...report },
        "duplex voice turn",
      );
      return true;
    },

    attach: ({ actor, voiceSessionId, callId }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return false;
      sideband?.attach(voiceSessionId, callId);
      return true;
    },

    end: ({ actor, voiceSessionId, reason, cause, stats }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return false;
      forget(voiceSessionId);
      logger.info(
        {
          qVoiceSessionId: voiceSessionId,
          reason,
          ...(cause === undefined ? {} : { cause }),
          ...(stats === undefined ? {} : { line: stats }),
          rejoins: line.rejoins,
          spentUsd: Math.round(line.spentUsd * 1e6) / 1e6,
          reports: line.kinds,
          seconds: Math.round((now() - line.openedAt) / 1000),
        },
        "duplex voice line ended",
      );
      return true;
    },
  };
}
