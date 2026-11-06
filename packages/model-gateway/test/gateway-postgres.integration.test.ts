import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createAnthropicWireDouble } from "../src/providers/anthropic-wire-double.js";
import {
  createFakeModelProvider,
  type ModelProvider,
  createStaticModelCatalog,
  providerJustifiedCeiling,
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

  it("loads the seeded catalog: four providers, fourteen models, versioned prices, eight active policies", async () => {
    const snapshot = await loadModelCatalogSnapshot(db.sql, new Date());
    const catalog = indexCatalog(snapshot);
    expect(snapshot.providers.map((p) => p.code).sort()).toEqual([
      // 20261231280000 (DECISIONS 62): staged behind RETIRED v2 policies.
      "anthropic",
      "google",
      "groq",
      // 20261006090000: added as a diagnostic provider; reviewed for
      // dialogue in 20261006100000.
      "openai",
    ]);
    // gemini-3.5-flash (20261008120000) and the two image models
    // (20261113010000) joined the original five; gpt-realtime-mini
    // (20261203090000) for duplex voice; gemini-3.1-flash-lite-image
    // (20261220192000) and gpt-live-1 (20261221090000).
    expect(snapshot.models.map((m) => m.modelCode).sort()).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "gemini-2.5-flash-image",
      "gemini-3.1-flash-lite-image",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.8-flash",
      "gpt-5.6-luna",
      "gpt-image-1",
      "gpt-live-1",
      "gpt-realtime-mini",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
    ]);
    // Seven Q policies, plus UI_TRANSLATION (20261228150500).
    expect(
      snapshot.routingPolicies.filter((p) => p.status === "ACTIVE"),
    ).toHaveLength(8);

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

  it("loads step 7's reasoning levels from the routing policy (20261231260000)", async () => {
    const snapshot = await loadModelCatalogSnapshot(db.sql, new Date());
    const dialogue = snapshot.routingPolicies.find(
      (p) => p.status === "ACTIVE" && p.taskClass === "NORMAL_DIALOGUE",
    );
    expect(dialogue?.reasoningLevels).toEqual({
      ANSWER_CHAT: "NONE",
      ANSWER_LOOKUP: "NONE",
      ANSWER_FOLLOW_UP: "LOW",
      ANSWER_COMPARISON: "MEDIUM",
      ANSWER_ANALYSIS: "MEDIUM",
      ANSWER_DOCUMENT: "MEDIUM",
    });
    const classification = snapshot.routingPolicies.find(
      (p) => p.status === "ACTIVE" && p.taskClass === "FAST_CLASSIFICATION",
    );
    expect(classification?.reasoningLevels ?? null).toBeNull();
  });

  it("v1: a CONFIDENTIAL request has no second route when OpenAI's credit is spent (Groq rolled back, 20261231310000)", async () => {
    // The v1 policies name no other CONFIDENTIAL model since the rollback;
    // Claude is the backup only behind the v2 switch (tested below). The
    // request fails with the account's own class, and neither Groq nor
    // Gemini (PUBLIC-only) is asked.
    const openai = createFakeModelProvider({
      code: "openai",
      script: [
        { kind: "FAIL", failureClass: "PERMANENT", accountExhausted: true },
      ],
    });
    const groq = createFakeModelProvider({
      code: "groq",
      script: [{ kind: "TEXT", text: "must never be reached" }],
    });
    const google = createFakeModelProvider({
      code: "google",
      script: [{ kind: "TEXT", text: "must never be reached" }],
    });
    const gateway = createModelGateway({
      catalog: createPostgresModelCatalog({ sql: db.sql, cacheTtlMs: 0 }),
      registry: createModelProviderRegistry([openai, groq, google]),
      usage: createPostgresModelUsageRepository({ sql: db.sql }),
      sleep: () => Promise.resolve(),
    });
    const failed = await gateway
      .execute({
        taskClass: "NORMAL_DIALOGUE",
        sensitivity: "CONFIDENTIAL",
        messages: [
          { role: "USER", content: "Synthetic confidential test sentence." },
        ],
        output: { kind: "TEXT" },
        budget: {
          maxAttempts: 3,
          maxEstimatedCostUsd: 0.5,
          maxOutputTokens: 256,
          attemptTimeoutMs: 5_000,
        },
        attribution: { tenantId, correlationId: "cor_v1_no_groq" },
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failed).toBeInstanceOf(ModelGatewayError);
    expect((failed as ModelGatewayError).failureClass).toBe("PERMANENT");
    expect(openai.calls).toHaveLength(1);
    expect(groq.calls).toHaveLength(0);
    expect(google.calls).toHaveLength(0);
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
    const openai = createFakeModelProvider({
      code: "openai",
      script: [
        {
          kind: "TEXT",
          text: "synthetic openai answer",
          usage: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 12 },
        },
      ],
    });
    const gateway = createModelGateway({
      catalog: createPostgresModelCatalog({ sql: db.sql, cacheTtlMs: 0 }),
      registry: createModelProviderRegistry([google, groq, openai]),
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

    // INTERNAL: unverified gemini is excluded before any call; the reviewed
    // fallback serves. Since 20261008120000 Groq is in no routing policy and
    // gpt-5.6-luna (reviewed, CONFIDENTIAL ceiling) is the fallback here.
    const internal = await gateway.execute({
      ...base,
      taskClass: "FAST_CLASSIFICATION",
      sensitivity: "INTERNAL",
    });
    expect(internal.providerCode).toBe("openai");
    expect(internal.modelCode).toBe("gpt-5.6-luna");
    // Not a fallback: nothing eligible was tried before it. The first
    // candidate was refused on privacy, not on availability.
    expect(internal.fallbackUsed).toBe(false);
    expect(internal.route.selectedCandidateIndex).toBe(1);
    expect(internal.route.candidates[0]).toMatchObject({
      providerCode: "google",
      reason: "SENSITIVITY_EXCEEDS_CEILING",
    });
    expect(google.calls).toHaveLength(1);

    // CONFIDENTIAL now routes, and only to the provider whose reviewed
    // terms justify it: OpenAI under zero data retention (20261006100000). Gemini
    // stays unreviewed and public-only, so it must not be the one that
    // answers.
    await gateway.execute({
      ...base,
      taskClass: "NORMAL_DIALOGUE",
      sensitivity: "CONFIDENTIAL",
    });
    expect(google.calls).toHaveLength(1);
    expect(openai.calls).toHaveLength(2);

    // NETWORK_VISIBLE is above PUBLIC: the unreviewed provider is refused
    // before any call and the reviewed one serves, exactly as for INTERNAL.
    const network = await gateway.execute({
      ...base,
      taskClass: "FAST_CLASSIFICATION",
      sensitivity: "NETWORK_VISIBLE",
    });
    expect(network.providerCode).toBe("openai");
    expect(network.route.candidates[0]).toMatchObject({
      providerCode: "google",
      reason: "SENSITIVITY_EXCEEDS_CEILING",
    });
    expect(google.calls).toHaveLength(1);
    expect(openai.calls).toHaveLength(3);
    expect(groq.calls).toHaveLength(0);

    // HIGHLY_CONFIDENTIAL: no reviewed class reaches it (CQ-C5-R2A), so the
    // request is refused before any provider attempt.
    let above: ModelGatewayError | undefined;
    try {
      await gateway.execute({
        ...base,
        taskClass: "NORMAL_DIALOGUE",
        sensitivity: "HIGHLY_CONFIDENTIAL",
      });
    } catch (error: unknown) {
      above = error instanceof ModelGatewayError ? error : undefined;
    }
    expect(above?.failureClass).toBe("POLICY_INELIGIBLE");
    expect(google.calls).toHaveLength(1);
    expect(openai.calls).toHaveLength(3);
    expect(groq.calls).toHaveLength(0);

    // RESTRICTED: nothing seeded is cleared for it, and no token is sent
    // anywhere. Approving a vendor for confidential work is not approving
    // it for everything.
    let denied: ModelGatewayError | undefined;
    try {
      await gateway.execute({
        ...base,
        taskClass: "NORMAL_DIALOGUE",
        sensitivity: "RESTRICTED",
      });
    } catch (error: unknown) {
      denied = error instanceof ModelGatewayError ? error : undefined;
    }
    expect(denied?.failureClass).toBe("POLICY_INELIGIBLE");
    expect(google.calls).toHaveLength(1);
    expect(openai.calls).toHaveLength(3);
    expect(groq.calls).toHaveLength(0);

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
    // Four ledger rows now: the public run, the INTERNAL run, the
    // CONFIDENTIAL run that OpenAI's reviewed zero-retention terms admit, and
    // the NETWORK_VISIBLE classification OpenAI carried because Gemini's
    // reviewed ceiling stops at PUBLIC. The RESTRICTED and HIGHLY_CONFIDENTIAL
    // attempts are refused before a provider is contacted, so they leave no
    // row — a refusal costs nothing and is not an execution.
    expect(rows.map((r) => [r.model_code, r.success, r.cost_basis])).toEqual([
      ["gemini-3.5-flash-lite", true, "PRICE_SNAPSHOT"],
      ["gpt-5.6-luna", true, "PRICE_SNAPSHOT"],
      ["gpt-5.6-luna", true, "PRICE_SNAPSHOT"],
      ["gpt-5.6-luna", true, "PRICE_SNAPSHOT"],
    ]);
    expect(Number(rows[0]?.cost_usd)).toBeGreaterThan(0);
    // 40 in × 0.30 + 10 out × 2.50, per million.
    expect(Number(rows[0]?.cost_usd)).toBeCloseTo(
      (40 * 0.3 + 10 * 2.5) / 1e6,
      10,
    );
  });

  it("routes CONFIDENTIAL reasoning OpenAI -> Claude -> Groq once the v2 policies are switched on (20261231280000, 20261231300000)", async () => {
    const loaded = await loadModelCatalogSnapshot(db.sql, new Date());
    // Before the switch nothing reaches Claude: the staged rows are RETIRED.
    const anthropicModels = new Set(
      loaded.models
        .filter((m) => m.modelCode.startsWith("claude-"))
        .map((m) => m.id),
    );
    expect(anthropicModels.size).toBe(2);
    for (const policy of loaded.routingPolicies) {
      if (policy.status !== "ACTIVE") continue;
      for (const id of [...policy.preferredModels, ...policy.fallbackModels]) {
        expect(anthropicModels.has(id)).toBe(false);
      }
    }
    // The owner's approval lifts the reviewed INTERNAL to CONFIDENTIAL.
    const anthropic = loaded.providers.find((p) => p.code === "anthropic");
    expect(anthropic?.ownerApprovedCeiling).toBe("CONFIDENTIAL");
    expect(anthropic?.supportsZeroRetention).toBe(false);
    if (anthropic === undefined) throw new Error("anthropic missing");
    expect(providerJustifiedCeiling(anthropic)).toBe("CONFIDENTIAL");

    // The switch, applied to the loaded rows exactly as the SQL applies it
    // (status = 'ACTIVE' on the v2 codes), without touching the shared DB.
    const switched = {
      ...loaded,
      routingPolicies: loaded.routingPolicies.map((p) =>
        p.version === 2 ? { ...p, status: "ACTIVE" as const } : p,
      ),
    };
    const text = (code: string, answer: string) =>
      createFakeModelProvider({
        code,
        script: [
          {
            kind: "TEXT",
            text: answer,
            usage: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 12 },
          },
        ],
      });
    const exhausted = (code: string) =>
      createFakeModelProvider({
        code,
        script: [
          {
            kind: "FAIL",
            failureClass: "PERMANENT",
            accountExhausted: true,
          },
        ],
      });
    const runId = randomUUID();
    const confidential = (
      taskClass: "NORMAL_DIALOGUE" | "FAST_CLASSIFICATION",
    ) => ({
      taskClass,
      sensitivity: "CONFIDENTIAL" as const,
      messages: [
        { role: "USER" as const, content: "Synthetic confidential question." },
      ],
      output: { kind: "TEXT" as const },
      budget: {
        maxAttempts: 4,
        maxEstimatedCostUsd: 0.2,
        maxOutputTokens: 256,
        attemptTimeoutMs: 5_000,
      },
      attribution: { tenantId, qRunId: runId, correlationId: "cor_claude" },
    });
    const gatewayWith = (providers: readonly ModelProvider[]) =>
      createModelGateway({
        catalog: createStaticModelCatalog(switched),
        registry: createModelProviderRegistry(providers),
        usage: createPostgresModelUsageRepository({ sql: db.sql }),
      });

    // Switched on, OpenAI still answers first (DECISIONS 67, 20261231300000).
    const all = gatewayWith([
      text("anthropic", "claude"),
      text("openai", "openai"),
      text("groq", "groq"),
      text("google", "google"),
    ]);
    const answered = await all.execute(confidential("NORMAL_DIALOGUE"));
    expect(answered.routingPolicyCode).toBe("normal_dialogue.v2");
    expect(answered.modelCode).toBe("gpt-5.6-luna");

    // OpenAI's credit exhausted: Claude answers, through the real adapter
    // and SDK over the Messages API's wire shapes -- Sonnet for the
    // answer, Haiku for the reader's class.
    const wire = createAnthropicWireDouble(text("anthropic", "claude"));
    const toClaude = gatewayWith([
      wire,
      exhausted("openai"),
      text("groq", "groq"),
      text("google", "google"),
    ]);
    const backup = await toClaude.execute(confidential("NORMAL_DIALOGUE"));
    expect(backup.providerCode).toBe("anthropic");
    expect(backup.modelCode).toBe("claude-sonnet-5-5");
    expect(backup.fallbackUsed).toBe(true);
    expect(backup.output).toEqual({ kind: "TEXT", text: "claude" });
    expect(backup.attempts.map((a) => a.providerCode)).toEqual([
      "openai",
      "anthropic",
    ]);
    const read = await toClaude.execute(confidential("FAST_CLASSIFICATION"));
    expect(read.modelCode).toBe("claude-haiku-5-5");
    expect(wire.refusals).toEqual([]);

    // OpenAI and Claude both empty: Groq answers.
    const toGroq = await gatewayWith([
      exhausted("anthropic"),
      exhausted("openai"),
      text("groq", "groq"),
      text("google", "google"),
    ]).execute(confidential("NORMAL_DIALOGUE"));
    expect(toGroq.providerCode).toBe("groq");
    expect(toGroq.attempts.map((a) => a.providerCode)).toEqual([
      "openai",
      "anthropic",
      "groq",
    ]);

    // All three empty: the PUBLIC-only Gemini is never sent the
    // CONFIDENTIAL request; the call fails rather than widening.
    const google = text("google", "google");
    await expect(
      gatewayWith([
        exhausted("anthropic"),
        exhausted("openai"),
        exhausted("groq"),
        google,
      ]).execute(confidential("NORMAL_DIALOGUE")),
    ).rejects.toBeInstanceOf(ModelGatewayError);
    expect(google.calls).toHaveLength(0);
  });
});
