import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Live check 15 Nov 2026 (O1): whether a NEEDS_YOU notice the network
 * context asked for still waits on the person, read from its own rows.
 * Returns the ids of the given notices whose subject is settled; a subject
 * that cannot be found is not returned (unknown stays shown).
 */

export type NetworkNoticeToCheck = {
  readonly id: string;
  readonly userId: string;
  readonly dedupeKey: string;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const INTEREST_KEY = new RegExp(
  `^(?:interest_received|connection_requested):(${UUID})$`,
  "iu",
);
const DILIGENCE_KEY = new RegExp(`^diligence:(${UUID})$`, "iu");

function keyed(
  notices: readonly NetworkNoticeToCheck[],
  pattern: RegExp,
): { readonly id: string; readonly subject: string }[] {
  return notices.flatMap((notice) => {
    const subject = pattern.exec(notice.dedupeKey)?.[1];
    return subject === undefined
      ? []
      : [{ id: notice.id, subject: subject.toLowerCase() }];
  });
}

/**
 * INTEREST_RECEIVED / CONNECTION_REQUESTED (`<kind>:<interest id>`):
 * settled once the interest was answered (accepted or declined) or
 * withdrawn.
 */
export async function settledInterestNotices(
  sql: DatabaseExecutor,
  notices: readonly NetworkNoticeToCheck[],
): Promise<ReadonlySet<string>> {
  const parsed = keyed(notices, INTEREST_KEY);
  if (parsed.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    select i.id
      from network.interests i
     where i.id = any(${[...new Set(parsed.map((one) => one.subject))]}::uuid[])
       and (i.status = 'WITHDRAWN'
            or exists (select 1 from network.interest_responses r
                        where r.interest_id = i.id))`;
  const closed = new Set(rows.map((row) => row.id));
  return new Set(
    parsed.filter((one) => closed.has(one.subject)).map((one) => one.id),
  );
}

/**
 * DILIGENCE (`diligence:<request id>`) for a document request: settled
 * once it was fulfilled or declined. Keys naming anything else (a data
 * room request, a question set) are not this function's to settle.
 */
export async function settledDiligenceRequestNotices(
  sql: DatabaseExecutor,
  notices: readonly NetworkNoticeToCheck[],
): Promise<ReadonlySet<string>> {
  const parsed = keyed(notices, DILIGENCE_KEY);
  if (parsed.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    select q.id
      from network.diligence_requests q
     where q.id = any(${[...new Set(parsed.map((one) => one.subject))]}::uuid[])
       and (exists (select 1 from network.diligence_fulfilments f
                     where f.request_id = q.id)
            or exists (select 1 from network.diligence_request_declines d
                        where d.request_id = q.id))`;
  const closed = new Set(rows.map((row) => row.id));
  return new Set(
    parsed.filter((one) => closed.has(one.subject)).map((one) => one.id),
  );
}
