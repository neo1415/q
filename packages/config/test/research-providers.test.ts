import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "../src/q-api.js";
import {
  RESEARCH_PROVIDER_ENV_NAMES,
  researchProviderConfigStatus,
} from "../src/research-providers.js";
import { parseWebServerConfig } from "../src/web.js";

/**
 * The research provider credential (CQ-Q-RESEARCH-001 §4, §41 J): optional,
 * server-only, reported by presence alone, and never reachable through
 * serialisation, inspection or the web app's configuration.
 */

const KEY = "tvly-synthetic-research-key-000000000000000000";

const base = {
  NODE_ENV: "test",
  CAPITAL_Q_ENV: "local",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_key_value_0000",
};

describe("research provider configuration", () => {
  it("names its key variables, none of them public", () => {
    expect([...RESEARCH_PROVIDER_ENV_NAMES]).toEqual([
      "TAVILY_API_KEY",
      "BRIGHT_DATA_API_KEY",
      "SERP_API_KEY",
    ]);
    for (const name of RESEARCH_PROVIDER_ENV_NAMES) {
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("is optional and reports presence by name only", () => {
    const none = parseQApiConfig(base);
    expect(
      researchProviderConfigStatus(none.secrets.researchProviders),
    ).toEqual({
      tavily: "unconfigured",
      brightData: "unconfigured",
      brightDataZones: "unconfigured",
      serpApi: "unconfigured",
    });
    expect(none.secrets.researchProviders.tavily).toBeUndefined();

    const configured = parseQApiConfig({ ...base, TAVILY_API_KEY: KEY });
    expect(
      researchProviderConfigStatus(configured.secrets.researchProviders),
    ).toEqual({
      tavily: "configured",
      brightData: "unconfigured",
      brightDataZones: "unconfigured",
      serpApi: "unconfigured",
    });
    expect(configured.secrets.researchProviders.tavily?.reveal()).toBe(KEY);
  });

  it("rejects a value too short to be a key, without echoing it", () => {
    expect(() => parseQApiConfig({ ...base, TAVILY_API_KEY: "short" })).toThrow(
      /provider API key/,
    );
    try {
      parseQApiConfig({ ...base, TAVILY_API_KEY: "short" });
    } catch (error: unknown) {
      expect(String(error)).not.toContain("TAVILY_API_KEY=short");
    }
  });

  it("never lets the key out through JSON, string or inspect", () => {
    const config = parseQApiConfig({ ...base, TAVILY_API_KEY: KEY });
    const credential = config.secrets.researchProviders.tavily;
    expect(JSON.stringify(config)).not.toContain(KEY);
    expect(String(credential)).not.toContain(KEY);
    expect(inspect(credential)).not.toContain(KEY);
    expect(inspect(config, { depth: 10 })).not.toContain(KEY);
  });

  it("is not part of the web app's configuration at all", () => {
    const web = parseWebServerConfig({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: base.SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: base.SUPABASE_PUBLISHABLE_KEY,
      TAVILY_API_KEY: KEY,
    });
    expect(JSON.stringify(web)).not.toContain(KEY);
    expect(JSON.stringify(web)).not.toContain("tavily");
    expect(JSON.stringify(web)).not.toContain("TAVILY");
  });
});
