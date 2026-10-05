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
 * A job for Q's team (founder brief J1, J4): the person asks for something
 * that takes several steps ("introduce me to Kestrel and book a call"),
 * and the lead Q plans it into steps, each owned by a specialist -- or by a
 * helper it spawns with only the tools that step needs.
 *
 * Prepare -> Recommend -> Approve: this tool plans and prepares the card;
 * the plan is the card's exact payload. Nothing runs until the person
 * approves that plan; once approved it runs as planned, under the plan's
 * tools and budget, and every message to the other side still passes the
 * reviewer first. A different plan is a new card.
 */

export const PROPOSE_Q_JOB = "q.workforce.job.propose" as const;

export type QJobPlanView = {
  readonly summary: string;
  /** Each step in plain words: who does it, and what. */
  readonly steps: readonly { readonly who: string; readonly does: string }[];
  readonly cannot: readonly string[];
  readonly budgetUsd: string;
};

export type QJobPort = {
  /**
   * The lead Q's plan for the goal, prepared as this run's card. NOT_PLANNED:
   * nothing could be planned within what Q's team can do.
   */
  readonly prepare: (
    actor: ActorContext,
    runId: string,
    goal: string,
  ) => Promise<
    | {
        readonly status: "PREPARED" | "ONE_PER_TURN";
        readonly plan: QJobPlanView;
      }
    | { readonly status: "NOT_PLANNED" }
    | { readonly status: "LIMIT_REACHED" }
  >;
};

const ProposeQJobInputSchema = z
  .object({
    goal: z
      .string()
      .trim()
      .min(3)
      .max(1_000)
      .describe(
        "The job in the person's own words, with the names and details they gave.",
      ),
  })
  .strict();
type ProposeQJobInput = z.output<typeof ProposeQJobInputSchema>;

const ProposeQJobOutputSchema = z
  .object({
    status: z.enum([
      "PREPARED",
      "ONE_PER_TURN",
      "NOT_PLANNED",
      "LIMIT_REACHED",
    ]),
    plan: z
      .object({
        summary: z.string(),
        steps: z.array(z.object({ who: z.string(), does: z.string() })),
        cannot: z.array(z.string()),
        budgetUsd: z.string(),
      })
      .nullable(),
  })
  .strict();
type ProposeQJobOutput = z.infer<typeof ProposeQJobOutputSchema>;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

export function createQJobTools(port: QJobPort): readonly AnyQToolDefinition[] {
  return [
    defineQTool<ProposeQJobInput, ProposeQJobOutput, null>({
      id: PROPOSE_Q_JOB,
      version: 1,
      status: "ACTIVE",
      requiredCapabilities: [],
      supportedPurposes: [...Q_TASK_CLASSES],
      requiredScopeKinds: ["OWN_Q_CONVERSATION"],
      idempotency: "SAFE_TO_REPEAT",
      owner: "q-tools",
      providerName: "propose_q_job",
      description:
        "A one-off job of several steps for Q's team ('introduce me to Kestrel Heat and book a call', 'reply to everyone who wrote and set up calls'): the lead Q plans it into steps, each done by a specialist (outreach, conversation, scheduling) or a helper with only the tools its step needs, and prepares the plan as ONE card. Nothing happens until they approve that exact plan; every message is checked by the reviewer before it goes. Call it with their words; say the plan back in a sentence. For a goal that should keep running over time use propose_standing_instruction instead.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: "WAITING_FOR_APPROVAL",
      input: ProposeQJobInputSchema,
      output: ProposeQJobOutputSchema,
      authorize: (_input, { actor, plan }) =>
        Promise.resolve(
          ownConversation(actor, plan)
            ? allow<null>("CONFIDENTIAL", null)
            : deny<null>("NOT_AVAILABLE"),
        ),
      execute: async (input, context) => {
        const prepared = await port.prepare(
          context.actor,
          context.runId,
          input.goal,
        );
        return {
          status: prepared.status,
          plan:
            prepared.status === "PREPARED" || prepared.status === "ONE_PER_TURN"
              ? {
                  summary: prepared.plan.summary,
                  steps: prepared.plan.steps.map((step) => ({
                    who: step.who,
                    does: step.does,
                  })),
                  cannot: [...prepared.plan.cannot],
                  budgetUsd: prepared.plan.budgetUsd,
                }
              : null,
        };
      },
    }),
  ];
}
