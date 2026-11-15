import {
  settledChatNotices,
  settledProposalNotices,
} from "@capital-q/communication";
import type { DatabaseExecutor } from "@capital-q/database";
import { settledDataRoomRequestNotices } from "@capital-q/evidence";
import {
  settledDiligenceRequestNotices,
  settledInterestNotices,
} from "@capital-q/network";
import { settledApprovalCardNotices } from "@capital-q/q-actions";

/**
 * Live check 15 Nov 2026 (O1): one "still needed" read for every surface
 * that presents what needs the person -- the web's Needs you list and its
 * badge count (api), Q's account digest and attention report, and the
 * voice opener (q-api) -- so they never disagree about a notice.
 *
 * A notice that asks for an action is history, written once when
 * something asked; whether it still asks is its subject's current state.
 * Each NEEDS_YOU kind declares its check here, each read through the
 * owning context's own export (communication: proposals and chat;
 * network: interests and document requests; evidence: data-room
 * requests; q-actions: approval cards). A kind with no check is shown as
 * before. Reading at the moment of asking covers every way the state can
 * move and notices written before the check existed, without a sweep.
 */

/** One unread NEEDS_YOU notice, as its "still needed" check reads it. */
export type NeedsYouNotice = {
  readonly id: string;
  readonly userId: string;
  readonly dedupeKey: string;
};

/**
 * Ids of the given notices whose subject no longer waits on the person. A
 * notice it cannot place is not returned: unknown stays shown.
 */
export type NoticeSettledCheck = (
  notices: readonly NeedsYouNotice[],
) => Promise<ReadonlySet<string>>;

export type NeedsYouChecks = Readonly<
  Record<string, readonly NoticeSettledCheck[]>
>;

export function needsYouChecks(sql: DatabaseExecutor): NeedsYouChecks {
  return {
    TIME_PROPOSED: [(notices) => settledProposalNotices(sql, notices)],
    CHAT_MESSAGE: [(notices) => settledChatNotices(sql, notices)],
    INTEREST_RECEIVED: [(notices) => settledInterestNotices(sql, notices)],
    CONNECTION_REQUESTED: [(notices) => settledInterestNotices(sql, notices)],
    DILIGENCE: [
      (notices) => settledDiligenceRequestNotices(sql, notices),
      (notices) => settledDataRoomRequestNotices(sql, notices),
    ],
    // "X is waiting for your yes": settled once the card is answered,
    // withdrawn or expired (no longer PENDING).
    Q_WORK: [(notices) => settledApprovalCardNotices(sql, notices)],
  };
}

/** Ids of the given notices whose subject is settled; a failing check throws. */
export async function settledNeedsYouIds(
  rows: readonly (NeedsYouNotice & { readonly kind: string })[],
  checks: NeedsYouChecks,
): Promise<ReadonlySet<string>> {
  const byKind = new Map<string, NeedsYouNotice[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }
  const settled = new Set<string>();
  await Promise.all(
    [...byKind].flatMap(([kind, notices]) =>
      (checks[kind] ?? []).map(async (check) => {
        for (const id of await check(notices)) settled.add(id);
      }),
    ),
  );
  return settled;
}

/** The notices still needed, in their order; a failing check throws. */
export async function stillNeededNotices<
  T extends NeedsYouNotice & { readonly kind: string },
>(rows: readonly T[], checks: NeedsYouChecks): Promise<readonly T[]> {
  const settled = await settledNeedsYouIds(rows, checks);
  return rows.filter((row) => !settled.has(row.id));
}

/** How many unread NEEDS_YOU notices one read considers (newest first). */
export const NEEDS_YOU_READ_LIMIT = 200;

/**
 * The person's unread NEEDS_YOU notices whose subject no longer waits on
 * them, by id: what every surface leaves out of "needs you" and its
 * count. Their own rows only (user id). Bounded to the newest
 * NEEDS_YOU_READ_LIMIT; an older one is left as it is (shown).
 */
export function createNeedsYouCurrency(dependencies: {
  readonly sql: DatabaseExecutor;
  /** Per NEEDS_YOU kind; default: needsYouChecks over the same sql. */
  readonly checks?: NeedsYouChecks | undefined;
}): {
  readonly checks: NeedsYouChecks;
  readonly settledUnread: (userId: string) => Promise<ReadonlySet<string>>;
} {
  const { sql } = dependencies;
  const checks = dependencies.checks ?? needsYouChecks(sql);
  return {
    checks,
    settledUnread: async (userId) => {
      const rows = await sql<
        { id: string; kind: string; dedupe_key: string }[]
      >`
        select id, kind, dedupe_key
          from communication.notifications
         where user_id = ${userId}
           and read_at is null
           and priority = 'NEEDS_YOU'
         order by created_at desc
         limit ${NEEDS_YOU_READ_LIMIT}`;
      return settledNeedsYouIds(
        rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          userId,
          dedupeKey: row.dedupe_key,
        })),
        checks,
      );
    },
  };
}
