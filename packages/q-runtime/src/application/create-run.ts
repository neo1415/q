import {
  CreateQRunRequestSchema,
  QConversationIdSchema,
  type CorrelationId,
  type CreateQRunRequest,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type {
  QConversation,
  QConversationMessage,
  QRunRecord,
} from "../contracts/index.js";
import {
  QConversationArchivedError,
  QConversationNotFoundError,
  QRunCreationConflictError,
  QSubjectNotFoundError,
  QSubjectUnsupportedError,
} from "../domain/errors.js";
import {
  hashCreateQRunRequest,
  hashRunIdempotencyKey,
} from "../domain/idempotency.js";
import {
  consequenceClassFor,
  INITIAL_Q_RUN_STATUS,
} from "../domain/lifecycle.js";
import { ownedConversation } from "./access.js";
import type { QRuntimeDependencies } from "./dependencies.js";
import { appendRunEvent } from "./run-events.js";

export type CreateQRunCommand = {
  /** Trusted: server-resolved for this request. Supplies tenant and organisation. */
  readonly actor: ActorContext;
  /** Validated against CreateQRunRequestSchema by the caller; re-parsed here. */
  readonly input: CreateQRunRequest;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type CreateQRunResult = {
  readonly run: QRunRecord;
  readonly conversation: QConversation;
  /** The person's opening turn, as stored. */
  readonly message: QConversationMessage;
  /** False when an earlier request with the same key already created this. */
  readonly created: boolean;
};

/**
 * Accept a Q request.
 *
 *   validate -> resolve or create the conversation (owner, tenant and
 *   organisation context must match) -> resolve every subject in the
 *   actor's tenant -> transaction: idempotency lock/lookup -> conversation
 *   row (if new) -> run row (RECEIVED) -> opening message -> q.run.started
 *   event #1 -> idempotency record -> COMMIT
 *
 * One transaction, so no run exists without its conversation, message and
 * first event, and no conversation is created for a run that failed to be.
 *
 * Nothing here analyses anything. The run is RECEIVED and stays RECEIVED
 * until an orchestrator exists to pick it up; the response says exactly
 * that. There is no model, no retrieval, no tool and no answer.
 */
export function createCreateQRun(dependencies: QRuntimeDependencies) {
  const { transactions, repositories, subjects } = dependencies;

  return async (command: CreateQRunCommand): Promise<CreateQRunResult> => {
    const input = CreateQRunRequestSchema.parse(command.input);
    const { actor } = command;
    const organisationId = actor.organisationId ?? null;

    // Continuation: the conversation must be this person's, in this tenant,
    // under the same organisation context. A client cannot pivot a
    // personal conversation into an organisation one or vice versa, and a
    // conversation id from anyone else is simply not found.
    const existing =
      input.conversationId === undefined
        ? null
        : await ownedConversation(
            dependencies,
            dependencies.sql,
            actor,
            QConversationIdSchema.parse(input.conversationId),
            command.correlationId,
          );
    if (existing !== null) {
      if (existing.organisationId !== organisationId) {
        throw new QConversationNotFoundError();
      }
      if (existing.archivedAt !== null) {
        throw new QConversationArchivedError();
      }
    }

    // Every subject must resolve in the actor's tenant through its owning
    // context's port. Unsupported kinds and unresolvable subjects both stop
    // the request before anything is written.
    const refs: readonly QSubjectRef[] = input.subjects ?? [];
    for (const ref of refs) {
      if (!subjects.supports(ref.kind)) {
        throw new QSubjectUnsupportedError(ref.kind);
      }
      const resolved = await subjects.resolve(actor, ref);
      if (resolved === null) {
        throw new QSubjectNotFoundError();
      }
    }

    const keyHash = hashRunIdempotencyKey(command.idempotencyKey);
    const requestHash = hashCreateQRunRequest(input);
    const objective = input.objective ?? input.message.text.slice(0, 500);

    return transactions.run(async (tx) => {
      await repositories.runCreationRequests.lock(tx, actor.userId, keyHash);
      const previous = await repositories.runCreationRequests.find(
        tx,
        actor.userId,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new QRunCreationConflictError();
        }
        return replay(previous.runId);
      }

      const conversation =
        existing ??
        (await repositories.conversations.insert(tx, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          organisationId,
          subjects: refs,
        }));

      const run = await repositories.runs.insert(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorOrganisationId: organisationId,
        conversationId: conversation.id,
        objective,
        capability: input.capability,
        consequenceClass: consequenceClassFor(input.capability),
        subjects: refs,
        correlationId: command.correlationId,
      });

      const message = await repositories.messages.insert(tx, {
        tenantId: actor.tenantId,
        conversationId: conversation.id,
        runId: run.id,
        role: "USER",
        content: input.message.text,
      });

      await appendRunEvent(repositories, tx, run, {
        type: "q.run.started",
        data: {
          capability: run.capability,
          status: INITIAL_Q_RUN_STATUS,
          conversationId: conversation.id,
        },
      });

      await repositories.runCreationRequests.record(tx, {
        userId: actor.userId,
        idempotencyKeyHash: keyHash,
        requestHash,
        runId: run.id,
        tenantId: actor.tenantId,
      });

      // Identifiers and coded values only. Never the message text.
      dependencies.logger?.info(
        {
          qRunId: run.id,
          conversationId: conversation.id,
          capability: run.capability,
          status: run.status,
          correlationId: command.correlationId,
        },
        "q run accepted",
      );

      return { run, conversation, message, created: true };

      async function replay(
        runId: QRunRecord["id"],
      ): Promise<CreateQRunResult> {
        // The retry is answered from what the first request created. Every
        // read still carries tenant and owner: an idempotency record is a
        // pointer, not a bypass.
        const run = await repositories.runs.findForActor(
          tx.sql,
          actor.tenantId,
          actor.userId,
          runId,
        );
        if (run === null || run.conversationId === null) {
          throw new QRunCreationConflictError();
        }
        const conversation = await repositories.conversations.findForOwner(
          tx.sql,
          actor.tenantId,
          actor.userId,
          run.conversationId,
        );
        const [message] = await repositories.messages.listForRun(
          tx.sql,
          actor.tenantId,
          run.id,
          1,
        );
        if (conversation === null || message === undefined) {
          throw new QRunCreationConflictError();
        }
        return { run, conversation, message, created: false };
      }
    });
  };
}
