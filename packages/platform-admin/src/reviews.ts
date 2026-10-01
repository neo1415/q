import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";

/**
 * Appeals Stage 4 — human review (PADL #050; spec
 * docs/specs/2026-10/admin-escalation-kyb.md). A person asks a Capital Q
 * operator to look again at something Capital Q or Q decided. The case
 * keeps a reference to what is under review and the person's own reason,
 * never a copy of private data. It is decided once, with a reason; the
 * person is told through a "Needs you" notice (pushed, then emailed if
 * unread, by the existing delivery).
 */

export const REVIEW_SUBJECTS = [
  "READINESS_ASSESSMENT",
  "VERIFICATION_DECISION",
  "ACCOUNT_ACTION",
  "Q_ASSESSMENT",
  "OTHER",
] as const;
export type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];

export const REVIEW_DECISIONS = [
  "UPHELD",
  "CHANGED",
  "NEEDS_EVIDENCE",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** The service level: an operator decides within 3 days. */
export const REVIEW_SLA_HOURS = 72;
/** Open cases one person may hold at once. */
export const MAX_OPEN_REVIEWS = 5;

const SUBJECT_REF = /^[A-Za-z0-9_:.-]{1,200}$/;

export type ReviewRequester = {
  readonly tenantId: string;
  readonly userId: string;
  readonly organisationId?: string | undefined;
};

export type OwnReview = {
  readonly reviewId: string;
  readonly subjectType: ReviewSubject;
  readonly subjectRef: string | null;
  readonly reason: string;
  readonly source: "APP" | "Q";
  readonly status: "OPEN" | "DECIDED";
  readonly outcome: ReviewDecision | null;
  readonly decisionReason: string | null;
  readonly dueAt: string;
  readonly decidedAt: string | null;
  readonly createdAt: string;
};

export type RequestReviewOutcome =
  | { readonly kind: "CREATED" | "REPLAYED"; readonly review: OwnReview }
  | { readonly kind: "TOO_MANY_OPEN" }
  | { readonly kind: "INVALID" };

type Row = {
  id: string;
  subject_type: ReviewSubject;
  subject_ref: string | null;
  reason: string;
  source: "APP" | "Q";
  status: "OPEN" | "DECIDED";
  outcome: ReviewDecision | null;
  decision_reason: string | null;
  due_at: Date;
  decided_at: Date | null;
  created_at: Date;
};

function own(row: Row): OwnReview {
  return {
    reviewId: row.id,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    reason: row.reason,
    source: row.source,
    status: row.status,
    outcome: row.outcome,
    decisionReason: row.decision_reason,
    dueAt: new Date(row.due_at).toISOString(),
    decidedAt:
      row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * The person's own request. Who they are comes from their server-resolved
 * context only. A replay with the same key returns the same case.
 */
export async function requestReview(
  transactions: TransactionManager,
  requester: ReviewRequester,
  input: {
    readonly subjectType: ReviewSubject;
    readonly subjectRef: string | null;
    readonly reason: string;
    readonly idempotencyKey: string;
    readonly source?: "APP" | "Q" | undefined;
    readonly qActionId?: string | null | undefined;
  },
): Promise<RequestReviewOutcome> {
  const reason = input.reason.trim();
  if (
    !(REVIEW_SUBJECTS as readonly string[]).includes(input.subjectType) ||
    reason.length < 10 ||
    reason.length > 2000 ||
    (input.subjectRef !== null && !SUBJECT_REF.test(input.subjectRef))
  ) {
    return { kind: "INVALID" };
  }
  const source = input.source ?? "APP";
  return transactions.run(async (tx): Promise<RequestReviewOutcome> => {
    // One person's requests are serialised so the open-case limit holds.
    await tx.sql`select pg_advisory_xact_lock(hashtext(${`human_reviews:${requester.userId}`}))`;
    const existing = await tx.sql<Row[]>`
      select id, subject_type, subject_ref, reason, source, status, outcome,
             decision_reason, due_at, decided_at, created_at from core.human_reviews
       where requester_user_id = ${requester.userId}
         and idempotency_key = ${input.idempotencyKey}`;
    if (existing[0] !== undefined) {
      return { kind: "REPLAYED", review: own(existing[0]) };
    }
    const [open] = await tx.sql<{ n: number }[]>`
      select count(*)::int as n from core.human_reviews
       where requester_user_id = ${requester.userId} and status = 'OPEN'`;
    if ((open?.n ?? 0) >= MAX_OPEN_REVIEWS) return { kind: "TOO_MANY_OPEN" };
    const [row] = await tx.sql<Row[]>`
      insert into core.human_reviews
        (tenant_id, organisation_id, requester_user_id, subject_type, subject_ref,
         reason, source, q_action_id, due_at, idempotency_key)
      values (${requester.tenantId}, ${requester.organisationId ?? null},
              ${requester.userId}, ${input.subjectType}, ${input.subjectRef},
              ${reason}, ${source}, ${source === "Q" ? (input.qActionId ?? null) : null},
              clock_timestamp() + make_interval(hours => ${REVIEW_SLA_HOURS}),
              ${input.idempotencyKey})
      returning id, subject_type, subject_ref, reason, source, status, outcome,
             decision_reason, due_at, decided_at, created_at`;
    if (row === undefined) return { kind: "INVALID" };
    return { kind: "CREATED", review: own(row) };
  });
}

export async function ownReviews(
  sql: DatabaseExecutor,
  userId: string,
): Promise<readonly OwnReview[]> {
  const rows = await sql<Row[]>`
    select id, subject_type, subject_ref, reason, source, status, outcome,
             decision_reason, due_at, decided_at, created_at from core.human_reviews
     where requester_user_id = ${userId}
     order by created_at desc limit 50`;
  return rows.map(own);
}

// --- console ------------------------------------------------------------------

export type ReviewQueueRow = OwnReview & {
  readonly requesterUserId: string;
  readonly requesterName: string | null;
  readonly organisationName: string | null;
  readonly overdue: boolean;
  readonly decidedByName: string | null;
};

export async function reviewQueue(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  options: { readonly includeDecided: boolean },
): Promise<readonly ReviewQueueRow[]> {
  const rows = await sql<
    (Row & {
      requester_user_id: string;
      requester_name: string | null;
      organisation_name: string | null;
      overdue: boolean;
      decided_by_name: string | null;
    })[]
  >`
    select h.id, h.subject_type, h.subject_ref, h.reason, h.source, h.status,
           h.outcome, h.decision_reason, h.due_at, h.decided_at, h.created_at,
           h.requester_user_id, p.display_name as requester_name,
           o.display_name as organisation_name,
           (h.status = 'OPEN' and h.due_at < clock_timestamp()) as overdue,
           d.display_name as decided_by_name
      from core.human_reviews h
      join identity.user_profiles p on p.id = h.requester_user_id
      left join identity.organisations o on o.id = h.organisation_id
      left join identity.user_profiles d on d.id = h.decided_by_user_id
     where ${options.includeDecided} or h.status = 'OPEN'
     order by (h.status = 'OPEN') desc, h.due_at, h.created_at
     limit 200`;
  return rows.map((row) => ({
    ...own(row),
    requesterUserId: row.requester_user_id,
    requesterName: row.requester_name,
    organisationName: row.organisation_name,
    overdue: row.overdue,
    decidedByName: row.decided_by_name,
  }));
}

export type DecideReviewOutcome =
  | { readonly kind: "DECIDED" }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "SELF" };

const OUTCOME_WORDS: Readonly<Record<ReviewDecision, string>> = {
  UPHELD: "The decision stands",
  CHANGED: "The decision was changed",
  NEEDS_EVIDENCE: "More evidence is needed",
};

export async function decideReview(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly reviewId: string;
    readonly outcome: ReviewDecision;
    readonly reason: string;
  },
): Promise<DecideReviewOutcome> {
  return transactions.run(async (tx): Promise<DecideReviewOutcome> => {
    const [row] = await tx.sql<
      { tenant_id: string; requester_user_id: string; status: string }[]
    >`
      select tenant_id, requester_user_id, status from core.human_reviews
       where id = ${input.reviewId} for update`;
    if (row === undefined || row.status !== "OPEN")
      return { kind: "NOT_FOUND" };
    if (row.requester_user_id === grant.userId) return { kind: "SELF" };
    await tx.sql`
      update core.human_reviews
         set status = 'DECIDED', outcome = ${input.outcome},
             decision_reason = ${input.reason}, decided_by_user_id = ${grant.userId},
             decided_at = clock_timestamp()
       where id = ${input.reviewId}`;
    await recordAdminAction(tx.sql, grant, {
      actionType: "review.decided",
      resourceType: "human_review",
      resourceId: input.reviewId,
      reason: input.reason,
      metadata: { outcome: input.outcome },
    });
    await tx.sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
      values (${row.tenant_id}, ${row.requester_user_id}, 'HUMAN_REVIEW',
              ${`Your review is decided: ${OUTCOME_WORDS[input.outcome].toLowerCase()}`},
              ${input.reason.slice(0, 1000)}, '/reviews',
              ${`review:${input.reviewId}:decided`}, 'NEEDS_YOU')
      on conflict (user_id, dedupe_key) do nothing`;
    return { kind: "DECIDED" };
  });
}
