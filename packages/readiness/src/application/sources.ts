import {
  CorrelationIdSchema,
  type CompanyDeckView,
  type DataRoomView,
  type ReadinessQuestionAnswerRequest,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { ReadinessInputs } from "../domain/inputs.js";
import type {
  ReadinessFollowUpPort,
  ReadinessFollowUpSource,
} from "./service.js";

/**
 * The readiness inputs and follow-ups, read through each context's own
 * service as the founder (the same reads their pages make), for the apps
 * to compose once. Structural types only: this package depends on no
 * other bounded context.
 */

type FollowUpLike = {
  readonly sessionId: string;
  readonly question: {
    readonly id: string;
    readonly stepKey: string;
    readonly factKey: string;
    readonly question: string;
    readonly why: string | null;
    readonly reason: ReadinessFollowUpSource["reason"];
    readonly readings: readonly string[];
    readonly createdAt: string;
  };
  readonly quickAnswers: readonly { readonly label: string }[];
  readonly typed: "NUMBER" | "TEXT" | "NONE";
  readonly answerable: boolean;
};

type OnboardingActorLike = {
  readonly userId: ActorContext["userId"];
  readonly context: ActorContext;
};

export type ReadinessOnboardingPort = {
  listFollowUps(raw: {
    readonly actor: OnboardingActorLike;
    readonly journeyType: "founder";
  }): Promise<readonly FollowUpLike[]>;
  answerFollowUp(raw: {
    readonly actor: OnboardingActorLike;
    readonly journeyType: "founder";
    readonly questionId: string;
    readonly answer: ReadinessQuestionAnswerRequest["answer"];
    readonly idempotencyKey: string;
    readonly correlationId: ReturnType<typeof CorrelationIdSchema.parse>;
  }): Promise<"ANSWERED" | "NOT_FOUND" | "NOT_ANSWERABLE" | "INVALID">;
  dismissFollowUp(raw: {
    readonly actor: OnboardingActorLike;
    readonly journeyType: "founder";
    readonly questionId: string;
    readonly idempotencyKey: string;
    readonly correlationId: ReturnType<typeof CorrelationIdSchema.parse>;
  }): Promise<"DISMISSED" | "NOT_FOUND">;
};

export type ReadinessObjective = {
  readonly target: { readonly amount: string; readonly currency: string };
  readonly useOfFundsSummary: string | null;
  readonly instrumentCode: string | null;
  readonly valuation: unknown;
  readonly targetCloseDate: string | null;
};

/** Where a follow-up that the interview can no longer take is changed now. */
function editHref(stepKey: string): string {
  return stepKey.startsWith("F6.") ? "/capital" : "/profile";
}

const onboardingActor = (actor: ActorContext): OnboardingActorLike => ({
  userId: actor.userId,
  context: actor,
});

export function readinessFollowUps(
  onboarding: ReadinessOnboardingPort,
): ReadinessFollowUpPort {
  return {
    list: async (actor) =>
      (
        await onboarding.listFollowUps({
          actor: onboardingActor(actor),
          journeyType: "founder",
        })
      ).map((item) => ({
        questionId: item.question.id,
        factKey: item.question.factKey,
        question: item.question.question.slice(0, 500),
        why: item.question.why,
        reason: item.question.reason,
        readings: item.question.readings
          .slice(0, 6)
          .map((r) => r.slice(0, 300)),
        quickAnswers: item.quickAnswers
          .slice(0, 20)
          .map((quick) => quick.label.slice(0, 120)),
        typed: item.typed,
        answerable: item.answerable,
        editHref: item.answerable ? null : editHref(item.question.stepKey),
        askedAt: item.question.createdAt,
      })),
    answer: (actor, questionId, answer, idempotencyKey, correlationId) =>
      onboarding.answerFollowUp({
        actor: onboardingActor(actor),
        journeyType: "founder",
        questionId,
        answer,
        idempotencyKey,
        correlationId: CorrelationIdSchema.parse(correlationId),
      }),
    dismiss: (actor, questionId, idempotencyKey, correlationId) =>
      onboarding.dismissFollowUp({
        actor: onboardingActor(actor),
        journeyType: "founder",
        questionId,
        idempotencyKey,
        correlationId: CorrelationIdSchema.parse(correlationId),
      }),
  };
}

export function readinessDeckFrom(companyDeck: {
  view(actor: ActorContext, companyId: string): Promise<CompanyDeckView | null>;
}) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<ReadinessInputs["deck"]> => {
    const view = await companyDeck.view(actor, companyId);
    if (view === null || view.viewer !== "OWNER" || view.deck === null) {
      return null;
    }
    return {
      documentId: view.deck.documentId,
      sections:
        view.coaching === null
          ? null
          : view.coaching.sections.map((section) => ({
              section: section.section,
              score: section.score,
              level: section.level,
              atStandard: section.atStandard,
              improve: section.improve,
            })),
    };
  };
}

export function readinessDataRoomFrom(dataRoom: {
  view(actor: ActorContext, companyId: string): Promise<DataRoomView | null>;
}) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<ReadinessInputs["dataRoom"]> => {
    const view = await dataRoom.view(actor, companyId);
    if (view === null || view.viewer !== "OWNER") return null;
    return {
      checklist: view.checklist.map((item) => ({
        code: item.code,
        folderCode: item.folderCode,
        label: item.label,
        present: item.present,
      })),
    };
  };
}

export function readinessRaiseFrom(
  objective: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<ReadinessObjective | null>,
) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<ReadinessInputs["raise"]> => {
    const current = await objective(actor, companyId);
    if (current === null) return null;
    return {
      target: `${current.target.amount} ${current.target.currency}`,
      useOfFunds: (current.useOfFundsSummary ?? "").trim().length > 0,
      instrument: current.instrumentCode !== null,
      valuation: current.valuation !== null && current.valuation !== undefined,
      targetCloseDate: current.targetCloseDate !== null,
    };
  };
}
