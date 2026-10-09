import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  QClientActionIntentSchema,
  QRunIdSchema,
  QVoiceDestinationSchema,
  sensitivityWithin,
  type ModelSensitivity,
} from "@capital-q/contracts";
import type { ModelUsageRepository } from "@capital-q/model-gateway";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";
import type { SpokenFacts } from "@capital-q/q-core";

import type { VoiceSessionBinding } from "../bindings.js";
import { askQFactsOutput, forRealtime } from "../duplex/broker.js";
import type { DuplexSpendLedger } from "../duplex/spend.js";
import type { DuplexTranscriptStore } from "../duplex/transcript.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "../provider.js";
import {
  GPT_LIVE_USD_PER_SECOND,
  LiveProviderError,
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
  liveContextPackage,
  referentsOf,
  REFERENTS_MAX,
  type LiveContextFacts,
} from "./context.js";
import { heardRequest, spokenWords, UNHEARD_COMMENTARY } from "./heard.js";
import { livePrompt } from "./prompt.js";

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
  | "PROVIDER_QUOTA";

export type LiveOpenOutcome =
  | { readonly kind: "OPEN"; readonly result: LiveOpenResult }
  | { readonly kind: "REFUSED"; readonly reason: LiveRefusal };

type Delegation = {
  readonly id: string;
  readonly request: string;
  readonly controller: AbortController;
  result: Promise<Omit<LiveDelegationResult, "stale">>;
  settled: boolean;
};

type LiveLine = {
  readonly voiceSessionId: string;
  readonly actor: ActorContext;
  readonly binding: VoiceSessionBinding;
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
  } | null>;
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
  readonly now?: (() => number) | undefined;
  /**
   * q_runtime.voice_line_turns (A's duplex write path): both sides of the
   * line, routed 'live', so what GPT-Live said can be audited.
   */
  readonly transcripts?: Pick<DuplexTranscriptStore, "record"> | undefined;
  /**
   * Part 6: the person's approved background (side, organisation, declared
   * mandate or company card facts), for the call's context package.
   */
  readonly contextFor?:
    ((actor: ActorContext) => Promise<LiveContextFacts | null>) | undefined;
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

/** Q's run, collected: what it said, or the facts of a code-built answer. */
function collector(id: string): {
  readonly speaker: VoiceSpeaker;
  readonly said: () => string;
  readonly held: () => SpokenFacts | null;
} {
  let text = "";
  let held: SpokenFacts | null = null;
  const add = (part: string) => {
    const trimmed = part.trim();
    if (trimmed.length === 0 || text.length >= SPOKEN_MAX) return;
    text = text.length === 0 ? trimmed : `${text} ${trimmed}`;
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

export function createLiveBroker(deps: LiveBrokerDependencies): LiveBroker {
  const { config, provider, firewall, turn, spend, logger } = deps;
  const now = deps.now ?? Date.now;
  const lines = new Map<string, LiveLine>();
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

  const forget = (line: LiveLine, reason: string) => {
    lines.delete(line.voiceSessionId);
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
  };

  const sweep = () => {
    const at = now();
    for (const line of lines.values()) {
      if (at - line.openedAt > config.maxSessionMs + GRACE_MS)
        forget(line, "expired");
    }
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
    const speaker = collector(`live_${line.voiceSessionId}`);
    const asked: VoiceTranscriptTurn = { role: "user", content: request };
    const startedAt = now();
    const delegation: Delegation = {
      id,
      request,
      controller,
      settled: false,
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
        const sequenceBefore =
          deps.board?.read(line.voiceSessionId).sequence ?? 0;
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
        const approvalPending = said.endsWith(APPROVAL_QUESTION);
        const commentary = commentaryFor({
          request,
          facts,
          said,
          approvalPending,
        });
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
      if (binding.thread.rehearsal !== undefined) {
        return { kind: "REFUSED", reason: "REHEARSAL" };
      }
      const { actor } = binding;
      sweep();
      // One live line per person: a new one replaces what was open. A
      // renewal of the same call (same voice session) keeps what Q was
      // asked and said, and the names discussed.
      let carried: Pick<LiveLine, "history" | "referents"> | null = null;
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
      let created;
      try {
        created = await provider.createWebRtcSession({
          config: {
            instructions: livePrompt({
              firstName,
              locale,
              briefingOpening,
              role,
              names,
              guided:
                binding.thread.onboarding !== undefined ||
                binding.thread.welcome === true,
            }),
            voice: config.voices[binding.voice],
          },
          sdp,
        });
      } catch (error: unknown) {
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
      lines.set(binding.voiceSessionId, {
        voiceSessionId: binding.voiceSessionId,
        actor,
        binding,
        openedAt: at,
        lastActivityAt: at,
        history: carried === null ? [] : [...carried.history],
        delegations: new Map(),
        latest: null,
        recordedSeconds: 0,
        finalReported: false,
        tail: Promise.resolve(),
        referents: carried === null ? [] : [...carried.referents],
      });
      // Part 6: the background note for this session (and its renewals).
      let facts: LiveContextFacts | null = null;
      try {
        facts = (await deps.contextFor?.(actor)) ?? null;
      } catch (error: unknown) {
        // A failed read costs the call its background, never the call.
        logger.warn({ err: error }, "live voice context could not be read");
      }
      const context = liveContextPackage({
        firstName,
        role,
        facts,
        referents: carried?.referents ?? [],
      });
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
      const result = await running.result;
      return { ...result, stale: line.latest !== delegation.delegationId };
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
      return {
        recordedSeconds: line.recordedSeconds,
        remainingMs: capReached
          ? 0
          : Math.max(0, config.maxSessionMs - (now() - line.openedAt)),
        ...(capReached ? { capReached: true } : {}),
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
