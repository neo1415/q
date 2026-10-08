import {
  CreateQRunRequestSchema,
  Q_SUBJECTS_MAX,
  QConversationIdSchema,
  type CorrelationId,
  type CreateQRunRequest,
  type QSubjectRef,
  type QViewingMoment,
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
  /**
   * Server-internal, never from a client body: the spoken utterance the
   * person's words are a form of, named by the voice channel. A newer
   * message of the same utterance supersedes this one when the
   * conversation is read (`domain/utterances.ts`).
   */
  readonly utteranceRef?: string | undefined;
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
/**
 * The actor's own context on every turn (CQ-QX-007, generalised in
 * CQ-QX-008).
 *
 * A founder asking for "a PDF describing my company" from Home Q was asked
 * "which company?": the turn named no subject, so no company was in the
 * run and nothing said whose company "my company" is. An investor asking
 * whether a company fits what they invest in was told their thesis was
 * unknown for the same reason. Their own company and their own investor
 * organisation are added here, on the server, from their membership — a
 * subject a client declares is input, never proof — and only after each
 * resolves in their tenant as belonging to their own organisation. What
 * either may contribute is still decided per run by the Context Firewall.
 *
 * Their company is added when the turn is about no company (a question
 * about somebody else's keeps that one alone); their investor
 * organisation whenever the turn names no investor or relationship.
 */
async function withOwnContext(
  dependencies: QRuntimeDependencies,
  actor: ActorContext,
  refs: readonly QSubjectRef[],
): Promise<readonly QSubjectRef[]> {
  if (actor.organisationId === undefined) return refs;
  let out = refs;
  const own = async (ref: QSubjectRef): Promise<QSubjectRef | null> => {
    if (!dependencies.subjects.supports(ref.kind)) return null;
    const resolved = await dependencies.subjects.resolve(actor, ref);
    return resolved !== null &&
      resolved.tenantId === actor.tenantId &&
      resolved.organisationId === actor.organisationId
      ? ref
      : null;
  };
  if (
    dependencies.ownCompany !== undefined &&
    out.length < Q_SUBJECTS_MAX &&
    !out.some((ref) => ref.kind === "COMPANY") &&
    !out.some((ref) => ref.kind === "RELATIONSHIP")
  ) {
    const companyId = await dependencies.ownCompany(actor);
    const ref =
      companyId === null ? null : await own({ kind: "COMPANY", companyId });
    if (ref !== null) out = [...out, ref];
  }
  if (
    dependencies.ownInvestorOrganisation !== undefined &&
    out.length < Q_SUBJECTS_MAX &&
    !out.some(
      (ref) =>
        ref.kind === "INVESTOR_ORGANISATION" || ref.kind === "RELATIONSHIP",
    )
  ) {
    const investorOrganisationId =
      await dependencies.ownInvestorOrganisation(actor);
    const ref =
      investorOrganisationId === null
        ? null
        : await own({
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId,
          });
    if (ref !== null) out = [...out, ref];
  }
  return out;
}

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
    const requested: readonly QSubjectRef[] = input.subjects ?? [];
    for (const ref of requested) {
      if (!subjects.supports(ref.kind)) {
        throw new QSubjectUnsupportedError(ref.kind);
      }
      const resolved = await subjects.resolve(actor, ref);
      if (resolved === null) {
        throw new QSubjectNotFoundError();
      }
    }

    /**
     * A conversation stays about what it was about until somebody changes
     * the subject.
     *
     * A voice turn is a run of its own and carries no subject, so every
     * turn arrived with an empty list: Q named a company and, asked to say
     * more about it, replied that no company had been named. Carrying the
     * conversation's own subjects forward is what a person means by "it".
     *
     * Inherited subjects are re-resolved here like any other, and a
     * subject that no longer resolves for this actor is simply dropped
     * rather than refused: a share can be revoked between two sentences,
     * and that ends the subject, it does not fail the question. Recording
     * a subject therefore grants nothing — authority is decided per run,
     * by the firewall, after this.
     */
    let refs: readonly QSubjectRef[] = requested;
    if (requested.length === 0 && existing !== null) {
      const carried: QSubjectRef[] = [];
      for (const ref of existing.subjects) {
        if (!subjects.supports(ref.kind)) {
          continue;
        }
        const resolved = await subjects.resolve(actor, ref);
        if (resolved !== null) {
          carried.push(ref);
        }
      }
      refs = carried;
    }

    // R18: what the person was viewing is a request, never authority. It
    // is kept only when the media context says this actor may play this
    // pitch now and the company resolves for them as a subject; otherwise
    // it is dropped silently, exactly as if it had not been sent.
    let viewing: QViewingMoment | null = null;
    if (input.viewing !== undefined && dependencies.viewing !== undefined) {
      const allowed = await dependencies.viewing
        .authorise(actor, input.viewing)
        .catch(() => false);
      const company: QSubjectRef = {
        kind: "COMPANY",
        companyId: input.viewing.companyId,
      };
      const named = refs.some(
        (ref) =>
          ref.kind === "COMPANY" && ref.companyId === input.viewing?.companyId,
      );
      if (
        allowed &&
        (named ||
          (refs.length < Q_SUBJECTS_MAX &&
            (await subjects.resolve(actor, company)) !== null))
      ) {
        viewing = input.viewing;
        if (!named) refs = [...refs, company];
      }
    }

    // R21: what is on the person's screen is a request, never authority.
    // Each entity it shows is resolved for this actor through its owning
    // context, exactly like a named subject, and joins this run's subjects
    // only then; one that does not resolve is dropped silently. It is
    // this turn's context, so it is not written to the conversation's
    // subjects and does not carry forward.
    const beforeScreen = refs;
    refs = await withScreenEntities(subjects, actor, refs, input.screen);
    const onScreen = refs.slice(beforeScreen.length);
    // The run keeps which screen it was asked from (the route), and only
    // the entities that are this run's subjects now: one that did not
    // resolve is not written down anywhere.
    const screen =
      input.screen === undefined ? null : screenKept(input.screen, refs);
    const keptByConversation = (all: readonly QSubjectRef[]) =>
      all.filter((ref) => !onScreen.includes(ref));

    refs = await withOwnContext(dependencies, actor, refs);

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
          subjects: keptByConversation(refs),
        }));

      // A turn that names a subject changes what the conversation is
      // about, so the next turn inherits the new one rather than the old.
      if (existing !== null && requested.length > 0) {
        await repositories.conversations.setSubjects(
          tx,
          actor.tenantId,
          conversation.id,
          keptByConversation(refs),
        );
      }

      const run = await repositories.runs.insert(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorOrganisationId: organisationId,
        conversationId: conversation.id,
        objective,
        capability: input.capability,
        consequenceClass: consequenceClassFor(input.capability),
        subjects: refs,
        viewing,
        screen,
        correlationId: command.correlationId,
      });

      // What the surface said before this first question, as Q's opening
      // line, so the conversation holds what a follow-up refers to.
      if (existing === null && input.opening !== undefined) {
        await repositories.messages.insert(tx, {
          tenantId: actor.tenantId,
          conversationId: conversation.id,
          runId: run.id,
          role: "Q",
          content: input.opening,
        });
      }

      const message = await repositories.messages.insert(tx, {
        tenantId: actor.tenantId,
        conversationId: conversation.id,
        runId: run.id,
        role: "USER",
        content: input.message.text,
        ...(command.utteranceRef === undefined
          ? {}
          : { utteranceRef: command.utteranceRef }),
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
        // The person's question; a surface's opening line, when the run
        // was given one, is recorded before it.
        const message = (
          await repositories.messages.listForRun(
            tx.sql,
            actor.tenantId,
            run.id,
            2,
          )
        ).find((recorded) => recorded.role === "USER");
        if (conversation === null || message === undefined) {
          throw new QRunCreationConflictError();
        }
        return { run, conversation, message, created: false };
      }
    });
  };
}

/**
 * The most a run's screen may hold (q_runtime.runs `runs_screen_check`,
 * 20261220210000). Past it the manifest is left out, never the turn.
 */
export const RUN_SCREEN_MAX_CHARS = 32_768;

/**
 * The screen as the run records it: the route, and only entities in `refs`.
 * A manifest that would take it past the column's bound is dropped (G-D8:
 * busy pages failed the insert and every turn from them answered 500).
 */
function screenKept(
  screen: NonNullable<CreateQRunRequest["screen"]>,
  refs: readonly QSubjectRef[],
): NonNullable<CreateQRunRequest["screen"]> {
  const kept = screenWithManifest(screen, refs);
  if (
    kept.manifest !== undefined &&
    JSON.stringify(kept).length > RUN_SCREEN_MAX_CHARS
  ) {
    const { manifest: _dropped, ...rest } = kept;
    return rest;
  }
  return kept;
}

function screenWithManifest(
  screen: NonNullable<CreateQRunRequest["screen"]>,
  refs: readonly QSubjectRef[],
): NonNullable<CreateQRunRequest["screen"]> {
  const has = (ref: QSubjectRef) =>
    refs.some((known) => JSON.stringify(known) === JSON.stringify(ref));
  const { companyId, investorOrganisationId, documentId, timeZone, manifest } =
    screen;
  return {
    route: screen.route,
    // The person's own clock: not an entity, nothing to resolve.
    ...(timeZone === undefined ? {} : { timeZone }),
    // Q room R1: the page's manifest, ids and closed kinds only. Kept as
    // asked; every ref is read back as the asker before the model sees
    // anything, and one that does not resolve is dropped there.
    ...(manifest === undefined ? {} : { manifest }),
    ...(companyId !== undefined && has({ kind: "COMPANY", companyId })
      ? { companyId }
      : {}),
    ...(investorOrganisationId !== undefined &&
    has({ kind: "INVESTOR_ORGANISATION", investorOrganisationId })
      ? { investorOrganisationId }
      : {}),
    ...(documentId !== undefined && has({ kind: "DOCUMENT", documentId })
      ? { documentId }
      : {}),
  };
}

/** The screen's entities as subjects, each resolved for the actor or dropped. */
async function withScreenEntities(
  subjects: QRuntimeDependencies["subjects"],
  actor: ActorContext,
  refs: readonly QSubjectRef[],
  screen: CreateQRunRequest["screen"],
): Promise<readonly QSubjectRef[]> {
  if (screen === undefined) return refs;
  const shown: QSubjectRef[] = [
    ...(screen.companyId === undefined
      ? []
      : [{ kind: "COMPANY" as const, companyId: screen.companyId }]),
    ...(screen.investorOrganisationId === undefined
      ? []
      : [
          {
            kind: "INVESTOR_ORGANISATION" as const,
            investorOrganisationId: screen.investorOrganisationId,
          },
        ]),
    ...(screen.documentId === undefined
      ? []
      : [{ kind: "DOCUMENT" as const, documentId: screen.documentId }]),
  ];
  let out = refs;
  for (const ref of shown) {
    const already = out.some(
      (known) => JSON.stringify(known) === JSON.stringify(ref),
    );
    if (
      already ||
      out.length >= Q_SUBJECTS_MAX ||
      !subjects.supports(ref.kind)
    ) {
      continue;
    }
    const resolved = await subjects.resolve(actor, ref).catch(() => null);
    if (resolved !== null) out = [...out, ref];
  }
  return out;
}
