import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  ConversationRecallV2ResultSchema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type ConversationRecallV2Result,
  type ConversationRecallV2Variables,
  type PromptRegistry,
} from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationFetch,
  QConversationMessage,
} from "@capital-q/q-runtime";

import type { ModelGateway } from "../gateway.js";
import { checkAnswer, claimCorpus } from "./claim-check.js";
import { conversationContextOf } from "./conversation-context.js";
import {
  evidenceScopeOf,
  type ConversationEvidence,
  type EvidenceScope,
} from "./conversation-evidence.js";

/**
 * The contextual follow-up fast path (owner, DECISIONS 104, 2026-11-17).
 *
 * Live 17 Nov (conversation 9995dcca, "expand on the second one. Why does
 * it matter?"): a same-subject follow-up the turn reader classed
 * CONTEXTUAL_FOLLOW_UP still paid for a second reading, a record-only
 * recall that could not answer it, a cancelled speculative answer and a
 * full answer call over ~49k input tokens: 14.5 s to the stored answer. In
 * five days of production, CONTEXTUAL_FOLLOW_UP runs took p50 10.4 s.
 *
 * Principle: what the previous full answer in THIS conversation was given
 * (its claim-check sources: the authorised facts, tool results and
 * documents read for this person) is kept as conversation evidence
 * (`keepAnswerContext`), and a follow-up the reader classes as answerable
 * from context is answered from it, and from what Q showed (SHOWN), in ONE
 * tool-free model call: no tools, no pre-readers, no retrieval, no
 * re-ranking, no wide reads.
 *
 * Guards, all of which hold here as on the full path:
 * - Authorisation: the evidence is keyed by tenant, person (user,
 *   organisation, membership, actor type), conversation and a hash of the
 *   run's access context (conversation-evidence.ts). Another person,
 *   conversation or a changed grant simply misses. It is reused only within
 *   the TTL (three minutes from when it was READ, never refreshed by
 *   reuse), and only while the watermark says nothing of theirs changed;
 *   any write through Q's tool seam forgets it. `take` is asked again
 *   just before the answer is returned, so a revocation that lands while
 *   the model writes still falls back.
 * - Claim check: every figure, date, count and name in the reply is held
 *   to the same sources the model was shown (claimCorpus); Q's own earlier
 *   words are echoes, which never bind a count. A single ungrounded claim
 *   is not trimmed and published: the turn goes the full way instead.
 * - Nothing invented: the model says `answerable: false` when the sources
 *   do not hold what is asked; that, a failed call, a reply claiming work
 *   done, or no kept evidence is a MISS, and the caller answers the turn
 *   the full way. A miss is never a reply.
 */

/** How long one source may be in EVIDENCE (characters). */
export const CONTEXT_SOURCE_CHARS_MAX = 8_000;
/** EVIDENCE's whole bound (within ConversationRecallV2VariablesSchema). */
export const CONTEXT_EVIDENCE_CHARS_MAX = 40_000;

const CONTEXT_FOLLOW_UP_BUDGET = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 700,
  attemptTimeoutMs: 9_000,
} as const;

const SPOKEN_LENGTH =
  "it is spoken aloud: two to four short sentences, at most 90 words, no lists, headings or markdown.";
const TYPED_LENGTH =
  "at most 180 words, in short paragraphs; a short list only where it helps.";

/** "I've opened/checked/looked up…": the fast path reads and does nothing. */
const CLAIMS_WORK =
  /\b(?:i(?:'ve| have)?\s+(?:just\s+)?(?:opened|saved|sent|booked|updated|changed|refreshed|re-?ran|looked\s+(?:it\s+)?up|checked|searched))\b/iu;

/** What the last full answer was given, kept for a follow-up. */
export type AnswerContext = {
  /** Its claim-check sources, deduplicated and bounded, in their order. */
  readonly sources: readonly string[];
};

/**
 * A full answer's sources, bounded for a follow-up's prompt: each source
 * cut to CONTEXT_SOURCE_CHARS_MAX, duplicates and blanks dropped, and the
 * whole within CONTEXT_EVIDENCE_CHARS_MAX, earlier sources first (the
 * full path lists its authorised facts first). What is kept is exactly
 * what the follow-up's model is shown and its claim check is held to.
 */
export function answerContextOf(sources: readonly string[]): AnswerContext {
  const kept: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const source of sources) {
    const text = source.trim().slice(0, CONTEXT_SOURCE_CHARS_MAX);
    if (text.length === 0 || seen.has(text)) continue;
    // The separator between sources counts too.
    if (used + text.length + 1 > CONTEXT_EVIDENCE_CHARS_MAX) continue;
    seen.add(text);
    kept.push(text);
    used += text.length + 1;
  }
  return { sources: kept };
}

/** Keep a full answer's sources for this conversation's follow-ups. */
export function keepAnswerContext(
  evidence: ConversationEvidence,
  scope: EvidenceScope,
  runId: string,
  sources: readonly string[],
): void {
  const context = answerContextOf(sources);
  if (context.sources.length === 0) return;
  evidence.keep(scope, "ANSWER", context, {
    runId,
    reads: ["answer.sources"],
  });
}

export type ContextFollowUpInput = {
  readonly conversationId: string;
  /** The conversation's stored messages, the latest user turn included. */
  readonly history: readonly QConversationMessage[];
  readonly latestId: string;
  readonly said: string;
  readonly spoken: boolean;
};

export type ContextFollowUpMiss =
  | "NO_EVIDENCE"
  | "NOT_ANSWERABLE"
  | "UNGROUNDED"
  | "CLAIMS_WORK"
  | "REVOKED"
  | "FAILED";

export type ContextFollowUpOutcome =
  | {
      readonly kind: "ANSWERED";
      readonly text: string;
      /** The run whose reads the answer reused, and their age. */
      readonly readByRun: string;
      readonly ageMs: number;
    }
  | { readonly kind: "MISS"; readonly reason: ContextFollowUpMiss };

export type ContextFollowUp = {
  /**
   * Whether evidence is held for this run's person, access context and
   * conversation, inside its TTL. A reason to START a call early, never to
   * serve one: `answer` takes it (watermark included) itself.
   */
  readonly holds: (request: QAnswerRequest, conversationId: string) => boolean;
  readonly answer: (
    request: QAnswerRequest,
    input: ContextFollowUpInput,
    options?: { readonly signal?: AbortSignal | undefined },
  ) => Promise<ContextFollowUpOutcome>;
};

function scopeOf(request: QAnswerRequest, conversationId: string) {
  return evidenceScopeOf({
    actor: request.actor,
    plan: request.plan,
    conversationId,
  });
}

/** The fetched results of a conversation, as the store keeps them. */
function fetchedOf(request: QAnswerRequest): readonly QConversationFetch[] {
  return request.fetchedInConversation ?? [];
}

export function createContextFollowUp(dependencies: {
  readonly gateway: ModelGateway;
  readonly evidence: ConversationEvidence;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}): ContextFollowUp {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const now = dependencies.now ?? Date.now;
  const { evidence, logger } = dependencies;
  const miss = (
    request: QAnswerRequest,
    reason: ContextFollowUpMiss,
  ): ContextFollowUpOutcome => {
    logger?.info(
      { qRunId: request.runId, reason },
      "q context follow-up missed; the full path answers",
    );
    return { kind: "MISS", reason };
  };
  return {
    holds: (request, conversationId) =>
      evidence.holds(scopeOf(request, conversationId), "ANSWER"),
    answer: async (request, input, options = {}) => {
      const scope = scopeOf(request, input.conversationId);
      const kept = await evidence
        .take<AnswerContext>(scope, "ANSWER")
        .catch(() => null);
      if (kept === null || kept.value.sources.length === 0) {
        return miss(request, "NO_EVIDENCE");
      }
      // SHOWN: Q's earlier turns here, with what they fetched (already
      // held to this run's ceiling by withFetched).
      const shown = conversationContextOf(
        input.history,
        input.latestId,
        fetchedOf(request),
      );
      const recent = input.history
        .filter((message) => message.id !== input.latestId)
        .slice(-6)
        .map((message) => ({
          role: message.role === "USER" ? "USER" : "Q",
          text: message.content.slice(0, 400),
        }));
      let say: string;
      try {
        const rendered = renderPrompt<ConversationRecallV2Variables>(registry, {
          task: "CONVERSATION_RECALL",
          taskVersion: 2,
          operatingMode: "DEBRIEF",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You are answering from what this conversation already read and showed; nothing new was read for this reply.",
          variables: {
            said: input.said.trim().slice(0, 1_000),
            recentTurns: JSON.stringify(recent).slice(0, 3_000),
            shown: shown.text.slice(0, 9_000),
            evidence: kept.value.sources.join("\n"),
            length: input.spoken ? SPOKEN_LENGTH : TYPED_LENGTH,
          },
        });
        const signal = anySignal([request.signal, options.signal]);
        const response =
          await dependencies.gateway.execute<ConversationRecallV2Result>(
            {
              taskClass: "NORMAL_DIALOGUE",
              // The evidence carries what this run may see: its own ceiling.
              sensitivity: request.plan.maxSensitivity,
              ...(dependencies.dataPosture === undefined
                ? {}
                : { dataPosture: dependencies.dataPosture }),
              budget: CONTEXT_FOLLOW_UP_BUDGET,
              messages: [...rendered.messages],
              output: rendered.output,
              attribution: {
                tenantId: request.tenantId,
                userId: request.actor.userId,
                qRunId: request.runId,
                correlationId: request.correlationId,
              },
            },
            {
              schema: ConversationRecallV2ResultSchema,
              ...(signal === undefined ? {} : { signal }),
            },
          );
        if (response.output.kind !== "STRUCTURED") {
          return miss(request, "FAILED");
        }
        const read = ConversationRecallV2ResultSchema.safeParse(
          response.output.value,
        );
        if (!read.success) return miss(request, "FAILED");
        if (!read.data.answerable) return miss(request, "NOT_ANSWERABLE");
        say = read.data.say?.trim() ?? "";
      } catch (error: unknown) {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "q context follow-up call failed; the full path answers",
        );
        return miss(request, "FAILED");
      }
      if (say.length === 0) return miss(request, "NOT_ANSWERABLE");
      if (CLAIMS_WORK.test(say)) return miss(request, "CLAIMS_WORK");
      // The claim check, over exactly what the model was shown: the kept
      // sources, what Q's turns showed and fetched, and their own words.
      // Q's earlier words are echoes: they ground a figure by value but
      // never bind a count.
      const shownSources = shown.turns.flatMap((turn) => [
        JSON.stringify(turn.blocks),
        JSON.stringify(turn.fetched),
      ]);
      const theirWords = input.history
        .filter((message) => message.role === "USER")
        .map((message) => message.content);
      const qWords = input.history
        .filter((message) => message.role === "Q")
        .map((message) => message.content);
      const checked = checkAnswer(
        say,
        claimCorpus(
          [...kept.value.sources, ...shownSources, ...theirWords],
          new Date(now()),
          qWords,
        ),
      );
      if (
        checked.ungrounded.length > 0 ||
        checked.stats.dropped > 0 ||
        checked.stats.rewritten > 0
      ) {
        // Kinds only: a figure the model wrote may itself be private.
        logger?.info(
          {
            qRunId: request.runId,
            ungrounded: checked.ungrounded,
            dropped: checked.stats.dropped,
            rewritten: checked.stats.rewritten,
          },
          "q context follow-up stated what its sources do not hold",
        );
        return miss(request, "UNGROUNDED");
      }
      // Re-checked at the last moment: a write of theirs or a revocation
      // while the model wrote drops the evidence, and the turn goes the
      // full way rather than answer from what they may no longer see.
      const still = await evidence
        .take<AnswerContext>(scope, "ANSWER")
        .catch(() => null);
      if (still === null || still.provenance.runId !== kept.provenance.runId) {
        return miss(request, "REVOKED");
      }
      logger?.info(
        {
          qRunId: request.runId,
          readByRun: kept.provenance.runId,
          ageMs: now() - kept.readAt,
          sources: kept.value.sources.length,
        },
        "q answered a follow-up from this conversation's evidence",
      );
      return {
        kind: "ANSWERED",
        text: checked.text,
        readByRun: kept.provenance.runId,
        ageMs: now() - kept.readAt,
      };
    },
  };
}

/** One signal that aborts when any of these does; undefined for none. */
function anySignal(
  signals: readonly (AbortSignal | undefined)[],
): AbortSignal | undefined {
  const present = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}
