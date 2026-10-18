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
 * SET_PREFERENCE_LEARNING -- `memory.learning.set` v1 (lane ob1; owner
 * decision 2026-10-16). The person's spoken or typed answer to Capital
 * Q's one-line question "may Q learn how you like to work?": ALLOW,
 * NOT_NOW (not asked again for 30 days) or TURN_OFF. Their own decision,
 * in their own conversation, for their current workspace only. The words
 * that carry it must be in what they just said: Q never decides it.
 */
export const SET_PREFERENCE_LEARNING = "memory.learning.set" as const;

export type PreferenceLearningPort = {
  readonly decide: (
    actor: ActorContext,
    choice: "ALLOW" | "NOT_NOW" | "TURN_OFF",
  ) => Promise<{ readonly status: string }>;
};

export const SetPreferenceLearningInputSchema = z
  .object({
    choice: z
      .enum(["ALLOW", "NOT_NOW", "TURN_OFF"])
      .describe(
        "ALLOW: they said yes to Q learning how they like to work. NOT_NOW: not now / maybe later. TURN_OFF: no, never, don't learn that.",
      ),
    quote: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .describe("Their exact words giving the answer, verbatim."),
  })
  .strict();
export type SetPreferenceLearningInput = z.infer<
  typeof SetPreferenceLearningInputSchema
>;

export const SetPreferenceLearningOutputSchema = z
  .object({
    recorded: z.enum(["ALLOW", "NOT_NOW", "TURN_OFF"]),
    meaning: z.string().max(240),
  })
  .strict();
export type SetPreferenceLearningOutput = z.infer<
  typeof SetPreferenceLearningOutputSchema
>;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

const normal = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();

type Grant = { readonly actor: ActorContext };

export function createSetPreferenceLearningTool(
  port: PreferenceLearningPort,
): AnyQToolDefinition {
  return defineQTool<
    SetPreferenceLearningInput,
    SetPreferenceLearningOutput,
    Grant
  >({
    id: SET_PREFERENCE_LEARNING,
    version: 1,
    status: "ACTIVE",
    providerName: "set_preference_learning",
    description:
      "Records their answer to Capital Q's question about whether Q may learn how they like to work from their conversations (concise or detailed, tone, language). Call it only when they answered that question, or asked to turn it on or off. Never for anything else. A preference they state directly is noted with note_preference instead and needs no permission.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-knowledge",
    visibleStage: null,
    input: SetPreferenceLearningInputSchema,
    output: SetPreferenceLearningOutputSchema,
    authorize: (input, { actor, plan, conversation }) => {
      if (!ownConversation(actor, plan)) {
        return Promise.resolve(deny<Grant>("NOT_AVAILABLE"));
      }
      // Their decision rests on their words, said now.
      const said = normal(conversation?.latestUserText ?? "");
      const quote = normal(input.quote);
      return Promise.resolve(
        quote.length > 0 && said.includes(quote)
          ? allow<Grant>("INTERNAL", { actor })
          : deny<Grant>("NOT_AVAILABLE"),
      );
    },
    execute: async (input, _context, grant) => {
      await port.decide(grant.actor, input.choice);
      return {
        recorded: input.choice,
        meaning:
          input.choice === "ALLOW"
            ? "Q may now learn how they like to work. They can turn it off in What Q remembers."
            : input.choice === "NOT_NOW"
              ? "Not now: Q will not ask again for 30 days, and learns nothing new meanwhile."
              : "Off: Q learns nothing new about how they like to work. They can turn it on in What Q remembers.",
      };
    },
  });
}
