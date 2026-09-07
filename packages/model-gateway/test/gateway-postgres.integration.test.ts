import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  createFakeModelProvider,
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  effectivePrice,
  indexCatalog,
  loadModelCatalogSnapshot,
  ModelGatewayError,
} from "../src/index.js";

/**
 * The gateway over the real ai_ops rows (`pnpm db:start`, run with
 * `pnpm test:integration`): the seeded catalog loads and validates, the
 * seeded routing matrix routes as the packet states, the seeded data-use
 * ceilings hold, and every attempt lands in the usage ledger against a
 * real tenant. Providers are FAKES registered under the real codes; no
 * SDK, no network, no key.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("@capital-q/model-gateway against local PostgreSQL", () => {
  let db: RequestDatabase;
  let tenantId: string;

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
    tenantId = randomUUID();
    await db.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Model Gateway Test Tenant')`;
  });

  afterAll(async () => {
    // The ledger is append-only by trigger; the trigger is disabled for
    // cleanup only, as the q_runtime suites do for run events.
    await db.sql`alter table ai_ops.model_usage disable trigger model_usage_append_only`;
    await db.sql`delete from ai_ops.model_usage where tenant_id = ${tenantId}`;
    await db.sql`alter table ai_ops.model_usage enable trigger model_usage_append_only`;
    await db.sql`delete from identity.tenants where id = ${tenantId}`;
    await db.close();
  });

  it("loads the seeded catalog: two providers, four models, versioned prices, seven policies", async () => {
    const snapshot = await loadModelCatalogSnapshot(db.sql, new Date());
    const catalog = indexCatalog(snapshot);
    expect(snapshot.providers.map((p) => p.code).sort()).toEqual([
      "google",
      "groq",
    ]);
    expect(snapshot.models.map((m) => m.modelCode).sort()).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.8-flash",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ]);
    expect(
      snapshot.routingPolicies.filter((p) => p.status === "ACTIVE"),
    ).toHaveLength(7);

    const flash = snapshot.models.find(
      (m) => m.modelCode === "gemini-3.8-flash",
    );
    if (flash === undefined) {
      throw new Error("gemini-3.8-flash missing");
    }
    // The introductory price applies now; the announced 2027 row applies later.
    expect(
      effectivePrice(catalog, flash.id, new Date("2026-10-01T00:00:00Z"))
        ?.inputPerMillion,
    ).toBe(0.75);
    expect(
      effectivePrice(catalog, flash.id, new Date("2027-02-01T00:00:00Z"))
        ?.inputPerMillion,
    ).toBe(1.5);
    expect(flash.sensitivityCeiling).toBe("PUBLIC");
  });

  it("routes and records against the real catalog and ledger", async () => {
    const google = createFakeModelProvider({
      code: "google",
      script: [
        {
          kind: "TEXT",
          text: "synthetic answer",
          usage: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 10 },
        },
      ],
    });
    const groq = createFakeModelProvider({
      code: "groq",
      script: [
        {
          kind: "TEXT",
          text: "synthetic groq answer",
          usage: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 12 },
        },
      ],
    });
    const gateway = createModelGateway({
      catalog: createPostgresModelCatalog({ sql: db.sql, cacheTtlMs: 0 }),
      registry: createModelProviderRegistry([google, groq]),
      usage: createPostgresModelUsageRepository({ sql: db.sql }),
    });
    const runId = randomUUID();
    const base = {
      messages: [
        {
          role: "USER" as const,
          content: "Synthetic public sentence about investment software.",
        },
      ],
      output: { kind: "TEXT" as const },
      budget: {
        maxAttempts: 3,
        maxEstimatedCostUsd: 0.1,
        maxOutputTokens: 256,
        attemptTimeoutMs: 5_000,
      },
      attribution: { tenantId, qRunId: runId, correlationId: "cor_it" },
    };

    // Public, light: gemini flash-lite is preferred by policy.
    const light = await gateway.execute({
      ...base,
      taskClass: "FAST_CLASSIFICATION",
      sensitivity: "PUBLIC",
    });
    expect(light.providerCode).toBe("google");
    expect(light.modelCode).toBe("gemini-3.5-flash-lite");
    expect(light.routingPolicyCode).toBe("fast_classification.v1");
    expect(light.cost.basis).toBe("PRICE_SNAPSHOT");

    // INTERNAL: unverified gemini is excluded before any call; groq serves.
    const internal = await gateway.execute({
      ...base,
      taskClass: "FAST_CLASSIFICATION",
      sensitivity: "INTERNAL",
    });
    expect(internal.providerCode).toBe("groq");
    expect(internal.modelCode).toBe("openai/gpt-oss-20b");
    // Not a fallback: nothing eligible was tried before it. The first
    // candidate was refused on privacy, not on availability.
    expect(internal.fallbackUsed).toBe(false);
    expect(internal.route.selectedCandidateIndex).toBe(1);
    expect(internal.route.candidates[0]).toMatchObject({
      providerCode: "google",
      reason: "SENSITIVITY_EXCEEDS_CEILING",
    });
    expect(google.calls).toHaveLength(1);

    // CONFIDENTIAL: nothing seeded is cleared; no token is sent anywhere.
    let denied: ModelGatewayError | undefined;
    try {
      await gateway.execute({
        ...base,
        taskClass: "NORMAL_DIALOGUE",
        sensitivity: "CONFIDENTIAL",
      });
    } catch (error: unknown) {
      denied = error instanceof ModelGatewayError ? error : undefined;
    }
    expect(denied?.failureClass).toBe("POLICY_INELIGIBLE");
    expect(google.calls).toHaveLength(1);
    expect(groq.calls).toHaveLength(1);

    const rows = await db.sql<
      {
        task_class: string;
        success: boolean;
        cost_usd: string | null;
        cost_basis: string;
        error_code: string | null;
        model_code: string;
      }[]
    >`select u.task_class, u.success, u.cost_usd::text as cost_usd, u.cost_basis, u.error_code, m.model_code
        from ai_ops.model_usage u join ai_ops.models m on m.id = u.model_id
       where u.q_run_id = ${runId} order by u.id`;
    expect(rows.map((r) => [r.model_code, r.success, r.cost_basis])).toEqual([
      ["gemini-3.5-flash-lite", true, "PRICE_SNAPSHOT"],
      ["openai/gpt-oss-20b", true, "PRICE_SNAPSHOT"],
    ]);
    expect(Number(rows[0]?.cost_usd)).toBeGreaterThan(0);
    // 40 in × 0.30 + 10 out × 2.50, per million.
    expect(Number(rows[0]?.cost_usd)).toBeCloseTo(
      (40 * 0.3 + 10 * 2.5) / 1e6,
      10,
    );
  });
});
