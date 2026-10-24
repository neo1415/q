import {
  WorkforceJobStartPayloadSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  planShape,
  WORKFORCE_JOB_START,
  type WaitingItem,
} from "./job-actions.js";

/**
 * S9b's proposal (2026-10-24): "is this already waiting?" is decided by
 * structure, never words. Each waiting job card's own plan -- the exact
 * payload the person would approve -- is read here, as its approver and
 * only theirs, and reduced to its shape (outward actions, records). The
 * payload itself never leaves this function: it is server-only material.
 */
export async function withWaitingPlans<
  T extends WaitingItem & { readonly approvalId: string },
>(
  sql: DatabaseExecutor,
  actor: ActorContext,
  waiting: readonly T[],
): Promise<readonly (T & WaitingItem)[]> {
  const ids = waiting
    .filter((item) => item.actionType === WORKFORCE_JOB_START)
    .map((item) => item.approvalId);
  if (ids.length === 0) return waiting;
  const rows = await sql<
    { readonly approval_id: string; readonly payload: unknown }[]
  >`
    select p.id::text as approval_id, a.proposed_payload as payload
      from q_runtime.approvals p
      join q_runtime.actions a
        on a.id = p.action_id and a.tenant_id = p.tenant_id
     where p.tenant_id = ${actor.tenantId}
       and p.requested_from_user_id = ${actor.userId}
       and p.status = 'PENDING'
       and a.action_type = ${WORKFORCE_JOB_START}
       and p.id::text = any(${ids})`;
  const shapes = new Map(
    rows.flatMap((row) => {
      const parsed = WorkforceJobStartPayloadSchema.safeParse(row.payload);
      return parsed.success && parsed.data.ownerUserId === actor.userId
        ? [[row.approval_id, planShape(parsed.data, [] as QSubjectRef[])]]
        : [];
    }),
  );
  return waiting.map((item) => {
    const plan = shapes.get(item.approvalId);
    return plan === undefined ? item : { ...item, plan };
  });
}
