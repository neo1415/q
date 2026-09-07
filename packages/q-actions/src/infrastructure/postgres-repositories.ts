import { z } from "zod";

import {
  QActionClassSchema,
  QActionPayloadHashSchema,
  QActionProposalIdSchema,
  QActionStatusSchema,
  QActionTypeSchema,
  QApprovalIdSchema,
  QApprovalStatusSchema,
  QRunIdSchema,
  QSubjectRefsSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type {
  QActionRecord,
  QActionRepositories,
  QApprovalRecord,
} from "../ports.js";

/**
 * PostgreSQL for `q_runtime.actions` and `q_runtime.approvals`.
 *
 * Tenant is always in the predicate. Every lifecycle mutation carries the
 * expected version so a stale writer updates zero rows and is told so.
 * Rows are parsed on the way out; a malformed row fails here, never at a
 * client. The payload column is selected only by the operations that must
 * bind or execute it — a listing never needs it and never gets it — and
 * nothing in this file logs.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const JsonObject = z.record(z.string(), z.unknown());

const ActionRow = z.object({
  id: QActionProposalIdSchema,
  tenant_id: TenantIdSchema,
  run_id: QRunIdSchema,
  organisation_id: OrganisationIdSchema.nullable(),
  proposed_by_user_id: UserIdSchema,
  action_type: QActionTypeSchema,
  action_version: z.number().int().min(1),
  risk_class: QActionClassSchema,
  target_refs: QSubjectRefsSchema,
  proposed_payload: JsonObject,
  proposed_payload_hash: QActionPayloadHashSchema,
  summary: z.string(),
  preview: z.string().nullable(),
  status: QActionStatusSchema,
  idempotency_key: z.string(),
  created_at: Timestamp,
  updated_at: Timestamp,
  executed_at: Timestamp.nullable(),
  execution_result: JsonObject.nullable(),
  failure_code: z.string().nullable(),
  retry_permitted: z.boolean(),
  execution_attempts: z.number().int().min(0),
  version: z.number().int().min(1),
});

function toAction(row: unknown): QActionRecord {
  const r = ActionRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    runId: r.run_id,
    organisationId: r.organisation_id,
    proposedByUserId: r.proposed_by_user_id,
    actionType: r.action_type,
    actionVersion: r.action_version,
    riskClass: r.risk_class,
    targets: r.target_refs,
    payload: r.proposed_payload,
    payloadHash: r.proposed_payload_hash,
    summary: r.summary,
    preview: r.preview,
    status: r.status,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    executedAt: r.executed_at,
    executionResult: r.execution_result,
    failureCode: r.failure_code,
    retryPermitted: r.retry_permitted,
    executionAttempts: r.execution_attempts,
    version: r.version,
  };
}

const ApprovalRow = z.object({
  id: QApprovalIdSchema,
  tenant_id: TenantIdSchema,
  action_id: QActionProposalIdSchema,
  requested_from_user_id: UserIdSchema,
  status: QApprovalStatusSchema,
  requested_at: Timestamp,
  expires_at: Timestamp,
  approved_at: Timestamp.nullable(),
  approved_by_user_id: UserIdSchema.nullable(),
  rejected_at: Timestamp.nullable(),
  rejected_by_user_id: UserIdSchema.nullable(),
  rejection_reason: z.string().nullable(),
  revoked_at: Timestamp.nullable(),
  revoked_by_user_id: UserIdSchema.nullable(),
  approval_payload_hash: QActionPayloadHashSchema.nullable(),
  version: z.number().int().min(1),
});

function toApproval(row: unknown): QApprovalRecord {
  const r = ApprovalRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    actionId: r.action_id,
    requestedFromUserId: r.requested_from_user_id,
    status: r.status,
    requestedAt: r.requested_at,
    expiresAt: r.expires_at,
    approvedAt: r.approved_at,
    approvedByUserId: r.approved_by_user_id,
    rejectedAt: r.rejected_at,
    rejectedByUserId: r.rejected_by_user_id,
    rejectionReason: r.rejection_reason,
    revokedAt: r.revoked_at,
    revokedByUserId: r.revoked_by_user_id,
    approvalPayloadHash: r.approval_payload_hash,
    version: r.version,
  };
}

function selectAction(executor: DatabaseExecutor) {
  return executor`
    select a.id, a.tenant_id, a.run_id, a.organisation_id, a.proposed_by_user_id,
           a.action_type, a.action_version, a.risk_class, a.target_refs,
           a.proposed_payload, a.proposed_payload_hash, a.summary, a.preview,
           a.status, a.idempotency_key, a.created_at, a.updated_at, a.executed_at,
           a.execution_result, a.failure_code, a.retry_permitted,
           a.execution_attempts, a.version
      from q_runtime.actions a`;
}

function selectApproval(executor: DatabaseExecutor) {
  return executor`
    select p.id, p.tenant_id, p.action_id, p.requested_from_user_id, p.status,
           p.requested_at, p.expires_at, p.approved_at, p.approved_by_user_id,
           p.rejected_at, p.rejected_by_user_id, p.rejection_reason,
           p.revoked_at, p.revoked_by_user_id, p.approval_payload_hash, p.version
      from q_runtime.approvals p`;
}

export function createPostgresQActionRepositories(): QActionRepositories {
  const findAction: QActionRepositories["actions"]["findById"] = async (
    executor,
    tenantId,
    actionId,
  ) => {
    const rows = await executor`
      ${selectAction(executor)}
       where a.id = ${actionId} and a.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toAction(rows[0]);
  };

  const findApproval: QActionRepositories["approvals"]["findById"] = async (
    executor,
    tenantId,
    approvalId,
  ) => {
    const rows = await executor`
      ${selectApproval(executor)}
       where p.id = ${approvalId} and p.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toApproval(rows[0]);
  };

  return {
    actions: {
      insert: async (tx, input) => {
        await tx.sql`
          insert into q_runtime.actions
            (id, tenant_id, run_id, organisation_id, proposed_by_user_id, action_type,
             action_version, risk_class, target_refs, proposed_payload,
             proposed_payload_hash, summary, preview, status, idempotency_key)
          values (${input.id}, ${input.tenantId}, ${input.runId}, ${input.organisationId},
                  ${input.proposedByUserId}, ${input.actionType}, ${input.actionVersion},
                  ${input.riskClass}, ${JSON.stringify(input.targets)}::text::jsonb,
                  ${JSON.stringify(input.payload)}::text::jsonb, ${input.payloadHash},
                  ${input.summary}, ${input.preview}, 'PROPOSED', ${input.idempotencyKey})`;
        const created = await findAction(tx.sql, input.tenantId, input.id);
        if (created === null) {
          throw new Error("q action insert did not return a row");
        }
        return created;
      },
      findById: findAction,
      lockById: async (tx, tenantId, actionId) => {
        const rows = await tx.sql`
          ${selectAction(tx.sql)}
           where a.id = ${actionId} and a.tenant_id = ${tenantId}
           for update`;
        return rows.length === 0 ? null : toAction(rows[0]);
      },
      listForRun: async (executor, tenantId, runId) => {
        const rows = await executor`
          ${selectAction(executor)}
           where a.run_id = ${runId} and a.tenant_id = ${tenantId}
           order by a.created_at desc, a.id desc
           limit 100`;
        return rows.map(toAction);
      },
      transition: async (tx, input) => {
        const rows = await tx.sql`
          update q_runtime.actions a
             set status = ${input.status},
                 executed_at = coalesce(${input.executedAt ?? null}::text::timestamptz, a.executed_at),
                 execution_result = coalesce(${input.executionResult === undefined ? null : JSON.stringify(input.executionResult)}::text::jsonb, a.execution_result),
                 failure_code = case when ${input.failureCode === undefined}::boolean then a.failure_code else ${input.failureCode ?? null}::text end,
                 retry_permitted = coalesce(${input.retryPermitted ?? null}::boolean, a.retry_permitted),
                 execution_attempts = a.execution_attempts + case when ${input.incrementAttempts === true}::boolean then 1 else 0 end,
                 version = a.version + 1
           where a.id = ${input.actionId}
             and a.tenant_id = ${input.tenantId}
             and a.version = ${input.expectedVersion}
          returning a.id`;
        if (rows.length === 0) {
          return null;
        }
        return findAction(tx.sql, input.tenantId, input.actionId);
      },
    },
    approvals: {
      insert: async (tx, input) => {
        await tx.sql`
          insert into q_runtime.approvals
            (id, tenant_id, action_id, requested_from_user_id, status, requested_at, expires_at)
          values (${input.id}, ${input.tenantId}, ${input.actionId}, ${input.requestedFromUserId},
                  'PENDING', ${input.requestedAt}::text::timestamptz, ${input.expiresAt}::text::timestamptz)`;
        const created = await findApproval(tx.sql, input.tenantId, input.id);
        if (created === null) {
          throw new Error("q approval insert did not return a row");
        }
        return created;
      },
      findById: findApproval,
      lockById: async (tx, tenantId, approvalId) => {
        const rows = await tx.sql`
          ${selectApproval(tx.sql)}
           where p.id = ${approvalId} and p.tenant_id = ${tenantId}
           for update`;
        return rows.length === 0 ? null : toApproval(rows[0]);
      },
      findOwnership: async (executor, approvalId) => {
        const rows = await executor`
          select p.tenant_id, p.requested_from_user_id
            from q_runtime.approvals p
           where p.id = ${approvalId}`;
        if (rows.length === 0) {
          return null;
        }
        const r = z
          .object({
            tenant_id: TenantIdSchema,
            requested_from_user_id: UserIdSchema,
          })
          .parse(rows[0]);
        return {
          tenantId: r.tenant_id,
          requestedFromUserId: r.requested_from_user_id,
        };
      },
      listForAction: async (executor, tenantId, actionId) => {
        const rows = await executor`
          ${selectApproval(executor)}
           where p.action_id = ${actionId} and p.tenant_id = ${tenantId}
           order by p.requested_at desc, p.id desc
           limit 50`;
        return rows.map(toApproval);
      },
      decide: async (tx, input) => {
        const approved = input.status === "APPROVED" ? input : null;
        const rejected = input.status === "REJECTED" ? input : null;
        const revoked = input.status === "REVOKED" ? input : null;
        const rows = await tx.sql`
          update q_runtime.approvals p
             set status = ${input.status},
                 approved_at = ${approved?.approvedAt ?? null}::text::timestamptz,
                 approved_by_user_id = ${approved?.approvedByUserId ?? null}::uuid,
                 approval_payload_hash = ${approved?.approvalPayloadHash ?? null}::text,
                 rejected_at = ${rejected?.rejectedAt ?? null}::text::timestamptz,
                 rejected_by_user_id = ${rejected?.rejectedByUserId ?? null}::uuid,
                 rejection_reason = ${rejected?.rejectionReason ?? null}::text,
                 revoked_at = ${revoked?.revokedAt ?? null}::text::timestamptz,
                 revoked_by_user_id = ${revoked?.revokedByUserId ?? null}::uuid,
                 version = p.version + 1
           where p.id = ${input.approvalId}
             and p.tenant_id = ${input.tenantId}
             and p.version = ${input.expectedVersion}
             and p.status = 'PENDING'
          returning p.id`;
        if (rows.length === 0) {
          return null;
        }
        return findApproval(tx.sql, input.tenantId, input.approvalId);
      },
    },
  };
}
