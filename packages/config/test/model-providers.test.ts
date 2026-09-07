import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "../src/q-api.js";
import {
  MODEL_PROVIDER_ENV_NAMES,
  modelProviderConfigStatus,
  ProviderCredential,
} from "../src/model-providers.js";

/**
 * Provider credentials (CQ-Q-005 §26-27, §64): optional per provider,
 * opaque once parsed, and never reachable through serialisation,
 * inspection or an error message.
 */

const GEMINI = "synthetic-gemini-key-000000000000000000000000";
const GROQ = "synthetic-groq-key-00000000000000000000000000";

const base = {
  NODE_ENV: "test",
  CAPITAL_Q_ENV: "local",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_key_value_0000",
};

describe("model provider configuration", () => {
  it("names exactly the two V1 variables", () => {
    expect([...MODEL_PROVIDER_ENV_NAMES]).toEqual([
      "GEMINI_API_KEY",
      "GROQ_API_KEY",
    ]);
  });

  it("treats each provider as optional and reports presence by name only", () => {
    const none = parseQApiConfig(base);
    expect(modelProviderConfigStatus(none.secrets.modelProviders)).toEqual({
      google: "unconfigured",
      groq: "unconfigured",
    });

    const groqOnly = parseQApiConfig({ ...base, GROQ_API_KEY: GROQ });
    expect(modelProviderConfigStatus(groqOnly.secrets.modelProviders)).toEqual({
      google: "unconfigured",
      groq: "configured",
    });
    expect(groqOnly.secrets.modelProviders.google).toBeUndefined();
    expect(groqOnly.secrets.modelProviders.groq?.reveal()).toBe(GROQ);

    const both = parseQApiConfig({
      ...base,
      GEMINI_API_KEY: GEMINI,
      GROQ_API_KEY: GROQ,
    });
    expect(both.secrets.modelProviders.google?.reveal()).toBe(GEMINI);
  });

  it("never lets a credential value out through JSON, string or inspect", () => {
    const config = parseQApiConfig({
      ...base,
      GEMINI_API_KEY: GEMINI,
      GROQ_API_KEY: GROQ,
    });
    const serialised = JSON.stringify(config);
    expect(serialised).not.toContain(GEMINI);
    expect(serialised).not.toContain(GROQ);
    expect(String(config.secrets.modelProviders.google)).toBe("[redacted]");
    expect(inspect(config.secrets.modelProviders)).not.toContain(GROQ);
    expect(Object.keys(new ProviderCredential(GEMINI))).toEqual([]);
  });

  it("refuses an obviously blank key without echoing it", () => {
    expect(() => parseQApiConfig({ ...base, GROQ_API_KEY: "short" })).toThrow(
      /GROQ_API_KEY/,
    );
    try {
      parseQApiConfig({ ...base, GEMINI_API_KEY: "   " });
    } catch (error: unknown) {
      expect(String(error)).not.toContain("   ");
    }
  });
});
