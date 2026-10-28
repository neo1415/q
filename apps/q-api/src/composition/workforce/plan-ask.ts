import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  QConversationIdSchema,
} from "@capital-q/contracts";
import type { QActionService } from "@capital-q/q-actions";
import {
  runRef,
  type QOrchestrationRuntime,
  type QRuntimeService,
} from "@capital-q/q-runtime";

import type { PlanCardAsk } from "./plans.js";

/**
 * A plan's approval card (S5): Execute for the exact version, or a step's
 * own card for outward work. Prepared the way a standing instruction's
 * card is (instructions/ask.ts): its own run in the plan's conversation,
 * begun under its own orchestration version so an approval goes straight
 * through the Approval Engine's execution gate, which re-verifies the
 * approval and the person's authority at that moment. One run per key: a
 * repeated Execute finds the card already waiting.
 */
export const PLAN_ORCHESTRATION_VERSION = "q-plan-v1";

export function createPlanCardAsk(dependencies: {
  readonly runtime: () => Pick<QRuntimeService, "createRun">;
  readonly orchestration: () => Pick<
    QOrchestrationRuntime,
    "begin" | "advanceThrough" | "fail" | "complete"
  >;
  readonly actions: () => Pick<QActionService, "propose">;
}): PlanCardAsk {
  return async (actor, card) => {
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const conversation =
      card.conversationId === null
        ? null
        : QConversationIdSchema.safeParse(card.conversationId);
    const created = await dependencies.runtime().createRun({
      actor,
      input: {
        capability: "PREPARE_ACTION",
        message: { text: card.words.slice(0, 1_000) },
        modality: "TEXT",
        ...(conversation === null || !conversation.success
          ? {}
          : { conversationId: conversation.data }),
      },
      idempotencyKey: card.key,
      correlationId,
    });
    const ref = runRef(created.run);
    const orchestration = dependencies.orchestration();
    try {
      if (created.created) {
        await orchestration.begin(ref, PLAN_ORCHESTRATION_VERSION);
        await orchestration.advanceThrough(ref, [
          "CONTEXT_RESOLUTION",
          "POLICY_CHECK",
          "PLANNING",
          "SYNTHESIS",
        ]);
      }
      const proposed = await dependencies.actions().propose({
        actor,
        runId: created.run.id,
        correlationId,
        actionType: card.actionType,
        payload: card.payload,
      });
      if (
        created.created &&
        (proposed.existing === true || proposed.alreadyDone !== undefined)
      ) {
        await orchestration.complete(ref).catch(() => undefined);
      }
      return { qActionId: proposed.action.id };
    } catch (error: unknown) {
      await orchestration.fail(ref, "INTERNAL_ERROR").catch(() => undefined);
      throw error;
    }
  };
}
