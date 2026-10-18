import { describe, expect, it } from "vitest";

import type { ModelSensitivity } from "@capital-q/contracts";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  createSyntheticDemoRoutingAllowance,
  ModelGatewayError,
  SyntheticDemoRoutingRefusedError,
  type FakeBehaviour,
  type SyntheticDemoRoutingAllowance,
} from "../src/index.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Synthetic-demo routing (CQ-REC-007 §14; doc 15 §62).
 *
 * The rule under test: free/shared inference may be used aggressively for
 * synthetic data and development, while confidential CUSTOMER information
 * still requires an approved provider. The catalogue is the same reviewed
 * one the posture matrix uses — `alpha` reviewed under zero retention
 * (Groq's class, CONFIDENTIAL ceiling), `beta` unreviewed (Gemini's class,
 * PUBLIC ceiling) — and `fast_classification.v1` prefers `beta` with
 * `alpha` behind it, which is the shape migration 20260920 gave the real
 * dialogue, extraction and synthesis policies.
 *
 * Two things must both be true for a row to change, and each half is
 * useless alone: the deployment must hold an attestation, and the request
 * must declare the posture. Nothing here moves a reviewed ceiling, and
 * nothing here rewrites a declared sensitivity.
 */

const noSleep = () => Promise.resolve();

/** The attestation a local demo deployment legitimately builds. */
const demoAllowance = (): SyntheticDemoRoutingAllowance => {
  const allowance = createSyntheticDemoRoutingAllowance({
    operatorEnabled: true,
    environment: "local",
    databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  if (allowance === null) throw new Error("expected an allowance");
  return allowance;
};

function build(
  options: {
    readonly alpha?: readonly FakeBehaviour[] | undefined;
    readonly beta?: readonly FakeBehaviour[] | undefined;
    readonly syntheticDemo?: SyntheticDemoRoutingAllowance | null | undefined;
  } = {},
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: options.alpha ?? [{ kind: "TEXT", text: "alpha answered" }],
  });
  const beta = createFakeModelProvider({
    code: "beta",
    script: options.beta ?? [{ kind: "TEXT", text: "beta answered" }],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry([alpha, beta]),
    usage: createInMemoryModelUsageRepository(),
    syntheticDemo: options.syntheticDemo ?? null,
    sleep: noSleep,
    random: () => 0.5,
  });
  return { gateway, alpha, beta };
}

async function refusal(promise: Promise<unknown>): Promise<ModelGatewayError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ModelGatewayError) return error;
    throw error;
  }
  throw new Error("expected the gateway to refuse");
}

/** A request shaped like the demo work this exists for. */
const demoRequest = (
  sensitivity: ModelSensitivity,
  posture: "REAL_CUSTOMER" | "SYNTHETIC_DEMO",
) =>
  request({
    taskClass: "FAST_CLASSIFICATION",
    sensitivity,
    dataPosture: posture,
  });

describe("synthetic-demo routing (CQ-REC-007)", () => {
  // ---------------------------------------------------------------- A-D
  // Real customer material: this packet changes nothing at all.

  it("A: real PUBLIC work routes by the ordinary policy", async () => {
    const { gateway, alpha, beta } = build();
    const result = await gateway.execute(
      demoRequest("PUBLIC", "REAL_CUSTOMER"),
    );
    // beta is preferred for this task class and its ceiling admits PUBLIC.
    expect(result.providerCode).toBe("beta");
    expect(beta.calls).toHaveLength(1);
    expect(alpha.calls).toHaveLength(0);
    expect(
      result.route.candidates.find((c) => c.providerCode === "beta")?.reason,
    ).toBe("ELIGIBLE");
  });

  it("B: real CONFIDENTIAL work gains the unreviewed provider nothing", async () => {
    const { gateway, alpha, beta } = build();
    const result = await gateway.execute(
      demoRequest("CONFIDENTIAL", "REAL_CUSTOMER"),
    );
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
    expect(alpha.calls).toHaveLength(1);
    expect(
      result.route.candidates.find((c) => c.providerCode === "beta")?.reason,
    ).toBe("SENSITIVITY_EXCEEDS_CEILING");
  });

  it("C/D: real HIGHLY_CONFIDENTIAL and RESTRICTED work reaches no provider", async () => {
    for (const sensitivity of ["HIGHLY_CONFIDENTIAL", "RESTRICTED"] as const) {
      const { gateway, alpha, beta } = build();
      const error = await refusal(
        gateway.execute(demoRequest(sensitivity, "REAL_CUSTOMER")),
      );
      expect(error.failureClass).toBe("POLICY_INELIGIBLE");
      expect(alpha.calls).toHaveLength(0);
      expect(beta.calls).toHaveLength(0);
    }
  });

  // ---------------------------------------------------------------- E-F
  // The posture, and the same payload without it.

  it("E: attested synthetic demo material reaches the preferred provider the ceiling would refuse", async () => {
    const { gateway, alpha, beta } = build({
      syntheticDemo: demoAllowance(),
    });
    const result = await gateway.execute(
      demoRequest("CONFIDENTIAL", "SYNTHETIC_DEMO"),
    );
    expect(result.providerCode).toBe("beta");
    expect(beta.calls).toHaveLength(1);
    expect(alpha.calls).toHaveLength(0);
    // The route says WHICH rule admitted it, rather than leaving an
    // auditor to infer it from a provider that "somehow" qualified.
    expect(
      result.route.candidates.find((c) => c.providerCode === "beta")?.reason,
    ).toBe("ELIGIBLE_SYNTHETIC_DEMO");
    // Neither the sensitivity nor the posture is sent to the vendor: they
    // decide the route and stay behind it.
    expect(beta.calls[0]?.request).not.toHaveProperty("sensitivity");
    expect(beta.calls[0]?.request).not.toHaveProperty("dataPosture");
  });

  it("F: the same payload as real customer material is refused the same provider", async () => {
    const allowance = demoAllowance();
    const { gateway, alpha, beta } = build({ syntheticDemo: allowance });
    const result = await gateway.execute(
      demoRequest("CONFIDENTIAL", "REAL_CUSTOMER"),
    );
    // Identical deployment, identical attestation, identical sensitivity:
    // only the posture differs, and it is the posture that decides.
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
    expect(alpha.calls).toHaveLength(1);
  });

  // ------------------------------------------------------------------ G
  // The forgery case. A declaration without an attestation is inert.

  it("G: a declared posture with no server attestation changes no route", async () => {
    const { gateway, beta } = build({ syntheticDemo: null });
    const result = await gateway.execute(
      demoRequest("CONFIDENTIAL", "SYNTHETIC_DEMO"),
    );
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
    expect(
      result.route.candidates.find((c) => c.providerCode === "beta")?.reason,
    ).toBe("SENSITIVITY_EXCEEDS_CEILING");

    // And it cannot reach anything a reviewed provider would not carry.
    const {
      gateway: strict,
      alpha: a2,
      beta: b2,
    } = build({
      syntheticDemo: null,
    });
    const error = await refusal(
      strict.execute(demoRequest("RESTRICTED", "SYNTHETIC_DEMO")),
    );
    expect(error.failureClass).toBe("POLICY_INELIGIBLE");
    expect(a2.calls).toHaveLength(0);
    expect(b2.calls).toHaveLength(0);
  });

  it("G2: the attestation refuses to exist where the claim cannot be true", () => {
    // Opting out is the ordinary answer, and not an error.
    expect(
      createSyntheticDemoRoutingAllowance({
        operatorEnabled: false,
        environment: "production",
        databaseUrl: "postgresql://user:pw@db.example.com:5432/postgres",
      }),
    ).toBeNull();
    // Opting in where it cannot hold fails at startup rather than quietly.
    for (const options of [
      {
        operatorEnabled: true,
        environment: "production",
        databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      },
      {
        operatorEnabled: true,
        environment: "local",
        databaseUrl: "postgresql://user:pw@db.hosted.example.com:5432/postgres",
      },
      {
        operatorEnabled: true,
        environment: undefined,
        databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      },
    ]) {
      expect(() => createSyntheticDemoRoutingAllowance(options)).toThrow(
        SyntheticDemoRoutingRefusedError,
      );
    }
  });

  // ---------------------------------------------------------------- H-K
  // Behaviour the demo depends on.

  it("H: the configured preference decides, so the demo stops depending on the fallback provider", async () => {
    const { gateway, alpha } = build({
      syntheticDemo: demoAllowance(),
    });
    const result = await gateway.execute(
      demoRequest("CONFIDENTIAL", "SYNTHETIC_DEMO"),
    );
    expect(result.providerCode).toBe("beta");
    expect(result.fallbackUsed).toBe(false);
    expect(alpha.calls).toHaveLength(0);
  });

  it("I: when the preferred provider is rate-limited the ordinary fallback still operates", async () => {
    const { gateway, beta } = build({
      beta: [{ kind: "FAIL", failureClass: "RATE_LIMIT" }],
      syntheticDemo: demoAllowance(),
    });
    const result = await gateway.execute(
      demoRequest("CONFIDENTIAL", "SYNTHETIC_DEMO"),
    );
    expect(beta.calls).toHaveLength(1);
    expect(result.providerCode).toBe("alpha");
    expect(result.fallbackUsed).toBe(true);
  });

  it("J: a provider's own error never reaches the caller verbatim", async () => {
    const { gateway } = build({
      beta: [
        { kind: "THROW_RAW", message: "beta: 429 quota 'projects/secret'" },
      ],
      alpha: [{ kind: "THROW_RAW", message: "alpha: internal trace" }],
      syntheticDemo: demoAllowance(),
    });
    const error = await refusal(
      gateway.execute(demoRequest("CONFIDENTIAL", "SYNTHETIC_DEMO")),
    );
    expect(error.message).not.toContain("quota");
    expect(error.message).not.toContain("projects/secret");
    expect(error.message).not.toContain("internal trace");
  });

  it("K: the same routing context decides the same way every time", async () => {
    const chosen = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { gateway } = build({ syntheticDemo: demoAllowance() });
      const result = await gateway.execute(
        demoRequest("CONFIDENTIAL", "SYNTHETIC_DEMO"),
      );
      chosen.add(`${result.providerCode}/${result.modelCode}`);
    }
    expect(chosen.size).toBe(1);
  });

  it("omitting the posture is REAL_CUSTOMER: silence never becomes a demo", async () => {
    const { gateway, beta } = build({
      syntheticDemo: demoAllowance(),
    });
    const result = await gateway.execute(
      request({
        taskClass: "FAST_CLASSIFICATION",
        sensitivity: "CONFIDENTIAL",
      }),
    );
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
  });
});
