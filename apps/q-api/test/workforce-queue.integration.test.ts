import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import type { WorkforceJobStartPayload } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createWorkforceJobs,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import { createPostgresAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { createPostgresWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Recovery D3 against the local database (migration 20261220180000): a
 * job a dead worker left RUNNING is reclaimed after its lease lapses,
 * resumed without redoing its finished step, and reaches a terminal state
 * in q_runtime.agent_work_queue and q_runtime.workforce_jobs.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("durable workforce jobs against PostgreSQL", () => {
  let db: RequestDatabase;
  let actor: ActorContext;
  const tenantId = randomUUID();
  const orgId = randomUUID();

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    const userId = await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      await sql`insert into identity.tenants (id, name) values (${tenantId}, 'Durable work')`;
      await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${orgId}, ${tenantId}, 'investment_firm', 'Durable work', ${`durable-${orgId.slice(0, 8)}`})`;
      await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
      const authId = randomUUID();
      await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@durable.example.invalid`})`;
      const [profile] = await sql<{ id: string }[]>`
        select id from identity.user_profiles where auth_user_id = ${authId}`;
      if (profile === undefined) throw new Error("profile trigger did not run");
      await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
        values (${tenantId}, ${orgId}, ${profile.id}, 'active')`;
      return profile.id;
    });
    actor = ActorContextSchema.parse({
      tenantId,
      userId,
      organisationId: orgId,
      actorType: "HUMAN",
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("reclaims a lapsed lease, resumes, and ends COMPLETED in the database", async () => {
    const owner = { tenantId: actor.tenantId, userId: actor.userId };
    const store = createPostgresWorkforceStore(db.sql);
    const queue = createPostgresAgentWorkQueue(db.sql);
    const expressed: string[] = [];
    let scans = 0;
    const ports: WorkforcePorts = {
      principalName: () => Promise.resolve("Ada"),
      mandateMatches: () => {
        scans += 1;
        return Promise.resolve([{ companyId: "c-new", name: "New" }]);
      },
      expressInterest: (_owner, companyId) => {
        expressed.push(companyId);
        return Promise.resolve({ ok: true });
      },
      openConversations: () => Promise.resolve([]),
      writeReply: () => Promise.resolve(null),
      send: () => Promise.resolve(false),
      freeSlots: () => Promise.resolve([]),
      book: () => Promise.resolve({ ok: false, meetingId: null }),
      notify: () => Promise.resolve(),
    };
    const jobsFor = () =>
      createWorkforceJobs({
        store,
        models: {
          plan: () => Promise.resolve(null),
          readReply: () => Promise.resolve(null),
        },
        review: createOutwardReview({
          store,
          models: {
            review: () => Promise.resolve(null),
            redraft: () => Promise.resolve(null),
          },
        }),
        ports,
      });
    const plan: WorkforceJobStartPayload = {
      ownerUserId: actor.userId,
      goal: "Express interest in fits.",
      summary: "Shortlist and reach out.",
      steps: [
        {
          key: "discover",
          role: "MANDATE_WATCHER",
          agentName: "Mandate watcher",
          goal: "Shortlist",
          tools: ["search_companies"],
          dependsOn: [],
          budgetUsd: "0.05",
          spawned: false,
        },
        {
          key: "reach",
          role: "OUTREACH",
          agentName: "Outreach",
          goal: "Reach out",
          tools: ["relationship.interest.express"],
          dependsOn: ["discover"],
          budgetUsd: "0.1",
          spawned: false,
        },
      ],
      permitted: ["search_companies", "relationship.interest.express"],
      budgetUsd: "0.5",
      cannot: [],
    };
    const actionId = randomUUID();
    const filed = await jobsFor().file(owner, {
      goal: plan.goal,
      budgetUsd: 0.5,
      source: { kind: "JOB", id: actionId },
    });
    await queue.enqueue(owner, {
      jobId: filed.jobId,
      plan,
      trace: { actionId, organisationId: orgId },
    });
    // A replayed approval enqueues nothing new.
    await queue.enqueue(owner, { jobId: filed.jobId, plan, trace: {} });

    // Worker 1 claims it, finishes "discover", then dies mid-"reach".
    const claimed = await queue.claim(`dead-${randomUUID()}`, 60_000, 50);
    const mine = claimed.find((row) => row.job_id === filed.jobId);
    expect(mine?.state).toBe("RUNNING");
    await queue.recordStep(filed.jobId, mine?.locked_by ?? "", "discover", {
      status: "DONE",
      summary: "Shortlisted 1.",
      outputs: { shortlist: [{ companyId: "c-kept", name: "Kept" }] },
    });
    await store.startRun(owner, {
      jobId: filed.jobId,
      role: "OUTREACH",
      agentName: "Outreach",
      goal: "Reach out",
      tools: ["relationship.interest.express"],
      budgetUsd: 0.1,
      stepKey: "reach",
      spawnedByRunId: filed.leadRunId,
    });
    // Its lease lapses (the worker is gone).
    await db.sql`
      update q_runtime.agent_work_queue
         set locked_until = clock_timestamp() - interval '1 second'
       where job_id = ${filed.jobId}`;

    const runner = createAgentWorkRunner({
      queue,
      store,
      actorFor: (who) =>
        Promise.resolve(who.userId === actor.userId ? actor : null),
      jobsFor,
      workerId: `live-${randomUUID()}`,
    });
    // Other rows in a shared local DB may be claimed too; ours must end.
    for (let pass = 0; pass < 5; pass += 1) await runner.pass();

    const [row] = await db.sql<
      {
        state: string;
        attempts: number;
        finished_at: Date | null;
        locked_by: string | null;
        trace: { actionId?: string; organisationId?: string };
      }[]
    >`select state, attempts, finished_at, locked_by, trace from q_runtime.agent_work_queue where job_id = ${filed.jobId}`;
    expect(row).toMatchObject({
      state: "COMPLETED",
      attempts: 2,
      locked_by: null,
    });
    expect(row?.finished_at).not.toBeNull();
    expect(row?.trace).toMatchObject({ actionId, organisationId: orgId });
    const [job] = await db.sql<{ status: string }[]>`
      select status from q_runtime.workforce_jobs where id = ${filed.jobId}`;
    expect(job?.status).toBe("DONE");
    const running = await db.sql`
      select 1 from q_runtime.workforce_agent_runs
       where job_id = ${filed.jobId} and status = 'RUNNING'`;
    expect(running.length).toBe(0);
    expect(expressed).toEqual(["c-kept"]);
    expect(scans).toBe(0);
  });
});
