import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CompanyId, CompanyIdentity } from "@capital-q/companies";
import {
  DEFAULT_PAGE_SIZE,
  type CloseCapitalObjectiveRequest,
  type CorrelationId,
  type CreateCapitalObjectiveRequest,
  type ReplaceCapitalObjectiveRequest,
  type UpdateCapitalObjectiveRequest,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import { capability, type ActorContext } from "@capital-q/security";

import type {
  CapitalObjective,
  CapitalObjectiveId,
} from "../contracts/index.js";
import {
  decodeCapitalObjectiveCursor,
  encodeCapitalObjectiveCursor,
} from "../domain/cursor.js";
import {
  ActiveCapitalObjectiveExistsError,
  CapitalObjectiveCreationConflictError,
  CapitalObjectiveLifecycleError,
  CapitalObjectiveNotFoundError,
  CapitalObjectiveVersionConflictError,
} from "../domain/errors.js";
import type {
  CapitalCanonicalValues,
  CapitalChangeKind,
} from "../domain/history.js";
import {
  hashCapitalObjectiveIdempotencyKey,
  hashCreateCapitalObjectiveRequest,
} from "../domain/idempotency.js";
import {
  capitalObjectiveClosedEvent,
  capitalObjectiveCreatedEvent,
  capitalObjectiveUpdatedEvent,
} from "../events/index.js";
import type { CapitalServiceDependencies } from "./dependencies.js";
import type { CapitalObjectiveChanges } from "./ports.js";

/**
 * Capital Objective use cases.
 *
 * Every operation resolves the company through the canonical Company query
 * port under the caller's tenant and active organisation (enumeration-safe
 * otherwise), then a capability on the exact resource. The only way an
 * objective changes is an authorised human command carrying the version it
 * read: no readiness signal, recommendation or Q inference has a write
 * path here, and no command ever creates a second ACTIVE objective.
 */

export const CAPITAL_OBJECTIVE_CREATE = capability("capital_objective.create");
export const CAPITAL_OBJECTIVE_VIEW = capability("capital_objective.view");
export const CAPITAL_OBJECTIVE_EDIT = capability("capital_objective.edit");
export const CAPITAL_OBJECTIVE_CLOSE = capability("capital_objective.close");

const RESOURCE = AuditResourceTypeSchema.parse("capital_objective");
const ACTION = {
  created: AuditActionTypeSchema.parse("capital_objective.created"),
  updated: AuditActionTypeSchema.parse("capital_objective.updated"),
  closed: AuditActionTypeSchema.parse("capital_objective.closed"),
  replaced: AuditActionTypeSchema.parse("capital_objective.replaced"),
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type CompanyScoped = {
  readonly actor: ActorContext;
  readonly companyId: CompanyId;
};
type ObjectiveScoped = CompanyScoped & {
  readonly capitalObjectiveId: CapitalObjectiveId;
};

type Organisation = NonNullable<ActorContext["organisationId"]>;

/**
 * The company, visible in the caller's tenant and active organisation, or
 * "not found". A company that exists elsewhere is indistinguishable from one
 * that does not exist.
 */
async function visibleCompany(
  dependencies: CapitalServiceDependencies,
  actor: ActorContext,
  companyId: CompanyId,
): Promise<{ company: CompanyIdentity; organisationId: Organisation }> {
  if (actor.organisationId === undefined) {
    throw new CapitalObjectiveNotFoundError();
  }
  const company = await dependencies.companies.getCanonicalCompany(
    actor.tenantId,
    companyId,
  );
  if (company === null || company.organisationId !== actor.organisationId) {
    throw new CapitalObjectiveNotFoundError();
  }
  return { company, organisationId: actor.organisationId };
}

async function visibleObjective(
  dependencies: CapitalServiceDependencies,
  scoped: ObjectiveScoped,
): Promise<{
  company: CompanyIdentity;
  organisationId: Organisation;
  objective: CapitalObjective;
}> {
  const { company, organisationId } = await visibleCompany(
    dependencies,
    scoped.actor,
    scoped.companyId,
  );
  const objective = await dependencies.repositories.objectives.findById(
    dependencies.sql,
    scoped.actor.tenantId,
    company.id,
    scoped.capitalObjectiveId,
  );
  if (objective === null) {
    throw new CapitalObjectiveNotFoundError();
  }
  return { company, organisationId, objective };
}

function companyScope(
  actor: ActorContext,
  organisationId: Organisation,
  companyId: string,
) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId,
    resourceType: "company",
    resourceId: companyId,
  };
}

function objectiveScope(
  actor: ActorContext,
  organisationId: Organisation,
  capitalObjectiveId: string,
) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId,
    resourceType: "capital_objective",
    resourceId: capitalObjectiveId,
  };
}

function canonicalValues(objective: CapitalObjective): CapitalCanonicalValues {
  return {
    objectiveType: objective.objectiveType,
    target: objective.target,
    targetStage: objective.targetStage,
    instrumentCode: objective.instrumentCode,
    targetCloseDate: objective.targetCloseDate,
    useOfFundsSummary: objective.useOfFundsSummary,
  };
}

function eventContext(
  actor: ActorContext,
  organisationId: string,
  correlationId: CorrelationId,
  objective: CapitalObjective,
) {
  return {
    tenantId: actor.tenantId,
    organisationId,
    actorUserId: actor.userId,
    correlationId,
    capitalObjectiveId: objective.id,
    companyId: objective.companyId,
    version: objective.version,
  };
}

/** Insert + CREATED history + audit + created event, inside the caller's transaction. */
async function establishObjective(
  dependencies: CapitalServiceDependencies,
  tx: TransactionContext,
  input: {
    readonly actor: ActorContext;
    readonly organisationId: Organisation;
    readonly company: CompanyIdentity;
    readonly request: CreateCapitalObjectiveRequest;
    readonly correlationId: CorrelationId;
    readonly replacedCapitalObjectiveId?: CapitalObjectiveId | undefined;
  },
): Promise<CapitalObjective> {
  const { actor, request } = input;
  const objective = await dependencies.repositories.objectives.insert(tx, {
    tenantId: actor.tenantId,
    companyId: input.company.id,
    objectiveType: request.objectiveType ?? "RAISE",
    target: request.target,
    targetStage: request.targetStage ?? null,
    instrumentCode: request.instrumentCode ?? null,
    targetCloseDate: request.targetCloseDate ?? null,
    useOfFundsSummary: request.useOfFundsSummary ?? null,
    createdByUserId: actor.userId,
  });
  await dependencies.repositories.history.append(tx, {
    tenantId: actor.tenantId,
    capitalObjectiveId: objective.id,
    eventType: "CREATED",
    actorType: actor.actorType,
    actorId: actor.userId,
    payload: {
      kind: "CREATED",
      status: objective.status,
      values: canonicalValues(objective),
      ...(input.replacedCapitalObjectiveId === undefined
        ? {}
        : { replacedCapitalObjectiveId: input.replacedCapitalObjectiveId }),
    },
  });
  await dependencies.audit.record(tx, {
    ...auditActorFromContext(actor),
    auditEventId: createAuditEventId(),
    actionType: ACTION.created,
    resourceType: RESOURCE,
    resourceId: objective.id,
    occurredAt: occurredNow(),
    outcome: "SUCCEEDED",
    metadata: {
      companyId: input.company.id,
      objectiveType: objective.objectiveType,
      ...(input.replacedCapitalObjectiveId === undefined
        ? {}
        : { replacedCapitalObjectiveId: input.replacedCapitalObjectiveId }),
    },
    correlationId: input.correlationId,
  });
  await dependencies.outbox.enqueue(
    tx,
    capitalObjectiveCreatedEvent(
      eventContext(actor, input.organisationId, input.correlationId, objective),
    ),
  );
  return objective;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateCapitalObjectiveCommand = CompanyScoped & {
  /** Validated against CreateCapitalObjectiveRequestSchema by the caller. */
  readonly input: CreateCapitalObjectiveRequest;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

/**
 * Establish the company's ACTIVE capital objective (version 1).
 *
 *   company visible in context and active -> capital_objective.create on the
 *   company resource -> transaction: idempotency lock/lookup -> per-company
 *   lock -> "already active?" (RESOURCE_CONFLICT) -> row -> CREATED history
 *   -> audit -> core.capital_objective.created -> idempotency record -> COMMIT
 *
 * Nothing is published, ranked, scored or related to any investor.
 */
export function createCreateCapitalObjective(
  dependencies: CapitalServiceDependencies,
) {
  const { transactions, authorization, repositories } = dependencies;

  return async (
    command: CreateCapitalObjectiveCommand,
  ): Promise<CapitalObjective> => {
    const { actor, input } = command;
    const { company, organisationId } = await visibleCompany(
      dependencies,
      actor,
      command.companyId,
    );
    await authorization.requireCapability({
      actor,
      capability: CAPITAL_OBJECTIVE_CREATE,
      resource: companyScope(actor, organisationId, company.id),
    });
    if (company.companyStatus !== "active") {
      throw new CapitalObjectiveLifecycleError(
        company.companyStatus,
        "A closed company cannot start a capital objective.",
      );
    }

    const keyHash = hashCapitalObjectiveIdempotencyKey(command.idempotencyKey);
    const requestHash = hashCreateCapitalObjectiveRequest(input);

    return transactions.run(async (tx) => {
      await repositories.creationRequests.lock(
        tx,
        actor.userId,
        company.id,
        keyHash,
      );
      const previous = await repositories.creationRequests.find(
        tx,
        actor.userId,
        company.id,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new CapitalObjectiveCreationConflictError();
        }
        const existing = await repositories.objectives.findById(
          tx.sql,
          actor.tenantId,
          company.id,
          previous.capitalObjectiveId,
        );
        if (existing === null) {
          throw new CapitalObjectiveCreationConflictError();
        }
        return existing;
      }

      await repositories.objectives.lockCompany(tx, company.id);
      const active = await repositories.objectives.findActive(
        tx.sql,
        actor.tenantId,
        company.id,
      );
      if (active !== null) {
        throw new ActiveCapitalObjectiveExistsError();
      }

      const objective = await establishObjective(dependencies, tx, {
        actor,
        organisationId,
        company,
        request: input,
        correlationId: command.correlationId,
      });
      await repositories.creationRequests.record(tx, {
        userId: actor.userId,
        companyId: company.id,
        idempotencyKeyHash: keyHash,
        requestHash,
        capitalObjectiveId: objective.id,
        tenantId: actor.tenantId,
      });
      return objective;
    });
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type GetCurrentCapitalObjectiveQuery = CompanyScoped;

/** The company's ACTIVE objective, or "not found". Never invented. */
export function createGetCurrentCapitalObjective(
  dependencies: CapitalServiceDependencies,
) {
  return async (
    query: GetCurrentCapitalObjectiveQuery,
  ): Promise<CapitalObjective> => {
    const { company, organisationId } = await visibleCompany(
      dependencies,
      query.actor,
      query.companyId,
    );
    const objective = await dependencies.repositories.objectives.findActive(
      dependencies.sql,
      query.actor.tenantId,
      company.id,
    );
    if (objective === null) {
      throw new CapitalObjectiveNotFoundError();
    }
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: CAPITAL_OBJECTIVE_VIEW,
      resource: objectiveScope(query.actor, organisationId, objective.id),
    });
    return objective;
  };
}

export type GetCapitalObjectiveQuery = ObjectiveScoped;

export function createGetCapitalObjective(
  dependencies: CapitalServiceDependencies,
) {
  return async (query: GetCapitalObjectiveQuery): Promise<CapitalObjective> => {
    const { organisationId, objective } = await visibleObjective(
      dependencies,
      query,
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: CAPITAL_OBJECTIVE_VIEW,
      resource: objectiveScope(query.actor, organisationId, objective.id),
    });
    return objective;
  };
}

export type ListCapitalObjectivesQuery = CompanyScoped & {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
};

export type CapitalObjectivePage = {
  readonly items: readonly CapitalObjective[];
  readonly nextCursor: string | undefined;
};

/** Current/latest first; history included; nothing deleted. */
export function createListCapitalObjectives(
  dependencies: CapitalServiceDependencies,
) {
  return async (
    query: ListCapitalObjectivesQuery,
  ): Promise<CapitalObjectivePage> => {
    const { company, organisationId } = await visibleCompany(
      dependencies,
      query.actor,
      query.companyId,
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: CAPITAL_OBJECTIVE_VIEW,
      resource: companyScope(query.actor, organisationId, company.id),
    });
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCapitalObjectiveCursor(query.cursor);
    const rows = await dependencies.repositories.objectives.list(
      dependencies.sql,
      query.actor.tenantId,
      company.id,
      { after, limit: limit + 1 },
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last !== undefined
        ? encodeCapitalObjectiveCursor({
            createdAt: last.createdAt,
            id: last.id,
          })
        : undefined;
    return { items, nextCursor };
  };
}

// ---------------------------------------------------------------------------
// Recalibrate
// ---------------------------------------------------------------------------

export type UpdateCapitalObjectiveCommand = ObjectiveScoped & {
  /** Validated against UpdateCapitalObjectiveRequestSchema by the caller. */
  readonly input: UpdateCapitalObjectiveRequest;
  readonly correlationId: CorrelationId;
};

function requireActive(objective: CapitalObjective): void {
  if (objective.status !== "ACTIVE") {
    throw new CapitalObjectiveLifecycleError(
      objective.status,
      "Only the active capital objective can be changed; a closed objective is history.",
    );
  }
}

/**
 * Recalibrate the ACTIVE objective in place: same id, version + 1, a
 * RECALIBRATED history row with previous and next values, audit and event
 * carrying change categories only. A recalibration never creates a new
 * objective, however large the change; that is the explicit replace command.
 */
export function createUpdateCapitalObjective(
  dependencies: CapitalServiceDependencies,
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: UpdateCapitalObjectiveCommand,
  ): Promise<CapitalObjective> => {
    const { actor, input } = command;
    const { organisationId, objective: visible } = await visibleObjective(
      dependencies,
      command,
    );
    await authorization.requireCapability({
      actor,
      capability: CAPITAL_OBJECTIVE_EDIT,
      resource: objectiveScope(actor, organisationId, visible.id),
    });

    return transactions.run(async (tx) => {
      const current = await repositories.objectives.lockById(
        tx,
        actor.tenantId,
        visible.companyId,
        command.capitalObjectiveId,
      );
      if (current === null) {
        throw new CapitalObjectiveNotFoundError();
      }
      if (current.version !== input.expectedVersion) {
        throw new CapitalObjectiveVersionConflictError(current.version);
      }
      requireActive(current);

      const changes: Mutable<CapitalObjectiveChanges> = {};
      const changedFields: string[] = [];
      const kinds = new Set<CapitalChangeKind>();
      const previous: Mutable<Partial<CapitalCanonicalValues>> = {};
      const next: Mutable<Partial<CapitalCanonicalValues>> = {};

      if (input.target !== undefined) {
        if (input.target.amount !== current.target.amount) {
          kinds.add("TARGET_AMOUNT");
        }
        if (input.target.currency !== current.target.currency) {
          kinds.add("CURRENCY");
        }
        if (
          input.target.amount !== current.target.amount ||
          input.target.currency !== current.target.currency
        ) {
          changes.target = input.target;
          changedFields.push("target");
          previous.target = current.target;
          next.target = input.target;
        }
      }
      const scalar = [
        ["targetStage", "TARGET_STAGE"],
        ["instrumentCode", "INSTRUMENT"],
        ["targetCloseDate", "TIMELINE"],
        ["useOfFundsSummary", "USE_OF_FUNDS"],
      ] as const;
      for (const [field, kind] of scalar) {
        const value = input[field];
        if (value !== undefined && value !== current[field]) {
          changes[field] = value;
          changedFields.push(field);
          kinds.add(kind);
          previous[field] = current[field];
          next[field] = value;
        }
      }
      if (changedFields.length === 0) {
        return current;
      }

      const updated = await repositories.objectives.recalibrate(tx, {
        tenantId: actor.tenantId,
        companyId: current.companyId,
        capitalObjectiveId: current.id,
        expectedVersion: current.version,
        changes,
      });
      if (updated === null) {
        throw new CapitalObjectiveVersionConflictError(current.version);
      }
      const changeKinds = [...kinds];
      await repositories.history.append(tx, {
        tenantId: actor.tenantId,
        capitalObjectiveId: updated.id,
        eventType: "RECALIBRATED",
        actorType: actor.actorType,
        actorId: actor.userId,
        payload: {
          kind: "RECALIBRATED",
          changedFields,
          changeKinds,
          previous,
          next,
          previousVersion: current.version,
          newVersion: updated.version,
        },
      });
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.updated,
        resourceType: RESOURCE,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          changedFields,
          changeKinds,
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        capitalObjectiveUpdatedEvent({
          ...eventContext(
            actor,
            organisationId,
            command.correlationId,
            updated,
          ),
          changedFields,
          changeKinds,
        }),
      );
      return updated;
    });
  };
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

export type CloseCapitalObjectiveCommand = ObjectiveScoped & {
  readonly input: CloseCapitalObjectiveRequest;
  readonly correlationId: CorrelationId;
};

/**
 * ACTIVE -> ACHIEVED | CLOSED_BY_FOUNDER | DISCONTINUED with server-time
 * closed_at. The reason is the company's statement; nothing here checks a
 * raised amount, and closing below target is never a failure.
 */
export function createCloseCapitalObjective(
  dependencies: CapitalServiceDependencies,
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: CloseCapitalObjectiveCommand,
  ): Promise<CapitalObjective> => {
    const { actor, input } = command;
    const { organisationId, objective: visible } = await visibleObjective(
      dependencies,
      command,
    );
    await authorization.requireCapability({
      actor,
      capability: CAPITAL_OBJECTIVE_CLOSE,
      resource: objectiveScope(actor, organisationId, visible.id),
    });

    return transactions.run(async (tx) => {
      const current = await repositories.objectives.lockById(
        tx,
        actor.tenantId,
        visible.companyId,
        command.capitalObjectiveId,
      );
      if (current === null) {
        throw new CapitalObjectiveNotFoundError();
      }
      if (current.version !== input.expectedVersion) {
        throw new CapitalObjectiveVersionConflictError(current.version);
      }
      requireActive(current);

      const closed = await repositories.objectives.close(tx, {
        tenantId: actor.tenantId,
        companyId: current.companyId,
        capitalObjectiveId: current.id,
        expectedVersion: current.version,
        status: input.reason,
      });
      if (closed === null) {
        throw new CapitalObjectiveVersionConflictError(current.version);
      }
      await repositories.history.append(tx, {
        tenantId: actor.tenantId,
        capitalObjectiveId: closed.id,
        eventType: "CLOSED",
        actorType: actor.actorType,
        actorId: actor.userId,
        payload: {
          kind: "CLOSED",
          reason: input.reason,
          previousVersion: current.version,
          newVersion: closed.version,
        },
      });
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.closed,
        resourceType: RESOURCE,
        resourceId: closed.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          closureReason: input.reason,
          previousVersion: current.version,
          newVersion: closed.version,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        capitalObjectiveClosedEvent({
          ...eventContext(actor, organisationId, command.correlationId, closed),
          closureReason: input.reason,
        }),
      );
      return closed;
    });
  };
}

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

export type ReplaceCapitalObjectiveCommand = ObjectiveScoped & {
  readonly input: ReplaceCapitalObjectiveRequest;
  readonly correlationId: CorrelationId;
};

export type ReplacedCapitalObjective = {
  readonly replaced: CapitalObjective;
  readonly replacement: CapitalObjective;
};

/**
 * A deliberately new objective: the old one becomes REPLACED (closed_at =
 * server time, REPLACED history naming the replacement) and a new ACTIVE
 * objective with a new id is created, all in one transaction. Requires both
 * capital_objective.close and capital_objective.create. At no committed
 * point do two ACTIVE objectives exist.
 */
export function createReplaceCapitalObjective(
  dependencies: CapitalServiceDependencies,
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: ReplaceCapitalObjectiveCommand,
  ): Promise<ReplacedCapitalObjective> => {
    const { actor, input } = command;
    const {
      company,
      organisationId,
      objective: visible,
    } = await visibleObjective(dependencies, command);
    await authorization.requireCapability({
      actor,
      capability: CAPITAL_OBJECTIVE_CLOSE,
      resource: objectiveScope(actor, organisationId, visible.id),
    });
    await authorization.requireCapability({
      actor,
      capability: CAPITAL_OBJECTIVE_CREATE,
      resource: companyScope(actor, organisationId, company.id),
    });
    if (company.companyStatus !== "active") {
      throw new CapitalObjectiveLifecycleError(
        company.companyStatus,
        "A closed company cannot start a capital objective.",
      );
    }

    return transactions.run(async (tx) => {
      await repositories.objectives.lockCompany(tx, company.id);
      const current = await repositories.objectives.lockById(
        tx,
        actor.tenantId,
        company.id,
        command.capitalObjectiveId,
      );
      if (current === null) {
        throw new CapitalObjectiveNotFoundError();
      }
      if (current.version !== input.expectedVersion) {
        throw new CapitalObjectiveVersionConflictError(current.version);
      }
      requireActive(current);

      const replaced = await repositories.objectives.close(tx, {
        tenantId: actor.tenantId,
        companyId: company.id,
        capitalObjectiveId: current.id,
        expectedVersion: current.version,
        status: "REPLACED",
      });
      if (replaced === null) {
        throw new CapitalObjectiveVersionConflictError(current.version);
      }
      const replacement = await establishObjective(dependencies, tx, {
        actor,
        organisationId,
        company,
        request: input.replacement,
        correlationId: command.correlationId,
        replacedCapitalObjectiveId: replaced.id,
      });
      await repositories.history.append(tx, {
        tenantId: actor.tenantId,
        capitalObjectiveId: replaced.id,
        eventType: "REPLACED",
        actorType: actor.actorType,
        actorId: actor.userId,
        payload: {
          kind: "REPLACED",
          replacementCapitalObjectiveId: replacement.id,
          previousVersion: current.version,
          newVersion: replaced.version,
        },
      });
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.replaced,
        resourceType: RESOURCE,
        resourceId: replaced.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          replacementCapitalObjectiveId: replacement.id,
          previousVersion: current.version,
          newVersion: replaced.version,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        capitalObjectiveClosedEvent({
          ...eventContext(
            actor,
            organisationId,
            command.correlationId,
            replaced,
          ),
          closureReason: "REPLACED",
          replacementCapitalObjectiveId: replacement.id,
        }),
      );
      return { replaced, replacement };
    });
  };
}
