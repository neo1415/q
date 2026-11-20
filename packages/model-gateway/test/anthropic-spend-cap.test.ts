import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createProcessLocalProviderHealth,
  createStaticModelCatalog,
  type ModelProvider,
} from "../src/index.js";
import {
  AnthropicAPIError as APIError,
  normalizeError,
} from "../src/providers/anthropic.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Decision 112: Claude first, OpenAI behind it. The owner's hard spend
 * limit in the Anthropic console refuses every call once it is reached;
 * the person must still get their answer from the next model, never an
 * error, and the capped provider is not called again on the next turn.
 *
 * The preferred candidate here throws exactly what the Anthropic adapter
 * makes of the console's refusal (normalizeError), so the classification
 * and the gateway's fall-over are tested together. No network.
 */

const SPEND_LIMIT =
  "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.";

function capped(): ModelProvider & { calls: number } {
  const base = createFakeModelProvider({ code: "alpha", script: [] });
  const provider = {
    ...base,
    calls: 0,
    generate: () => {
      provider.calls += 1;
      return Promise.reject(
        normalizeError(
          APIError.generate(
            400,
            {
              type: "error",
              error: { type: "invalid_request_error", message: SPEND_LIMIT },
            },
            SPEND_LIMIT,
            new Headers(),
          ),
        ),
      );
    },
  };
  return provider;
}

describe("the Anthropic spend cap (decision 112)", () => {
  it("falls over to the next model, quietly, and sets the capped provider aside", async () => {
    const alpha = capped();
    const beta = createFakeModelProvider({
      code: "beta",
      script: [
        { kind: "TEXT", text: "beta answers" },
        { kind: "TEXT", text: "beta answers again" },
      ],
    });
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(testCatalog()),
      registry: createModelProviderRegistry([alpha, beta]),
      usage: createInMemoryModelUsageRepository(),
      health: createProcessLocalProviderHealth(),
      sleep: () => Promise.resolve(),
      random: () => 0.5,
    });

    const first = await gateway.execute(request());
    expect(first.providerCode).toBe("beta");
    // One refused call: an exhausted account is not retried on itself.
    expect(alpha.calls).toBe(1);

    const second = await gateway.execute(request());
    expect(second.providerCode).toBe("beta");
    expect(alpha.calls).toBe(1);
    expect(second.route.candidates[0]).toMatchObject({
      providerCode: "alpha",
      reason: "PROVIDER_TEMPORARILY_FAILING",
    });
  });
});
