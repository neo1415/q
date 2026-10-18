import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";
import { isSuspended } from "./accounts.js";

/**
 * Trust & safety (spec §4): R34 reports and blocks from chat. The queue
 * shows who reported what and why -- never the conversation; reading it
 * needs break-glass. A review appends to `platform_ops.report_reviews`; an
 * ACCOUNT_SUSPENDED review suspends one named member of the reported side
 * in the same transaction.
 */

export const REVIEW_OUTCOMES = [
  "NO_ACTION",
  "WARNED",
  "ACCOUNT_SUSPENDED",
  "ESCALATED",
] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export type SafetyReportRow = {
  readonly reportId: string;
  readonly relationshipId: string;
  readonly companyName: string;
  readonly investorName: string;
  readonly reporterSide: "COMPANY" | "INVESTOR";
  readonly reporterName: string | null;
  readonly reasonCode: string;
  readonly reasonLabel: string;
  readonly note: string | null;
  readonly aboutMessage: boolean;
  readonly createdAt: string;
  readonly review: {
    readonly outcome: ReviewOutcome;
    readonly note: string;
    readonly reviewerName: string | null;
    readonly at: string;
  } | null;
  /** Active members of the reported side, for an ACCOUNT_SUSPENDED review. */
  readonly reportedMembers: readonly {
    readonly userId: string;
    readonly name: string | null;
  }[];
};

export type BlockRow = {
  readonly blockId: string;
  readonly relationshipId: string;
  readonly companyName: string;
  readonly investorName: string;
  readonly blockerSide: "COMPANY" | "INVESTOR";
  readonly createdAt: string;
};

export async function safetyQueue(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  options: { readonly includeReviewed: boolean },
): Promise<{
  readonly reports: readonly SafetyReportRow[];
  readonly blocks: readonly BlockRow[];
}> {
  const reports = await sql<
    {
      id: string;
      relationship_id: string;
      company_name: string;
      investor_name: string;
      company_org: string;
      investor_org: string;
      reporter_org: string;
      reporter_name: string | null;
      reason_code: string;
      reason_label: string;
      note: string | null;
      message_id: string | null;
      created_at: Date;
      review_outcome: ReviewOutcome | null;
      review_note: string | null;
      reviewer_name: string | null;
      reviewed_at: Date | null;
    }[]
  >`
    select r.id, r.relationship_id, c.canonical_name as company_name,
           io.display_name as investor_name, c.organisation_id as company_org,
           io.organisation_id as investor_org, r.reporter_organisation_id as reporter_org,
           rp.display_name as reporter_name, r.reason_code, rr.label as reason_label,
           r.note, r.message_id, r.created_at,
           rv.outcome as review_outcome, rv.note as review_note,
           vp.display_name as reviewer_name, rv.occurred_at as reviewed_at
      from communication.reports r
      join communication.report_reasons rr on rr.code = r.reason_code
      join network.relationships rel on rel.id = r.relationship_id
      join core.companies c on c.id = rel.company_id
      join core.investor_organisations io on io.id = rel.investor_organisation_id
      join identity.user_profiles rp on rp.id = r.reporter_user_id
      left join lateral (
        select x.outcome, x.note, x.occurred_at, x.reviewer_user_id
          from platform_ops.report_reviews x
         where x.report_id = r.id
         order by x.occurred_at desc, x.id desc limit 1) rv on true
      left join identity.user_profiles vp on vp.id = rv.reviewer_user_id
     where ${options.includeReviewed} or rv.outcome is null or rv.outcome = 'ESCALATED'
     order by r.created_at
     limit 200`;
  const reportedOrgs = [
    ...new Set(
      reports.map((r) =>
        r.reporter_org === r.company_org ? r.investor_org : r.company_org,
      ),
    ),
  ];
  const members =
    reportedOrgs.length === 0
      ? []
      : await sql<
          {
            organisation_id: string;
            user_id: string;
            display_name: string | null;
          }[]
        >`
          select m.organisation_id, m.user_id, p.display_name
            from identity.organisation_memberships m
            join identity.user_profiles p on p.id = m.user_id
           where m.organisation_id = any(${reportedOrgs}::uuid[])
             and m.membership_status = 'active'
           order by m.created_at`;
  const blocks = await sql<
    {
      id: string;
      relationship_id: string;
      company_name: string;
      investor_name: string;
      blocker_side: "COMPANY" | "INVESTOR";
      created_at: Date;
    }[]
  >`
    select b.id, b.relationship_id, c.canonical_name as company_name,
           io.display_name as investor_name, b.blocker_side, b.created_at
      from communication.blocks b
      join network.relationships rel on rel.id = b.relationship_id
      join core.companies c on c.id = rel.company_id
      join core.investor_organisations io on io.id = rel.investor_organisation_id
     where b.lifted_at is null
     order by b.created_at desc
     limit 100`;
  return {
    reports: reports.map((r) => {
      const reported =
        r.reporter_org === r.company_org ? r.investor_org : r.company_org;
      return {
        reportId: r.id,
        relationshipId: r.relationship_id,
        companyName: r.company_name,
        investorName: r.investor_name,
        reporterSide: r.reporter_org === r.company_org ? "COMPANY" : "INVESTOR",
        reporterName: r.reporter_name,
        reasonCode: r.reason_code,
        reasonLabel: r.reason_label,
        note: r.note,
        aboutMessage: r.message_id !== null,
        createdAt: new Date(r.created_at).toISOString(),
        review:
          r.review_outcome === null ||
          r.review_note === null ||
          r.reviewed_at === null
            ? null
            : {
                outcome: r.review_outcome,
                note: r.review_note,
                reviewerName: r.reviewer_name,
                at: new Date(r.reviewed_at).toISOString(),
              },
        reportedMembers: members
          .filter((m) => m.organisation_id === reported)
          .map((m) => ({ userId: m.user_id, name: m.display_name })),
      };
    }),
    blocks: blocks.map((b) => ({
      blockId: b.id,
      relationshipId: b.relationship_id,
      companyName: b.company_name,
      investorName: b.investor_name,
      blockerSide: b.blocker_side,
      createdAt: new Date(b.created_at).toISOString(),
    })),
  };
}

export type ReviewResult =
  | { readonly kind: "REVIEWED" }
  | { readonly kind: "NOT_FOUND" }
  /** ACCOUNT_SUSPENDED needs a member of the reported side (not oneself). */
  | { readonly kind: "INVALID_SUBJECT" };

export async function reviewReport(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly reportId: string;
    readonly outcome: ReviewOutcome;
    readonly note: string;
    readonly suspendUserId: string | null;
  },
): Promise<ReviewResult> {
  return transactions.run(async (tx): Promise<ReviewResult> => {
    const [report] = await tx.sql<
      {
        id: string;
        reporter_org: string;
        company_org: string;
        investor_org: string;
      }[]
    >`
      select r.id, r.reporter_organisation_id as reporter_org,
             c.organisation_id as company_org, io.organisation_id as investor_org
        from communication.reports r
        join network.relationships rel on rel.id = r.relationship_id
        join core.companies c on c.id = rel.company_id
        join core.investor_organisations io on io.id = rel.investor_organisation_id
       where r.id = ${input.reportId}`;
    if (report === undefined) return { kind: "NOT_FOUND" };
    let suspended: string | null = null;
    if (input.outcome === "ACCOUNT_SUSPENDED") {
      const reported =
        report.reporter_org === report.company_org
          ? report.investor_org
          : report.company_org;
      if (
        input.suspendUserId === null ||
        input.suspendUserId === grant.userId
      ) {
        return { kind: "INVALID_SUBJECT" };
      }
      const member = await tx.sql<{ one: number }[]>`
        select 1 as one from identity.organisation_memberships
         where organisation_id = ${reported} and user_id = ${input.suspendUserId}
           and membership_status = 'active'`;
      if (member.length === 0) return { kind: "INVALID_SUBJECT" };
      if (!(await isSuspended(tx.sql, input.suspendUserId))) {
        await tx.sql`
          insert into platform_ops.account_suspensions (user_id, action, reason, actor_user_id)
          values (${input.suspendUserId}, 'SUSPENDED',
                  ${`Safety report ${input.reportId}: ${input.note}`.slice(0, 500)},
                  ${grant.userId})`;
        await recordAdminAction(tx.sql, grant, {
          actionType: "account.suspend",
          resourceType: "user_profile",
          resourceId: input.suspendUserId,
          reason: input.note,
          metadata: { via: `report:${input.reportId}` },
        });
      }
      suspended = input.suspendUserId;
    }
    await tx.sql`
      insert into platform_ops.report_reviews (report_id, reviewer_user_id, outcome, note)
      values (${input.reportId}, ${grant.userId}, ${input.outcome}, ${input.note})`;
    await recordAdminAction(tx.sql, grant, {
      actionType: "safety.report.reviewed",
      resourceType: "chat_report",
      resourceId: input.reportId,
      reason: input.note,
      metadata: { outcome: input.outcome, suspendedUserId: suspended },
    });
    return { kind: "REVIEWED" };
  });
}
