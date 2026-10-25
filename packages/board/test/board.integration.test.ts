import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createBoardService, type BoardService } from "../src/index.js";

/**
 * The work board against PostgreSQL (migration 20261230090000): a person's
 * own items only, one revision per change with its history, idempotent adds
 * and moves, stale revisions refused, archived items gone, another person's
 * items and jobs the same as none, and an item whose Q job finished moved
 * to DONE by code.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("@capital-q/board against PostgreSQL", () => {
  let db: RequestDatabase;
  let board: BoardService;
  const tenants = [randomUUID(), randomUUID()];
  const authIds = [randomUUID(), randomUUID()];
  const actors: ActorContext[] = [];
  const jobs = { mine: randomUUID(), theirs: randomUUID() };
  const jobStatus = new Map<string, string>();

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    await db.transactions.run(async ({ sql }) => {
      for (const [at, tenant] of tenants.entries()) {
        const auth = authIds[at] ?? randomUUID();
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Board test ${at}`})`;
        await sql`insert into auth.users (id, email) values (${auth}, ${`board-${auth}@example.invalid`})`;
        const rows =
          await sql`select id from identity.user_profiles where auth_user_id = ${auth}`;
        const userId = (rows[0] as { id: string }).id;
        actors.push({
          tenantId: tenant,
          userId,
          actorType: "HUMAN",
        } as ActorContext);
      }
      const [a, b] = actors;
      if (a === undefined || b === undefined) throw new Error("fixture");
      await sql`
        insert into q_runtime.workforce_jobs (id, tenant_id, user_id, source_kind, goal, rubric_version)
        values (${jobs.mine}, ${a.tenantId}, ${a.userId}, 'JOB', 'Research item', 'rubric.v1'),
               (${jobs.theirs}, ${b.tenantId}, ${b.userId}, 'JOB', 'Not yours', 'rubric.v1')`;
    });
    board = createBoardService({
      sql: db.sql,
      transactions: db.transactions,
      jobStatus: (_actor, ids) =>
        Promise.resolve(
          new Map(
            ids.flatMap((id) => {
              const status = jobStatus.get(id);
              return status === undefined ? [] : [[id, status] as const];
            }),
          ),
        ),
    });
  });

  afterAll(async () => {
    await db.sql`delete from identity.tenants where id = any(${tenants})`;
    await db.sql`delete from identity.user_profiles where auth_user_id = any(${authIds})`;
    await db.sql`delete from auth.users where id = any(${authIds})`;
    await db.close();
  });

  const a = () => actors[0] as ActorContext;
  const b = () => actors[1] as ActorContext;
  const titles = async (actor: ActorContext) =>
    (await board.list(actor)).items.map((item) => [item.status, item.title]);

  it("adds to the end of a column, once per idempotency key", async () => {
    const key = randomUUID();
    const first = await board.add(
      a(),
      { kind: "TASK", title: "Hire a head of sales" },
      { by: "PERSON", idempotencyKey: key },
    );
    const again = await board.add(
      a(),
      { kind: "TASK", title: "Hire a head of sales" },
      { by: "PERSON", idempotencyKey: key },
    );
    expect(first).toMatchObject({
      outcome: "OK",
      replayed: false,
      value: { status: "TODO", revision: 1, createdBy: "PERSON" },
    });
    expect(again).toMatchObject({ outcome: "OK", replayed: true });
    expect(
      again.outcome === "OK" &&
        first.outcome === "OK" &&
        again.value.id === first.value.id,
    ).toBe(true);
    // The same key with a different item is a conflict, never a second item.
    expect(
      await board.add(
        a(),
        { kind: "TASK", title: "Something else" },
        { by: "PERSON", idempotencyKey: key },
      ),
    ).toEqual({ outcome: "REFUSED", code: "CONFLICT" });
    await board.add(
      a(),
      { kind: "DOCUMENT", refId: randomUUID(), title: "12-month plan" },
      { by: "Q", idempotencyKey: randomUUID() },
    );
    expect(await titles(a())).toEqual([
      ["TODO", "Hire a head of sales"],
      ["TODO", "12-month plan"],
    ]);
  });

  it("moves within and between columns, records each move, and refuses a stale revision", async () => {
    const [sales, plan] = (await board.list(a())).items;
    if (sales === undefined || plan === undefined) throw new Error("fixture");
    const key = randomUUID();
    expect(
      await board.move(
        a(),
        plan.id,
        { status: "TODO", index: 0, revision: plan.revision },
        { by: "PERSON", idempotencyKey: key },
      ),
    ).toMatchObject({
      outcome: "OK",
      value: { revision: 2 },
    });
    expect(await titles(a())).toEqual([
      ["TODO", "12-month plan"],
      ["TODO", "Hire a head of sales"],
    ]);
    // A retried move writes nothing more.
    expect(
      await board.move(
        a(),
        plan.id,
        { status: "TODO", index: 0 },
        { by: "PERSON", idempotencyKey: key },
      ),
    ).toMatchObject({
      outcome: "OK",
      replayed: true,
      value: { revision: 2 },
    });
    expect(
      await board.move(
        a(),
        sales.id,
        { status: "DOING", index: 0, revision: 9 },
        { by: "PERSON", idempotencyKey: randomUUID() },
      ),
    ).toEqual({
      outcome: "REFUSED",
      code: "CONFLICT",
    });
    await board.move(
      a(),
      sales.id,
      { status: "DOING", index: 0 },
      { by: "PERSON", idempotencyKey: randomUUID() },
    );
    expect(await titles(a())).toEqual([
      ["TODO", "12-month plan"],
      ["DOING", "Hire a head of sales"],
    ]);
    const events = await db.sql`
      select revision, action, actor, from_status, to_status from workspace.board_item_events
       where item_id = ${sales.id} order by revision`;
    expect(
      events.map((e): unknown[] => [
        e["revision"],
        e["action"],
        e["actor"],
        e["from_status"],
        e["to_status"],
      ]),
    ).toEqual([
      [1, "ADDED", "PERSON", null, "TODO"],
      [2, "MOVED", "PERSON", "TODO", "DOING"],
    ]);
  });

  it("keeps order when one place is split many times (the column is renumbered)", async () => {
    const ids: string[] = [];
    for (const title of ["first", "last"]) {
      const added = await board.add(
        a(),
        { kind: "NOTE", title, status: "DONE" },
        { by: "PERSON", idempotencyKey: randomUUID() },
      );
      if (added.outcome === "OK") ids.push(added.value.id);
    }
    for (let at = 0; at < 40; at += 1) {
      const added = await board.add(
        a(),
        { kind: "NOTE", title: `n${at}`, status: "DONE" },
        { by: "PERSON", idempotencyKey: randomUUID() },
      );
      if (added.outcome !== "OK") throw new Error("add");
      await board.move(
        a(),
        added.value.id,
        { status: "DONE", index: 1 },
        { by: "PERSON", idempotencyKey: randomUUID() },
      );
    }
    const done = (await board.list(a())).items
      .filter((item) => item.status === "DONE")
      .map((item) => item.title);
    expect(done[0]).toBe("first");
    expect(done.at(-1)).toBe("last");
    expect(done.slice(1, 4)).toEqual(["n39", "n38", "n37"]);
    expect(new Set(done).size).toBe(42);
  });

  it("edits as the next revision, archives, and refuses a stale edit", async () => {
    const plan = (await board.list(a())).items.find(
      (item) => item.title === "12-month plan",
    );
    if (plan === undefined) throw new Error("fixture");
    expect(
      await board.update(
        a(),
        plan.id,
        { revision: plan.revision, notes: "Q filed this", dueOn: "2026-12-01" },
        { by: "PERSON" },
      ),
    ).toMatchObject({
      outcome: "OK",
      value: {
        notes: "Q filed this",
        dueOn: "2026-12-01",
        revision: plan.revision + 1,
      },
    });
    expect(
      await board.update(
        a(),
        plan.id,
        { revision: plan.revision, title: "stale" },
        { by: "PERSON" },
      ),
    ).toEqual({
      outcome: "REFUSED",
      code: "CONFLICT",
    });
    await board.update(
      a(),
      plan.id,
      { revision: plan.revision + 1, archived: true },
      { by: "PERSON" },
    );
    expect(
      (await board.list(a())).items.some((item) => item.id === plan.id),
    ).toBe(false);
    expect(
      await board.move(
        a(),
        plan.id,
        { status: "DONE", index: 0 },
        { by: "PERSON", idempotencyKey: randomUUID() },
      ),
    ).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
  });

  it("is the same NOT_FOUND for another person's item or job", async () => {
    const mine = (await board.list(a())).items[0];
    if (mine === undefined) throw new Error("fixture");
    expect((await board.list(b())).items).toEqual([]);
    expect(
      await board.move(
        b(),
        mine.id,
        { status: "DONE", index: 0 },
        { by: "PERSON", idempotencyKey: randomUUID() },
      ),
    ).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
    expect(
      await board.update(
        b(),
        mine.id,
        { revision: mine.revision, title: "taken" },
        { by: "PERSON" },
      ),
    ).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
    expect(
      await board.linkJob(a(), mine.id, jobs.theirs, {
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
    expect(
      await board.update(
        a(),
        "not-a-uuid",
        { revision: 1, title: "x" },
        { by: "PERSON" },
      ),
    ).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
  });

  it("links their own Q job (DOING) and moves the item to DONE when the job is done", async () => {
    const added = await board.add(
      a(),
      { kind: "TASK", title: "Research the market" },
      { by: "Q", idempotencyKey: randomUUID() },
    );
    if (added.outcome !== "OK") throw new Error("add");
    expect(
      await board.linkJob(a(), added.value.id, jobs.mine, {
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({
      outcome: "OK",
      value: { status: "DOING", workJobId: jobs.mine },
    });
    jobStatus.set(jobs.mine, "RUNNING");
    expect(
      (await board.list(a())).items.find((item) => item.id === added.value.id)
        ?.status,
    ).toBe("DOING");
    jobStatus.set(jobs.mine, "DONE");
    expect(
      (await board.list(a())).items.find((item) => item.id === added.value.id)
        ?.status,
    ).toBe("DONE");
    const events = await db.sql`
      select action, actor, to_status from workspace.board_item_events
       where item_id = ${added.value.id} order by revision`;
    expect(
      events.map((e): unknown[] => [e["action"], e["actor"], e["to_status"]]),
    ).toEqual([
      ["ADDED", "Q", "TODO"],
      ["LINKED_JOB", "Q", "DOING"],
      ["MOVED", "Q", "DONE"],
    ]);
  });

  // F11 (QA re-score, 2026-10-25): six growth-plan items sat in Doing after
  // their jobs failed. Work no longer happening goes back to To do.
  it("moves an item back to TODO when its job failed or was stopped", async () => {
    for (const ended of ["FAILED", "STOPPED"]) {
      const added = await board.add(
        a(),
        { kind: "TASK", title: `Plan ${ended}` },
        { by: "Q", idempotencyKey: randomUUID() },
      );
      if (added.outcome !== "OK") throw new Error("add");
      await board.linkJob(a(), added.value.id, jobs.mine, {
        idempotencyKey: randomUUID(),
      });
      jobStatus.set(jobs.mine, "HELD");
      expect(
        (await board.list(a())).items.find((item) => item.id === added.value.id)
          ?.status,
      ).toBe("DOING");
      jobStatus.set(jobs.mine, ended);
      expect(
        (await board.list(a())).items.find((item) => item.id === added.value.id)
          ?.status,
        ended,
      ).toBe("TODO");
    }
  });
});
