import { randomUUID } from "node:crypto";

import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  InstructionPlanV3ResultSchema,
  renderPrompt,
  type InstructionPlanV3Result,
  type InstructionPlanVariables,
} from "@capital-q/q-core";

/**
 * The standing-instruction planner (ADR 0043 §4, §7): one structured call
 * through the Q Model Gateway. Its spend belongs to the instruction: the
 * correlation id carries the instruction id into the usage ledger, the
 * gateway refuses a call estimated above what is left of the month's budget,
 * and the actual cost comes back to be added to the instruction.
 */

/** The most one planning call may cost. */
export const PLAN_MAX_COST_USD = 0.08;

export type PlanVariables = Omit<
  InstructionPlanVariables,
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes"
>;

export type PlanOutcome = {
  /** Null: refused, failed or unreadable; the firing plans nothing. */
  readonly plan: InstructionPlanV3Result | null;
  /** What it cost, USD (0 when nothing was spent or it was unpriced). */
  readonly costUsd: number;
};

export type InstructionPlanner = (
  who: {
    readonly tenantId: string;
    readonly userId: string;
    readonly instructionId: string;
  },
  variables: PlanVariables,
  limits: { readonly maxCostUsd: number },
) => Promise<PlanOutcome>;

export function createInstructionPlanner(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): InstructionPlanner {
  const registry = createDefaultPromptRegistry();
  return async (who, variables, limits) => {
    try {
      const rendered = renderPrompt<PlanVariables>(registry, {
        task: "INSTRUCTION_PLAN",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are planning, not acting. Code checks every step against what they approved before anything happens.",
        variables,
      });
      const response =
        await dependencies.gateway.execute<InstructionPlanV3Result>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: {
              maxAttempts: 1,
              maxEstimatedCostUsd: Math.min(
                PLAN_MAX_COST_USD,
                limits.maxCostUsd,
              ),
              maxOutputTokens: 2_000,
              attemptTimeoutMs: 60_000,
            },
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              purpose: "INSTRUCTION",
              tenantId: who.tenantId,
              userId: who.userId,
              // The instruction this spend belongs to, in the usage ledger.
              correlationId: `cor_instr_${who.instructionId}_${randomUUID().slice(0, 8)}`,
            },
          },
          { schema: InstructionPlanV3ResultSchema },
        );
      const costUsd = response.cost.amount;
      if (response.output.kind !== "STRUCTURED") return { plan: null, costUsd };
      const parsed = InstructionPlanV3ResultSchema.safeParse(
        response.output.value,
      );
      return { plan: parsed.success ? parsed.data : null, costUsd };
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, instructionId: who.instructionId },
        "instruction plan not written",
      );
      return { plan: null, costUsd: 0 };
    }
  };
}
