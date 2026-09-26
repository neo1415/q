import { z } from "zod";

import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * The onboarding interview's tools (ADR 0016).
 *
 * The interview is a Q run: the model reads what the person meant and acts
 * through these tools; code resolves, validates and writes through the
 * owning onboarding service, which validates again. The port is bound per
 * turn to the caller's own session — the model never names a session, a
 * user or an organisation — and every tool is offered only under the
 * actor-wide OWN_ONBOARDING scope the Context Firewall grants the owner.
 *
 * Writes are to the caller's own record, at their own word, and are
 * idempotent at the service: LOW_RISK_INTERNAL / SIDE_EFFECT, the one write
 * lane the registry admits. Nothing here sends, shares or publishes.
 */

export const GET_ONBOARDING_STATE = "onboarding.state.get" as const;
export const RECORD_ONBOARDING_ANSWERS = "onboarding.answers.record" as const;
export const RECOMMEND_ONBOARDING_ANSWERS =
  "onboarding.recommendations.make" as const;
export const ACCEPT_ONBOARDING_RECOMMENDATIONS =
  "onboarding.recommendations.accept" as const;
export const FINISH_ONBOARDING = "onboarding.finish" as const;
export const CORRECT_ONBOARDING_ANSWERS = "onboarding.answers.correct" as const;
export const SET_ASIDE_ONBOARDING_STEPS = "onboarding.steps.set_aside" as const;
export const CONFIRM_ONBOARDING_AS_STATED =
  "onboarding.checks.confirm_as_stated" as const;

const StepKeySchema = z.string().min(1).max(80);

export const OnboardingStepStateSchema = z
  .object({
    stepKey: StepKeySchema,
    question: z.string().max(400),
    kind: z.enum([
      "ONE_OF",
      "MANY_OF",
      "NUMBER",
      "TEXT",
      "CATEGORIES",
      "YES_NO",
      "DOCUMENT",
      "CHOICE_OF_RECORD",
    ]),
    required: z.boolean(),
    status: z.enum(["ANSWERED", "OPEN", "SET_ASIDE"]),
    /** What is on the record, as a person would say it. Null when nothing is. */
    value: z.string().max(600).nullable(),
    options: z
      .array(z.object({ key: z.string().max(64), label: z.string().max(120) }))
      .max(50)
      .optional(),
    maxChoices: z.number().int().min(1).max(50).optional(),
    /** A recommendation of Q's awaiting the person's decision. Never an answer. */
    pendingRecommendation: z.string().max(600).optional(),
    /**
     * An open optional step whose concept is already settled by another
     * step's answer or decline (one concept, one answer): theirs to add
     * to, never a question to ask again.
     */
    coveredBy: StepKeySchema.optional(),
  })
  .strict();
export type OnboardingStepState = z.infer<typeof OnboardingStepStateSchema>;

export const OnboardingStateSchema = z
  .object({
    journey: z.enum(["investor", "founder"]),
    /** Where the journey's own order would go next; a hint, not a route. */
    currentStepKey: StepKeySchema.nullable(),
    /** Every required step is answered, so the journey can be completed. */
    canComplete: z.boolean(),
    completed: z.boolean(),
    steps: z.array(OnboardingStepStateSchema).max(80),
    /**
     * Inconsistencies Capital Q found in what is on the record, computed by
     * code, not yet settled by the person. Raise each once; never correct
     * a value yourself.
     */
    checks: z
      .array(
        z
          .object({
            checkId: z.string().max(200),
            fact: z.string().max(400),
            stepKeys: z.array(StepKeySchema).max(4),
            /** Already put to them in this conversation: do not raise again. */
            raised: z.boolean(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/**
 * The person's own words that carry a write (P0-2). Code checks them
 * against what the person actually said in this conversation; words that
 * came from anywhere else — a web page, a deck, a tool result — can never
 * cause a write.
 */
const QuoteSchema = z
  .string()
  .trim()
  .min(3)
  .max(400)
  .describe(
    "The person's exact words, verbatim, that give this answer, or that delegate the choice to you.",
  );

const AnswerValueSchema = z.union([
  z.string().min(1).max(2_000),
  z.array(z.string().min(1).max(200)).min(1).max(20),
  z.number(),
  z.boolean(),
]);

export const RecordOnboardingAnswersInputSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            stepKey: StepKeySchema.describe(
              "The step this answers, as listed in the onboarding state.",
            ),
            value: AnswerValueSchema.describe(
              "The answer in the person's terms: an option key or label, a list of them, a number (plain, in the step's unit), free text, or category words for a CATEGORIES step.",
            ),
            quote: QuoteSchema,
            basis: z
              .enum(["STATED", "DELEGATED"])
              .default("STATED")
              .describe(
                "STATED: they said this answer. DELEGATED: they explicitly asked you to choose it for them in the same instruction; the quote is that instruction.",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type RecordOnboardingAnswersInput = z.infer<
  typeof RecordOnboardingAnswersInputSchema
>;

export const OnboardingRecordResultSchema = z
  .object({
    stepKey: StepKeySchema,
    outcome: z.enum([
      "COMMITTED",
      "WITHDRAWN",
      "SET_ASIDE",
      "CONFIRMED_AS_STATED",
      "REJECTED",
      "AMBIGUOUS",
      "UNMATCHED",
      "NEEDS_FIRST",
    ]),
    /** COMMITTED: what is now on the record, as a person would say it. */
    recorded: z.string().max(600).optional(),
    /** The step's question, so a reply names the right one. */
    question: z.string().max(400).optional(),
    /**
     * COMMITTED: items this write took off another step, because a concept
     * lives on one step only (a never-show item leaves "rather not see").
     */
    movedFrom: z
      .object({
        stepKey: StepKeySchema,
        question: z.string().max(400),
        items: z.string().max(600),
      })
      .strict()
      .optional(),
    /** REJECTED / NEEDS_FIRST: why, in the owning service's terms. */
    reason: z.string().max(400).optional(),
    /**
     * AMBIGUOUS: what the words could mean; ask which. UNMATCHED: every
     * choice the step records, since none is named in their words; choose
     * the one that means what they said.
     */
    candidates: z.array(z.string().max(160)).max(40).optional(),
    /** NEEDS_FIRST: the step that has to be answered before this one. */
    needsStepKey: StepKeySchema.optional(),
  })
  .strict();
export type OnboardingRecordResult = z.infer<
  typeof OnboardingRecordResultSchema
>;

export const RecordOnboardingAnswersOutputSchema = z
  .object({
    results: z.array(OnboardingRecordResultSchema).max(24),
    /**
     * What is still open after these writes, required first: the picture
     * the reply must be grounded in, since the state read before the turn
     * is now out of date.
     */
    stillOpen: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            question: z.string().max(400),
            required: z.boolean(),
          })
          .strict(),
      )
      .max(80),
    canComplete: z.boolean(),
  })
  .strict();
export type RecordOnboardingAnswersOutput = z.infer<
  typeof RecordOnboardingAnswersOutputSchema
>;

export const RecommendOnboardingAnswersInputSchema = z
  .object({
    recommendations: z
      .array(
        z
          .object({
            stepKey: StepKeySchema.describe(
              "The step this recommendation is for.",
            ),
            value: AnswerValueSchema.describe(
              "What you recommend, in the step's terms, exactly as it would be recorded if accepted.",
            ),
            because: z
              .string()
              .min(1)
              .max(300)
              .describe("Why, in one sentence, from what the person has said."),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type RecommendOnboardingAnswersInput = z.infer<
  typeof RecommendOnboardingAnswersInputSchema
>;

export const OnboardingRecommendResultSchema = z
  .object({
    stepKey: StepKeySchema,
    outcome: z.enum(["RECOMMENDED", "REJECTED"]),
    /** RECOMMENDED: what would be recorded on acceptance, as a person would say it. */
    recommended: z.string().max(600).optional(),
    reason: z.string().max(400).optional(),
    candidates: z.array(z.string().max(160)).max(8).optional(),
  })
  .strict();
export type OnboardingRecommendResult = z.infer<
  typeof OnboardingRecommendResultSchema
>;

export const RecommendOnboardingAnswersOutputSchema = z
  .object({ results: z.array(OnboardingRecommendResultSchema).max(12) })
  .strict();
export type RecommendOnboardingAnswersOutput = z.infer<
  typeof RecommendOnboardingAnswersOutputSchema
>;

export const AcceptOnboardingRecommendationsInputSchema = z
  .object({
    stepKeys: z
      .array(StepKeySchema)
      .min(1)
      .max(6)
      .describe(
        "The steps whose pending recommendation the person has just approved.",
      ),
  })
  .strict();
export type AcceptOnboardingRecommendationsInput = z.infer<
  typeof AcceptOnboardingRecommendationsInputSchema
>;

export const CorrectOnboardingAnswersInputSchema = z
  .object({
    corrections: z
      .array(
        z
          .object({
            stepKey: StepKeySchema.describe("The step whose answer changes."),
            value: AnswerValueSchema.nullable().describe(
              "The new answer in the person's terms, or null when they take the answer back entirely.",
            ),
            quote: QuoteSchema,
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type CorrectOnboardingAnswersInput = z.infer<
  typeof CorrectOnboardingAnswersInputSchema
>;

/**
 * A decline of an optional step ("no preference", "nothing applies",
 * "rather not say") is an answer: the step is set aside, unknown stays
 * unknown, and it is not asked again. Never a magic word the person must
 * learn (ACC 2026-09-25).
 */
export const SetAsideOnboardingStepsInputSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            stepKey: StepKeySchema.describe("The optional step they declined."),
            quote: QuoteSchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type SetAsideOnboardingStepsInput = z.infer<
  typeof SetAsideOnboardingStepsInputSchema
>;

/** The person says the values a check questioned are right as they stand. */
export const ConfirmOnboardingAsStatedInputSchema = z
  .object({
    checkId: z.string().min(1).max(200),
    quote: QuoteSchema,
  })
  .strict();
export type ConfirmOnboardingAsStatedInput = z.infer<
  typeof ConfirmOnboardingAsStatedInputSchema
>;

export const FinishOnboardingOutputSchema = z
  .object({
    /** The journey is now complete. */
    completed: z.boolean(),
    /** Required steps still unanswered, when it could not complete. */
    missing: z
      .array(
        z
          .object({ stepKey: StepKeySchema, question: z.string().max(400) })
          .strict(),
      )
      .max(80),
    /** Why it could not complete, in the owning service's terms. */
    reason: z.string().max(400).optional(),
  })
  .strict();
export type FinishOnboardingOutput = z.infer<
  typeof FinishOnboardingOutputSchema
>;

/**
 * The caller's own onboarding session, bound for one turn. Implemented by
 * the app that holds the person's session (it calls the onboarding
 * service's existing APIs with the person's own credentials).
 */
export type OnboardingToolPort = {
  /** The user whose session this is. Authorisation compares, never trusts. */
  readonly ownerUserId: string;
  readonly state: () => Promise<OnboardingState>;
  readonly record: (
    answers: RecordOnboardingAnswersInput["answers"],
  ) => Promise<readonly OnboardingRecordResult[]>;
  /** Hold Q's recommendations for the person's decision. Writes no answer. */
  readonly recommend: (
    recommendations: RecommendOnboardingAnswersInput["recommendations"],
  ) => Promise<readonly OnboardingRecommendResult[]>;
  /** Write exactly the pending recommendations the person approved. */
  readonly accept: (
    stepKeys: readonly string[],
  ) => Promise<readonly OnboardingRecordResult[]>;
  /**
   * Finish: code checks every required answer is on the record, records
   * the journey's own review confirmations on the person's word, and
   * completes the journey once — or says exactly what is missing.
   */
  readonly finish: () => Promise<FinishOnboardingOutput>;
  /** Change or take back answers already given; history is kept. */
  readonly correct: (
    corrections: CorrectOnboardingAnswersInput["corrections"],
  ) => Promise<readonly OnboardingRecordResult[]>;
  /** Keep the values a check questioned, on the person's word. */
  readonly confirmAsStated: (
    input: ConfirmOnboardingAsStatedInput,
  ) => Promise<readonly OnboardingRecordResult[]>;
  /** Set aside optional steps the person declined. Writes no answer. */
  readonly setAside: (
    steps: SetAsideOnboardingStepsInput["steps"],
  ) => Promise<readonly OnboardingRecordResult[]>;
};

type Grant = { readonly userId: string };

/** Offered for any purpose a person's own conversation can have. */
const PURPOSES = [
  "GENERAL_QUESTION",
  "OWN_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
] as const;

function ownSession(port: OnboardingToolPort) {
  return (
    _input: unknown,
    context: Parameters<AnyQToolDefinition["authorize"]>[1],
  ) => {
    // The actor-wide scope, filtered to this very person, and a session
    // that is theirs: three facts from three places, all required.
    const scope = actorWideScope(context.plan, "OWN_ONBOARDING");
    if (
      scope === undefined ||
      scope.filter.userId !== context.actor.userId ||
      context.actor.userId !== port.ownerUserId
    ) {
      return Promise.resolve(deny<Grant>("NOT_AVAILABLE"));
    }
    return Promise.resolve(
      allow<Grant>("CONFIDENTIAL", { userId: context.actor.userId }),
    );
  };
}

export function createOnboardingTools(
  port: OnboardingToolPort,
): readonly AnyQToolDefinition[] {
  const authorize = ownSession(port);
  return [
    defineQTool<Record<string, never>, OnboardingState, Grant>({
      id: GET_ONBOARDING_STATE,
      version: 1,
      status: "ACTIVE",
      providerName: "get_onboarding_state",
      description:
        "Returns the person's onboarding as it stands: every step with its question, whether it is answered, open or set aside, what is on the record, its options, and any pending recommendation. An open step with coveredBy asks about a concept another answer already settled: never ask it again; record to it only what they add. Call it after recording if you need the fresh picture.",
      classification: "READ_ONLY",
      riskClass: "SAFE_READ",
      requiredCapabilities: [capability("onboarding.session.view")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: z.object({}).strict(),
      output: OnboardingStateSchema,
      authorize,
      execute: () => port.state(),
    }),
    defineQTool<
      RecordOnboardingAnswersInput,
      RecordOnboardingAnswersOutput,
      Grant
    >({
      id: RECORD_ONBOARDING_ANSWERS,
      version: 1,
      status: "ACTIVE",
      providerName: "record_answers",
      description:
        "Records what the person has told you, for any steps at once, each with their own words as the quote. Each result says COMMITTED (now on the record, with what was recorded), REJECTED (with the reason), AMBIGUOUS (with candidates: ask which), UNMATCHED (their words name none of the step's choices; candidates lists every choice: record again with the one that means what they said, by its name, and say which you chose, or ask them when none fits) or NEEDS_FIRST (another step must be answered first). Only a COMMITTED result is on the record. Also returns what is still open afterwards, required first.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [capability("onboarding.session.respond")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: RecordOnboardingAnswersInputSchema,
      output: RecordOnboardingAnswersOutputSchema,
      authorize,
      execute: async (input) =>
        withOpen(port, [...(await port.record(input.answers))]),
    }),
    defineQTool<
      RecommendOnboardingAnswersInput,
      RecommendOnboardingAnswersOutput,
      Grant
    >({
      id: RECOMMEND_ONBOARDING_ANSWERS,
      version: 1,
      status: "ACTIVE",
      providerName: "recommend",
      description:
        "Holds your own recommendation for steps, for the person to decide. It records NO answer: it is Q's inference until they approve it. Each result is RECOMMENDED (with exactly what would be recorded) or REJECTED (with the reason). Tell them what you recommend and why, and ask for their decision.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [capability("onboarding.session.respond")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: RecommendOnboardingAnswersInputSchema,
      output: RecommendOnboardingAnswersOutputSchema,
      authorize,
      execute: async (input) => ({
        results: [...(await port.recommend(input.recommendations))],
      }),
    }),
    defineQTool<
      AcceptOnboardingRecommendationsInput,
      RecordOnboardingAnswersOutput,
      Grant
    >({
      id: ACCEPT_ONBOARDING_RECOMMENDATIONS,
      version: 1,
      status: "ACTIVE",
      providerName: "accept_recommendation",
      description:
        "Call only when the person has just approved your pending recommendation for these steps. Records exactly what you recommended, as their answer, and returns results like record_answers. If they changed it, record their version with record_answers instead.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [capability("onboarding.session.respond")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: AcceptOnboardingRecommendationsInputSchema,
      output: RecordOnboardingAnswersOutputSchema,
      authorize,
      execute: async (input) =>
        withOpen(port, [...(await port.accept(input.stepKeys))]),
    }),
    defineQTool<
      CorrectOnboardingAnswersInput,
      RecordOnboardingAnswersOutput,
      Grant
    >({
      id: CORRECT_ONBOARDING_ANSWERS,
      version: 1,
      status: "ACTIVE",
      providerName: "correct_answer",
      description:
        "Changes an answer already on the record, or takes it back entirely (value null), when the person corrects themselves. The earlier answer is kept as history, never erased. Results are like record_answers.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [capability("onboarding.session.respond")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: CorrectOnboardingAnswersInputSchema,
      output: RecordOnboardingAnswersOutputSchema,
      authorize,
      execute: async (input) =>
        withOpen(port, [...(await port.correct(input.corrections))]),
    }),
    defineQTool<
      SetAsideOnboardingStepsInput,
      RecordOnboardingAnswersOutput,
      Grant
    >({
      id: SET_ASIDE_ONBOARDING_STEPS,
      version: 1,
      status: "ACTIVE",
      providerName: "set_aside",
      description:
        "Sets aside optional steps the person has declined to answer (they have no preference, nothing applies, or they would rather not say), each with their own words as the quote. Nothing is recorded as their answer; the step is not asked again, and they can answer it later. SET_ASIDE is done; REJECTED says why (a required step cannot be set aside). Also returns what is still open.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [capability("onboarding.session.respond")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: SetAsideOnboardingStepsInputSchema,
      output: RecordOnboardingAnswersOutputSchema,
      authorize,
      execute: async (input) =>
        withOpen(port, [...(await port.setAside(input.steps))]),
    }),
    defineQTool<
      ConfirmOnboardingAsStatedInput,
      RecordOnboardingAnswersOutput,
      Grant
    >({
      id: CONFIRM_ONBOARDING_AS_STATED,
      version: 1,
      status: "ACTIVE",
      providerName: "confirm_as_stated",
      description:
        "Records that the person says the values a check questioned are right as they stand (their words as the quote). The values are unchanged; the check is settled and not raised again. When they change a value instead, record the new value with correct_answer or record_answers.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [capability("onboarding.session.respond")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: ConfirmOnboardingAsStatedInputSchema,
      output: RecordOnboardingAnswersOutputSchema,
      authorize,
      execute: async (input) =>
        withOpen(port, [...(await port.confirmAsStated(input))]),
    }),
    defineQTool<Record<string, never>, FinishOnboardingOutput, Grant>({
      id: FINISH_ONBOARDING,
      version: 1,
      status: "ACTIVE",
      providerName: "confirm_and_finish",
      description:
        "Call only when the person has confirmed that what is on the record is right and wants to finish. Checks that every required answer is there, records their confirmation of the review, and completes the onboarding. If anything required is missing it completes nothing and lists what is missing.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [capability("onboarding.session.respond")],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: ["OWN_ONBOARDING"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "onboarding",
      visibleStage: null,
      input: z.object({}).strict(),
      output: FinishOnboardingOutputSchema,
      authorize,
      execute: () => port.finish(),
    }),
  ];
}

/** Results, plus what is still open once they have landed. */
async function withOpen(
  port: OnboardingToolPort,
  results: OnboardingRecordResult[],
): Promise<RecordOnboardingAnswersOutput> {
  const after = await port.state();
  // A step whose concept another answer settled is not still open.
  const open = after.steps.filter(
    (step) => step.status === "OPEN" && step.coveredBy === undefined,
  );
  return {
    results,
    stillOpen: [
      ...open.filter((step) => step.required),
      ...open.filter((step) => !step.required),
    ].map((step) => ({
      stepKey: step.stepKey,
      question: step.question,
      required: step.required,
    })),
    canComplete: after.canComplete,
  };
}
