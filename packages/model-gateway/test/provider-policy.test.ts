import { describe, expect, it } from "vitest";

import {
  ModelGatewayRequestSchema,
  type ModelSensitivity,
  type ProviderPrivacyPolicyClass,
} from "@capital-q/contracts";

import { indexCatalog, type ModelCatalogSnapshot } from "../src/catalog.js";
import {
  planRoute,
  providerJustifiedCeiling,
} from "../src/policy/eligibility.js";
import {
  createFakeModelProvider,
  createModelProviderRegistry,
  createProcessLocalProviderHealth,
} from "../src/index.js";
import { IDS, request, testCatalog } from "./fixtures.js";

/**
 * The provider data-use gate (CQ-C5-R2A §20-§25, §34).
 *
 * A model's `sensitivity_ceiling` says what that model may be sent. It used
 * to be the only thing eligibility read, which meant one edit to one row —
 * raising a ceiling — could send a founder's confidential material to a
 * vendor whose terms nobody had verified. Nothing else in the system would
 * have objected.
 *
 * These tests hold the second opinion: the provider's reviewed class is an
 * independent limit, and a request must satisfy both. The cases below are
 * chosen so that passing them requires the gate to exist rather than the
 * fixtures to happen to agree — every one of them uses a model whose OWN
 * ceiling admits the request.
 */

const CLASS_CEILINGS: readonly (readonly [
  ProviderPrivacyPolicyClass,
  boolean,
  ModelSensitivity,
])[] = [
  ["UNREVIEWED", false, "PUBLIC"],
  ["TRAINING_PERMITTED", false, "PUBLIC"],
  // A vendor that offers zero retention but has not had it enabled for this
  // account has offered nothing that applies to us.
  ["TRAINING_PERMITTED", true, "PUBLIC"],
  ["NO_TRAINING_DEFAULT_RETENTION", false, "INTERNAL"],
  ["NO_TRAINING_DEFAULT_RETENTION", true, "INTERNAL"],
  ["NO_TRAINING_ZERO_RETENTION", false, "INTERNAL"],
  ["NO_TRAINING_ZERO_RETENTION", true, "CONFIDENTIAL"],
  ["ENTERPRISE_CONTRACT", false, "CONFIDENTIAL"],
];

function provider(
  privacyPolicyClass: ProviderPrivacyPolicyClass,
  supportsZeroRetention: boolean,
) {
  return {
    id: IDS.alpha,
    code: "alpha" as const,
    name: "Alpha",
    status: "ACTIVE" as const,
    privacyPolicyClass,
    supportsZeroRetention,
    regionSupport: ["global"],
  };
}

/**
 * A catalog whose ONE routable model has a CONFIDENTIAL ceiling, so the
 * model never refuses and every refusal below is the provider gate.
 */
function catalogWith(
  privacyPolicyClass: ProviderPrivacyPolicyClass,
  supportsZeroRetention: boolean,
  modelCeiling: ModelSensitivity = "CONFIDENTIAL",
): ModelCatalogSnapshot {
  return testCatalog((snapshot) => ({
    ...snapshot,
    providers: snapshot.providers.map((existing) =>
      existing.id === IDS.alpha
        ? { ...existing, privacyPolicyClass, supportsZeroRetention }
        : existing,
    ),
    models: snapshot.models.map((existing) =>
      existing.id === IDS.alphaStandard
        ? { ...existing, sensitivityCeiling: modelCeiling }
        : existing,
    ),
  }));
}

function route(snapshot: ModelCatalogSnapshot, sensitivity: ModelSensitivity) {
  const catalog = indexCatalog(snapshot);
  const policy = snapshot.routingPolicies.find(
    (candidate) => candidate.id === IDS.dialoguePolicy,
  );
  if (policy === undefined) {
    throw new Error("dialogue policy missing from the fixture catalog");
  }
  return planRoute(
    {
      catalog,
      // The gateway parses the caller's input into a request before
      // routing; the same normalisation applies here so the fixture is the
      // shape planRoute actually receives.
      request: ModelGatewayRequestSchema.parse(request({ sensitivity })),
      registry: createModelProviderRegistry([
        createFakeModelProvider({ code: "alpha", script: [] }),
        createFakeModelProvider({ code: "beta", script: [] }),
      ]),
      health: createProcessLocalProviderHealth(),
      requiredCapabilities: [],
      // No tenant narrowing: this suite is about the provider's own terms.
      tenantPolicy: undefined,
      estimatedInputTokens: 500,
      now: new Date("2026-09-08T00:00:00.000Z"),
    },
    policy,
  );
}

describe("R2A-P01 · a provider's reviewed terms cap what it may be sent", () => {
  it.each(CLASS_CEILINGS)(
    "%s with zero retention %s justifies at most %s",
    (privacyPolicyClass, supportsZeroRetention, expected) => {
      expect(
        providerJustifiedCeiling(
          provider(privacyPolicyClass, supportsZeroRetention),
        ),
      ).toBe(expected);
    },
  );

  it("never justifies more than CONFIDENTIAL, whatever the class", () => {
    // The strongest material Capital Q holds does not leave it through a
    // model provider under any review short of a decision nobody has made.
    for (const [privacyPolicyClass] of CLASS_CEILINGS) {
      for (const zeroRetention of [true, false]) {
        const ceiling = providerJustifiedCeiling(
          provider(privacyPolicyClass, zeroRetention),
        );
        expect(ceiling).not.toBe("HIGHLY_CONFIDENTIAL");
        expect(ceiling).not.toBe("RESTRICTED");
      }
    }
  });
});

describe("R2A-P02 · raising a model ceiling alone cannot bypass review", () => {
  it("refuses CONFIDENTIAL to an unreviewed provider even when the model admits it", () => {
    // The exact mistake this gate exists to make impossible: someone edits
    // one model row to unblock a demo, and confidential customer data starts
    // reaching a vendor whose terms were never read.
    const plan = route(catalogWith("UNREVIEWED", false), "CONFIDENTIAL");
    expect(plan.eligible).toHaveLength(0);
    expect(plan.decisions.map((decision) => decision.reason)).toContain(
      "PROVIDER_POLICY_INSUFFICIENT",
    );
  });

  it("refuses CONFIDENTIAL when zero retention is offered but not enabled", () => {
    const plan = route(
      catalogWith("NO_TRAINING_ZERO_RETENTION", false),
      "CONFIDENTIAL",
    );
    expect(plan.eligible).toHaveLength(0);
    expect(plan.decisions.map((decision) => decision.reason)).toContain(
      "PROVIDER_POLICY_INSUFFICIENT",
    );
  });

  it("allows CONFIDENTIAL once the class and the enabled flag agree", () => {
    const plan = route(
      catalogWith("NO_TRAINING_ZERO_RETENTION", true),
      "CONFIDENTIAL",
    );
    expect(plan.eligible.length).toBeGreaterThan(0);
    expect(plan.eligible[0]?.provider.code).toBe("alpha");
  });

  it("still refuses RESTRICTED to the best-reviewed provider there is", () => {
    // Approving a vendor for confidential work is not approving it for
    // everything (§25, §34).
    for (const klass of [
      "NO_TRAINING_ZERO_RETENTION",
      "ENTERPRISE_CONTRACT",
    ] as const) {
      const plan = route(catalogWith(klass, true), "RESTRICTED");
      expect(plan.eligible).toHaveLength(0);
    }
  });

  it("records the model's own refusal when both limits would refuse", () => {
    // The more specific fact is the more useful one in a route explanation.
    const plan = route(
      catalogWith("UNREVIEWED", false, "PUBLIC"),
      "CONFIDENTIAL",
    );
    expect(plan.decisions.map((decision) => decision.reason)).toContain(
      "SENSITIVITY_EXCEEDS_CEILING",
    );
  });
});
