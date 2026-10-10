import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createLogger } from "@capital-q/observability";
import {
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createUnconfiguredQAnswer,
  createUnconfiguredQRetrieval,
  neverPause,
  type ContextFirewallPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
} from "../src/index.js";

/**
 * SUB-SECOND: how many database round trips a run makes between "understanding
 * the request" (begin) and "preparing analysis" (SYNTHESIS), counted by the
 * per-run counter over the request client and the checkpoint pool. On hosted
 * each costs 15-20 ms. Real local PostgreSQL; the firewall is a stub and no
 * model is configured, so nothing leaves the machine.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUNS = 20;

const firewall: ContextFirewallPort = {
  plan: (request) =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: PermittedContextPlanSchema.parse({
        contractVersion: 1,
        policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
        planId: randomUUID(),
        fingerprint: "0".repeat(64),
        runId: request.runId,
        tenantId: request.actor.tenantId,
        actor: {
          userId: request.actor.userId,
          ...(request.actor.organisationId === undefined
            ? {}
            : { organisationId: request.actor.organisationId }),
        },
        purpose: {
          capability: request.capability,
          taskClass: "GENERAL_QUESTION",
        },
        subjects: request.subjects,
        scopes: [],
        denied: [],
        maxSensitivity: "PUBLIC",
        allowedLayers: [],
        combinationConstraints: [],
        evaluatedAt: new Date().toISOString(),
        revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
        revalidateOnResume: true,
      }),
    }),
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}
function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.NaN;
}

describe("round trips before PREPARING_ANALYSIS, against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });
  afterAll(async () => {
    await db.close();
  });

  it("counts and bounds them", async () => {
    const tenantId = randomUUID();
    const organisationId = randomUUID();
    const authUserId = randomUUID();
    const membershipId = randomUUID();
    const userId = await db.transactions.run(async (tx) => {
      await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Round trips')`;
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${organisationId}, ${tenantId}, 'company', 'RT Org', ${`rt-${organisationId.slice(0, 8)}`})`;
      await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
      await tx.sql`insert into auth.users (id) values (${authUserId})`;
      const [profile] = await tx.sql<
        { id: string }[]
      >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
      if (profile === undefined) throw new Error("no profile");
      await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
        values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
      return profile.id;
    });
    const actor = ActorContextSchema.parse({
      userId,
      tenantId,
      organisationId,
      membershipId,
      actorType: "HUMAN",
    });
    const lines: string[] = [];
    const logger = createLogger(
      { serviceName: "round-trips-test", environment: "test" },
      {
        level: "info",
        destination: { write: (chunk: string) => lines.push(chunk) },
      },
    );
    const service = createQRuntimeService({
      sql: db.sql,
      transactions: db.transactions,
      subjects: createQSubjectResolverRegistry([]),
      securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
      logger,
    });
    const store = createPostgresQCheckpointStore({
      connectionString: TEST_DATABASE_URL,
    });
    const engine = createLangGraphQOrchestrator({
      runtime: createQOrchestrationRuntime({
        sql: db.sql,
        transactions: db.transactions,
        subjects: createQSubjectResolverRegistry([]),
        securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
        repositories: createPostgresQRuntimeRepositories(),
        logger,
      }),
      cancelRun: service.cancelRun,
      checkpoints: store,
      firewall,
      retrieval: createUnconfiguredQRetrieval(),
      answer: createUnconfiguredQAnswer(),
      pausePolicy: neverPause,
      logger,
    });

    const before: number[] = [];
    const ms: number[] = [];
    const checkpoint: number[] = [];
    try {
      for (let i = 0; i < RUNS; i += 1) {
        const { run } = await service.createRun({
          actor,
          input: {
            capability: "INVESTIGATE",
            message: { text: "What changed this week?" },
            objective: "Round trips",
            modality: "TEXT",
          },
          idempotencyKey: `rt-${randomUUID()}`,
          correlationId: `cor_${randomUUID()}`,
        });
        lines.length = 0;
        await engine.start({
          actor,
          runId: run.id,
          correlationId: `cor_${randomUUID()}`,
        });
        const returned = lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((entry) => entry["msg"] === "q orchestration returned");
        const count = returned?.["dbRoundTripsBeforeAnalysis"];
        const at = returned?.["msBeforeAnalysis"];
        if (typeof count !== "number" || typeof at !== "number") {
          throw new Error("no round-trip count logged");
        }
        before.push(count);
        ms.push(at);
        // R5: the phase attribution rides on the same line, and the
        // checkpoint saver writes in one statement per save, not one per
        // channel and write plus BEGIN/COMMIT (35 per run before).
        const phases = returned?.["dbRoundTripsByPhase"] as
          Record<string, number> | undefined;
        checkpoint.push(phases?.["checkpoint"] ?? Number.NaN);
      }
    } finally {
      await store.close();
    }
    // Printed for the SUB-SECOND report; bounded below.
    process.stdout.write(
      `round trips before PREPARING_ANALYSIS: p50 ${String(median(before))}, p95 ${String(p95(before))}; ms p50 ${String(median(ms))}, p95 ${String(p95(ms))} (local, n=${String(RUNS)})\n`,
    );
    expect(median(before)).toBeGreaterThan(0);
    expect(Math.max(...checkpoint)).toBeLessThanOrEqual(4);
    expect(median(before)).toBeLessThanOrEqual(
      Number(process.env["CQ_ROUND_TRIP_BUDGET"] ?? "30"),
    );
  }, 120_000);
});
