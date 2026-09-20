import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  createSyntheticDemoRoutingAllowance,
  ModelGatewayError,
  type FakeBehaviour,
  type SyntheticDemoRoutingAllowance,
} from "../src/index.js";
import { IDS, request, testCatalog } from "./fixtures.js";

/**
 * Extraction work under a data posture (CQ-REC-008 entry gate 0C; doc 15
 * §62).
 *
 * REC-007 gave the gateway an attestation and the Q answer path a posture.
 * Every worker request kept declaring nothing, which means REAL_CUSTOMER,
 * which meant a demo full of invented founders still pushed document
 * extraction through the reviewed provider and its free tier. These rows
 * are the fix stated as behaviour.
 *
 * The catalogue here is mutated so the unreviewed provider is PREFERRED for
 * STRUCTURED_EXTRACTION, because the seeded one is: `structured_extraction.v1`
 * lists `gemini-3.5-flash-lite` first with Groq models behind it. A fixture
 * that quietly preferred the reviewed provider would pass whatever the
 * posture did, and prove nothing.
 *
 * Extraction is declared CONFIDENTIAL and stays CONFIDENTIAL in every row.
 * Nothing below rewrites a sensitivity or moves a ceiling; the only
 * question asked is whose data it is.
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

/** The seeded shape: the free tier first, the reviewed provider behind it. */
const freeTierFirstForExtraction = testCatalog((snapshot) => ({
  ...snapshot,
  routingPolicies: snapshot.routingPolicies.map((policy) =>
    policy.taskClass === "STRUCTURED_EXTRACTION"
      ? {
          ...policy,
          preferredModels: [IDS.betaCheap],
          fallbackModels: [IDS.alphaStandard],
        }
      : policy,
  ),
}));

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
    catalog: createStaticModelCatalog(freeTierFirstForExtraction),
    registry: createModelProviderRegistry([alpha, beta]),
    usage: createInMemoryModelUsageRepository(),
    syntheticDemo: options.syntheticDemo ?? null,
    sleep: noSleep,
    random: () => 0.5,
  });
  return { gateway, alpha, beta };
}

const extraction = (posture: "REAL_CUSTOMER" | "SYNTHETIC_DEMO") =>
  request({
    taskClass: "STRUCTURED_EXTRACTION",
    // A founder's own documents. This never changes.
    sensitivity: "CONFIDENTIAL",
    dataPosture: posture,
  });

describe("extraction under a data posture (CQ-REC-008 gate 0C)", () => {
  it("E: attested synthetic extraction reaches the free tier", async () => {
    const { gateway, alpha, beta } = build({
      syntheticDemo: demoAllowance(),
    });
    const result = await gateway.execute(extraction("SYNTHETIC_DEMO"));
    expect(result.providerCode).toBe("beta");
    expect(beta.calls).toHaveLength(1);
    expect(alpha.calls).toHaveLength(0);
    const admitted = result.route.candidates.find(
      (candidate) => candidate.providerCode === "beta",
    );
    // Named as what it is, never folded into ordinary eligibility.
    expect(admitted?.reason).toBe("ELIGIBLE_SYNTHETIC_DEMO");
  });

  it("G: the same extraction as a customer's keeps the reviewed provider", async () => {
    // Identical words, identical declared sensitivity. Only whose data it
    // is differs, and the unreviewed provider is never called.
    const { gateway, alpha, beta } = build({
      syntheticDemo: demoAllowance(),
    });
    const result = await gateway.execute(extraction("REAL_CUSTOMER"));
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
    expect(alpha.calls).toHaveLength(1);
  });

  it("C/D: a declared posture without an attestation changes nothing", async () => {
    // This is the whole client-forgery story at the gateway: a request may
    // say SYNTHETIC_DEMO all it likes. Without a server attestation the
    // ceilings decide exactly as before.
    const { gateway, alpha, beta } = build({ syntheticDemo: null });
    const result = await gateway.execute(extraction("SYNTHETIC_DEMO"));
    expect(result.providerCode).toBe("alpha");
    expect(alpha.calls).toHaveLength(1);
    expect(beta.calls).toHaveLength(0);
  });

  it("F: a failing free tier falls back to the reviewed provider", async () => {
    const { gateway, alpha, beta } = build({
      syntheticDemo: demoAllowance(),
      beta: [{ kind: "FAIL", failureClass: "RATE_LIMIT" }],
    });
    const result = await gateway.execute(extraction("SYNTHETIC_DEMO"));
    expect(result.providerCode).toBe("alpha");
    expect(result.fallbackUsed).toBe(true);
    expect(beta.calls).toHaveLength(1);
    expect(alpha.calls).toHaveLength(1);
  });

  it("G2: attested or not, material above every ceiling reaches nobody", async () => {
    // The posture is not a skeleton key. RESTRICTED has no route in this
    // catalogue and does not acquire one.
    const { gateway, alpha, beta } = build({
      syntheticDemo: demoAllowance(),
    });
    const refused = await gateway
      .execute(
        request({
          taskClass: "STRUCTURED_EXTRACTION",
          sensitivity: "RESTRICTED",
          dataPosture: "REAL_CUSTOMER",
        }),
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(ModelGatewayError);
    expect(alpha.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);
  });

  it("omitting the posture is REAL_CUSTOMER, which is what every worker had", async () => {
    const { gateway, alpha, beta } = build({
      syntheticDemo: demoAllowance(),
    });
    const result = await gateway.execute(
      request({
        taskClass: "STRUCTURED_EXTRACTION",
        sensitivity: "CONFIDENTIAL",
      }),
    );
    expect(result.providerCode).toBe("alpha");
    expect(alpha.calls).toHaveLength(1);
    expect(beta.calls).toHaveLength(0);
  });
});
