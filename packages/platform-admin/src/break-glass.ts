import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";
import { ADMIN_PERMISSIONS, BREAK_GLASS_MINUTES } from "./permissions.js";

/**
 * Break-glass (spec §4, ADR 0033 §4): private content -- a relationship's
 * chat or a Q run's words -- is redacted from every operator until a
 * stated reason has been approved by a second person. SOLO approval exists
 * only while no other eligible approver does, and is marked everywhere.
 * The window is 30 minutes; only the requester reads; every read is logged.
 */

export type BreakGlassTarget = "RELATIONSHIP_CHAT" | "Q_RUN";

export type BreakGlassRow = {
  readonly requestId: string;
  readonly requesterUserId: string;
  readonly requesterName: string | null;
  readonly targetType: BreakGlassTarget;
  readonly targetId: string;
  readonly targetLabel: string | null;
  readonly reason: string;
  readonly status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
  readonly approvalKind: "SECOND_PERSON" | "SOLO" | null;
  readonly decidedByName: string | null;
  readonly decisionNote: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly reads: number;
  /** The caller may decide it, and how. */
  readonly canDecide: "SECOND_PERSON" | "SOLO" | null;
};

const APPROVER_ROLES = ADMIN_PERMISSIONS["breakglass.approve"].roles;

async function otherApprovers(
  sql: DatabaseExecutor,
  userId: string,
): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from identity.platform_admins
     where user_id <> ${userId} and role = any(${[...APPROVER_ROLES]}::text[])`;
  return row?.n ?? 0;
}

export async function listBreakGlass(
  sql: DatabaseExecutor,
  grant: AdminGrant,
): Promise<readonly BreakGlassRow[]> {
  const others = await otherApprovers(sql, grant.userId);
  const mayApprove = (APPROVER_ROLES as readonly string[]).includes(grant.role);
  const rows = await sql<
    {
      id: string;
      requester_user_id: string;
      requester_name: string | null;
      target_type: BreakGlassTarget;
      target_id: string;
      target_label: string | null;
      reason: string;
      status: "PENDING" | "APPROVED" | "DENIED";
      approval_kind: "SECOND_PERSON" | "SOLO" | null;
      decided_by_name: string | null;
      decision_note: string | null;
      expires_at: Date | null;
      expired: boolean;
      created_at: Date;
      reads: number;
    }[]
  >`
    select b.id, b.requester_user_id, rp.display_name as requester_name,
           b.target_type, b.target_id,
           case when b.target_type = 'RELATIONSHIP_CHAT' then
             (select c.canonical_name || ' ↔ ' || io.display_name
                from network.relationships r
                join core.companies c on c.id = r.company_id
                join core.investor_organisations io on io.id = r.investor_organisation_id
               where r.id = b.target_id)
           else
             (select 'Q run · ' || lower(q.capability) from q_runtime.runs q where q.id = b.target_id)
           end as target_label,
           b.reason, b.status, b.approval_kind, dp.display_name as decided_by_name,
           b.decision_note, b.expires_at,
           (b.status = 'APPROVED' and b.expires_at <= clock_timestamp()) as expired,
           b.created_at,
           (select count(*)::int from platform_ops.break_glass_reads x where x.request_id = b.id) as reads
      from platform_ops.break_glass_requests b
      join identity.user_profiles rp on rp.id = b.requester_user_id
      left join identity.user_profiles dp on dp.id = b.decided_by_user_id
     where b.status = 'PENDING' or b.created_at > clock_timestamp() - interval '30 days'
     order by (b.status = 'PENDING') desc, b.created_at desc
     limit 100`;
  return rows.map((row) => {
    let canDecide: "SECOND_PERSON" | "SOLO" | null = null;
    if (row.status === "PENDING" && mayApprove) {
      if (row.requester_user_id !== grant.userId) canDecide = "SECOND_PERSON";
      else if (others === 0) canDecide = "SOLO";
    }
    return {
      requestId: row.id,
      requesterUserId: row.requester_user_id,
      requesterName: row.requester_name,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label,
      reason: row.reason,
      status: row.expired ? "EXPIRED" : row.status,
      approvalKind: row.approval_kind,
      decidedByName: row.decided_by_name,
      decisionNote: row.decision_note,
      expiresAt:
        row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      reads: row.reads,
      canDecide,
    };
  });
}

export async function requestBreakGlass(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly targetType: BreakGlassTarget;
    readonly targetId: string;
    readonly reason: string;
  },
): Promise<{ readonly requestId: string } | null> {
  return transactions.run(async (tx) => {
    const exists =
      input.targetType === "RELATIONSHIP_CHAT"
        ? await tx.sql<{ one: number }[]>`
            select 1 as one from network.relationships where id = ${input.targetId}`
        : await tx.sql<{ one: number }[]>`
            select 1 as one from q_runtime.runs where id = ${input.targetId}`;
    if (exists.length === 0) return null;
    const [row] = await tx.sql<{ id: string }[]>`
      insert into platform_ops.break_glass_requests
        (requester_user_id, target_type, target_id, reason)
      values (${grant.userId}, ${input.targetType}, ${input.targetId}, ${input.reason})
      returning id`;
    if (row === undefined) return null;
    await recordAdminAction(tx.sql, grant, {
      actionType: "breakglass.requested",
      resourceType: "break_glass_request",
      resourceId: row.id,
      reason: input.reason,
      breakGlassId: row.id,
      metadata: { targetType: input.targetType, targetId: input.targetId },
    });
    return { requestId: row.id };
  });
}

export type BreakGlassDecision =
  | { readonly kind: "DECIDED"; readonly status: "APPROVED" | "DENIED" }
  | { readonly kind: "NOT_FOUND" }
  /** The requester cannot decide while another eligible approver exists. */
  | { readonly kind: "SECOND_PERSON_REQUIRED" };

export async function decideBreakGlass(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly requestId: string;
    readonly approve: boolean;
    readonly note: string;
  },
): Promise<BreakGlassDecision> {
  return transactions.run(async (tx): Promise<BreakGlassDecision> => {
    const [request] = await tx.sql<
      { requester_user_id: string; status: string }[]
    >`
      select requester_user_id, status from platform_ops.break_glass_requests
       where id = ${input.requestId} for update`;
    if (request === undefined || request.status !== "PENDING") {
      return { kind: "NOT_FOUND" };
    }
    let kind: "SECOND_PERSON" | "SOLO" = "SECOND_PERSON";
    if (request.requester_user_id === grant.userId) {
      if (!input.approve || (await otherApprovers(tx.sql, grant.userId)) > 0) {
        return { kind: "SECOND_PERSON_REQUIRED" };
      }
      kind = "SOLO";
    }
    if (input.approve) {
      await tx.sql`
        update platform_ops.break_glass_requests b
           set status = 'APPROVED', approval_kind = ${kind},
               decided_by_user_id = ${grant.userId}, decided_at = t.at,
               decision_note = ${input.note},
               expires_at = t.at + make_interval(mins => ${BREAK_GLASS_MINUTES})
          from (select clock_timestamp() as at) t
         where b.id = ${input.requestId}`;
    } else {
      await tx.sql`
        update platform_ops.break_glass_requests
           set status = 'DENIED', decided_by_user_id = ${grant.userId},
               decided_at = clock_timestamp(), decision_note = ${input.note}
         where id = ${input.requestId}`;
    }
    await recordAdminAction(tx.sql, grant, {
      actionType: input.approve ? "breakglass.approved" : "breakglass.denied",
      resourceType: "break_glass_request",
      resourceId: input.requestId,
      reason: input.note,
      breakGlassId: input.requestId,
      metadata: input.approve ? { approvalKind: kind } : {},
    });
    return {
      kind: "DECIDED",
      status: input.approve ? "APPROVED" : "DENIED",
    };
  });
}

/** The caller's own live approval for exactly this target, or null. */
export async function activeBreakGlass(
  sql: DatabaseExecutor,
  userId: string,
  targetType: BreakGlassTarget,
  targetId: string,
): Promise<{ readonly requestId: string; readonly expiresAt: string } | null> {
  const rows = await sql<{ id: string; expires_at: Date }[]>`
    select id, expires_at from platform_ops.break_glass_requests
     where requester_user_id = ${userId} and target_type = ${targetType}
       and target_id = ${targetId} and status = 'APPROVED'
       and expires_at > clock_timestamp()
     order by expires_at desc limit 1`;
  const row = rows[0];
  return row === undefined
    ? null
    : { requestId: row.id, expiresAt: new Date(row.expires_at).toISOString() };
}

export async function logBreakGlassRead(
  sql: DatabaseExecutor,
  grant: AdminGrant,
  requestId: string,
  items: number,
  actionType: string,
): Promise<void> {
  await sql`
    insert into platform_ops.break_glass_reads (request_id, reader_user_id, items)
    values (${requestId}, ${grant.userId}, ${items})`;
  await recordAdminAction(sql, grant, {
    actionType,
    resourceType: "break_glass_request",
    resourceId: requestId,
    breakGlassId: requestId,
    metadata: { items },
  });
}

export type BreakGlassChat = {
  readonly requestId: string;
  readonly expiresAt: string;
  readonly reason: string;
  readonly companyName: string;
  readonly investorName: string;
  readonly messages: readonly {
    readonly messageId: string;
    readonly senderName: string | null;
    readonly side: string;
    readonly kind: string;
    readonly body: string | null;
    readonly attachmentTitle: string | null;
    readonly at: string;
  }[];
};

/** Reads a chat under the caller's own live approval, logging the read. */
export async function readChatUnderBreakGlass(
  transactions: TransactionManager,
  grant: AdminGrant,
  requestId: string,
): Promise<BreakGlassChat | null> {
  return transactions.run(async (tx) => {
    const [request] = await tx.sql<
      { target_id: string; reason: string; expires_at: Date }[]
    >`
      select target_id, reason, expires_at from platform_ops.break_glass_requests
       where id = ${requestId} and requester_user_id = ${grant.userId}
         and target_type = 'RELATIONSHIP_CHAT' and status = 'APPROVED'
         and expires_at > clock_timestamp()`;
    if (request === undefined) return null;
    const [names] = await tx.sql<{ company: string; investor: string }[]>`
      select c.canonical_name as company, io.display_name as investor
        from network.relationships r
        join core.companies c on c.id = r.company_id
        join core.investor_organisations io on io.id = r.investor_organisation_id
       where r.id = ${request.target_id}`;
    const messages = await tx.sql<
      {
        id: string;
        sender: string | null;
        sender_side: string;
        kind: string;
        body: string | null;
        attachment_title: string | null;
        created_at: Date;
      }[]
    >`
      select m.id, p.display_name as sender, m.sender_side, m.kind, m.body,
             m.attachment_title, m.created_at
        from communication.messages m
        join communication.conversations c on c.id = m.conversation_id
        left join identity.user_profiles p on p.id = m.sender_user_id
       where c.relationship_id = ${request.target_id}
       order by m.created_at desc
       limit 200`;
    await logBreakGlassRead(
      tx.sql,
      grant,
      requestId,
      messages.length,
      "breakglass.chat.read",
    );
    return {
      requestId,
      expiresAt: new Date(request.expires_at).toISOString(),
      reason: request.reason,
      companyName: names?.company ?? "—",
      investorName: names?.investor ?? "—",
      messages: messages.reverse().map((m) => ({
        messageId: m.id,
        senderName: m.sender,
        side: m.sender_side,
        kind: m.kind,
        body: m.body,
        attachmentTitle: m.attachment_title,
        at: new Date(m.created_at).toISOString(),
      })),
    };
  });
}
