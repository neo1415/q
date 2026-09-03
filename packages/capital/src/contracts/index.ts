import { z } from "zod";

import type { CompanyId } from "@capital-q/companies";
import {
  createUuidIdSchema,
  type CapitalObjectiveDto,
  type CapitalObjectiveStatus,
  type CapitalObjectiveType,
  type CapitalTarget,
  type LocalDate,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { TenantId, UserId } from "@capital-q/security";

/**
 * @capital-q/capital/contracts
 *
 * The safe public surface of the Capital bounded context: the canonical
 * identifiers, the domain entity and the snapshot later consumers anchor
 * to. No persistence, no use cases.
 *
 *   Company ≠ Capital Objective ≠ Readiness ≠ Progress ≠ Outcome ≠ Q Inference
 */

/** The canonical Capital Objective identifier. Never a CompanyId, OrganisationId or UserId. */
export const CapitalObjectiveIdSchema =
  createUuidIdSchema("CapitalObjectiveId");
export type CapitalObjectiveId = z.infer<typeof CapitalObjectiveIdSchema>;

/** Identity of one goal-evolution history row. Not an outbox event id, not an audit id. */
export const CapitalObjectiveHistoryEventIdSchema = createUuidIdSchema(
  "CapitalObjectiveHistoryEventId",
);
export type CapitalObjectiveHistoryEventId = z.infer<
  typeof CapitalObjectiveHistoryEventIdSchema
>;

export type CapitalObjective = {
  readonly id: CapitalObjectiveId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly objectiveType: CapitalObjectiveType;
  readonly status: CapitalObjectiveStatus;
  /** Exact decimal string and ISO currency; never a number. */
  readonly target: CapitalTarget;
  readonly targetStage: string | null;
  readonly instrumentCode: string | null;
  readonly targetCloseDate: LocalDate | null;
  readonly useOfFundsSummary: string | null;
  readonly startedAt: UtcTimestamp;
  readonly closedAt: UtcTimestamp | null;
  readonly createdByUserId: UserId;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
};

/**
 * What a later consumer (Q tools, InvestIQ, Blueprint, recommendations)
 * receives through the query port: the structured goal without the
 * founder-provided narrative. Permission-neutral; callers authorize first.
 */
export type CapitalObjectiveSnapshot = {
  readonly id: CapitalObjectiveId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly objectiveType: CapitalObjectiveType;
  readonly status: CapitalObjectiveStatus;
  readonly target: CapitalTarget;
  readonly targetStage: string | null;
  readonly instrumentCode: string | null;
  readonly targetCloseDate: LocalDate | null;
  readonly startedAt: UtcTimestamp;
  readonly closedAt: UtcTimestamp | null;
  readonly version: number;
};

/** Organisation-internal wire shape. A disclosure-safe projection is a later, separate contract. */
export function toCapitalObjectiveDto(
  objective: CapitalObjective,
): CapitalObjectiveDto {
  return {
    id: objective.id,
    companyId: objective.companyId,
    objectiveType: objective.objectiveType,
    status: objective.status,
    target: objective.target,
    targetStage: objective.targetStage,
    instrumentCode: objective.instrumentCode,
    targetCloseDate: objective.targetCloseDate,
    useOfFundsSummary: objective.useOfFundsSummary,
    startedAt: objective.startedAt,
    closedAt: objective.closedAt,
    version: objective.version,
    createdAt: objective.createdAt,
    updatedAt: objective.updatedAt,
  };
}

export function toCapitalObjectiveSnapshot(
  objective: CapitalObjective,
): CapitalObjectiveSnapshot {
  return {
    id: objective.id,
    tenantId: objective.tenantId,
    companyId: objective.companyId,
    objectiveType: objective.objectiveType,
    status: objective.status,
    target: objective.target,
    targetStage: objective.targetStage,
    instrumentCode: objective.instrumentCode,
    targetCloseDate: objective.targetCloseDate,
    startedAt: objective.startedAt,
    closedAt: objective.closedAt,
    version: objective.version,
  };
}
