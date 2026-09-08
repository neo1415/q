import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { FounderFactKey } from "@capital-q/q-core";
import type { TenantId, UserId } from "@capital-q/security";

import type {
  FounderCandidate,
  FounderExtractionOutcome,
  FounderSuggestionDraft,
  PlannedQuestion,
} from "./contracts.js";
import type {
  FounderExtractionRequest,
  FounderExtractionSource,
} from "./extraction.js";
import {
  businessShapeFrom,
  factKeyForStep,
  stepForFactKey,
} from "./mapping.js";
import { planFollowUpQuestions } from "./planner.js";
import { draftSuggestions } from "./suggestions.js";

/**
 * The bridge from a processed document to something a founder can review
 * (CQ-Q-021 §18-§20, §47-§49).
 *
 * This is what makes F3 real. It runs after a document finishes processing,
 * and it is the only place that connects the two halves of the packet:
 *
 *   processed documents → authorised passages → extraction → validated
 *   candidates → onboarding suggestions → the founder confirms, edits or
 *   rejects → the journey's own validated-response path → owning domain
 *
 * Three properties it exists to guarantee:
 *
 *   - It replans rather than repeats (§48). Facts a document just answered
 *     become suggestions to confirm, not blank questions to type. Facts the
 *     founder already answered are not extracted into a competing
 *     suggestion at all.
 *   - It never writes truth (§20, §51). Its output is suggestions, and the
 *     onboarding runtime validates each one against the pinned step's own
 *     schema before storing it. Accepting one takes the same path a typed
 *     answer takes.
 *   - It is safe to run twice (§63). A fact that already has a pending
 *     suggestion or a confirmed answer produces nothing, so a replayed job
 *     or a second document does not bury the founder in duplicates.
 */

/** What the session already knows, read from its own responses. */
export type FounderSessionFacts = {
  /** Facts with a submitted response. */
  readonly answered: ReadonlySet<FounderFactKey>;
  /** Facts with a suggestion still awaiting the founder. */
  readonly suggested: ReadonlySet<FounderFactKey>;
  /** The founder's own words, when they wrote any. */
  readonly narrative: string | null;
  /** Answers already established, so the model neither re-asks nor re-extracts. */
  readonly known: readonly {
    readonly key: FounderFactKey;
    readonly value: string;
  }[];
  readonly revenueStatus: string | null;
  readonly stage: string | null;
};

/**
 * Reads a session's responses into the facts the extraction and the planner
 * both work from.
 *
 * `answered` is derived from the step a fact maps to, which is what makes
 * "already answered" a decidable property rather than a heuristic.
 */
export function sessionFactsFrom(input: {
  readonly responses: readonly {
    readonly stepKey: string;
    readonly value: unknown;
  }[];
  readonly pendingSuggestionSteps: readonly string[];
  readonly narrative: string | null;
}): FounderSessionFacts {
  const answered = new Set<FounderFactKey>();
  const known: { key: FounderFactKey; value: string }[] = [];
  let revenueStatus: string | null = null;
  let stage: string | null = null;

  for (const response of input.responses) {
    const key = factKeyForStep(response.stepKey);
    if (key === null) {
      continue;
    }
    answered.add(key);
    const described = describeValue(response.value);
    if (described !== null) {
      known.push({ key, value: described });
      if (key === "revenue_status") {
        revenueStatus = described;
      }
      if (key === "stage") {
        stage = described;
      }
    }
  }

  const suggested = new Set<FounderFactKey>();
  for (const stepKey of input.pendingSuggestionSteps) {
    const key = factKeyForStep(stepKey);
    if (key !== null) {
      suggested.add(key);
    }
  }

  return {
    answered,
    suggested,
    narrative: input.narrative,
    known,
    revenueStatus,
    stage,
  };
}

/** A response value as one short string. Never a nested object dumped raw. */
function describeValue(value: unknown): string | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record["text"] === "string") {
    return record["text"];
  }
  if (typeof record["optionKey"] === "string") {
    return record["optionKey"];
  }
  if (Array.isArray(record["optionKeys"])) {
    return (record["optionKeys"] as unknown[]).map(String).join(", ");
  }
  if (typeof record["value"] === "string") {
    return record["value"];
  }
  return null;
}

/**
 * A processed document's chunks as labelled passages.
 *
 * Bounded per document so one long deck cannot crowd out a financial model,
 * and ordered by position so the model reads the material the way a person
 * would.
 */
export function passagesFrom(
  documents: readonly {
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly title: string;
    readonly chunks: readonly {
      readonly content: string;
      readonly chunkIndex: number;
      readonly locator: {
        readonly slide?: number | undefined;
        readonly pageStart?: number | undefined;
        readonly sheet?: string | undefined;
      };
    }[];
  }[],
  perDocument = 12,
): readonly FounderExtractionSource[] {
  return documents.flatMap((document) =>
    [...document.chunks]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .slice(0, perDocument)
      .map((chunk): FounderExtractionSource => {
        const where =
          chunk.locator.slide !== undefined
            ? `slide ${String(chunk.locator.slide)}`
            : chunk.locator.pageStart !== undefined
              ? `page ${String(chunk.locator.pageStart)}`
              : chunk.locator.sheet !== undefined
                ? `sheet ${chunk.locator.sheet}`
                : null;
        return {
          documentId: document.documentId,
          documentVersionId: document.documentVersionId,
          // What a founder would call it, so provenance reads as a sentence
          // rather than an identifier (§21).
          label:
            where === null
              ? `your ${document.title}`
              : `your ${document.title}, ${where}`,
          page: chunk.locator.pageStart ?? chunk.locator.slide ?? null,
          text: chunk.content,
        };
      }),
  );
}

export type FounderReviewPlan = {
  readonly outcome: FounderExtractionOutcome;
  /** Suggestions to create. Already filtered against what is known. */
  readonly suggestions: readonly FounderSuggestionDraft[];
  /** Candidates with no directly suggestable step, for the review screen. */
  readonly forReview: readonly FounderCandidate[];
  /** The follow-up questions worth asking after this reading (§48). */
  readonly questions: readonly PlannedQuestion[];
};

export type FounderReviewDependencies = {
  readonly extraction: {
    readonly extract: (
      request: FounderExtractionRequest,
    ) => Promise<FounderExtractionOutcome>;
  };
  readonly logger?: Logger | undefined;
};

export type FounderReviewCommand = {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly sql: DatabaseExecutor;
  readonly facts: FounderSessionFacts;
  readonly sources: readonly FounderExtractionSource[];
  /** The unit of work, carried through to the model call's attribution. */
  readonly correlationId: string;
  readonly signal?: AbortSignal | undefined;
};

export function createFounderReview(dependencies: FounderReviewDependencies): {
  readonly prepare: (
    command: FounderReviewCommand,
  ) => Promise<FounderReviewPlan>;
} {
  const { extraction, logger } = dependencies;

  return {
    prepare: async (
      command: FounderReviewCommand,
    ): Promise<FounderReviewPlan> => {
      const { facts } = command;
      const shape = businessShapeFrom(facts.revenueStatus);

      // What is still open, so the model proposes questions about facts the
      // server already established are unanswered rather than about
      // whatever it found interesting (§41).
      const unanswered: FounderFactKey[] = [];
      for (const key of ALL_MAPPED_KEYS) {
        if (!facts.answered.has(key) && !facts.suggested.has(key)) {
          unanswered.push(key);
        }
      }

      const outcome = await extraction.extract({
        tenantId: command.tenantId,
        userId: command.userId,
        sources: command.sources,
        narrative: facts.narrative,
        knownFacts: facts.known,
        unansweredKeys: unanswered,
        shape,
        stage: facts.stage,
        correlationId: command.correlationId,
        ...(command.signal === undefined ? {} : { signal: command.signal }),
      });

      // A candidate about something the founder already answered is not
      // offered. Their own answer stands, and a competing suggestion would
      // be exactly the duplicate this packet removes (§23, §49).
      const fresh = outcome.candidates.filter(
        (candidate) =>
          !facts.answered.has(candidate.key) &&
          !facts.suggested.has(candidate.key),
      );

      const suggestions = draftSuggestions(fresh);
      const suggestedKeys = new Set(
        suggestions.flatMap((draft) => {
          const key = factKeyForStep(draft.stepKey);
          return key === null ? [] : [key];
        }),
      );
      const forReview = fresh.filter(
        (candidate) => !suggestedKeys.has(candidate.key),
      );

      const questions = planFollowUpQuestions({
        answered: facts.answered,
        // A fact this reading just proposed is a review, not a question.
        suggested: new Set([...facts.suggested, ...suggestedKeys]),
        conflicts: outcome.conflicts,
        ambiguities: outcome.ambiguities,
        proposed: outcome.proposed,
        shape,
      });

      logger?.info(
        {
          sources: command.sources.length,
          candidates: outcome.candidates.length,
          fresh: fresh.length,
          suggestions: suggestions.length,
          questions: questions.length,
          conflicts: outcome.conflicts.length,
          blocked: outcome.blocked,
        },
        "founder onboarding review prepared",
      );

      return { outcome, suggestions, forReview, questions };
    },
  };
}

/** Every fact the journey has a step for. Derived once, not restated. */
const ALL_MAPPED_KEYS: readonly FounderFactKey[] = (
  [
    "company_name",
    "website",
    "country",
    "stage",
    "description",
    "categories",
    "founder_role",
    "founder_count",
    "full_time",
    "team_size",
    "functions",
    "signal",
    "pilots",
    "revenue_status",
    "customers",
    "growth",
    "raising",
    "currency",
    "target_amount",
    "instrument",
    "timeframe",
    "use_of_funds",
  ] as const satisfies readonly FounderFactKey[]
).filter((key) => stepForFactKey(key) !== null);
