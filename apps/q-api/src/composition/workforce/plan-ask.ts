import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QConversationIdSchema,
  type QRunId,
} from "@capital-q/contracts";
import {
  QActionPayloadMismatchError,
  QApprovalAlreadyDecidedError,
  QApprovalExpiredError,
  type QActionService,
} from "@capital-q/q-actions";
import {
  runRef,
  type CreateQRunCommand,
  type QOrchestrationRuntime,
  type QRuntimeService,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

import type { ApprovedContinuation } from "../approved-continuation.js";
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
    const command: CreateQRunCommand = {
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
      // The person pressed a button; they typed nothing. The card's line is
      // Q's own (live 2026-10-29: "Run the plan: …" read as their message).
      openedBy: "Q",
    };
    // Owner 2026-11-04: a plan's execute card sits behind the plan card on
    // screen (its Execute is the one visible control), so its run records
    // no line of its own ("Here is your plan to approve…" read as a second
    // prompt). Its approval stays pending, decided by Execute or by "okay"
    // (conversation-approvals). A step's own card keeps its line.
    const runtime = dependencies.runtime();
    const created =
      card.quiet === true
        ? await runtime.createRun({ ...command, quiet: true })
        : await runtime.createRun(command);
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

/**
 * Owner 2026-11-04: "after I click on execute, I still have to click on
 * yes or approve ... and it doesn't start." The plan card's Execute is the
 * person's approval of the exact version it showed (the card sends its
 * version and body hash; plans.ts refuses any other). So the one execute
 * card Execute prepares -- or finds already waiting -- is approved here as
 * the person, on the CARD channel (the button they pressed), through the
 * Approval Engine's own approve, which binds to that card's stored payload
 * hash; then the same continuation the card's Approve starts runs it
 * through the execution gate, which claims the action so a repeated press
 * or a racing yes never executes twice. Nothing is approved without that
 * press.
 */
export type PlanCardApproval = "STARTED" | "CHANGED" | "EXPIRED" | "FAILED";

export function createPlanCardApprove(dependencies: {
  readonly actions: () => Pick<
    QActionService,
    "findApprovalForAction" | "approve"
  >;
  readonly continueApproved: () => ApprovedContinuation;
}): (actor: ActorContext, qActionId: string) => Promise<PlanCardApproval> {
  return async (actor, qActionId) => {
    const actionId = QActionProposalIdSchema.safeParse(qActionId);
    if (!actionId.success) return "FAILED";
    const actions = dependencies.actions();
    const approval = await actions.findApprovalForAction(
      actor.tenantId,
      actionId.data,
    );
    if (approval === null) return "FAILED";
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    let runId: QRunId;
    try {
      const decided = await actions.approve({
        actor,
        approvalId: QApprovalIdSchema.parse(approval.id),
        correlationId,
        via: { channel: "CARD" },
      });
      // Approved already and run (a second press): nothing to continue.
      if (!decided.decided && decided.action.status !== "APPROVED") {
        return decided.action.status === "EXECUTED" ||
          decided.action.status === "EXECUTING"
          ? "STARTED"
          : "FAILED";
      }
      runId = decided.action.runId;
    } catch (error: unknown) {
      if (error instanceof QActionPayloadMismatchError) return "CHANGED";
      if (error instanceof QApprovalExpiredError) return "EXPIRED";
      if (error instanceof QApprovalAlreadyDecidedError) return "FAILED";
      throw error;
    }
    await dependencies.continueApproved()({
      actor,
      runId,
      actionId: actionId.data,
      correlationId,
    });
    return "STARTED";
  };
}
