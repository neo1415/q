import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Live check 15 Nov 2026 (O1): a Q_WORK "X is waiting for your yes" notice
 * (`instr:<instruction id>:card-waiting:<approval id>`) still asks only
 * while its approval card is PENDING. Returns the ids of the given notices
 * whose card was answered, withdrawn or expired; a notice it cannot place
 * is not returned (unknown stays shown). Notices are never changed.
 */
export type ApprovalNoticeToCheck = {
  readonly id: string;
  readonly userId: string;
  readonly dedupeKey: string;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CARD_WAITING_KEY = new RegExp(
  `^instr:${UUID}:card-waiting:(${UUID})$`,
  "iu",
);

export async function settledApprovalCardNotices(
  sql: DatabaseExecutor,
  notices: readonly ApprovalNoticeToCheck[],
): Promise<ReadonlySet<string>> {
  const parsed = notices.flatMap((notice) => {
    const approvalId = CARD_WAITING_KEY.exec(notice.dedupeKey)?.[1];
    return approvalId === undefined
      ? []
      : [{ ...notice, approvalId: approvalId.toLowerCase() }];
  });
  if (parsed.length === 0) return new Set<string>();
  const rows = await sql<{ id: string }[]>`
    select n.id
      from unnest(${parsed.map((one) => one.id)}::uuid[],
                  ${parsed.map((one) => one.userId)}::uuid[],
                  ${parsed.map((one) => one.approvalId)}::uuid[])
             as n(id, user_id, approval_id)
      join q_runtime.approvals a on a.id = n.approval_id
     where a.status <> 'PENDING'`;
  return new Set(rows.map((row) => row.id));
}
