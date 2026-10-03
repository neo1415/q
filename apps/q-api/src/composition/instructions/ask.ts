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
import {
  AuthUserIdSchema,
  OrganisationIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type ActorContextResolver,
} from "@capital-q/security";

import type { InstructionRow, InstructionStore } from "./store.js";

/**
 * An ASK step of a standing instruction (ADR 0043): the same `app.<name>`
 * card the person's own request would prepare, in the instruction's own Q
 * conversation. The run is begun under its own orchestration version, so an
 * approval never resumes the conversational engine for it: the approved
 * continuation sends it straight through the Approval Engine's execution
 * gate, which re-verifies the approval and the person's authority now.
 */
export const INSTRUCTION_ORCHESTRATION_VERSION = "q-instruction-v1";

export function createInstructionAsk(dependencies: {
  readonly runtime: Pick<QRuntimeService, "createRun">;
  readonly orchestration: Pick<
    QOrchestrationRuntime,
    "begin" | "advanceThrough" | "fail"
  >;
  readonly actions: Pick<QActionService, "propose">;
  readonly store: Pick<InstructionStore, "own" | "setConversation">;
}) {
  return async (
    actor: ActorContext,
    card: {
      readonly instructionId: string;
      readonly actionType: string;
      readonly payload: unknown;
      readonly words: string;
      readonly key: string;
    },
  ): Promise<{ readonly qActionId: string } | null> => {
    // Only the person's own instruction asks in their name.
    const instruction = await dependencies.store.own(actor, card.instructionId);
    if (instruction === null) return null;
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const created = await dependencies.runtime.createRun({
      actor,
      input: {
        capability: "PREPARE_ACTION",
        message: {
          text: `Standing instruction "${instruction.goal_text.slice(0, 200)}": ${card.words}`.slice(
            0,
            1_000,
          ),
        },
        modality: "TEXT",
        ...(instruction.conversation_id === null
          ? {}
          : {
              conversationId: QConversationIdSchema.parse(
                instruction.conversation_id,
              ),
            }),
      },
      idempotencyKey: card.key,
      correlationId,
    });
    if (instruction.conversation_id === null) {
      await dependencies.store.setConversation(
        instruction.id,
        created.conversation.id,
      );
    }
    const ref = runRef(created.run);
    if (created.created) {
      await dependencies.orchestration.begin(
        ref,
        INSTRUCTION_ORCHESTRATION_VERSION,
      );
      await dependencies.orchestration.advanceThrough(ref, [
        "CONTEXT_RESOLUTION",
        "POLICY_CHECK",
        "PLANNING",
        "SYNTHESIS",
      ]);
    }
    try {
      const proposed = await dependencies.actions.propose({
        actor,
        runId: created.run.id,
        correlationId,
        actionType: card.actionType,
        payload: card.payload,
      });
      return { qActionId: proposed.action.id };
    } catch (error: unknown) {
      // Nothing waits on this run: it ends rather than lingering.
      await dependencies.orchestration
        .fail(ref, "INTERNAL_ERROR")
        .catch(() => undefined);
      throw error;
    }
  };
}

/**
 * The person a standing instruction acts as, resolved NOW through the same
 * resolver a request uses: a revoked membership or a disabled account means
 * Q no longer acts for them.
 */
export function createInstructionActor(dependencies: {
  readonly resolver: ActorContextResolver;
  readonly authUserOf: (userId: string) => Promise<string | null>;
}) {
  return async (row: InstructionRow): Promise<ActorContext | null> => {
    const authUserId = AuthUserIdSchema.safeParse(
      await dependencies.authUserOf(row.user_id),
    );
    if (!authUserId.success) return null;
    const organisationId =
      row.organisation_id === null
        ? undefined
        : OrganisationIdSchema.parse(row.organisation_id);
    const resolution = await resolveHumanActorContext(dependencies.resolver, {
      principal: { authUserId: authUserId.data },
      selection: organisationId === undefined ? {} : { organisationId },
    });
    return resolution.status === "RESOLVED" &&
      resolution.context.userId === row.user_id
      ? resolution.context
      : null;
  };
}
