import { z } from "zod";

import {
  Q_TASK_CLASSES,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * RECALL_MY_SETUP -- `onboarding.transcript.recall` v1 (lane ob1).
 *
 * "What did I tell you about our pilots when I signed up?" Reads the
 * person's OWN setup conversation and answers, and keeps three things
 * apart: answers on the record (confirmed), their own words (statements,
 * not confirmed facts), and what Q said back (Q's interpretation at the
 * time, never evidence). Only for the person's own Q conversation; another
 * person's setup is never reachable here.
 */
export const RECALL_MY_SETUP = "onboarding.transcript.recall" as const;

export type OnboardingTranscriptPort = {
  readonly recall: (
    actor: ActorContext,
    options: { readonly about: string | null; readonly limit: number },
  ) => Promise<RecallMySetupOutput>;
};

export const RecallMySetupInputSchema = z
  .object({
    about: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .optional()
      .describe(
        "A word or short phrase from what they said during setup to look for (e.g. 'pilots'). Omit for the latest of the conversation.",
      ),
  })
  .strict();
export type RecallMySetupInput = z.infer<typeof RecallMySetupInputSchema>;

const Line = z
  .object({
    at: z.string().max(40),
    text: z.string().max(1200),
    question: z.string().max(300).nullable(),
  })
  .strict();

export const RecallMySetupOutputSchema = z
  .object({
    status: z.enum(["FOUND", "NONE"]),
    setups: z
      .array(
        z
          .object({
            journey: z.enum(["founder", "investor"]),
            status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
            /** On the record: confirmed through the journey. */
            answers: z
              .array(
                z
                  .object({
                    question: z.string().max(300),
                    answer: z.string().max(600),
                  })
                  .strict(),
              )
              .max(60),
            /** Their own words, verbatim: statements, NOT confirmed facts. */
            theirWords: z.array(Line).max(40),
            /** What Q said then: its interpretation at the time, never evidence. */
            qSaid: z.array(Line).max(40),
          })
          .strict(),
      )
      .max(2),
  })
  .strict();
export type RecallMySetupOutput = z.infer<typeof RecallMySetupOutputSchema>;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

export function createRecallMySetupTool(
  port: OnboardingTranscriptPort,
): AnyQToolDefinition {
  return defineQTool<RecallMySetupInput, RecallMySetupOutput, null>({
    id: RECALL_MY_SETUP,
    version: 1,
    status: "ACTIVE",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    providerName: "recall_my_setup",
    description:
      "Reads what they told you while setting up Capital Q: the answers on their record, their own words from that conversation, and what you said back. Their words are statements, not confirmed facts: say 'you said', never present them as verified, and prefer the answers on the record. What you said then is your interpretation at the time, never evidence.",
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    input: RecallMySetupInputSchema,
    output: RecallMySetupOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) =>
      port
        .recall(context.actor, { about: input.about ?? null, limit: 20 })
        .catch((): RecallMySetupOutput => ({ status: "NONE", setups: [] })),
  });
}
