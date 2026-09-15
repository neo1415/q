import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "../src/q-api.js";
import {
  SPEECH_PROVIDER_ENV_NAMES,
  speechProviderConfigStatus,
} from "../src/speech-providers.js";
import { parseWebServerConfig } from "../src/web.js";

/**
 * The speech provider credential (CQ-Q-VOICE-001 C §30-§31, §85):
 * optional, server-only, reported by presence alone, never reachable
 * through serialisation or inspection, and never part of the web app's
 * configuration. The Speech Engine ids are named, not secret, and absent
 * means no voice.
 */

const KEY = "sk_synthetic-speech-key-0000000000000000000000";

const base = {
  NODE_ENV: "test",
  CAPITAL_Q_ENV: "local",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_key_value_0000",
};

describe("speech provider configuration", () => {
  it("names its variables, none of them public", () => {
    expect([...SPEECH_PROVIDER_ENV_NAMES]).toEqual([
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_SPEECH_ENGINE_ID",
      "ELEVENLABS_SPEECH_ENGINE_ID_MALE",
      "DEEPGRAM_API_KEY",
    ]);
    for (const name of SPEECH_PROVIDER_ENV_NAMES) {
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("is optional and reports presence and voices by name only", () => {
    const none = parseQApiConfig(base);
    expect(
      speechProviderConfigStatus(
        none.secrets.speechProviders,
        none.voice.speechEngines,
      ),
    ).toEqual({
      elevenLabs: "unconfigured",
      deepgram: "unconfigured",
      speechEngines: "unconfigured",
      provider: "none",
      voices: [],
    });
    expect(none.voice.speechEngines).toBeUndefined();
    expect(none.voice.apiBaseUrl).toBeUndefined();

    const one = parseQApiConfig({
      ...base,
      ELEVENLABS_API_KEY: KEY,
      ELEVENLABS_SPEECH_ENGINE_ID: "seng_0000000000000001",
      CQ_API_URL: "http://127.0.0.1:3001/",
    });
    expect(
      speechProviderConfigStatus(
        one.secrets.speechProviders,
        one.voice.speechEngines,
      ),
    ).toEqual({
      elevenLabs: "configured",
      deepgram: "unconfigured",
      speechEngines: "configured",
      provider: "elevenlabs",
      voices: ["FEMALE"],
    });
    expect(one.voice.apiBaseUrl).toBe("http://127.0.0.1:3001");

    const two = parseQApiConfig({
      ...base,
      ELEVENLABS_API_KEY: KEY,
      ELEVENLABS_SPEECH_ENGINE_ID: "seng_0000000000000001",
      ELEVENLABS_SPEECH_ENGINE_ID_MALE: "seng_0000000000000002",
    });
    expect(
      speechProviderConfigStatus(
        two.secrets.speechProviders,
        two.voice.speechEngines,
      ).voices,
    ).toEqual(["FEMALE", "MALE"]);
  });

  it("never reveals the key through serialisation, inspection or interpolation", () => {
    const config = parseQApiConfig({ ...base, ELEVENLABS_API_KEY: KEY });
    const credential = config.secrets.speechProviders.elevenLabs;
    expect(credential).toBeDefined();
    expect(JSON.stringify(config)).not.toContain(KEY);
    expect(inspect(config, { depth: 10 })).not.toContain(KEY);
    expect(`${String(credential)}`).not.toContain(KEY);
    expect(credential?.reveal()).toBe(KEY);
  });

  it("rejects a malformed engine id rather than passing free text to the provider", () => {
    expect(() =>
      parseQApiConfig({
        ...base,
        ELEVENLABS_API_KEY: KEY,
        ELEVENLABS_SPEECH_ENGINE_ID: "not an id / with spaces",
      }),
    ).toThrow();
  });

  it("is not part of the web app's configuration at all", () => {
    const web = parseWebServerConfig({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: base.SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: base.SUPABASE_PUBLISHABLE_KEY,
      ELEVENLABS_API_KEY: KEY,
      ELEVENLABS_SPEECH_ENGINE_ID: "seng_0000000000000001",
    });
    expect(JSON.stringify(web)).not.toContain(KEY);
    expect(JSON.stringify(web)).not.toContain("seng_");
    expect(JSON.stringify(web).toLowerCase()).not.toContain("elevenlabs");
  });
});
