import { describe, expect, it } from "vitest";

import {
  TestRoutingRefusedError,
  withTestRouting,
  type ModelCatalogPort,
} from "../src/index.js";
import {
  createOpenAIModelProvider,
  OPENAI_TEST_MODEL,
} from "../src/providers/openai.js";

/**
 * The fence around the OpenAI diagnostic route (QX-004 core gate §12).
 *
 * OpenAI is here to tell a Capital Q defect apart from a vendor outage,
 * and for nothing else. Gemini spent a day answering "this model is
 * currently experiencing high demand" and Groq's free tier spent it
 * rate-limited; with both unreliable, every failing journey looked
 * identical and no acceptance run could be trusted.
 *
 * A diagnostic that can reach production is not a diagnostic, so these
 * hold the fence rather than the feature: it cannot be switched on
 * outside a local or test environment, it cannot be switched on without
 * the synthetic-demo attestation, it cannot be switched on by anything a
 * browser sends, it runs one model and refuses the rest, and taking the
 * switch away restores ordinary selection exactly.
 */

const provider = { id: "p-openai", code: "openai", status: "ACTIVE" };
const gemini = { id: "p-google", code: "google", status: "ACTIVE" };

function snapshot() {
  return {
    providers: [provider, gemini],
    models: [
      {
        id: "m-luna",
        providerId: "p-openai",
        modelCode: OPENAI_TEST_MODEL,
        status: "ACTIVE",
        modelType: "TEXT_GENERATION",
      },
      {
        id: "m-gemini",
        providerId: "p-google",
        modelCode: "gemini-3.5-flash-lite",
        status: "ACTIVE",
        modelType: "TEXT_GENERATION",
      },
    ],
    prices: [],
    routingPolicies: [
      {
        id: "pol-1",
        code: "normal_dialogue.v1",
        taskClass: "NORMAL_DIALOGUE",
        preferredModels: ["m-gemini"],
        fallbackModels: [],
      },
    ],
    loadedAt: "2026-09-22T00:00:00.000Z",
  };
}

const catalog = (): ModelCatalogPort => ({
  load: () => Promise.resolve(snapshot() as never),
});

const permitted = {
  providerCode: "openai",
  environment: "local",
  syntheticDemoPermitted: true,
};

describe("the OpenAI diagnostic route cannot escape local/test", () => {
  it("is absent from ordinary routing when no override is set", async () => {
    const plain = withTestRouting(catalog(), {
      ...permitted,
      providerCode: undefined,
    });
    const loaded = await plain.load();
    const policy = loaded.routingPolicies[0];
    expect(policy?.preferredModels).toEqual(["m-gemini"]);
    expect(JSON.stringify(loaded.routingPolicies)).not.toContain("m-luna");
  });

  it("refuses outside a local or test environment", () => {
    for (const environment of ["staging", "preview", "production", undefined]) {
      expect(() =>
        withTestRouting(catalog(), { ...permitted, environment }),
      ).toThrow(TestRoutingRefusedError);
    }
  });

  it("refuses without the synthetic-demo attestation", () => {
    expect(() =>
      withTestRouting(catalog(), {
        ...permitted,
        syntheticDemoPermitted: false,
      }),
    ).toThrow(TestRoutingRefusedError);
  });

  it("refuses a provider the catalogue does not carry", async () => {
    const wrong = withTestRouting(catalog(), {
      ...permitted,
      providerCode: "anthropic",
    });
    await expect(wrong.load()).rejects.toThrow(TestRoutingRefusedError);
  });

  it("puts the diagnostic model first and keeps the ordinary ones behind it", async () => {
    const loaded = await withTestRouting(catalog(), permitted).load();
    const policy = loaded.routingPolicies[0];
    // First, not only: a diagnostic run that cannot fall back is not
    // testing the thing it claims to.
    expect(policy?.preferredModels).toEqual(["m-luna", "m-gemini"]);
  });

  it("restores ordinary selection the moment the override is taken away", async () => {
    const before = await withTestRouting(catalog(), {
      ...permitted,
      providerCode: undefined,
    }).load();
    const during = await withTestRouting(catalog(), permitted).load();
    const after = await withTestRouting(catalog(), {
      ...permitted,
      providerCode: "",
    }).load();
    expect(during.routingPolicies[0]?.preferredModels).not.toEqual(
      before.routingPolicies[0]?.preferredModels,
    );
    expect(after.routingPolicies[0]?.preferredModels).toEqual(
      before.routingPolicies[0]?.preferredModels,
    );
  });
});

describe("the OpenAI adapter runs one model and no other", () => {
  const adapter = createOpenAIModelProvider({ apiKey: "sk-not-a-real-key" });

  const request = (modelCode: string) => ({
    modelCode,
    messages: [{ role: "USER" as const, content: "hello" }],
    output: { kind: "TEXT" as const },
    tools: [],
    maxOutputTokens: 64,
    temperature: 0,
    reasoning: "NONE" as const,
  });

  const context = {
    signal: new AbortController().signal,
    attemptTimeoutMs: 5_000,
    attempt: 1,
    correlationId: "cor_test",
  };

  it("refuses a model it was not given, before any network call", async () => {
    // The account holds a few dollars. An expensive model reached by a
    // stray catalogue row would spend them without anybody noticing.
    for (const model of ["gpt-5.6-terra", "gpt-5.6-sol", "o4-pro"]) {
      await expect(adapter.generate(request(model), context)).rejects.toThrow(
        /refuses model/,
      );
    }
  });

  it("never puts the key in an error it throws", async () => {
    const error = await adapter
      .generate(request("gpt-5.6-terra"), context)
      .catch((thrown: unknown) => thrown);
    const serialised = `${String(error)} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
    expect(serialised).not.toContain("sk-not-a-real-key");
  });
});
