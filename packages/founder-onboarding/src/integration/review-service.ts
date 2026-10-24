import { randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import type { DocumentRepository } from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import {
  onboardingDocumentTreatment,
  type OnboardingResponseRepository,
  type OnboardingSessionRepository,
  type OnboardingSuggestionRepository,
  type OnboardingUtteranceRepository,
} from "@capital-q/onboarding";
import type { ChunkRepository } from "@capital-q/q-knowledge";
import type { TenantId, UserId } from "@capital-q/security";

import {
  FOUNDER_JOURNEY_TYPE,
  FOUNDER_PROFILE_SECTIONS,
  FOUNDER_STEPS,
} from "../definition/index.js";
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
  /** Sensitive or unsuitable for onboarding: acknowledged by metadata, never read. */
  "NOT_FOR_ONBOARDING_READING",
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
   * The name of the person on the account (their own profile). Optional:
   * without it, no role read from material is offered as theirs (F-74).
   */
  readonly accountName?:
    ((userId: UserId) => Promise<string | null>) | undefined;
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
  /** Lane ov's pitch section readings; absent: no pitch proposals. */
  readonly pitchSections?: FounderPitchSectionsPort | undefined;
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
  /**
   * Their pitch video was read into the profile's sections (lane ov's
   * reading, event media.pitch_sections.read; owner 2026-10-16). No model
   * here: each section the reading filled becomes a proposal for its v6
   * step, sourced to the pitch, unless they answered it or the deck
   * already proposed it. Q then asks only for the gaps.
   */
  readonly onPitchSectionsRead: (event: {
    readonly tenantId: TenantId;
    readonly companyId: string;
    readonly readingId: string;
  }) => Promise<FounderReviewResult>;
  /** A free-text turn of the conversational interview (CQ-PRE-REC-001 §20). */
  readonly onUtterance: (event: {
    readonly sessionId: string;
    readonly utteranceId: string;
  }) => Promise<FounderReviewResult>;
};

type SourceRef = { readonly sourceType: string; readonly sourceId: string };

/** How a pitch transcript is named in a proposal's sources. */
export const PITCH_TRANSCRIPT_SOURCE = "PITCH_TRANSCRIPT" as const;
/**
 * Lane ov's stored pitch reading, by id, as founder onboarding reads it
 * (the composition reads media's table; this package owns no media data).
 */
export type FounderPitchSectionsPort = {
  /**
   * The reading's sections (of the company's pitch, in this tenant) and the
   * company's active founder onboarding session, if any. Null: no such
   * reading for that company.
   */
  readonly read: (
    tenantId: TenantId,
    readingId: string,
    companyId: string,
  ) => Promise<{
    readonly sessionId: string | null;
    readonly sections: readonly {
      readonly key: string;
      readonly facts: readonly {
        readonly label: string;
        readonly value: string;
      }[];
    }[];
  } | null>;
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
    utterances,
    createSuggestion,
    extraction,
    accountName,
    recordQuestions,
    logger,
    pitchSections,
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
    const [current, pending, holder] = await Promise.all([
      responses.listCurrent(sql, input.sessionId as never),
      suggestions.listPending(sql, input.sessionId as never),
      // Unread is unknown: no role from the material is assumed theirs.
      accountName?.(input.userId).catch(() => null) ?? null,
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
      accountName: holder,
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
      // Lane ob1: onboarding reads only suitable, non-sensitive material
      // (deck, company or product profile). Financial, legal, corporate,
      // customer or data-room documents, and anything classed highly
      // confidential, are acknowledged by their metadata only: there is no
      // authorised onboarding purpose to read them, so no model sees them.
      if (
        onboardingDocumentTreatment({
          documentType: document.documentType,
          sensitivityClass: document.sensitivityClass,
        }) === "METADATA_ONLY"
      ) {
        return { kind: "SKIPPED", reason: "NOT_FOR_ONBOARDING_READING" };
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

    onPitchSectionsRead: async (event): Promise<FounderReviewResult> => {
      if (pitchSections === undefined) {
        return { kind: "SKIPPED", reason: "NO_UTTERANCE" };
      }
      const found = await pitchSections.read(
        event.tenantId,
        event.readingId,
        event.companyId,
      );
      if (found === null) {
        return { kind: "SKIPPED", reason: "NO_UTTERANCE" };
      }
      const session =
        found.sessionId === null
          ? null
          : await sessions.findById(sql, found.sessionId as never);
      if (
        session === null ||
        session.journeyType !== FOUNDER_JOURNEY_TYPE ||
        session.status !== "ACTIVE" ||
        session.tenantId !== event.tenantId ||
        session.subject?.subjectId !== event.companyId
      ) {
        return { kind: "SKIPPED", reason: "NO_ACTIVE_SESSION" };
      }
      const reading = found.sections;
      const [current, pending] = await Promise.all([
        responses.listCurrent(sql, session.id),
        suggestions.listPending(sql, session.id),
      ]);
      // Deck first: a section the deck proposed, or they answered, stays.
      const settled = new Set([
        ...current.map((response) => response.stepKey),
        ...pending.map((suggestion) => suggestion.stepKey),
      ]);
      let created = 0;
      for (const section of reading) {
        const profile = FOUNDER_PROFILE_SECTIONS.find(
          (candidate) => (candidate.factKey ?? candidate.key) === section.key,
        );
        const stepKey = profile?.stepKeys.find((key) => key.startsWith("F9."));
        if (stepKey === undefined || settled.has(stepKey)) continue;
        const text = section.facts
          .map((fact) => `${fact.label}: ${fact.value}`)
          .join("\n")
          .trim()
          .slice(0, 2000);
        if (text.length === 0) continue;
        try {
          await createSuggestion({
            sessionId: session.id,
            stepKey,
            targetField: profile?.factKey ?? section.key,
            suggestedValue: { type: "TEXT", text },
            sourceRefs: [
              {
                sourceType: PITCH_TRANSCRIPT_SOURCE,
                sourceId: event.readingId,
              },
            ],
            confidence: null,
          });
          created += 1;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, sessionId: session.id, stepKey },
            "pitch section proposal refused by the onboarding runtime",
          );
        }
      }
      return {
        kind: "PREPARED",
        sessionId: session.id,
        suggestionsCreated: created,
        questionsPlanned: 0,
        blocked: null,
      };
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
