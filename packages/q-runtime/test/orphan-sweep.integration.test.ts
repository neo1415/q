import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import {
  createOrphanedRunSweep,
  createPostgresQRuntimeRepositories,
  type QOrchestrationRuntime,
} from "../src/index.js";

/**
 * The orphan sweep never touches a run another process is working on
 * (CQ-QACT-001). Live, every q-api start failed ALL non-terminal runs in
 * the shared database, so a second instance's deck run died as
 * RUN_EXPIRED 1.5 s after it began — the same hazard a rolling deploy
 * has. Real local PostgreSQL, one rolled-back transaction.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

const MINUTE = 60 * 1000;

describe("the orphaned run sweep, against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function insertRun(
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly userId: string;
      readonly status: string;
      readonly createdMinutesAgo: number;
      readonly lastEventMinutesAgo?: number;
      /** G-D24: when its engine last said it still holds the run. */
      readonly heartbeatSecondsAgo?: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    const created = new Date(Date.now() - input.createdMinutesAgo * MINUTE);
    await tx.sql`insert into q_runtime.runs
        (id, tenant_id, actor_user_id, objective, capability, consequence_class,
         status, correlation_id, created_at, started_at)
      values (${id}, ${input.tenantId}, ${input.userId}, 'sweep test', 'ANSWER', 'LOW',
              ${input.status}, ${`cor_${randomUUID()}`}, ${created}, ${created})`;
    if (input.lastEventMinutesAgo !== undefined) {
      await tx.sql`insert into q_runtime.run_events
          (tenant_id, run_id, sequence, event_type, payload, occurred_at)
        values (${input.tenantId}, ${id}, 1, 'q.stage.changed', '{}'::jsonb,
                ${new Date(Date.now() - input.lastEventMinutesAgo * MINUTE)})`;
    }
    if (input.heartbeatSecondsAgo !== undefined) {
      await tx.sql`update q_runtime.runs
          set engine_heartbeat_at = ${new Date(Date.now() - input.heartbeatSecondsAgo * 1000)}
        where id = ${id}`;
    }
    return id;
  }

  it("closes only runs silent past their window; a live run elsewhere and a paused run are left alone", async () => {
    let checked = false;
    try {
      await db.transactions.run(async (tx) => {
        const tenantId = randomUUID();
        await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Sweep tenant')`;
        const authUserId = randomUUID();
        await tx.sql`insert into auth.users (id) values (${authUserId})`;
        const [profile] = await tx.sql<
          { id: string }[]
        >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        const userId = profile.id;

        // Another instance's run, started a second ago: the ACC case.
        const justStarted = await insertRun(tx, {
          tenantId,
          userId,
          status: "SYNTHESIS",
          createdMinutesAgo: 0,
        });
        // Old, but its engine wrote an event a minute ago: alive.
        const longButAlive = await insertRun(tx, {
          tenantId,
          userId,
          status: "SPECIALIST_EXECUTION",
          createdMinutesAgo: 40,
          lastEventMinutesAgo: 1,
        });
        // Waiting on a person for an hour: needs no engine.
        const paused = await insertRun(tx, {
          tenantId,
          userId,
          status: "AWAITING_APPROVAL",
          createdMinutesAgo: 60,
          lastEventMinutesAgo: 60,
        });
        // Silent for 30 minutes mid-flight: nobody's.
        const orphan = await insertRun(tx, {
          tenantId,
          userId,
          status: "PLANNING",
          createdMinutesAgo: 30,
          lastEventMinutesAgo: 30,
        });
        // A cancellation nobody finished, silent for an hour.
        const stuckCancel = await insertRun(tx, {
          tenantId,
          userId,
          status: "CANCEL_REQUESTED",
          createdMinutesAgo: 60,
        });
        // A pause abandoned for two days.
        const abandoned = await insertRun(tx, {
          tenantId,
          userId,
          status: "AWAITING_INPUT",
          createdMinutesAgo: 48 * 60,
        });

        const failed: string[] = [];
        const expired: string[] = [];
        const cancelled: string[] = [];
        const runtime = {
          fail: (ref: { runId: string }) => {
            failed.push(ref.runId);
            return Promise.resolve({ kind: "ADVANCED" });
          },
          expire: (ref: { runId: string }) => {
            expired.push(ref.runId);
            return Promise.resolve({ kind: "ADVANCED" });
          },
          finishCancellation: (ref: { runId: string }) => {
            cancelled.push(ref.runId);
            return Promise.resolve({ kind: "ADVANCED" });
          },
        } as unknown as QOrchestrationRuntime;

        await createOrphanedRunSweep({
          sql: tx.sql,
          runs: createPostgresQRuntimeRepositories().runs,
          runtime,
        }).sweep();

        const ours = new Set([
          justStarted,
          longButAlive,
          paused,
          orphan,
          stuckCancel,
          abandoned,
        ]);
        const failedHere = failed.filter((id) => ours.has(id)).sort();
        expect(failedHere).toEqual([orphan]);
        // A pause whose wait ran out expires; it is not a failure.
        expect(expired.filter((id) => ours.has(id))).toEqual([abandoned]);
        expect(cancelled.filter((id) => ours.has(id))).toEqual([stuckCancel]);
        expect(failed).not.toContain(justStarted);
        expect(failed).not.toContain(longButAlive);
        expect(failed).not.toContain(paused);
        checked = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(checked).toBe(true);
  });
  it("G-D24: a run whose engine stopped heartbeating is closed within a minute; a live engine in a long call is not", async () => {
    let checked = false;
    try {
      await db.transactions.run(async (tx) => {
        const tenantId = randomUUID();
        await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Heartbeat tenant')`;
        const authUserId = randomUUID();
        await tx.sql`insert into auth.users (id) values (${authUserId})`;
        const [profile] = await tx.sql<
          { id: string }[]
        >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        const userId = profile.id;

        // Mid-answer when q-api restarted two minutes ago: the K7 case.
        const caughtByRestart = await insertRun(tx, {
          tenantId,
          userId,
          status: "SYNTHESIS",
          createdMinutesAgo: 3,
          lastEventMinutesAgo: 2,
          heartbeatSecondsAgo: 120,
        });
        // Thirty minutes in one model call, but its engine is alive.
        const liveLongCall = await insertRun(tx, {
          tenantId,
          userId,
          status: "SYNTHESIS",
          createdMinutesAgo: 30,
          lastEventMinutesAgo: 30,
          heartbeatSecondsAgo: 10,
        });
        // Paused on a person for an hour; its old heartbeat is irrelevant.
        const paused = await insertRun(tx, {
          tenantId,
          userId,
          status: "AWAITING_APPROVAL",
          createdMinutesAgo: 60,
          lastEventMinutesAgo: 60,
          heartbeatSecondsAgo: 3600,
        });

        const failed: { runId: string; code: string }[] = [];
        const runtime = {
          fail: (ref: { runId: string }, code: string) => {
            failed.push({ runId: ref.runId, code });
            return Promise.resolve({ kind: "ADVANCED" });
          },
          expire: () => Promise.resolve({ kind: "ADVANCED" }),
          finishCancellation: () => Promise.resolve({ kind: "ADVANCED" }),
        } as unknown as QOrchestrationRuntime;

        await createOrphanedRunSweep({
          sql: tx.sql,
          runs: createPostgresQRuntimeRepositories().runs,
          runtime,
        }).sweep();

        const ours = new Set([caughtByRestart, liveLongCall, paused]);
        expect(failed.filter((f) => ours.has(f.runId))).toEqual([
          { runId: caughtByRestart, code: "RUN_EXPIRED" },
        ]);
        checked = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(checked).toBe(true);
  });
});
