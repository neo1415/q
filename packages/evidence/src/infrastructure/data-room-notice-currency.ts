import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Live check 15 Nov 2026 (O1): a data-room access request's NEEDS_YOU
 * notice (`diligence:<request id>`) still asks the founder only while the
 * request has no decision. Returns the ids of the given notices whose
 * request was approved or declined; any other key is left alone.
 */
const KEY =
  /^diligence:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;

export async function settledDataRoomRequestNotices(
  sql: DatabaseExecutor,
  notices: readonly {
    readonly id: string;
    readonly userId: string;
    readonly dedupeKey: string;
  }[],
): Promise<ReadonlySet<string>> {
  const parsed = notices.flatMap((notice) => {
    const subject = KEY.exec(notice.dedupeKey)?.[1];
    return subject === undefined
      ? []
      : [{ id: notice.id, subject: subject.toLowerCase() }];
  });
  if (parsed.length === 0) return new Set();
  const rows = await sql<{ request_id: string }[]>`
    select k.request_id
      from evidence.data_room_request_decisions k
     where k.request_id = any(${[...new Set(parsed.map((one) => one.subject))]}::uuid[])`;
  const decided = new Set(rows.map((row) => row.request_id));
  return new Set(
    parsed.filter((one) => decided.has(one.subject)).map((one) => one.id),
  );
}
