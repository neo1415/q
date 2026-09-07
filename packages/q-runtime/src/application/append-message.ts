import {
  AppendQRunMessageRequestSchema,
  type AppendQRunMessageRequest,
  type CorrelationId,
  type QRunId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { QConversationMessage, QRunRecord } from "../contracts/index.js";
import {
  QMessageCreationConflictError,
  QRunNotAcceptingMessagesError,
  QRunNotFoundError,
} from "../domain/errors.js";
import {
  hashAppendQRunMessageRequest,
  hashMessageIdempotencyKey,
} from "../domain/idempotency.js";
import { acceptsMessages } from "../domain/lifecycle.js";
import { refuseRunIfForeign } from "./access.js";
import type { QRuntimeDependencies } from "./dependencies.js";

export type AppendQRunMessageCommand = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly input: AppendQRunMessageRequest;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type AppendQRunMessageResult = {
  readonly run: QRunRecord;
  readonly message: QConversationMessage;
  readonly created: boolean;
};

/**
 * Add the person's next turn to a live run.
 *
 * The run is locked for the decision: a terminal transition racing with
 * an append cannot slip a message into a run that has just ended, and two
 * retries of one message serialise on the idempotency lock and produce one
 * row. The message is stored and nothing else: it is not an instruction to
 * the runtime, it grants no permission, it changes no canonical state, and
 * no answer follows until an orchestrator exists.
 */
export function createAppendQRunMessage(dependencies: QRuntimeDependencies) {
  const { transactions, repositories } = dependencies;

  return async (
    command: AppendQRunMessageCommand,
  ): Promise<AppendQRunMessageResult> => {
    const input = AppendQRunMessageRequestSchema.parse(command.input);
    const { actor } = command;
    const keyHash = hashMessageIdempotencyKey(command.idempotencyKey);
    const requestHash = hashAppendQRunMessageRequest(input);

    return transactions.run(async (tx) => {
      const run = await repositories.runs.lockForActor(
        tx,
        actor.tenantId,
        actor.userId,
        command.runId,
      );
      if (run === null) {
        await refuseRunIfForeign(
          dependencies,
          tx.sql,
          actor,
          command.runId,
          command.correlationId,
        );
        throw new QRunNotFoundError();
      }
      if (run.conversationId === null) {
        // A run created through the API always has one; a future
        // system-initiated run without one cannot take a person's turn.
        throw new QRunNotAcceptingMessagesError(run.status);
      }
      if (!acceptsMessages(run.status)) {
        throw new QRunNotAcceptingMessagesError(run.status);
      }

      await repositories.messageCreationRequests.lock(
        tx,
        actor.userId,
        run.id,
        keyHash,
      );
      const previous = await repositories.messageCreationRequests.find(
        tx,
        actor.userId,
        run.id,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new QMessageCreationConflictError();
        }
        const message = await repositories.messages.findById(
          tx.sql,
          actor.tenantId,
          previous.messageId,
        );
        if (message === null) {
          throw new QMessageCreationConflictError();
        }
        return { run, message, created: false };
      }

      const message = await repositories.messages.insert(tx, {
        tenantId: actor.tenantId,
        conversationId: run.conversationId,
        runId: run.id,
        role: "USER",
        content: input.message.text,
      });

      await repositories.messageCreationRequests.record(tx, {
        userId: actor.userId,
        runId: run.id,
        idempotencyKeyHash: keyHash,
        requestHash,
        messageId: message.id,
        tenantId: actor.tenantId,
      });

      dependencies.logger?.info(
        {
          qRunId: run.id,
          messageId: message.id,
          status: run.status,
          correlationId: command.correlationId,
        },
        "q message appended",
      );

      return { run, message, created: true };
    });
  };
}
