import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ModelGatewayRequestInput } from "@capital-q/contracts";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createProcessLocalProviderHealth,
  createStaticModelCatalog,
  ModelGatewayError,
  type FakeBehaviour,
  type ModelGatewayDependencies,
  type ModelProvider,
} from "../src/index.js";
import { IDS, request, testCatalog } from "./fixtures.js";

/**
 * The gateway against the provider port (packet §54, §83). Every test uses
 * the scripted fake provider and the synthetic catalog; no SDK, no network,
 * no real price.
 */

const PRIVATE_ERROR = "PRIVATE-MODEL-PROVIDER-ERROR-DO-NOT-EMIT";
const noSleep = () => Promise.resolve();

type Built = {
  readonly gateway: ReturnType<typeof createModelGateway>;
  readonly usage: ReturnType<typeof createInMemoryModelUsageRepository>;
  readonly alpha: ReturnType<typeof createFakeModelProvider>;
  readonly beta: ReturnType<typeof createFakeModelProvider>;
  readonly logLines: string[];
};

function build(
  options: {
    readonly alpha?: readonly FakeBehaviour[] | undefined;
    readonly beta?: readonly FakeBehaviour[] | undefined;
    readonly providers?: readonly ModelProvider[] | undefined;
    readonly catalog?: ReturnType<typeof testCatalog> | undefined;
    readonly dependencies?: Partial<ModelGatewayDependencies> | undefined;
  } = {},
): Built {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: options.alpha ?? [{ kind: "TEXT", text: "alpha says hello" }],
  });
  const beta = createFakeModelProvider({
    code: "beta",
    script: options.beta ?? [{ kind: "TEXT", text: "beta says hello" }],
  });
  const usage = createInMemoryModelUsageRepository();
  const logLines: string[] = [];
  const logger = {
    debug: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    info: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    warn: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    error: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    child: () => logger,
  };
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(options.catalog ?? testCatalog()),
    registry: createModelProviderRegistry(options.providers ?? [alpha, beta]),
    usage,
    sleep: noSleep,
    random: () => 0.5,
    logger,
    ...options.dependencies,
  });
  return { gateway, usage, alpha, beta, logLines };
}

async function failure(promise: Promise<unknown>): Promise<ModelGatewayError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ModelGatewayError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the gateway to fail");
}

function dialoguePolicyOf(snapshot: ReturnType<typeof testCatalog>) {
  const policy = snapshot.routingPolicies.find(
    (p) => p.code === "normal_dialogue.v1",
  );
  if (policy === undefined) {
    throw new Error("dialogue policy missing from fixture");
  }
  return policy;
}

describe("routing", () => {
  it("routes a light task to the cheap preferred model and a dialogue to the standard one", async () => {
    const { gateway, alpha, beta } = build();
    const light = await gateway.execute(
      request({ taskClass: "FAST_CLASSIFICATION" }),
    );
    expect(light.providerCode).toBe("beta");
    expect(light.modelCode).toBe("beta-cheap");
    expect(light.routingPolicyCode).toBe("fast_classification.v1");
    expect(light.route.routingPolicyVersion).toBe(1);
    expect(light.fallbackUsed).toBe(false);

    const dialogue = await gateway.execute(
      request({ taskClass: "NORMAL_DIALOGUE" }),
    );
    expect(dialogue.providerCode).toBe("alpha");
    expect(dialogue.modelCode).toBe("alpha-standard");
    expect(beta.calls).toHaveLength(1);
    expect(alpha.calls).toHaveLength(1);
  });

  it("routes a deep task to the HIGH model and enforces the quality floor on fallbacks", async () => {
    const { gateway } = build({
      alpha: [
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
      ],
    });
    const error = await failure(
      gateway.execute(
        request({
          taskClass: "DEEP_INVESTIGATION",
          budget: {
            maxAttempts: 4,
            maxEstimatedCostUsd: 2,
            maxOutputTokens: 256,
            attemptTimeoutMs: 1_000,
          },
        }),
      ),
    );
    // alpha-high failed twice; alpha-standard and beta-cheap are below the HIGH floor.
    expect(error.failureClass).toBe("PROVIDER_OUTAGE");
    expect(error.attempts).toBe(2);
    expect(error.candidates.map((c) => `${c.modelCode}:${c.reason}`)).toEqual([
      "alpha-high:ELIGIBLE",
      "alpha-standard:QUALITY_BELOW_FLOOR",
      "beta-cheap:QUALITY_BELOW_FLOOR",
    ]);
  });

  it("skips a disabled model, an unpriced model and an unconfigured provider, in policy order", async () => {
    const { gateway } = build({
      providers: [
        createFakeModelProvider({
          code: "alpha",
          script: [{ kind: "TEXT", text: "ok" }],
        }),
      ],
    });
    const result = await gateway.execute(
      request({ taskClass: "STRUCTURED_EXTRACTION" }),
    );
    expect(result.modelCode).toBe("alpha-standard");
    expect(
      result.route.candidates.map((c) => `${c.modelCode}:${c.reason}`),
    ).toEqual([
      "alpha-disabled:MODEL_DISABLED",
      "alpha-unpriced:PRICE_UNKNOWN",
      "alpha-standard:ELIGIBLE",
      "beta-cheap:PROVIDER_UNCONFIGURED",
    ]);
  });

  it("rejects models whose context window cannot hold the request", async () => {
    const { gateway } = build();
    const big = "x".repeat(40_000); // ~10k tokens: beta-cheap (8k) cannot, alpha-standard (32k) can
    const result = await gateway.execute(
      request({
        taskClass: "FAST_CLASSIFICATION",
        messages: [{ role: "USER", content: big }],
        budget: {
          maxAttempts: 3,
          maxEstimatedCostUsd: 0.5,
          maxOutputTokens: 256,
          attemptTimeoutMs: 1_000,
        },
      }),
    );
    expect(result.modelCode).toBe("alpha-standard");
    expect(result.route.candidates[0]?.reason).toBe("CONTEXT_WINDOW_TOO_SMALL");
  });

  it("honours a disabled provider as a kill switch and a retired policy", async () => {
    const disabledBeta = testCatalog((s) => ({
      ...s,
      providers: s.providers.map((p) =>
        p.code === "beta" ? { ...p, status: "DISABLED" as const } : p,
      ),
    }));
    const { gateway } = build({ catalog: disabledBeta });
    const result = await gateway.execute(
      request({ taskClass: "FAST_CLASSIFICATION" }),
    );
    expect(result.providerCode).toBe("alpha");
    expect(result.route.candidates[0]?.reason).toBe("PROVIDER_DISABLED");

    const retired = testCatalog((s) => ({
      ...s,
      routingPolicies: s.routingPolicies.map((p) => ({
        ...p,
        status: "RETIRED" as const,
      })),
    }));
    const error = await failure(
      build({ catalog: retired }).gateway.execute(request()),
    );
    expect(error.failureClass).toBe("POLICY_INELIGIBLE");
  });

  it("selects the most specific active policy version for the sensitivity", async () => {
    const layered = testCatalog((s) => ({
      ...s,
      routingPolicies: [
        ...s.routingPolicies,
        {
          ...dialoguePolicyOf(s),
          id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
          code: "normal_dialogue_public.v2",
          sensitivityClass: "PUBLIC" as const,
          qualityFloor: "BASIC" as const,
          version: 2,
          preferredModels: [IDS.betaCheap],
          fallbackModels: [],
        },
      ],
    }));
    const { gateway } = build({ catalog: layered });
    const publicResult = await gateway.execute(
      request({ sensitivity: "PUBLIC" }),
    );
    expect(publicResult.routingPolicyCode).toBe("normal_dialogue_public.v2");
    const internalResult = await gateway.execute(
      request({ sensitivity: "INTERNAL" }),
    );
    expect(internalResult.routingPolicyCode).toBe("normal_dialogue.v1");
  });
});

describe("privacy", () => {
  it("excludes the public-only provider for a confidential request before any call", async () => {
    const { gateway, beta, alpha } = build();
    const result = await gateway.execute(
      request({
        taskClass: "FAST_CLASSIFICATION",
        sensitivity: "CONFIDENTIAL",
      }),
    );
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
    expect(alpha.calls).toHaveLength(1);
    expect(result.route.candidates[0]).toMatchObject({
      providerCode: "beta",
      reason: "SENSITIVITY_EXCEEDS_CEILING",
    });
  });

  it("never lets a fallback broaden privacy: the eligible provider fails, the public-only one is not tried", async () => {
    const { gateway, beta, usage } = build({
      alpha: [{ kind: "FAIL", failureClass: "PROVIDER_OUTAGE" }],
    });
    const error = await failure(
      gateway.execute(request({ sensitivity: "INTERNAL" })),
    );
    expect(error.failureClass).toBe("PROVIDER_OUTAGE");
    expect(beta.calls).toHaveLength(0);
    expect(
      error.candidates.find((c) => c.providerCode === "beta")?.reason,
    ).toBe("SENSITIVITY_EXCEEDS_CEILING");
    expect(usage.entries.every((e) => e.providerId === IDS.alpha)).toBe(true);
  });

  it("refuses a RESTRICTED request outright: no ceiling admits it", async () => {
    const { gateway, alpha, beta } = build();
    const error = await failure(
      gateway.execute(request({ sensitivity: "RESTRICTED" })),
    );
    expect(error.failureClass).toBe("POLICY_INELIGIBLE");
    expect(alpha.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);
  });

  it("enforces tenant provider policy from the request and from the port", async () => {
    const { gateway, alpha } = build();
    const viaRequest = await gateway.execute(
      request({
        taskClass: "FAST_CLASSIFICATION",
        tenantPolicy: { deniedProviderCodes: ["beta"] },
      }),
    );
    expect(viaRequest.providerCode).toBe("alpha");
    expect(viaRequest.route.candidates[0]?.reason).toBe(
      "TENANT_POLICY_DENIES_PROVIDER",
    );

    const { gateway: scoped } = build({
      dependencies: {
        tenantPolicies: {
          policyFor: () =>
            Promise.resolve({
              deniedProviderCodes: [],
              allowedProviderCodes: ["beta"],
            }),
        },
      },
    });
    const error = await failure(
      scoped.execute(request({ sensitivity: "INTERNAL" })),
    );
    expect(error.failureClass).toBe("POLICY_INELIGIBLE");
    expect(alpha.calls).toHaveLength(1);
  });
});

describe("reliability", () => {
  it("falls back to the next eligible candidate on an outage, marks it, and records every attempt", async () => {
    const { gateway, usage } = build({
      alpha: [
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
      ],
    });
    const result = await gateway.execute(request());
    expect(result.providerCode).toBe("beta");
    expect(result.fallbackUsed).toBe(true);
    expect(
      result.attempts.map((a) => `${a.providerCode}:${a.outcome}`),
    ).toEqual([
      "alpha:PROVIDER_OUTAGE",
      "alpha:PROVIDER_OUTAGE",
      "beta:SUCCESS",
    ]);
    expect(usage.entries).toHaveLength(3);
    expect(usage.entries.map((e) => e.success)).toEqual([false, false, true]);
    expect(usage.entries[0]?.errorCode).toBe("PROVIDER_OUTAGE");
    expect(result.output).toEqual({ kind: "TEXT", text: "beta says hello" });
  });

  it("retries a rate limit once with backoff, honouring retry-after, then succeeds", async () => {
    const waits: number[] = [];
    const { gateway } = build({
      alpha: [
        { kind: "FAIL", failureClass: "RATE_LIMIT", retryAfterMs: 1_500 },
        { kind: "TEXT", text: "recovered" },
      ],
      dependencies: {
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    });
    const result = await gateway.execute(request());
    expect(result.providerCode).toBe("alpha");
    expect(result.attempts).toHaveLength(2);
    expect(result.fallbackUsed).toBe(false);
    expect(waits).toEqual([1_500]);
  });

  it("bounds a hung provider by the attempt timeout, retries, then falls back", async () => {
    const { gateway } = build({
      alpha: [{ kind: "HANG" }, { kind: "HANG" }],
    });
    const result = await gateway.execute(
      request({
        budget: {
          maxAttempts: 3,
          maxEstimatedCostUsd: 0.5,
          maxOutputTokens: 256,
          attemptTimeoutMs: 1_000,
        },
      }),
    );
    expect(result.providerCode).toBe("beta");
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      "TIMEOUT",
      "TIMEOUT",
      "SUCCESS",
    ]);
  }, 10_000);

  it("does not retry an authentication failure on the same provider but may fall back", async () => {
    const { gateway, alpha } = build({
      alpha: [{ kind: "FAIL", failureClass: "AUTHENTICATION" }],
    });
    const result = await gateway.execute(request());
    expect(alpha.calls).toHaveLength(1);
    expect(result.providerCode).toBe("beta");
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      "AUTHENTICATION",
      "SUCCESS",
    ]);
  });

  it("fails safely when every provider is unavailable, within the attempt budget", async () => {
    const { gateway, usage } = build({
      alpha: [{ kind: "FAIL", failureClass: "PROVIDER_OUTAGE" }],
      beta: [{ kind: "FAIL", failureClass: "PROVIDER_OUTAGE" }],
    });
    const error = await failure(
      gateway.execute(
        request({
          budget: {
            maxAttempts: 6,
            maxEstimatedCostUsd: 0.5,
            maxOutputTokens: 256,
            attemptTimeoutMs: 1_000,
          },
        }),
      ),
    );
    expect(error.failureClass).toBe("PROVIDER_OUTAGE");
    expect(error.attempts).toBe(4);
    expect(usage.entries).toHaveLength(4);
  });

  it("stops entirely on cancellation: no retry and no fallback", async () => {
    const controller = new AbortController();
    const { gateway, beta, alpha } = build({ alpha: [{ kind: "HANG" }] });
    const pending = gateway.execute(request(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const error = await failure(pending);
    expect(error.failureClass).toBe("CANCELLED");
    expect(alpha.calls).toHaveLength(1);
    expect(beta.calls).toHaveLength(0);

    const already = await failure(
      gateway.execute(request(), { signal: AbortSignal.abort() }),
    );
    expect(already.failureClass).toBe("CANCELLED");
    expect(already.attempts).toBe(0);
  });

  it("temporarily skips a provider that keeps failing, without making an ineligible one eligible", async () => {
    const health = createProcessLocalProviderHealth({
      failureThreshold: 2,
      windowMs: 60_000,
      openForMs: 30_000,
    });
    const { gateway } = build({
      alpha: [{ kind: "FAIL", failureClass: "PROVIDER_OUTAGE" }],
      dependencies: { health },
    });
    await gateway.execute(request()); // alpha fails twice → circuit opens → beta answers
    const next = await gateway.execute(request());
    expect(next.route.candidates[0]).toMatchObject({
      providerCode: "alpha",
      reason: "PROVIDER_TEMPORARILY_FAILING",
    });
    expect(next.providerCode).toBe("beta");
    // A confidential request is still refused rather than routed to beta.
    const error = await failure(
      gateway.execute(request({ sensitivity: "INTERNAL" })),
    );
    expect(error.failureClass).toBe("POLICY_INELIGIBLE");
  });
});

describe("cost", () => {
  it("prices provider-reported usage with the effective snapshot and estimates otherwise", async () => {
    const { gateway } = build({
      alpha: [
        {
          kind: "TEXT",
          text: "priced",
          usage: {
            inputTokens: 1_000,
            cachedInputTokens: 0,
            outputTokens: 500,
          },
        },
        { kind: "TEXT", text: "estimated output text" },
      ],
    });
    const priced = await gateway.execute(request());
    expect(priced.cost).toMatchObject({
      currency: "USD",
      amount: 0.003,
      basis: "PRICE_SNAPSHOT",
    });
    const estimated = await gateway.execute(request());
    expect(estimated.cost.basis).toBe("ESTIMATED");
    expect(estimated.cost.amount).toBeGreaterThan(0);
    expect(estimated.usage.inputTokens).toBeGreaterThan(0);
  });

  it("rejects a route whose estimate exceeds the budget before any call", async () => {
    const { gateway, alpha, beta } = build();
    const error = await failure(
      gateway.execute(
        request({
          budget: {
            maxAttempts: 3,
            maxEstimatedCostUsd: 0.00001,
            maxOutputTokens: 1_024,
            attemptTimeoutMs: 1_000,
          },
        }),
      ),
    );
    expect(error.failureClass).toBe("BUDGET_EXCEEDED");
    expect(alpha.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);
    expect(
      error.candidates.every((c) => c.reason === "COST_EXCEEDS_CEILING"),
    ).toBe(true);
  });

  it("counts retries and fallbacks toward the same cost budget", async () => {
    // Each alpha attempt at 256 output tokens is ~0.00106 USD; a budget of
    // 0.0015 allows one attempt, not a retry.
    const { gateway, alpha } = build({
      alpha: [
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
        { kind: "TEXT", text: "would have recovered" },
      ],
      beta: [{ kind: "FAIL", failureClass: "PROVIDER_OUTAGE" }],
    });
    const error = await failure(
      gateway.execute(
        request({
          budget: {
            maxAttempts: 4,
            maxEstimatedCostUsd: 0.0015,
            maxOutputTokens: 256,
            attemptTimeoutMs: 1_000,
          },
        }),
      ),
    );
    expect(alpha.calls).toHaveLength(1);
    expect(error.attempts).toBeGreaterThanOrEqual(1);
    expect(["BUDGET_EXCEEDED", "PROVIDER_OUTAGE"]).toContain(
      error.failureClass,
    );
  });

  it("bounds attempts by the budget across candidates", async () => {
    const { gateway } = build({
      alpha: [{ kind: "FAIL", failureClass: "TRANSIENT" }],
      beta: [{ kind: "FAIL", failureClass: "TRANSIENT" }],
    });
    const error = await failure(
      gateway.execute(
        request({
          budget: {
            maxAttempts: 2,
            maxEstimatedCostUsd: 0.5,
            maxOutputTokens: 256,
            attemptTimeoutMs: 1_000,
          },
        }),
      ),
    );
    expect(error.attempts).toBe(2);
  });
});

describe("structured output", () => {
  const Category = z
    .object({
      category: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
    })
    .strict();
  const structured = (): ModelGatewayRequestInput =>
    request({
      taskClass: "FAST_CLASSIFICATION",
      output: {
        kind: "STRUCTURED",
        schemaName: "Category",
        jsonSchema: z.toJSONSchema(Category),
      },
    });

  it("accepts JSON the schema validates, typed", async () => {
    const { gateway } = build({
      beta: [
        {
          kind: "JSON",
          value: { category: "investment_software", confidence: "high" },
        },
      ],
    });
    const result = await gateway.execute(structured(), { schema: Category });
    expect(result.output).toEqual({
      kind: "STRUCTURED",
      value: { category: "investment_software", confidence: "high" },
    });
  });

  it("classifies invalid JSON and schema mismatches as INVALID_MODEL_OUTPUT, retries once, then falls back", async () => {
    const { gateway, usage } = build({
      beta: [
        { kind: "TEXT", text: "not json at all" },
        { kind: "JSON", value: { category: "x", confidence: "certain" } },
      ],
      alpha: [
        {
          kind: "JSON",
          value: { category: "investment_software", confidence: "medium" },
        },
      ],
    });
    const result = await gateway.execute(structured(), { schema: Category });
    expect(result.providerCode).toBe("alpha");
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      "INVALID_MODEL_OUTPUT",
      "INVALID_MODEL_OUTPUT",
      "SUCCESS",
    ]);
    expect(
      usage.entries.filter((e) => e.errorCode === "INVALID_MODEL_OUTPUT"),
    ).toHaveLength(2);
  });

  it("never accepts malformed output when no fallback is left", async () => {
    const { gateway } = build({
      beta: [{ kind: "JSON", value: { wrong: true } }],
      alpha: [{ kind: "JSON", value: { wrong: true } }],
    });
    const error = await failure(
      gateway.execute(structured(), { schema: Category }),
    );
    expect(error.failureClass).toBe("INVALID_MODEL_OUTPUT");
  });

  it("tolerates a fenced JSON block and refuses a structured request without a schema", async () => {
    const { gateway } = build({
      beta: [
        {
          kind: "TEXT",
          text: '```json\n{"category":"fintech","confidence":"low"}\n```',
        },
      ],
    });
    const result = await gateway.execute(structured(), { schema: Category });
    expect(result.output).toMatchObject({
      kind: "STRUCTURED",
      value: { category: "fintech" },
    });
    const error = await failure(gateway.execute(structured()));
    expect(error.failureClass).toBe("INVALID_REQUEST");
  });
});

describe("boundaries", () => {
  it("rejects a request that names a provider or model", async () => {
    const { gateway } = build();
    const error = await failure(
      gateway.execute({
        ...request(),
        provider: "beta",
        model: "beta-cheap",
      } as unknown as ModelGatewayRequestInput),
    );
    expect(error.failureClass).toBe("INVALID_REQUEST");
    expect(error.attempts).toBe(0);
  });

  it("keeps a provider's raw error out of the gateway error, the ledger and the logs", async () => {
    const { gateway, usage, logLines } = build({
      alpha: [
        {
          kind: "FAIL",
          failureClass: "PROVIDER_OUTAGE",
          cause: new Error(`upstream said: ${PRIVATE_ERROR}`),
        },
        { kind: "THROW_RAW", message: `raw sdk exception ${PRIVATE_ERROR}` },
      ],
      beta: [
        { kind: "FAIL", failureClass: "PERMANENT", message: "beta refused" },
      ],
    });
    const error = await failure(gateway.execute(request()));
    expect(error.message).not.toContain(PRIVATE_ERROR);
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(
      PRIVATE_ERROR,
    );
    expect(JSON.stringify(usage.entries)).not.toContain(PRIVATE_ERROR);
    expect(logLines.join("\n")).not.toContain(PRIVATE_ERROR);
    expect(error.attempts).toBe(3);
    expect(error.failureClass).toBe("PERMANENT");
  });

  it("surfaces only normalized metadata: no raw response, no reasoning field", async () => {
    const { gateway } = build();
    const result = await gateway.execute(request());
    expect(Object.keys(result).sort()).toEqual(
      [
        "attempts",
        "completedAt",
        "cost",
        "fallbackUsed",
        "finish",
        "latencyMs",
        "modelCode",
        "output",
        "providerCode",
        "route",
        "routingPolicyCode",
        "taskClass",
        "usage",
      ].sort(),
    );
  });

  it("keeps serving when the usage ledger write fails, and says so in the logs", async () => {
    const { gateway, logLines } = build({
      dependencies: {
        usage: { record: () => Promise.reject(new Error("ledger down")) },
      },
    });
    const result = await gateway.execute(request());
    expect(result.output).toEqual({ kind: "TEXT", text: "alpha says hello" });
    expect(
      logLines.some((l) => l.includes("model usage ledger write failed")),
    ).toBe(true);
  });
});
