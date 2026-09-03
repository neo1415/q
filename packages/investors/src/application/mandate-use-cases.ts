import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  DEFAULT_PAGE_SIZE,
  type CorrelationId,
  type CreateInvestorMandateRequest,
  type InvestorMandateStatus,
  type InvestorMandateTransitionRequest,
  type MandateChequeRange,
  type MandateConstraintInput,
  type UpdateInvestorMandateRequest,
} from "@capital-q/contracts";
import { capability, type ActorContext } from "@capital-q/security";

import type { InvestorOrganisationId } from "../contracts/index.js";
import {
  chequeRangeOf,
  type InvestorMandate,
  type InvestorMandateConstraint,
  type InvestorMandateId,
  type InvestorMandateSummary,
} from "../contracts/mandate.js";
import { InvestorVersionConflictError } from "../domain/errors.js";
import {
  decodeMandateCursor,
  encodeMandateCursor,
} from "../domain/mandate-cursor.js";
import {
  InvestorMandateCreationConflictError,
  InvestorMandateLifecycleError,
  InvestorMandateNotFoundError,
} from "../domain/mandate-errors.js";
import {
  hashCreateInvestorMandateRequest,
  hashInvestorMandateIdempotencyKey,
} from "../domain/mandate-idempotency.js";
import {
  validateChequeRange,
  validateMandateConstraints,
} from "../domain/mandate-registry.js";
import {
  investorMandateActivatedEvent,
  investorMandateClosedEvent,
  investorMandateCreatedEvent,
  investorMandateUpdatedEvent,
  type MandateChangeKind,
} from "../events/mandate.js";
import type { InvestorServiceDependencies } from "./dependencies.js";
import type {
  InvestorMandateScalarChanges,
  NewMandateConstraint,
} from "./mandate-ports.js";
import { visibleInvestorOrganisation } from "./read-investor-organisation.js";

/**
 * Declared-mandate use cases.
 *
 * Every operation starts by resolving the investor organisation in the
 * caller's tenant and active organisation (enumeration-safe otherwise),
 * then the mandate under that investor, then a capability on the exact
 * mandate (or investor, for creation) resource. Nothing here reads
 * behaviour, asks a model, or touches GateQ: the only way a mandate changes
 * is an authorised human command carrying the version it read.
 */

export const INVESTOR_MANDATE_CREATE = capability("investor.mandate.create");
export const INVESTOR_MANDATE_VIEW = capability("investor.mandate.view");
export const INVESTOR_MANDATE_EDIT = capability("investor.mandate.edit");

const RESOURCE_MANDATE = AuditResourceTypeSchema.parse("investor_mandate");
const ACTION = {
  created: AuditActionTypeSchema.parse("investor_mandate.created"),
  updated: AuditActionTypeSchema.parse("investor_mandate.updated"),
  activated: AuditActionTypeSchema.parse("investor_mandate.activated"),
  closed: AuditActionTypeSchema.parse("investor_mandate.closed"),
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type InvestorScoped = {
  readonly actor: ActorContext;
  readonly investorOrganisationId: InvestorOrganisationId;
};
type MandateScoped = InvestorScoped & {
  readonly mandateId: InvestorMandateId;
};

function mandateScope(
  actor: ActorContext,
  organisationId: NonNullable<ActorContext["organisationId"]>,
  mandateId: string,
) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId,
    resourceType: "investor_mandate",
    resourceId: mandateId,
  };
}

/** Investor visible in context, then the mandate under it, or "not found". */
async function visibleMandate(
  dependencies: InvestorServiceDependencies,
  scoped: MandateScoped,
): Promise<{
  mandate: InvestorMandate;
  organisationId: NonNullable<ActorContext["organisationId"]>;
}> {
  const { investor, organisationId } = await visibleInvestorOrganisation(
    dependencies,
    scoped.actor,
    scoped.investorOrganisationId,
  );
  const mandate = await dependencies.repositories.mandates.findById(
    dependencies.sql,
    scoped.actor.tenantId,
    investor.id,
    scoped.mandateId,
  );
  if (mandate === null) {
    throw new InvestorMandateNotFoundError();
  }
  return { mandate, organisationId };
}

/** The derived typical-cheque constraint, when a typical cheque is declared. */
function typicalConstraint(
  range: MandateChequeRange | null | undefined,
): NewMandateConstraint | null {
  if (range?.typical === undefined) {
    return null;
  }
  return {
    dimension: "cheque.typical",
    operator: "EQ",
    value: { kind: "amount", amount: range.typical, currency: range.currency },
    importance: "NEUTRAL",
    isHardExclusion: false,
  };
}

function toNewConstraints(
  inputs: readonly MandateConstraintInput[],
): NewMandateConstraint[] {
  return inputs.map((input) => ({
    dimension: input.dimension,
    operator: input.operator,
    value: input.value,
    importance: input.importance,
    isHardExclusion: input.isHardExclusion,
  }));
}

/** Identity of a constraint's declared content, for set comparison. */
function constraintKey(constraint: NewMandateConstraint): string {
  return JSON.stringify([
    constraint.dimension,
    constraint.operator,
    constraint.value,
    constraint.importance,
    constraint.isHardExclusion,
  ]);
}

function changeKindOf(constraint: NewMandateConstraint): MandateChangeKind {
  if (constraint.isHardExclusion) {
    return "HARD_EXCLUSION";
  }
  if (constraint.dimension === "stage") {
    return "STAGE";
  }
  if (constraint.dimension === "geography.country") {
    return "GEOGRAPHY";
  }
  if (constraint.dimension === "cheque.typical") {
    return "CHEQUE";
  }
  return "PREFERENCE";
}

function eventContext(
  actor: ActorContext,
  organisationId: string,
  correlationId: CorrelationId,
  mandate: Pick<InvestorMandate, "id" | "investorOrganisationId" | "version">,
) {
  return {
    tenantId: actor.tenantId,
    organisationId,
    actorUserId: actor.userId,
    correlationId,
    investorMandateId: mandate.id,
    investorOrganisationId: mandate.investorOrganisationId,
    version: mandate.version,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateInvestorMandateCommand = InvestorScoped & {
  /** Validated against CreateInvestorMandateRequestSchema by the caller. */
  readonly input: CreateInvestorMandateRequest;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

/**
 * Create a DRAFT mandate (version 1) for the investor organisation.
 *
 *   investor visible in context -> investor.mandate.create on the investor
 *   resource -> registry validation -> transaction: idempotency lock/lookup
 *   -> mandate + constraints -> audit -> core.investor_mandate.created
 *   -> idempotency record -> COMMIT
 *
 * Nothing is activated, ranked or inferred. No fund, GateQ rule set or
 * behaviour feature is created.
 */
export function createCreateInvestorMandate(
  dependencies: InvestorServiceDependencies,
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: CreateInvestorMandateCommand,
  ): Promise<InvestorMandate> => {
    const { actor, input } = command;
    const { investor, organisationId } = await visibleInvestorOrganisation(
      dependencies,
      actor,
      command.investorOrganisationId,
    );
    await authorization.requireCapability({
      actor,
      capability: INVESTOR_MANDATE_CREATE,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId,
        resourceType: "investor_organisation",
        resourceId: investor.id,
      },
    });

    const declared = validateMandateConstraints(input.constraints ?? []);
    if (input.chequeRange !== undefined) {
      validateChequeRange(input.chequeRange);
    }
    const typical = typicalConstraint(input.chequeRange);
    const keyHash = hashInvestorMandateIdempotencyKey(command.idempotencyKey);
    const requestHash = hashCreateInvestorMandateRequest(input);

    return transactions.run(async (tx) => {
      await repositories.mandateCreationRequests.lock(
        tx,
        actor.userId,
        investor.id,
        keyHash,
      );
      const previous = await repositories.mandateCreationRequests.find(
        tx,
        actor.userId,
        investor.id,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new InvestorMandateCreationConflictError();
        }
        const existing = await repositories.mandates.findById(
          tx.sql,
          actor.tenantId,
          investor.id,
          previous.mandateId,
        );
        if (existing === null) {
          throw new InvestorMandateCreationConflictError();
        }
        return existing;
      }

      const mandate = await repositories.mandates.insert(tx, {
        tenantId: actor.tenantId,
        investorOrganisationId: investor.id,
        name: input.name,
        discoveryMode: input.discoveryMode ?? null,
        minCheque: input.chequeRange?.min ?? null,
        maxCheque: input.chequeRange?.max ?? null,
        currencyCode: input.chequeRange?.currency ?? null,
        minStageCode: input.minStageCode ?? null,
        maxStageCode: input.maxStageCode ?? null,
        rawMandateText: input.rawMandateText ?? null,
        createdByUserId: actor.userId,
        constraints: [
          ...toNewConstraints(declared),
          ...(typical === null ? [] : [typical]),
        ],
      });

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.created,
        resourceType: RESOURCE_MANDATE,
        resourceId: mandate.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          investorOrganisationId: investor.id,
          constraintCount: mandate.constraints.length,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        investorMandateCreatedEvent(
          eventContext(actor, organisationId, command.correlationId, mandate),
        ),
      );
      await repositories.mandateCreationRequests.record(tx, {
        userId: actor.userId,
        investorOrganisationId: investor.id,
        idempotencyKeyHash: keyHash,
        requestHash,
        mandateId: mandate.id,
        tenantId: actor.tenantId,
      });
      return mandate;
    });
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type GetInvestorMandateQuery = MandateScoped;

export function createGetInvestorMandate(
  dependencies: InvestorServiceDependencies,
) {
  return async (query: GetInvestorMandateQuery): Promise<InvestorMandate> => {
    const { mandate, organisationId } = await visibleMandate(
      dependencies,
      query,
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: INVESTOR_MANDATE_VIEW,
      resource: mandateScope(query.actor, organisationId, mandate.id),
    });
    return mandate;
  };
}

export type ListInvestorMandatesQuery = InvestorScoped & {
  readonly status?: InvestorMandateStatus | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
};

export type InvestorMandatePage = {
  readonly items: readonly InvestorMandateSummary[];
  readonly nextCursor: string | undefined;
};

/** The investor's own mandates, newest first. `investor.mandate.view` on the investor. */
export function createListInvestorMandates(
  dependencies: InvestorServiceDependencies,
) {
  return async (
    query: ListInvestorMandatesQuery,
  ): Promise<InvestorMandatePage> => {
    const { investor, organisationId } = await visibleInvestorOrganisation(
      dependencies,
      query.actor,
      query.investorOrganisationId,
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: INVESTOR_MANDATE_VIEW,
      resource: {
        kind: "RESOURCE",
        tenantId: query.actor.tenantId,
        organisationId,
        resourceType: "investor_organisation",
        resourceId: investor.id,
      },
    });
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const after =
      query.cursor === undefined
        ? undefined
        : decodeMandateCursor(query.cursor);
    const rows = await dependencies.repositories.mandates.list(
      dependencies.sql,
      query.actor.tenantId,
      investor.id,
      { status: query.status, after, limit: limit + 1 },
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last !== undefined
        ? encodeMandateCursor({ createdAt: last.createdAt, id: last.id })
        : undefined;
    return { items, nextCursor };
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateInvestorMandateCommand = MandateScoped & {
  /** Validated against UpdateInvestorMandateRequestSchema by the caller. */
  readonly input: UpdateInvestorMandateRequest;
  readonly correlationId: CorrelationId;
};

function requireEditable(mandate: InvestorMandate): void {
  if (mandate.status === "CLOSED") {
    throw new InvestorMandateLifecycleError(
      mandate.status,
      "A closed mandate is history and cannot be edited.",
    );
  }
}

/**
 * Replace parts of the declared policy snapshot. Scalars change only when
 * they differ; `chequeRange` replaces the whole cheque envelope including
 * the typical cheque; `constraints` replaces the whole client-editable
 * constraint set (unchanged constraints keep their ids). Everything --
 * scalar write, constraint removal and insertion, audit and event -- is one
 * transaction under the version the caller read.
 */
export function createUpdateInvestorMandate(
  dependencies: InvestorServiceDependencies,
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: UpdateInvestorMandateCommand,
  ): Promise<InvestorMandate> => {
    const { actor, input } = command;
    const { mandate: visible, organisationId } = await visibleMandate(
      dependencies,
      command,
    );
    await authorization.requireCapability({
      actor,
      capability: INVESTOR_MANDATE_EDIT,
      resource: mandateScope(actor, organisationId, visible.id),
    });

    const declared =
      input.constraints === undefined
        ? undefined
        : validateMandateConstraints(input.constraints);
    if (input.chequeRange !== undefined && input.chequeRange !== null) {
      validateChequeRange(input.chequeRange);
    }

    return transactions.run(async (tx) => {
      const current = await repositories.mandates.lockById(
        tx,
        actor.tenantId,
        visible.investorOrganisationId,
        command.mandateId,
      );
      if (current === null) {
        throw new InvestorMandateNotFoundError();
      }
      if (current.version !== input.expectedVersion) {
        throw new InvestorVersionConflictError(current.version, "mandate");
      }
      requireEditable(current);

      // Scalars.
      const changes: Mutable<InvestorMandateScalarChanges> = {};
      const changedFields: string[] = [];
      const kinds = new Set<MandateChangeKind>();
      if (input.name !== undefined && input.name !== current.name) {
        changes.name = input.name;
        changedFields.push("name");
        kinds.add("NAME");
      }
      if (
        input.discoveryMode !== undefined &&
        input.discoveryMode !== current.discoveryMode
      ) {
        changes.discoveryMode = input.discoveryMode;
        changedFields.push("discoveryMode");
        kinds.add("DISCOVERY_MODE");
      }
      for (const field of ["minStageCode", "maxStageCode"] as const) {
        const next = input[field];
        if (next !== undefined && next !== current[field]) {
          changes[field] = next;
          changedFields.push(field);
          kinds.add("STAGE");
        }
      }
      if (
        input.rawMandateText !== undefined &&
        input.rawMandateText !== current.rawMandateText
      ) {
        changes.rawMandateText = input.rawMandateText;
        changedFields.push("rawMandateText");
        kinds.add("RAW_TEXT");
      }

      // Cheque envelope: min / max / currency on the row, typical as a constraint.
      const nextConstraints: NewMandateConstraint[] = [];
      let replaceTypical = false;
      if (input.chequeRange !== undefined) {
        const range = input.chequeRange;
        const nextMin = range?.min ?? null;
        const nextMax = range?.max ?? null;
        const nextCurrency = range?.currency ?? null;
        const currentRange = chequeRangeOf(current);
        const currentTypical = currentRange?.typical;
        if (
          nextMin !== current.minCheque ||
          nextMax !== current.maxCheque ||
          nextCurrency !== current.currencyCode ||
          (range?.typical ?? undefined) !== currentTypical
        ) {
          changes.minCheque = nextMin;
          changes.maxCheque = nextMax;
          changes.currencyCode = nextCurrency;
          changedFields.push("chequeRange");
          kinds.add("CHEQUE");
          replaceTypical = true;
        }
      }

      // Constraint set: diff against the stored, client-editable set.
      const stored = current.constraints;
      const keep = (constraint: InvestorMandateConstraint) =>
        constraint.dimension === "cheque.typical"
          ? !replaceTypical
          : declared === undefined;
      const targetKeys = new Map<string, NewMandateConstraint>();
      if (declared !== undefined) {
        for (const constraint of toNewConstraints(declared)) {
          targetKeys.set(constraintKey(constraint), constraint);
        }
      }
      if (replaceTypical) {
        const typical = typicalConstraint(input.chequeRange);
        if (typical !== null) {
          targetKeys.set(constraintKey(typical), typical);
        }
      }
      const removeIds: InvestorMandateConstraint["id"][] = [];
      const storedKeys = new Set<string>();
      for (const constraint of stored) {
        const key = constraintKey(constraint);
        if (keep(constraint)) {
          storedKeys.add(key);
          continue;
        }
        if (targetKeys.has(key)) {
          storedKeys.add(key);
          continue;
        }
        removeIds.push(constraint.id);
        kinds.add(changeKindOf(constraint));
      }
      for (const [key, constraint] of targetKeys) {
        if (!storedKeys.has(key)) {
          nextConstraints.push(constraint);
          kinds.add(changeKindOf(constraint));
        }
      }
      if (
        declared !== undefined &&
        (removeIds.length > 0 || nextConstraints.length > 0) &&
        !changedFields.includes("constraints")
      ) {
        changedFields.push("constraints");
      }

      if (
        changedFields.length === 0 &&
        removeIds.length === 0 &&
        nextConstraints.length === 0
      ) {
        return current;
      }

      const matched = await repositories.mandates.updateScalars(tx, {
        tenantId: actor.tenantId,
        investorOrganisationId: current.investorOrganisationId,
        mandateId: current.id,
        expectedVersion: current.version,
        changes,
      });
      if (!matched) {
        throw new InvestorVersionConflictError(current.version, "mandate");
      }
      await repositories.mandates.replaceConstraints(tx, {
        tenantId: actor.tenantId,
        mandateId: current.id,
        removeIds,
        add: nextConstraints,
      });
      const updated = await repositories.mandates.findById(
        tx.sql,
        actor.tenantId,
        current.investorOrganisationId,
        current.id,
      );
      if (updated === null) {
        throw new InvestorMandateNotFoundError();
      }
      const changeKinds = [...kinds];
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.updated,
        resourceType: RESOURCE_MANDATE,
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
        investorMandateUpdatedEvent({
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
// Lifecycle
// ---------------------------------------------------------------------------

export type TransitionInvestorMandateCommand = MandateScoped & {
  readonly input: InvestorMandateTransitionRequest;
  readonly correlationId: CorrelationId;
};

/**
 * DRAFT -> ACTIVE. Structural validity was enforced on every write, and an
 * incomplete mandate (unknown dimensions) is still a valid one: unknown is
 * not a reason to withhold a useful feed. Server time becomes
 * effective_from; nothing is ranked synchronously.
 */
export function createActivateInvestorMandate(
  dependencies: InvestorServiceDependencies,
) {
  return transition(dependencies, "ACTIVE");
}

/** DRAFT or ACTIVE -> CLOSED. The row stays as history. */
export function createCloseInvestorMandate(
  dependencies: InvestorServiceDependencies,
) {
  return transition(dependencies, "CLOSED");
}

function transition(
  dependencies: InvestorServiceDependencies,
  to: "ACTIVE" | "CLOSED",
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: TransitionInvestorMandateCommand,
  ): Promise<InvestorMandate> => {
    const { actor } = command;
    const { mandate: visible, organisationId } = await visibleMandate(
      dependencies,
      command,
    );
    await authorization.requireCapability({
      actor,
      capability: INVESTOR_MANDATE_EDIT,
      resource: mandateScope(actor, organisationId, visible.id),
    });

    return transactions.run(async (tx) => {
      const current = await repositories.mandates.lockById(
        tx,
        actor.tenantId,
        visible.investorOrganisationId,
        command.mandateId,
      );
      if (current === null) {
        throw new InvestorMandateNotFoundError();
      }
      if (
        command.input.expectedVersion !== undefined &&
        command.input.expectedVersion !== current.version
      ) {
        throw new InvestorVersionConflictError(current.version, "mandate");
      }
      if (to === "ACTIVE" && current.status !== "DRAFT") {
        throw new InvestorMandateLifecycleError(
          current.status,
          "Only a draft mandate can be activated.",
        );
      }
      if (to === "CLOSED" && current.status === "CLOSED") {
        throw new InvestorMandateLifecycleError(
          current.status,
          "The mandate is already closed.",
        );
      }

      const effective = await repositories.mandates.transition(tx, {
        tenantId: actor.tenantId,
        investorOrganisationId: current.investorOrganisationId,
        mandateId: current.id,
        expectedVersion: current.version,
        to,
      });
      if (effective === null) {
        throw new InvestorVersionConflictError(current.version, "mandate");
      }
      const updated = await repositories.mandates.findById(
        tx.sql,
        actor.tenantId,
        current.investorOrganisationId,
        current.id,
      );
      if (updated === null) {
        throw new InvestorMandateNotFoundError();
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: to === "ACTIVE" ? ACTION.activated : ACTION.closed,
        resourceType: RESOURCE_MANDATE,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          previousStatus: current.status,
          newStatus: updated.status,
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });
      const context = eventContext(
        actor,
        organisationId,
        command.correlationId,
        updated,
      );
      await outbox.enqueue(
        tx,
        to === "ACTIVE"
          ? investorMandateActivatedEvent({
              ...context,
              effectiveFrom: effective,
            })
          : investorMandateClosedEvent({ ...context, effectiveTo: effective }),
      );
      return updated;
    });
  };
}
