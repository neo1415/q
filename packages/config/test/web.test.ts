import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../src/errors.js";
import { parseWebServerConfig } from "../src/web.js";

const SUPABASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
} as const;

describe("parseWebServerConfig", () => {
  it("builds local defaults: fixture onboarding, loopback origin, insecure cookies", () => {
    const config = parseWebServerConfig({ NODE_ENV: "test", ...SUPABASE_ENV });

    expect(config.founderOnboardingAdapter).toBe("fixture");
    expect(config.auth.appOrigin).toBe("http://127.0.0.1:3000");
    expect(config.auth.secureCookies).toBe(false);
    expect(config.auth.supabase.url).toBe("http://127.0.0.1:54321");
    expect(config.public.supabasePublishableKey).toBe(
      "sb_publishable_local_test",
    );
    expect(config.apiBaseUrl).toBeUndefined();
    expect(config.secrets).toEqual({});
  });

  it("defaults to the api adapter whenever CQ_API_URL is configured, and requires it for api", () => {
    const local = parseWebServerConfig({
      NODE_ENV: "test",
      CQ_API_URL: "http://127.0.0.1:3001",
      ...SUPABASE_ENV,
    });
    expect(local.founderOnboardingAdapter).toBe("api");
    expect(local.apiBaseUrl).toBe("http://127.0.0.1:3001");

    const production = parseWebServerConfig({
      NODE_ENV: "production",
      CAPITAL_Q_ENV: "production",
      CQ_WEB_ORIGIN: "https://app.capitalq.test",
      CQ_API_URL: "https://api.capitalq.test/",
      ...SUPABASE_ENV,
    });
    expect(production.founderOnboardingAdapter).toBe("api");
    expect(production.apiBaseUrl).toBe("https://api.capitalq.test");

    expect(() =>
      parseWebServerConfig({
        NODE_ENV: "test",
        CQ_FOUNDER_ONBOARDING_ADAPTER: "api",
        ...SUPABASE_ENV,
      }),
    ).toThrow(ConfigurationError);
  });

  it("never composes the fixture on a production build or environment", () => {
    expect(() =>
      parseWebServerConfig({
        NODE_ENV: "production",
        CAPITAL_Q_ENV: "preview",
        CQ_WEB_ORIGIN: "https://preview.capitalq.test",
        CQ_FOUNDER_ONBOARDING_ADAPTER: "fixture",
        ...SUPABASE_ENV,
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseWebServerConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "production",
        CQ_WEB_ORIGIN: "https://app.capitalq.test",
        CQ_FOUNDER_ONBOARDING_ADAPTER: "fixture",
        ...SUPABASE_ENV,
      }),
    ).toThrow(ConfigurationError);
  });

  it("requires the Supabase URL and publishable key", () => {
    expect(() => parseWebServerConfig({ NODE_ENV: "test" })).toThrow(
      ConfigurationError,
    );
  });

  it("refuses a service-role or secret key under the public name", () => {
    expect(() =>
      parseWebServerConfig({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_definitely_not",
      }),
    ).toThrow(ConfigurationError);
  });

  it("requires an explicit origin and secures cookies outside local", () => {
    expect(() =>
      parseWebServerConfig({
        NODE_ENV: "production",
        CAPITAL_Q_ENV: "preview",
        ...SUPABASE_ENV,
      }),
    ).toThrow(ConfigurationError);

    const config = parseWebServerConfig({
      NODE_ENV: "production",
      CAPITAL_Q_ENV: "preview",
      CQ_WEB_ORIGIN: "https://preview.capitalq.test/",
      ...SUPABASE_ENV,
    });
    expect(config.auth.appOrigin).toBe("https://preview.capitalq.test");
    expect(config.auth.secureCookies).toBe(true);
    expect(config.founderOnboardingAdapter).toBe("none");
  });

  it("rejects an origin carrying a path, and a non-URL API base", () => {
    expect(() =>
      parseWebServerConfig({
        NODE_ENV: "test",
        CQ_WEB_ORIGIN: "https://app.capitalq.test/auth",
        ...SUPABASE_ENV,
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseWebServerConfig({
        NODE_ENV: "test",
        CQ_API_URL: "not-a-url",
        ...SUPABASE_ENV,
      }),
    ).toThrow(ConfigurationError);
    expect(
      parseWebServerConfig({
        NODE_ENV: "test",
        CQ_API_URL: "http://127.0.0.1:3001/",
        ...SUPABASE_ENV,
      }).apiBaseUrl,
    ).toBe("http://127.0.0.1:3001");
  });
});
