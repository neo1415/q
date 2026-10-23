import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { GEMINI_ENABLED_ENV, geminiEnabled } from "../src/providers/google.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Owner 2026-10-23: "I'm not paying for Gemini." The apps register it only
 * when CQ_GEMINI_ENABLED=1. A preferred model whose provider is not
 * registered is passed over before any attempt, so the policy's next
 * model answers first: no 402, no 2-4 s detour, no fallback.
 */
describe("Gemini off unless switched on", () => {
  it("is on only for an explicit 1", () => {
    expect(geminiEnabled({})).toBe(false);
    expect(geminiEnabled({ [GEMINI_ENABLED_ENV]: "" })).toBe(false);
    expect(geminiEnabled({ [GEMINI_ENABLED_ENV]: "0" })).toBe(false);
    expect(geminiEnabled({ [GEMINI_ENABLED_ENV]: "true" })).toBe(false);
    expect(geminiEnabled({ [GEMINI_ENABLED_ENV]: "1" })).toBe(true);
  });

  it("a classification whose preferred provider is off is served by the next model first, in one attempt", async () => {
    // The fixture prefers beta for FAST_CLASSIFICATION (as production
    // prefers flash-lite), with alpha (as luna) behind it. Beta is the
    // provider left unregistered.
    const alpha = createFakeModelProvider({
      code: "alpha",
      script: [{ kind: "TEXT", text: "ok" }],
    });
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(testCatalog()),
      registry: createModelProviderRegistry([alpha]),
      usage: createInMemoryModelUsageRepository(),
      sleep: () => Promise.resolve(),
    });
    const served = await gateway.execute(
      request({ taskClass: "FAST_CLASSIFICATION" }),
    );
    expect(served.providerCode).toBe("alpha");
    expect(served.attempts).toHaveLength(1);
    expect(alpha.calls).toHaveLength(1);
  });
});
