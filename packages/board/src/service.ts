import { z } from "zod";

import {
  BOARD_COLUMNS,
  BOARD_ITEM_LIMIT,
  BoardItemSchema,
  type AddBoardItemRequest,
  type BoardItem,
  type BoardItemStatus,
  type BoardList,
  type MoveBoardItemRequest,
  type UpdateBoardItemRequest,
} from "@capital-q/contracts";
import {
  DatabaseError,
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * The work board's one service (owner 2026-10-23): the page and Q call the
 * same methods, as the signed-in person, so nothing Q does to a board is a
 * different path from their own button.
 *
 * Every change runs in one short transaction that holds the person's board
 * lock, writes the item's next revision and the event that says what
 * changed and who changed it. Nothing here calls the network: a Q job's
 * status comes from the injected port, read before the transaction opens.
 *
 * The owner is always the actor: no method takes a user or tenant id, so an
 * item id that is not theirs is the same NOT_FOUND as one that does not
 * exist.
 */

/** Who made a change: the person, or Q for them (as they asked). */
export type BoardChangedBy = "PERSON" | "Q";

export type BoardRefusal = "NOT_FOUND" | "CONFLICT" | "FULL";

export type BoardOutcome<T> =
  | { readonly outcome: "OK"; readonly value: T; readonly replayed: boolean }
  | { readonly outcome: "REFUSED"; readonly code: BoardRefusal };

/**
 * QA F-117 (25 Oct 2026): the board listed a job that had FAILED under
 * "Doing". What an item's Q job needs from the person, by the job's own
 * status: a stopped or held job is never "Doing". Null: nothing.
 */
export function jobAttention(status: string | undefined): string | null {
  switch (status) {
    case "FAILED":
      return "Q couldn't finish this. Ask Q to try again.";
    case "HELD":
      return "Q is waiting for you on the Work page.";
    case "STOPPED":
      return "This work was stopped.";
    case undefined:
    default:
      return null;
  }
}

/** A Q job's status, as the workforce reads it for the person. */
export type BoardJobStatusPort = (
  actor: ActorContext,
  jobIds: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

export type BoardService = {
  readonly list: (actor: ActorContext) => Promise<BoardList>;
  readonly add: (
    actor: ActorContext,
    request: AddBoardItemRequest,
    options: { readonly by: BoardChangedBy; readonly idempotencyKey: string },
  ) => Promise<BoardOutcome<BoardItem>>;
  readonly update: (
    actor: ActorContext,
    itemId: string,
    request: UpdateBoardItemRequest,
    options: {
      readonly by: BoardChangedBy;
      readonly idempotencyKey?: string | undefined;
    },
  ) => Promise<BoardOutcome<BoardItem>>;
  readonly move: (
    actor: ActorContext,
    itemId: string,
    request: MoveBoardItemRequest,
    options: { readonly by: BoardChangedBy; readonly idempotencyKey: string },
  ) => Promise<BoardOutcome<BoardItem>>;
  /**
   * Q's job now works on this item: it is linked and moves to DOING. The
   * job is the person's own (the table's composite key refuses any other).
   */
  readonly linkJob: (
    actor: ActorContext,
    itemId: string,
    jobId: string,
    options: { readonly idempotencyKey: string },
  ) => Promise<BoardOutcome<BoardItem>>;
};

/** A new column's first item, and the gap left at either end of a column. */
const POSITION_STEP = "1024";

const ItemRow = z.object({
  id: z.string(),
  kind: z.string(),
  ref_id: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  status: z.string(),
  position: z.string(),
  due_on: z.string().nullable(),
  work_job_id: z.string().nullable(),
  created_by: z.string(),
  revision: z.number(),
  created_at: z.union([z.date(), z.string()]),
  updated_at: z.union([z.date(), z.string()]),
  archived_at: z.union([z.date(), z.string()]).nullable(),
});
type ItemRow = z.infer<typeof ItemRow>;

const iso = (value: Date | string) =>
  (value instanceof Date ? value : new Date(value)).toISOString();

function toItem(row: unknown): BoardItem {
  const r = ItemRow.parse(row);
  return BoardItemSchema.parse({
    id: r.id,
    kind: r.kind,
    refId: r.ref_id,
    title: r.title,
    notes: r.notes,
    status: r.status,
    position: r.position,
    dueOn: r.due_on,
    workJobId: r.work_job_id,
    createdBy: r.created_by,
    revision: r.revision,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });
}

function itemColumns(sql: DatabaseExecutor) {
  return sql`
    id, kind, ref_id, title, notes, status, position::text as position,
    due_on::text as due_on, work_job_id, created_by, revision,
    created_at, updated_at, archived_at`;
}

const columnOrder = (status: string) =>
  BOARD_COLUMNS.indexOf(status as BoardItemStatus);

/** The board's current items, by column then position. */
async function currentItems(
  sql: DatabaseExecutor,
  actor: ActorContext,
): Promise<ItemRow[]> {
  const rows = await sql`
    select ${itemColumns(sql)} from workspace.board_items
     where tenant_id = ${actor.tenantId} and user_id = ${actor.userId}
       and archived_at is null
     order by position, created_at
     limit ${BOARD_ITEM_LIMIT}`;
  return rows
    .map((row) => ItemRow.parse(row))
    .sort((a, b) => columnOrder(a.status) - columnOrder(b.status));
}

async function ownItem(
  sql: DatabaseExecutor,
  actor: ActorContext,
  itemId: string,
): Promise<ItemRow | null> {
  if (!z.uuid().safeParse(itemId).success) return null;
  const rows = await sql`
    select ${itemColumns(sql)} from workspace.board_items
     where id = ${itemId} and tenant_id = ${actor.tenantId}
       and user_id = ${actor.userId}
     for update`;
  return rows.length === 0 ? null : ItemRow.parse(rows[0]);
}

/** One person's board changes one at a time (order and revisions stay whole). */
async function lockBoard(sql: DatabaseExecutor, actor: ActorContext) {
  await sql`
    select pg_advisory_xact_lock(hashtextextended(${`board:${actor.userId}`}, 0))`;
}

async function replayedEvent(
  sql: DatabaseExecutor,
  actor: ActorContext,
  idempotencyKey: string | undefined,
): Promise<string | null> {
  if (idempotencyKey === undefined) return null;
  const rows = await sql`
    select item_id from workspace.board_item_events
     where tenant_id = ${actor.tenantId} and user_id = ${actor.userId}
       and idempotency_key = ${idempotencyKey}`;
  const first = rows[0] as { item_id?: unknown } | undefined;
  return typeof first?.item_id === "string" ? first.item_id : null;
}

/**
 * The position for a place in a column (decimal arithmetic in the
 * database, never floats). Null when the two neighbours are too close to
 * split, and the column needs renumbering first.
 */
async function positionAt(
  sql: DatabaseExecutor,
  column: readonly ItemRow[],
  index: number,
): Promise<string | null> {
  const before = index > 0 ? column[Math.min(index, column.length) - 1] : null;
  const after = index < column.length ? column[index] : null;
  const rows =
    before === null && after === null
      ? await sql`select ${POSITION_STEP}::numeric(30, 10)::text as p`
      : before === null
        ? await sql`select (${after?.position ?? "0"}::numeric - ${POSITION_STEP})::numeric(30, 10)::text as p`
        : after === null || after === undefined
          ? await sql`select (${before?.position ?? "0"}::numeric + ${POSITION_STEP})::numeric(30, 10)::text as p`
          : await sql`select ((${before?.position ?? "0"}::numeric + ${after.position}::numeric) / 2)::numeric(30, 10)::text as p`;
  const position = (rows[0] as { p: string }).p;
  const same = await sql`
    select (${position}::numeric = ${before?.position ?? null}::numeric
            or ${position}::numeric = ${after?.position ?? null}::numeric) as same`;
  return (same[0] as { same: boolean | null }).same === true ? null : position;
}

async function writeChange(
  sql: DatabaseExecutor,
  actor: ActorContext,
  item: ItemRow,
  change: {
    readonly action: "EDITED" | "MOVED" | "LINKED_JOB" | "ARCHIVED";
    readonly by: BoardChangedBy;
    readonly set: {
      readonly title?: string;
      readonly notes?: string | null;
      readonly dueOn?: string | null;
      readonly status?: string;
      readonly position?: string;
      readonly workJobId?: string;
      readonly archived?: true;
    };
    readonly idempotencyKey?: string | undefined;
  },
): Promise<ItemRow> {
  const next = item.revision + 1;
  const s = change.set;
  const rows = await sql`
    update workspace.board_items set
      title = ${s.title ?? item.title},
      notes = ${s.notes === undefined ? item.notes : s.notes},
      due_on = ${s.dueOn === undefined ? item.due_on : s.dueOn}::date,
      status = ${s.status ?? item.status},
      position = ${s.position ?? item.position}::numeric,
      work_job_id = ${s.workJobId ?? item.work_job_id}::uuid,
      archived_at = ${s.archived === true ? sql`clock_timestamp()` : null},
      revision = ${next}
    where id = ${item.id}
    returning ${itemColumns(sql)}`;
  const updated = ItemRow.parse(rows[0]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, from, to] of [
    ["title", item.title, updated.title],
    ["notes", item.notes, updated.notes],
    ["dueOn", item.due_on, updated.due_on],
    ["position", item.position, updated.position],
    ["workJobId", item.work_job_id, updated.work_job_id],
  ] as const) {
    if (from !== to) changes[key] = { from, to };
  }
  await sql`
    insert into workspace.board_item_events
      (tenant_id, user_id, item_id, revision, action, actor,
       from_status, to_status, changes, idempotency_key)
    values (${actor.tenantId}, ${actor.userId}, ${item.id}, ${next},
            ${change.action}, ${change.by}, ${item.status}, ${updated.status},
            ${jsonbParam(sql, changes)}, ${change.idempotencyKey ?? null})`;
  return updated;
}

/** Spread a column evenly again (rare: only when two places cannot be split). */
async function renumber(
  sql: DatabaseExecutor,
  actor: ActorContext,
  column: readonly ItemRow[],
  by: BoardChangedBy,
): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  for (const [at, item] of column.entries()) {
    const rows = await sql`
      select (${POSITION_STEP}::numeric * ${at + 1})::numeric(30, 10)::text as p`;
    out.push(
      await writeChange(sql, actor, item, {
        action: "MOVED",
        by,
        set: { position: (rows[0] as { p: string }).p },
      }),
    );
  }
  return out;
}

export function createBoardService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /** When present, items whose Q job is DONE are moved to DONE on read. */
  readonly jobStatus?: BoardJobStatusPort | undefined;
}): BoardService {
  const { transactions } = dependencies;

  const moveWithin = async (
    sql: DatabaseExecutor,
    actor: ActorContext,
    item: ItemRow,
    target: { readonly status: BoardItemStatus; readonly index: number },
    change: {
      readonly action: "MOVED" | "LINKED_JOB";
      readonly by: BoardChangedBy;
      readonly workJobId?: string;
      readonly idempotencyKey?: string | undefined;
    },
  ): Promise<ItemRow> => {
    let column = (await currentItems(sql, actor)).filter(
      (one) => one.status === target.status && one.id !== item.id,
    );
    let position = await positionAt(sql, column, target.index);
    if (position === null) {
      column = await renumber(sql, actor, column, change.by);
      position = await positionAt(sql, column, target.index);
    }
    const current = (await ownItem(sql, actor, item.id)) ?? item;
    return writeChange(sql, actor, current, {
      action: change.action,
      by: change.by,
      set: {
        status: target.status,
        position: position ?? current.position,
        ...(change.workJobId === undefined
          ? {}
          : { workJobId: change.workJobId }),
      },
      idempotencyKey: change.idempotencyKey,
    });
  };

  /**
   * Items whose Q job finished move to DONE, and (F-117) items in DOING
   * whose job stopped or waits for them go back to TO DO: code reading job
   * status, never a model. The statuses read, for the list's attention.
   */
  const syncJobs = async (
    actor: ActorContext,
  ): Promise<ReadonlyMap<string, string>> => {
    if (dependencies.jobStatus === undefined) return new Map();
    const linked = (await currentItems(dependencies.sql, actor)).filter(
      (item) => item.work_job_id !== null && item.status !== "DONE",
    );
    if (linked.length === 0) return new Map();
    const statuses = await dependencies
      .jobStatus(
        actor,
        linked.flatMap((item) =>
          item.work_job_id === null ? [] : [item.work_job_id],
        ),
      )
      .catch(() => new Map<string, string>());
    const done = linked.filter(
      (item) =>
        item.work_job_id !== null && statuses.get(item.work_job_id) === "DONE",
    );
    const stopped = linked.filter(
      (item) =>
        item.status === "DOING" &&
        item.work_job_id !== null &&
        jobAttention(statuses.get(item.work_job_id)) !== null,
    );
    if (done.length === 0 && stopped.length === 0) return statuses;
    await transactions.run(async ({ sql }) => {
      await lockBoard(sql, actor);
      for (const item of stopped) {
        const current = await ownItem(sql, actor, item.id);
        if (current?.archived_at !== null || current.status !== "DOING") {
          continue;
        }
        await moveWithin(
          sql,
          actor,
          current,
          { status: "TODO", index: 0 },
          { action: "MOVED", by: "Q" },
        );
      }
      for (const item of done) {
        const current = await ownItem(sql, actor, item.id);
        if (current?.archived_at !== null || current.status === "DONE") {
          continue;
        }
        const doneCount = (await currentItems(sql, actor)).filter(
          (one) => one.status === "DONE",
        ).length;
        await moveWithin(
          sql,
          actor,
          current,
          { status: "DONE", index: doneCount },
          { action: "MOVED", by: "Q" },
        );
      }
    });
    return statuses;
  };

  return {
    list: async (actor) => {
      const statuses = await syncJobs(actor);
      const items = await currentItems(dependencies.sql, actor);
      return {
        items: items.map((row) => {
          const attention =
            row.work_job_id === null || row.status === "DONE"
              ? null
              : jobAttention(statuses.get(row.work_job_id));
          const item = toItem(row);
          return attention === null ? item : { ...item, attention };
        }),
        columns: [...BOARD_COLUMNS],
        visibility: "personal_private",
      };
    },

    add: async (actor, request, options) =>
      transactions.run(async ({ sql }) => {
        await lockBoard(sql, actor);
        const existing = await sql`
          select ${itemColumns(sql)} from workspace.board_items
           where tenant_id = ${actor.tenantId} and user_id = ${actor.userId}
             and idempotency_key = ${options.idempotencyKey}`;
        if (existing.length > 0) {
          const row = ItemRow.parse(existing[0]);
          const same =
            row.kind === request.kind &&
            row.title === request.title &&
            row.ref_id === (request.refId ?? null);
          return same
            ? { outcome: "OK", value: toItem(row), replayed: true }
            : { outcome: "REFUSED", code: "CONFLICT" };
        }
        const items = await currentItems(sql, actor);
        if (items.length >= BOARD_ITEM_LIMIT) {
          return { outcome: "REFUSED", code: "FULL" };
        }
        const status = request.status ?? "TODO";
        const column = items.filter((item) => item.status === status);
        const position =
          (await positionAt(sql, column, column.length)) ?? POSITION_STEP;
        const rows = await sql`
          insert into workspace.board_items
            (tenant_id, user_id, kind, ref_id, title, notes, status, position,
             due_on, created_by, idempotency_key)
          values (${actor.tenantId}, ${actor.userId}, ${request.kind},
                  ${request.refId ?? null}, ${request.title},
                  ${request.notes ?? null}, ${status}, ${position}::numeric,
                  ${request.dueOn ?? null}::date, ${options.by},
                  ${options.idempotencyKey})
          returning ${itemColumns(sql)}`;
        const row = ItemRow.parse(rows[0]);
        await sql`
          insert into workspace.board_item_events
            (tenant_id, user_id, item_id, revision, action, actor, to_status)
          values (${actor.tenantId}, ${actor.userId}, ${row.id}, 1, 'ADDED',
                  ${options.by}, ${status})`;
        return { outcome: "OK", value: toItem(row), replayed: false };
      }),

    update: async (actor, itemId, request, options) =>
      transactions.run(async ({ sql }) => {
        await lockBoard(sql, actor);
        const replay = await replayedEvent(sql, actor, options.idempotencyKey);
        const item = await ownItem(sql, actor, replay ?? itemId);
        if (item === null || (replay !== null && replay !== itemId)) {
          return { outcome: "REFUSED", code: "NOT_FOUND" };
        }
        if (replay !== null) {
          return { outcome: "OK", value: toItem(item), replayed: true };
        }
        if (item.archived_at !== null) {
          return { outcome: "REFUSED", code: "NOT_FOUND" };
        }
        if (request.revision !== item.revision) {
          return { outcome: "REFUSED", code: "CONFLICT" };
        }
        const updated = await writeChange(sql, actor, item, {
          action: request.archived === true ? "ARCHIVED" : "EDITED",
          by: options.by,
          set: {
            ...(request.title === undefined ? {} : { title: request.title }),
            ...(request.notes === undefined
              ? {}
              : { notes: request.notes === "" ? null : request.notes }),
            ...(request.dueOn === undefined ? {} : { dueOn: request.dueOn }),
            ...(request.archived === true ? { archived: true } : {}),
          },
          idempotencyKey: options.idempotencyKey,
        });
        return { outcome: "OK", value: toItem(updated), replayed: false };
      }),

    move: async (actor, itemId, request, options) =>
      transactions.run(async ({ sql }) => {
        await lockBoard(sql, actor);
        const replay = await replayedEvent(sql, actor, options.idempotencyKey);
        const item = await ownItem(sql, actor, itemId);
        if (
          item === null ||
          item.archived_at !== null ||
          (replay !== null && replay !== itemId)
        ) {
          return { outcome: "REFUSED", code: "NOT_FOUND" };
        }
        if (replay !== null) {
          return { outcome: "OK", value: toItem(item), replayed: true };
        }
        if (
          request.revision !== undefined &&
          request.revision !== item.revision
        ) {
          return { outcome: "REFUSED", code: "CONFLICT" };
        }
        const moved = await moveWithin(
          sql,
          actor,
          item,
          { status: request.status, index: request.index },
          {
            action: "MOVED",
            by: options.by,
            idempotencyKey: options.idempotencyKey,
          },
        );
        return { outcome: "OK", value: toItem(moved), replayed: false };
      }),

    linkJob: async (actor, itemId, jobId, options) =>
      transactions
        .run(async ({ sql }): Promise<BoardOutcome<BoardItem>> => {
          await lockBoard(sql, actor);
          const replay = await replayedEvent(
            sql,
            actor,
            options.idempotencyKey,
          );
          const item = await ownItem(sql, actor, itemId);
          if (
            item === null ||
            item.archived_at !== null ||
            (replay !== null && replay !== itemId)
          ) {
            return { outcome: "REFUSED", code: "NOT_FOUND" };
          }
          if (replay !== null) {
            return { outcome: "OK", value: toItem(item), replayed: true };
          }
          const doing = (await currentItems(sql, actor)).filter(
            (one) => one.status === "DOING" && one.id !== item.id,
          ).length;
          const linked = await moveWithin(
            sql,
            actor,
            item,
            { status: "DOING", index: doing },
            {
              action: "LINKED_JOB",
              by: "Q",
              workJobId: jobId,
              idempotencyKey: options.idempotencyKey,
            },
          );
          return { outcome: "OK", value: toItem(linked), replayed: false };
        })
        // A job that is not the person's own (the composite key refuses it)
        // is the same as no such job.
        .catch((error: unknown) => {
          if (isForeignKeyViolation(error)) {
            return { outcome: "REFUSED", code: "NOT_FOUND" } as const;
          }
          throw error;
        }),
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof DatabaseError &&
    error.sqlState === "23503" &&
    error.constraintName === "board_items_work_job_owned"
  );
}
