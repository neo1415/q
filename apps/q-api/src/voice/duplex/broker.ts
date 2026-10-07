import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  Q_VOICE_LISTENING_DEFAULT,
  QRunIdSchema,
  type QSilenceBeat,
  type QVoiceDuplexListening,
  type QVoiceDuplexNarrationResult,
  type QVoiceDuplexCredential,
  type QVoiceDuplexLineStats,
  type QVoiceDuplexRejoin,
  type QVoiceDuplexRejoinResult,
  type QVoiceDuplexToolCall,
  type QVoiceDuplexToolResult,
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
import type { DuplexSpendLedger } from "./spend.js";

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
};

/** How long a narration poll is held open when nothing is said. */
const NARRATION_HOLD_MS = 12_000;
const NARRATION_KEPT = 8;

/** The turns of a line the next ask_q carries. */
const LINE_HISTORY_MAX = 12;

export type DuplexBroker = {
  readonly enabled: boolean;
  readonly open: (input: {
    readonly binding: VoiceSessionBinding;
    readonly firstMessage?: string | undefined;
    readonly locale?: string | undefined;
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
  /** Open lines, for tests and the startup log. */
  readonly size: () => number;
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
  readonly now?: (() => number) | undefined;
};

/** A speaker that keeps what Q would have said, for the model to say. */
function collectingSpeaker(
  id: string,
  narrate?: (beat: QSilenceBeat) => void,
): VoiceSpeaker & {
  readonly said: () => string;
} {
  let text = "";
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
    said: () => text.slice(0, SPOKEN_MAX),
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

export function createDuplexBroker(
  dependencies: DuplexBrokerDependencies,
): DuplexBroker {
  const { config, gateway, firewall, tools, turn, spend, logger } =
    dependencies;
  const now = dependencies.now ?? Date.now;
  const lines = new Map<string, DuplexLine>();
  const enabled = config.enabled && gateway.enabled;

  const expired = (line: DuplexLine, at: number) =>
    at - line.openedAt > config.maxSessionMs + GRACE_MS ||
    at - line.lastActivityAt > config.idleMs + GRACE_MS;

  const sweep = () => {
    const at = now();
    for (const [id, line] of lines) if (expired(line, at)) lines.delete(id);
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

  const fallback = (reason: DuplexFallbackReason): DuplexOpenResult => {
    logger.info({ reason }, "duplex voice fell back to the standard line");
    return { kind: "FALLBACK", reason };
  };

  return {
    enabled,
    size: () => {
      sweep();
      return lines.size;
    },

    open: async ({ binding, firstMessage, locale }) => {
      if (!enabled) return { kind: "FALLBACK", reason: "OFF" };
      // A rehearsal line speaks only as the person Q plays; never duplex.
      if (binding.thread.rehearsal !== undefined) return fallback("REHEARSAL");
      const { actor } = binding;
      sweep();
      // One duplex line per person: a new one replaces what was open.
      for (const [id, line] of lines) {
        if (line.actor.userId === actor.userId) lines.delete(id);
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
      if (decision.outcome === "DENIED") return fallback("DENIED");
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
        return fallback("TOOLS_UNAVAILABLE");
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
            remembered === null
              ? null
              : new Date(remembered.setAt).toISOString(),
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
        ...(listens
          ? {
              transcribeInput: true,
              turnEagerness:
                listening?.level === "OFF"
                  ? ("HIGH" as const)
                  : ("AUTO" as const),
            }
          : {}),
        sensitivity: decision.plan.maxSensitivity,
        attribution: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          correlationId,
        },
      };
      const minted = await gateway.mint(mint);
      if (minted.status !== "MINTED") return fallback("MINT_UNAVAILABLE");

      const at = now();
      lines.set(binding.voiceSessionId, {
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
      });
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
        },
      };
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
        // One spoken turn on the standard handler: the same seam, the
        // same Q run, the same tools, approvals and conduct.
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
        try {
          const asked: VoiceTranscriptTurn = {
            role: "user",
            content: request.slice(0, ASK_Q_MAX_CHARS),
          };
          const outcome = await turn(
            line.binding,
            // The realtime turn detector already ended their turn: never
            // held for sounding unfinished.
            settledTurn([...line.history, asked]),
            abort,
            speaker,
          );
          const said = speaker.said();
          // What was asked stays on the line's record either way; what Q
          // said, only when it was said.
          line.history.push(asked);
          if (outcome.kind !== "INTERRUPTED" && !abort.aborted && said !== "") {
            line.history.push({ role: "agent", content: said });
          }
          line.history.splice(
            0,
            Math.max(0, line.history.length - LINE_HISTORY_MAX),
          );
          if (outcome.kind === "INTERRUPTED" || abort.aborted) {
            return output({ ok: false, interrupted: true });
          }
          const { say, amused } = forRealtime(said);
          return output(
            amused
              ? { ok: true, say, delivery: AMUSED_DELIVERY }
              : { ok: true, say },
            said.endsWith(APPROVAL_QUESTION),
          );
        } catch (error: unknown) {
          logger.warn(
            { err: error, qVoiceSessionId: voiceSessionId },
            "duplex ask_q turn failed",
          );
          return output({
            ok: false,
            error: "That didn't go through on my side.",
          });
        } finally {
          line.asking -= 1;
          wake();
        }
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
      if (!line.seen.has(report.responseId)) {
        line.seen.add(report.responseId);
        const { responseId: _responseId, kind, ...usage } = report;
        const counted = kind ?? "RESPONSE";
        line.kinds[counted] = (line.kinds[counted] ?? 0) + 1;
        try {
          line.spentUsd += await gateway.record({
            usage,
            kind: counted,
            attribution: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              correlationId: `rt_${voiceSessionId}`,
            },
          });
        } catch (error: unknown) {
          // Spend that could not be recorded cannot be capped: stop.
          logger.warn({ err: error }, "duplex usage could not be recorded");
          lines.delete(voiceSessionId);
          return { continue: false };
        }
      }
      if (at - line.openedAt >= config.maxSessionMs) {
        // Kept (I1): the browser rejoins this line with a fresh call; an
        // abandoned one is swept GRACE_MS past its length.
        return { continue: false };
      }
      let spent: number;
      try {
        spent = await spend.spentTodayUsd(new Date(at));
      } catch {
        lines.delete(voiceSessionId);
        return { continue: false };
      }
      if (spent >= config.dailyCapUsd) {
        lines.delete(voiceSessionId);
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
        lines.delete(voiceSessionId);
        return {};
      }
      // This line's own reservation is already inside `reserved()`.
      if (
        spent >= config.dailyCapUsd ||
        spent + reserved() > config.dailyCapUsd
      ) {
        lines.delete(voiceSessionId);
        logger.info({ spentUsd: spent, cause }, "duplex daily cap reached");
        return { notice: DUPLEX_CAP_NOTICE };
      }
      const minted = await gateway.mint(line.mint);
      if (minted.status !== "MINTED") {
        logger.warn(
          { qVoiceSessionId: voiceSessionId, cause },
          "duplex voice rejoin could not mint",
        );
        lines.delete(voiceSessionId);
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
        },
      };
    },

    end: ({ actor, voiceSessionId, reason, cause, stats }) => {
      const line = ownLine(actor, voiceSessionId);
      if (line === null) return false;
      lines.delete(voiceSessionId);
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
