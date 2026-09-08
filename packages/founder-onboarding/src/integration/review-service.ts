import { randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import type { DocumentRepository } from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import type {
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingSuggestionRepository,
} from "@capital-q/onboarding";
import type { ChunkRepository } from "@capital-q/q-knowledge";
import type { TenantId } from "@capital-q/security";

import { FOUNDER_JOURNEY_TYPE, FOUNDER_STEPS } from "../definition/index.js";
import type { FounderExtractionOutcome } from "../intelligence/contracts.js";
import type { FounderExtractionRequest } from "../intelligence/extraction.js";
import {
  createFounderReview,
  passagesFrom,
  sessionFactsFrom,
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
  readonly logger?: Logger | undefined;
};

/** How many of a document's chunks the model reads. Bounded (CQ-Q-021 §79). */
const PASSAGES_PER_DOCUMENT = 12;

export type FounderDocumentReview = {
  readonly onDocumentReady: (event: {
    readonly tenantId: TenantId;
    readonly documentId: string;
    readonly documentVersionId: string;
  }) => Promise<FounderReviewResult>;
};

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
    createSuggestion,
    extraction,
    logger,
  } = dependencies;

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

      const [current, pending] = await Promise.all([
        responses.listCurrent(sql, session.id),
        suggestions.listPending(sql, session.id),
      ]);

      const facts = sessionFactsFrom({
        responses: current.map((response) => ({
          stepKey: response.stepKey,
          value: response.value,
        })),
        pendingSuggestionSteps: pending.map((suggestion) => suggestion.stepKey),
        narrative: narrativeOf(current),
      });

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

      const plan = await createFounderReview({
        extraction,
        ...(logger === undefined ? {} : { logger }),
      }).prepare({
        tenantId: event.tenantId,
        userId: document.createdByUserId,
        sql,
        facts,
        sources,
        // One unit of work per ready document, so the model call can be
        // traced back to the document that caused it.
        correlationId: `cor_${randomUUID()}`,
      });

      let created = 0;
      for (const draft of plan.suggestions) {
        // One at a time and independently: a single rejected draft — a value
        // the pinned step's schema refuses — must not discard the others.
        try {
          await createSuggestion({
            sessionId: session.id,
            stepKey: draft.stepKey,
            targetField: draft.targetField,
            suggestedValue: draft.suggestedValue,
            sourceRefs: draft.sourceRefs,
            confidence: draft.confidence,
          });
          created += 1;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, sessionId: session.id, stepKey: draft.stepKey },
            "founder review suggestion refused by the onboarding runtime",
          );
        }
      }

      logger?.info(
        {
          sessionId: session.id,
          documentId: event.documentId,
          passages: sources.length,
          drafted: plan.suggestions.length,
          created,
          questions: plan.questions.length,
          blocked: plan.outcome.blocked,
        },
        "founder document review prepared",
      );

      return {
        kind: "PREPARED",
        sessionId: session.id,
        suggestionsCreated: created,
        questionsPlanned: plan.questions.length,
        blocked: plan.outcome.blocked,
      };
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
  return typeof text === "string" && text.length > 0 ? text : null;
}
