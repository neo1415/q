import { randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import type { DocumentRepository } from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import type {
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingSuggestionRepository,
  OnboardingUtteranceRepository,
} from "@capital-q/onboarding";
import type { ChunkRepository } from "@capital-q/q-knowledge";
import type { TenantId, UserId } from "@capital-q/security";

import { FOUNDER_JOURNEY_TYPE, FOUNDER_STEPS } from "../definition/index.js";
import type { FounderExtractionOutcome } from "../intelligence/contracts.js";
import type {
  FounderExtractionRequest,
  FounderExtractionSource,
} from "../intelligence/extraction.js";
import {
  createFounderReview,
  passagesFrom,
  sessionFactsFrom,
  type FounderReviewPlan,
} from "../intelligence/review.js";

/**
 * The production caller for Founder Onboarding Q (CQ-C5-R2B §7-§9).
 *
 * CQ-Q-021 built the whole pipeline — extraction, validation, suggestion
 * drafting, follow-up planning — and nothing in the running application ever
 * called it. This is what calls it, when a document the founder uploaded has
 * genuinely finished processing:
 *
 *   evidence.document.ready
 *     → the document, and the company it belongs to
 *     → the founder's ACTIVE onboarding session for that company
 *     → what the session already knows (responses, pending suggestions)
 *     → the document's chunks as labelled passages
 *     → ONE model call, through the gateway, behind the firewall's ceiling
 *     → onboarding suggestions the founder confirms, edits or rejects
 *
 * and, since CQ-PRE-REC-001 §20, when the founder says something to Q in
 * the conversational interview that no deterministic rule could place:
 *
 *   onboarding.utterance.recorded
 *     → the session and the utterance
 *     → the same session state, the utterance as the narrative
 *     → the same one model call, the same suggestions and questions
 *
 * Three properties it is built to hold.
 *
 * It is asynchronous by construction. The upload request returns as soon as
 * the version exists; this runs later, off the event, so a founder is never
 * left watching a spinner while a model reads a deck (§7).
 *
 * It is safe to run twice (§9). The only suggestions it creates are for facts
 * the session has neither answered nor already been offered — a filter the
 * review pipeline applies from the session's own current state, read fresh on
 * every run. A redelivered event, a replayed job or a second document
 * therefore adds nothing it has already added, and a late result from a
 * replaced document cannot overwrite a newer answer, because it can only ever
 * ADD an offer for something still open. Nothing here supersedes anything.
 *
 * It decides no truth. Its entire output is suggestions, each validated by
 * the onboarding runtime against the pinned step's own schema before it is
 * stored, and each inert until a person accepts it.
 */

/** Why a ready document produced no review. All of these are ordinary. */
export const FOUNDER_REVIEW_SKIP_REASONS = [
  /** The document is not attached to a company. */
  "NOT_A_COMPANY_DOCUMENT",
  /** Nobody is in a founder journey for that company right now. */
  "NO_ACTIVE_SESSION",
  /** Processing finished but produced no readable passages. */
  "NO_PASSAGES",
  /** The utterance belongs to no active founder session, or was read already. */
  "NO_UTTERANCE",
] as const;

export type FounderReviewSkipReason =
  (typeof FOUNDER_REVIEW_SKIP_REASONS)[number];

export type FounderReviewResult =
  | {
      readonly kind: "PREPARED";
      readonly sessionId: string;
      readonly suggestionsCreated: number;
      /** Follow-ups the planner would ask now. Not persisted; see §13. */
      readonly questionsPlanned: number;
      readonly blocked: FounderExtractionOutcome["blocked"];
    }
  | { readonly kind: "SKIPPED"; readonly reason: FounderReviewSkipReason };

export type FounderReviewServiceDependencies = {
  readonly sql: DatabaseExecutor;
  /** Evidence's own repository. The document is read through its owner. */
  readonly documents: DocumentRepository;
  /** Q Knowledge's chunks for the processed version. */
  readonly chunks: ChunkRepository;
  readonly sessions: OnboardingSessionRepository;
  readonly responses: OnboardingResponseRepository;
  readonly suggestions: OnboardingSuggestionRepository;
  /** The conversational interview's free-text turns. Optional: without it, none are read. */
  readonly utterances?: OnboardingUtteranceRepository | undefined;
  /** The onboarding runtime's internal, never-browser-reachable creation. */
  readonly createSuggestion: (command: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly targetField: string;
    readonly suggestedValue: unknown;
    readonly sourceRefs: readonly {
      readonly sourceType: string;
      readonly sourceId: string;
    }[];
    readonly confidence: string | null;
  }) => Promise<unknown>;
  readonly extraction: {
    readonly extract: (
      request: FounderExtractionRequest,
    ) => Promise<FounderExtractionOutcome>;
  };
  /**
   * The onboarding runtime's internal question recording (CQ-PRE-REC-001).
   * What the planner decided is worth asking is persisted as journey state
   * so F7 — and the conversational interview — can ask it after a refresh
   * or a new machine. Optional: a composition without it still produces
   * suggestions, and the planned questions are merely counted.
   */
  readonly recordQuestions?:
    | ((command: {
        readonly sessionId: string;
        readonly questions: readonly {
          readonly stepKey: string;
          readonly factKey: string;
          readonly question: string;
          readonly why: string | null;
          readonly reason: string;
          readonly readings: readonly string[];
          readonly sourceRefs: readonly {
            readonly sourceType: string;
            readonly sourceId: string;
          }[];
        }[];
      }) => Promise<unknown>)
    | undefined;
  readonly logger?: Logger | undefined;
};

/** How many of a document's chunks the model reads. Bounded (CQ-Q-021 §79). */
const PASSAGES_PER_DOCUMENT = 12;

/** The narrative steps whose commit is worth Q's reading (CQ-PRE-REC-001 §20). */
export const FOUNDER_NARRATIVE_STEP_KEYS: readonly string[] = [
  FOUNDER_STEPS.description,
  FOUNDER_STEPS.followUp,
];

export type FounderDocumentReview = {
  /** A founder wrote prose on a narrative step: read it like a turn of the interview. */
  readonly onResponseCommitted: (event: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly responseId: string;
  }) => Promise<FounderReviewResult>;
  readonly onDocumentReady: (event: {
    readonly tenantId: TenantId;
    readonly documentId: string;
    readonly documentVersionId: string;
  }) => Promise<FounderReviewResult>;
  /** A free-text turn of the conversational interview (CQ-PRE-REC-001 §20). */
  readonly onUtterance: (event: {
    readonly sessionId: string;
    readonly utteranceId: string;
  }) => Promise<FounderReviewResult>;
};

type SourceRef = { readonly sourceType: string; readonly sourceId: string };

export function createFounderDocumentReview(
  dependencies: FounderReviewServiceDependencies,
): FounderDocumentReview {
  const {
    sql,
    documents,
    chunks,
    sessions,
    responses,
    suggestions,
    utterances,
    createSuggestion,
    extraction,
    recordQuestions,
    logger,
  } = dependencies;

  /** One reading of the session against some material, then its offers. */
  async function read(input: {
    readonly tenantId: TenantId;
    readonly userId: UserId;
    readonly sessionId: string;
    readonly sources: readonly FounderExtractionSource[];
    /** The founder's own words for this reading; the description otherwise. */
    readonly narrative: string | null;
    readonly sourceRef: SourceRef;
    readonly context: Readonly<Record<string, string | number>>;
  }): Promise<FounderReviewResult> {
    const [current, pending] = await Promise.all([
      responses.listCurrent(sql, input.sessionId as never),
      suggestions.listPending(sql, input.sessionId as never),
    ]);

    const facts = sessionFactsFrom({
      responses: current.map((response) => ({
        stepKey: response.stepKey,
        value: response.value,
      })),
      pendingSuggestionSteps: pending.map((suggestion) => suggestion.stepKey),
      narrative: input.narrative ?? narrativeOf(current),
    });

    const plan = await createFounderReview({
      extraction,
      ...(logger === undefined ? {} : { logger }),
    }).prepare({
      tenantId: input.tenantId,
      userId: input.userId,
      sql,
      facts,
      sources: input.sources,
      // One unit of work per reading, so the model call can be traced back
      // to the document or the turn that caused it.
      correlationId: `cor_${randomUUID()}`,
    });

    return applyPlan(input.sessionId, plan, input.sourceRef, input.context);
  }

  /** The plan's offers, persisted through the runtime's own validation. */
  async function applyPlan(
    sessionId: string,
    plan: FounderReviewPlan,
    sourceRef: SourceRef,
    context: Readonly<Record<string, string | number>>,
  ): Promise<FounderReviewResult> {
    let created = 0;
    for (const draft of plan.suggestions) {
      // One at a time and independently: a single rejected draft — a value
      // the pinned step's schema refuses — must not discard the others.
      try {
        await createSuggestion({
          sessionId,
          stepKey: draft.stepKey,
          targetField: draft.targetField,
          suggestedValue: draft.suggestedValue,
          sourceRefs:
            draft.sourceRefs.length === 0 ? [sourceRef] : draft.sourceRefs,
          confidence: draft.confidence,
        });
        created += 1;
      } catch (error: unknown) {
        logger?.warn(
          { err: error, sessionId, stepKey: draft.stepKey },
          "founder review suggestion refused by the onboarding runtime",
        );
      }
    }

    // The planner's questions are journey state, not a model's opinion:
    // every one maps to a real step of the pinned definition, and the
    // runtime validates that again before storing. A question a later
    // reading re-plans supersedes the earlier one for the same fact.
    let questionsRecorded = 0;
    if (recordQuestions !== undefined && plan.questions.length > 0) {
      try {
        await recordQuestions({
          sessionId,
          questions: plan.questions.map((question) => ({
            stepKey: question.stepKey,
            factKey: question.key,
            question: question.question,
            why: question.why,
            reason: question.reason,
            readings: question.readings,
            sourceRefs: [sourceRef],
          })),
        });
        questionsRecorded = plan.questions.length;
      } catch (error: unknown) {
        logger?.warn(
          { err: error, sessionId },
          "founder follow-up questions refused by the onboarding runtime",
        );
      }
    }

    logger?.info(
      {
        sessionId,
        ...context,
        drafted: plan.suggestions.length,
        created,
        questions: plan.questions.length,
        questionsRecorded,
        blocked: plan.outcome.blocked,
      },
      "founder review prepared",
    );

    return {
      kind: "PREPARED",
      sessionId,
      suggestionsCreated: created,
      questionsPlanned: plan.questions.length,
      blocked: plan.outcome.blocked,
    };
  }

  return {
    onDocumentReady: async (event): Promise<FounderReviewResult> => {
      const document = await documents.findInTenant(
        sql,
        event.tenantId,
        event.documentId as never,
      );
      if (document === null || document.companyId === null) {
        return { kind: "SKIPPED", reason: "NOT_A_COMPANY_DOCUMENT" };
      }

      // The founder's own journey for this company. A document uploaded by
      // someone with no open session is still processed and still
      // retrievable by Q; it simply has no review to feed.
      const session = await sessions.findActive(
        sql,
        document.createdByUserId,
        FOUNDER_JOURNEY_TYPE,
        { subjectType: "COMPANY", subjectId: document.companyId },
      );
      if (session === null) {
        return { kind: "SKIPPED", reason: "NO_ACTIVE_SESSION" };
      }

      const stored = await chunks.listActiveByVersion(
        sql,
        event.tenantId,
        event.documentVersionId as never,
      );
      if (stored.length === 0) {
        return { kind: "SKIPPED", reason: "NO_PASSAGES" };
      }

      const sources = passagesFrom(
        [
          {
            documentId: event.documentId,
            documentVersionId: event.documentVersionId,
            title: document.title,
            chunks: stored.map((chunk) => ({
              content: chunk.content,
              chunkIndex: chunk.chunkIndex,
              locator: chunk.locator,
            })),
          },
        ],
        PASSAGES_PER_DOCUMENT,
      );

      return read({
        tenantId: event.tenantId,
        userId: document.createdByUserId,
        sessionId: session.id,
        sources,
        narrative: null,
        sourceRef: {
          sourceType: "EVIDENCE_DOCUMENT",
          sourceId: event.documentId,
        },
        context: { documentId: event.documentId, passages: sources.length },
      });
    },

    onResponseCommitted: async (event): Promise<FounderReviewResult> => {
      if (!FOUNDER_NARRATIVE_STEP_KEYS.includes(event.stepKey)) {
        return { kind: "SKIPPED", reason: "NO_ACTIVE_SESSION" };
      }
      const session = await sessions.findById(sql, event.sessionId as never);
      if (
        session === null ||
        session.journeyType !== FOUNDER_JOURNEY_TYPE ||
        session.status !== "ACTIVE" ||
        session.tenantId === null
      ) {
        return { kind: "SKIPPED", reason: "NO_ACTIVE_SESSION" };
      }
      const current = await responses.listCurrent(sql, session.id);
      const response = current.find(
        (candidate) =>
          candidate.stepKey === event.stepKey &&
          candidate.id === event.responseId,
      );
      const text =
        response !== undefined && response.value.type === "TEXT"
          ? response.value.text.trim()
          : "";
      if (text.length === 0) {
        return { kind: "SKIPPED", reason: "NO_PASSAGES" };
      }
      return read({
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId: session.id,
        sources: [],
        narrative: text,
        sourceRef: {
          sourceType: "ONBOARDING_RESPONSE",
          sourceId: event.responseId,
        },
        context: { responseId: event.responseId, passages: 0 },
      });
    },

    onUtterance: async (event): Promise<FounderReviewResult> => {
      if (utterances === undefined) {
        return { kind: "SKIPPED", reason: "NO_UTTERANCE" };
      }
      const session = await sessions.findById(sql, event.sessionId as never);
      if (
        session === null ||
        session.journeyType !== FOUNDER_JOURNEY_TYPE ||
        session.status !== "ACTIVE" ||
        session.tenantId === null
      ) {
        return { kind: "SKIPPED", reason: "NO_ACTIVE_SESSION" };
      }
      const utterance = await utterances.findById(
        sql,
        session.id,
        event.utteranceId as never,
      );
      if (utterance === null || utterance.status !== "PENDING") {
        return { kind: "SKIPPED", reason: "NO_UTTERANCE" };
      }

      const result = await read({
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId: session.id,
        sources: [],
        narrative: utterance.text,
        sourceRef: {
          sourceType: "ONBOARDING_UTTERANCE",
          sourceId: utterance.id,
        },
        context: { utteranceId: utterance.id, passages: 0 },
      });
      // Read once. A reading the model could not complete stays PENDING so
      // the retried event finds it again; a completed one is done.
      if (result.kind === "PREPARED" && result.blocked === null) {
        await utterances.markRead(sql, utterance.id, "READ");
      }
      return result;
    },
  };
}

/**
 * The founder's own words, when they wrote any.
 *
 * The description step is the one place a founder writes prose about the
 * business, and the extraction reads it beside the documents so it does not
 * propose what they have already said.
 */
function narrativeOf(
  responses: readonly { readonly stepKey: string; readonly value: unknown }[],
): string | null {
  const description = responses.find(
    (response) => response.stepKey === FOUNDER_STEPS.description,
  );
  if (description === undefined || typeof description.value !== "object") {
    return null;
  }
  const text = (description.value as Record<string, unknown>)["text"];
  return typeof text === "string" && text.trim().length > 0 ? text : null;
}
