import { z } from "zod";

import {
  AnswerOnboardingQuestionRequestSchema,
  CompleteOnboardingSessionRequestSchema,
  DismissOnboardingQuestionRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  ONBOARDING_ANSWER_SEGMENT,
  ONBOARDING_COMPLETE_SEGMENT,
  ONBOARDING_DISMISS_SEGMENT,
  ONBOARDING_NUDGE_CHOICE_SEGMENT,
  ONBOARDING_NUDGE_SEGMENT,
  ONBOARDING_PATH,
  ONBOARDING_QUESTIONS_SEGMENT,
  ONBOARDING_RESOLVE_SEGMENT,
  ONBOARDING_RESPONSES_SEGMENT,
  ONBOARDING_REVISIONS_SEGMENT,
  ONBOARDING_SESSIONS_SEGMENT,
  ONBOARDING_SKIP_SEGMENT,
  ONBOARDING_STEPS_SEGMENT,
  ONBOARDING_SUGGESTIONS_SEGMENT,
  ONBOARDING_WITHDRAW_SEGMENT,
  OnboardingNudgeChoiceRequestSchema,
  OnboardingNudgeChoiceResponseSchema,
  OnboardingSessionViewSchema,
  OnboardingStepKeySchema,
  ResolveOnboardingSuggestionRequestSchema,
  SkipOnboardingStepRequestSchema,
  SubmitOnboardingResponseRequestSchema,
  WithdrawOnboardingResponseRequestSchema,
} from "@capital-q/contracts";
import {
  OnboardingInterviewQuestionIdSchema,
  OnboardingSessionIdSchema,
  OnboardingSuggestionIdSchema,
} from "@capital-q/onboarding";

import {
  definePersonAction,
  portMissing,
  type AnyPersonAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Onboarding (ADR 0040 checklist, L): the person's own answers in their
 * setup, each declared once with its route generated under the onboarding
 * actor (the person, with their organisation's context when they have
 * one). Q keeps the ADR 0016 loop's own tools for every one of them
 * (`legacyTool`): no tool is added here. The session's start, the form's
 * Back, today's Home reminder and the conversational turns stay exempt,
 * each with its reason in the parity map.
 */

const runtime = (ports: AppActionPorts) =>
  ports.onboarding ?? portMissing("onboarding");

const sessions = `${ONBOARDING_PATH}${ONBOARDING_SESSIONS_SEGMENT}`;
const byId = `${sessions}/:sessionId`;

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const view = (out: unknown) => OnboardingSessionViewSchema.parse(out);

const Session = {
  sessionId: OnboardingSessionIdSchema,
  idempotencyKey: IdempotencyKeyHeaderSchema,
};

/** A step's answer, submitted or (ADR 0024) revised after completion. */
function answer(revision: boolean): AnyPersonAction {
  const Input = z
    .object({ ...Session, input: SubmitOnboardingResponseRequestSchema })
    .strict();
  return definePersonAction<z.infer<typeof Input>, unknown>({
    name: revision ? "onboarding.answer.revise" : "onboarding.answer.submit",
    short: revision ? "revise a setup answer" : "answer a setup step",
    area: "onboarding",
    classification: "INSTANT",
    does: revision
      ? "Revises one answer of their finished setup, through the same commit as a submission."
      : "Records their answer to a setup step, as the onboarding screen does.",
    input: Input,
    output: z.unknown(),
    run: (ports, context, input) =>
      (revision
        ? runtime(ports).reviseResponse
        : runtime(ports).submitResponse)({
        actor: context.person,
        sessionId: input.sessionId,
        stepKey: input.input.stepKey,
        response: input.input.response,
        expectedSessionVersion: input.input.expectedSessionVersion,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
      }),
    http: {
      method: "POST",
      path: `${byId}${revision ? ONBOARDING_REVISIONS_SEGMENT : ONBOARDING_RESPONSES_SEGMENT}`,
      fromRequest: (params, body, headers) => ({
        sessionId: params["sessionId"],
        idempotencyKey: keyOf(headers),
        input: body,
      }),
      respond: view,
    },
    legacyTool: revision ? "propose_profile_answer_change" : "record_answers",
  });
}

/** Setting a step aside, or withdrawing its answer. */
function step(withdraw: boolean): AnyPersonAction {
  const Input = z
    .object({
      ...Session,
      stepKey: OnboardingStepKeySchema,
      input: withdraw
        ? WithdrawOnboardingResponseRequestSchema
        : SkipOnboardingStepRequestSchema,
    })
    .strict();
  return definePersonAction<z.infer<typeof Input>, unknown>({
    name: withdraw ? "onboarding.answer.withdraw" : "onboarding.step.skip",
    short: withdraw ? "withdraw a setup answer" : "skip a setup step",
    area: "onboarding",
    classification: "INSTANT",
    does: withdraw
      ? "Withdraws their answer to a setup step, so it is unknown again."
      : "Sets a setup step aside for later; unknown stays unknown.",
    input: Input,
    output: z.unknown(),
    run: (ports, context, input) =>
      (withdraw ? runtime(ports).withdrawResponse : runtime(ports).skipStep)({
        actor: context.person,
        sessionId: input.sessionId,
        stepKey: input.stepKey,
        expectedSessionVersion: input.input.expectedSessionVersion,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
      }),
    http: {
      method: "POST",
      path: `${byId}${ONBOARDING_STEPS_SEGMENT}/:stepKey${withdraw ? ONBOARDING_WITHDRAW_SEGMENT : ONBOARDING_SKIP_SEGMENT}`,
      fromRequest: (params, body, headers) => ({
        sessionId: params["sessionId"],
        stepKey: params["stepKey"],
        idempotencyKey: keyOf(headers),
        input: body,
      }),
      respond: view,
    },
    legacyTool: withdraw ? "correct_answer" : "set_aside",
  });
}

const Complete = z
  .object({
    sessionId: OnboardingSessionIdSchema,
    input: CompleteOnboardingSessionRequestSchema,
  })
  .strict();

const COMPLETE = definePersonAction<z.infer<typeof Complete>, unknown>({
  name: "onboarding.complete",
  short: "finish my setup",
  area: "onboarding",
  classification: "CONSEQUENTIAL",
  does: "Finishes their setup once they've confirmed it, as the onboarding screen does.",
  input: Complete,
  output: z.unknown(),
  run: (ports, context, input) =>
    runtime(ports).completeSession({
      actor: context.person,
      sessionId: input.sessionId,
      expectedSessionVersion: input.input.expectedSessionVersion,
      correlationId: context.correlationId,
    }),
  http: {
    method: "POST",
    path: `${byId}${ONBOARDING_COMPLETE_SEGMENT}`,
    fromRequest: (params, body) => ({
      sessionId: params["sessionId"],
      input: body,
    }),
    respond: view,
  },
  legacyTool: "confirm_and_finish",
});

const Resolve = z
  .object({
    ...Session,
    suggestionId: OnboardingSuggestionIdSchema,
    input: ResolveOnboardingSuggestionRequestSchema,
  })
  .strict();

const RESOLVE = definePersonAction<z.infer<typeof Resolve>, unknown>({
  name: "onboarding.suggestion.resolve",
  short: "accept a setup suggestion",
  area: "onboarding",
  classification: "INSTANT",
  does: "Accepts, edits or declines one of Q's suggestions for their setup.",
  input: Resolve,
  output: z.unknown(),
  run: (ports, context, input) =>
    runtime(ports).resolveSuggestion({
      actor: context.person,
      sessionId: input.sessionId,
      suggestionId: input.suggestionId,
      resolution: input.input.resolution,
      response: input.input.response,
      expectedSessionVersion: input.input.expectedSessionVersion,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  http: {
    method: "POST",
    path: `${byId}${ONBOARDING_SUGGESTIONS_SEGMENT}/:suggestionId${ONBOARDING_RESOLVE_SEGMENT}`,
    fromRequest: (params, body, headers) => ({
      sessionId: params["sessionId"],
      suggestionId: params["suggestionId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    respond: view,
  },
  legacyTool: "accept_recommendation",
});

/** An interview question answered (a normal validated response) or dismissed (nothing written). */
function question(dismiss: boolean): AnyPersonAction {
  const Input = z
    .object({
      ...Session,
      questionId: OnboardingInterviewQuestionIdSchema,
      input: dismiss
        ? DismissOnboardingQuestionRequestSchema
        : AnswerOnboardingQuestionRequestSchema,
    })
    .strict();
  return definePersonAction<z.infer<typeof Input>, unknown>({
    name: dismiss
      ? "onboarding.question.dismiss"
      : "onboarding.question.answer",
    short: dismiss ? "dismiss a setup question" : "answer a setup question",
    area: "onboarding",
    classification: "INSTANT",
    does: dismiss
      ? "Dismisses one of Q's setup questions; nothing is written."
      : "Answers one of Q's setup questions, committed to the step it maps to.",
    input: Input,
    output: z.unknown(),
    run: (ports, context, input) => {
      if (dismiss) {
        return runtime(ports).dismissInterviewQuestion({
          actor: context.person,
          sessionId: input.sessionId,
          questionId: input.questionId,
          expectedSessionVersion: input.input.expectedSessionVersion,
          idempotencyKey: input.idempotencyKey,
          correlationId: context.correlationId,
        });
      }
      const answered = AnswerOnboardingQuestionRequestSchema.parse(input.input);
      return runtime(ports).answerInterviewQuestion({
        actor: context.person,
        sessionId: input.sessionId,
        questionId: input.questionId,
        stepKey: answered.stepKey,
        response: answered.response,
        expectedSessionVersion: answered.expectedSessionVersion,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
      });
    },
    http: {
      method: "POST",
      path: `${byId}${ONBOARDING_QUESTIONS_SEGMENT}/:questionId${dismiss ? ONBOARDING_DISMISS_SEGMENT : ONBOARDING_ANSWER_SEGMENT}`,
      fromRequest: (params, body, headers) => ({
        sessionId: params["sessionId"],
        questionId: params["questionId"],
        idempotencyKey: keyOf(headers),
        input: body,
      }),
      respond: view,
    },
    legacyTool: dismiss ? "set_aside" : "record_answers",
  });
}

const Choice = z.object({ input: OnboardingNudgeChoiceRequestSchema }).strict();

/** "Later" or "stop" on their setup reminders; safe to repeat, no key. */
const NUDGE_CHOICE = definePersonAction<z.infer<typeof Choice>, unknown>({
  name: "onboarding.reminders.choose",
  short: "set setup reminders",
  area: "onboarding",
  classification: "INSTANT",
  does: "Sets their setup reminders to later or stops them, as Home's card does.",
  input: Choice,
  output: z.unknown(),
  run: async (ports, context, input) => {
    await (ports.onboardingNudges ?? portMissing("onboardingNudges")).choose(
      context.person.userId,
      input.input.choice,
    );
    return input.input.choice;
  },
  http: {
    method: "POST",
    path: `${ONBOARDING_PATH}${ONBOARDING_NUDGE_SEGMENT}${ONBOARDING_NUDGE_CHOICE_SEGMENT}`,
    fromRequest: (_params, body) => ({ input: body }),
    respond: (out) =>
      OnboardingNudgeChoiceResponseSchema.parse({ recorded: out }),
  },
  legacyTool: "set_onboarding_reminders",
});

export const ONBOARDING_ACTIONS: readonly AnyPersonAction[] = [
  answer(false),
  answer(true),
  step(false),
  step(true),
  COMPLETE,
  RESOLVE,
  question(false),
  question(true),
  NUDGE_CHOICE,
];
