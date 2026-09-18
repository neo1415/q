import { describe, expect, it } from "vitest";

import type { ModelSensitivity } from "@capital-q/contracts";

import {
  createFakeModelProvider,
  createStaticModelCatalog,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  ModelGatewayError,
  type FakeBehaviour,
  type ModelProvider,
} from "../src/index.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * The provider posture matrix (CQ-REC-002R §10; doc 13 §57.2; doc 15 §61-§62).
 *
 * One reviewed catalogue, two providers in the classes the seeded ones
 * hold — `alpha` reviewed under zero retention (Groq's class), `beta`
 * unreviewed (Gemini's class) — and scripted adapters. Every row states,
 * for one sensitivity, which provider may answer and which must never be
 * called. No environment flag, demo switch or test filename changes a
 * row: the posture is the catalogue, and the catalogue is data under
 * migration.
 */

const noSleep = () => Promise.resolve();

function build(
  options: {
    readonly alpha?: readonly FakeBehaviour[] | undefined;
    readonly beta?: readonly FakeBehaviour[] | undefined;
    readonly providers?: readonly ModelProvider[] | undefined;
  } = {},
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: options.alpha ?? [{ kind: "TEXT", text: "alpha says hello" }],
  });
  const beta = createFakeModelProvider({
    code: "beta",
    script: options.beta ?? [{ kind: "TEXT", text: "beta says hello" }],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry(options.providers ?? [alpha, beta]),
    usage: createInMemoryModelUsageRepository(),
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

/** fast_classification.v1 prefers the unreviewed provider's cheap model. */
const LIGHT = { taskClass: "FAST_CLASSIFICATION" } as const;
/** normal_dialogue.v1 prefers the reviewed provider, unreviewed as fallback. */
const DIALOGUE = { taskClass: "NORMAL_DIALOGUE" } as const;

describe("provider posture matrix", () => {
  it("PUBLIC: the unreviewed provider may answer where policy prefers it", async () => {
    const { gateway, alpha, beta } = build();
    const result = await gateway.execute(
      request({ ...LIGHT, sensitivity: "PUBLIC" }),
    );
    expect(result.providerCode).toBe("beta");
    expect(beta.calls).toHaveLength(1);
    expect(alpha.calls).toHaveLength(0);
  });

  it.each<ModelSensitivity>(["NETWORK_VISIBLE", "INTERNAL"])(
    "%s: the unreviewed provider is refused before any call; the reviewed one serves",
    async (sensitivity) => {
      const { gateway, alpha, beta } = build();
      const result = await gateway.execute(request({ ...LIGHT, sensitivity }));
      expect(result.providerCode).toBe("alpha");
      expect(beta.calls).toHaveLength(0);
      expect(alpha.calls).toHaveLength(1);
      expect(result.route.candidates[0]).toMatchObject({
        providerCode: "beta",
        reason: "SENSITIVITY_EXCEEDS_CEILING",
      });
    },
  );

  it("CONFIDENTIAL: only the provider whose reviewed terms carry it; an outage there does not broaden to the unreviewed one", async () => {
    const served = build();
    const ok = await served.gateway.execute(
      request({ ...DIALOGUE, sensitivity: "CONFIDENTIAL" }),
    );
    expect(ok.providerCode).toBe("alpha");
    expect(served.beta.calls).toHaveLength(0);

    const down = build({
      alpha: [
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
        { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
      ],
    });
    const error = await refusal(
      down.gateway.execute(
        request({ ...DIALOGUE, sensitivity: "CONFIDENTIAL" }),
      ),
    );
    expect(error.failureClass).not.toBe("POLICY_INELIGIBLE");
    expect(down.beta.calls).toHaveLength(0);
  });

  it.each<ModelSensitivity>(["HIGHLY_CONFIDENTIAL", "RESTRICTED"])(
    "%s: no configured provider is cleared; refused before any provider attempt",
    async (sensitivity) => {
      const { gateway, alpha, beta } = build();
      const error = await refusal(
        gateway.execute(request({ ...DIALOGUE, sensitivity })),
      );
      expect(error.failureClass).toBe("POLICY_INELIGIBLE");
      expect(alpha.calls).toHaveLength(0);
      expect(beta.calls).toHaveLength(0);
    },
  );

  it("a provider with no configured adapter is skipped as unconfigured, never attempted; the next eligible one serves", async () => {
    const { gateway, alpha } = build({ providers: undefined });
    const alphaOnly = createModelGateway({
      catalog: createStaticModelCatalog(testCatalog()),
      registry: createModelProviderRegistry([alpha]),
      usage: createInMemoryModelUsageRepository(),
      sleep: noSleep,
      random: () => 0.5,
    });
    void gateway;
    const result = await alphaOnly.execute(
      request({ ...LIGHT, sensitivity: "PUBLIC" }),
    );
    expect(result.providerCode).toBe("alpha");
    expect(result.route.candidates[0]).toMatchObject({
      providerCode: "beta",
      reason: "PROVIDER_UNCONFIGURED",
    });
  });

  it("a rate limit falls back along the existing policy without broadening privacy", async () => {
    const { gateway, alpha, beta } = build({
      alpha: [
        {
          kind: "FAIL",
          failureClass: "RATE_LIMIT",
          retryAfterMs: 1,
        },
        { kind: "TEXT", text: "alpha after the limit" },
      ],
    });
    const result = await gateway.execute(
      request({ ...DIALOGUE, sensitivity: "INTERNAL" }),
    );
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
    expect(alpha.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("the same request under the same catalogue routes the same way, every time", async () => {
    const routes = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const { gateway } = build();
      const result = await gateway.execute(
        request({ ...DIALOGUE, sensitivity: "INTERNAL" }),
      );
      routes.add(
        `${result.providerCode}/${result.modelCode}/${String(result.route.selectedCandidateIndex)}`,
      );
    }
    expect(routes.size).toBe(1);
  });
});
