import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { parseApiConfig } from "../src/api.js";
import {
  VIDEO_PROVIDER_ENV_NAMES,
  videoProviderConfigStatus,
} from "../src/video-providers.js";

/**
 * Video provider configuration (CQ-MEDIA-010): optional, server-only,
 * reported by presence alone, never reachable through serialisation or
 * inspection. The older token spelling is accepted; a key id without a
 * key signs nothing.
 */

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "cf-synthetic-stream-token-0000000000000000";
const PEM = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(64)}\n-----END PRIVATE KEY-----`;

const base = { NODE_ENV: "test", CAPITAL_Q_ENV: "local" };

describe("video provider configuration", () => {
  it("names its variables, none of them public", () => {
    expect([...VIDEO_PROVIDER_ENV_NAMES]).toEqual([
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_STREAM_API_TOKEN",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
      "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
      "CLOUDFLARE_STREAM_SIGNING_KEY_PEM",
    ]);
    for (const name of VIDEO_PROVIDER_ENV_NAMES) {
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("is optional and says by name what is missing", () => {
    const none = parseApiConfig(base);
    expect(none.secrets.videoProviders.cloudflareStream).toBeUndefined();
    expect(none.public.videoProviders).toEqual({
      cloudflareStream: "unconfigured",
      playback: "unconfigured",
      signing: "none",
      missing: [
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_STREAM_API_TOKEN",
        "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
      ],
    });
  });

  it("needs both the account and the token before it composes anything", () => {
    const accountOnly = parseApiConfig({
      ...base,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    });
    expect(accountOnly.secrets.videoProviders.cloudflareStream).toBeUndefined();
    const tokenOnly = parseApiConfig({
      ...base,
      CLOUDFLARE_STREAM_API_TOKEN: TOKEN,
    });
    expect(tokenOnly.secrets.videoProviders.cloudflareStream).toBeUndefined();
  });

  it("accepts the older token spelling, preferring the canonical one", () => {
    const alias = parseApiConfig({
      ...base,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_API_KEY: TOKEN,
    });
    expect(
      alias.secrets.videoProviders.cloudflareStream?.apiToken.reveal(),
    ).toBe(TOKEN);
    expect(alias.public.videoProviders).toEqual({
      cloudflareStream: "configured",
      playback: "unconfigured",
      signing: "none",
      missing: ["CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN"],
    });

    const both = parseApiConfig({
      ...base,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_API_KEY: `${TOKEN}-older`,
      CLOUDFLARE_STREAM_API_TOKEN: TOKEN,
    });
    expect(
      both.secrets.videoProviders.cloudflareStream?.apiToken.reveal(),
    ).toBe(TOKEN);
  });

  it("reports playback as configured only with a host, and how it signs", () => {
    const viaEndpoint = parseApiConfig({
      ...base,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_STREAM_API_TOKEN: TOKEN,
      CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN:
        "customer-abc123.cloudflarestream.com",
    });
    expect(viaEndpoint.public.videoProviders).toEqual({
      cloudflareStream: "configured",
      playback: "configured",
      signing: "provider_token_endpoint",
      missing: [],
    });

    const local = parseApiConfig({
      ...base,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_STREAM_API_TOKEN: TOKEN,
      CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN:
        "customer-abc123.cloudflarestream.com",
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: "keyid0000000000001",
      CLOUDFLARE_STREAM_SIGNING_KEY_PEM: PEM,
    });
    expect(local.public.videoProviders.signing).toBe("local_key");
    expect(
      local.secrets.videoProviders.cloudflareStream?.signingKey?.keyId,
    ).toBe("keyid0000000000001");

    // A key id alone signs nothing, and says so by falling back.
    const keyIdOnly = parseApiConfig({
      ...base,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_STREAM_API_TOKEN: TOKEN,
      CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN:
        "customer-abc123.cloudflarestream.com",
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: "keyid0000000000001",
    });
    expect(keyIdOnly.public.videoProviders.signing).toBe(
      "provider_token_endpoint",
    );
  });

  it("refuses a malformed account id or host rather than guessing", () => {
    expect(() =>
      parseApiConfig({ ...base, CLOUDFLARE_ACCOUNT_ID: "not-hex" }),
    ).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(() =>
      parseApiConfig({
        ...base,
        CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: "https://example.com",
      }),
    ).toThrow(/CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN/);
  });

  it("never lets the token or the key out through serialisation", () => {
    const config = parseApiConfig({
      ...base,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_STREAM_API_TOKEN: TOKEN,
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: "keyid0000000000001",
      CLOUDFLARE_STREAM_SIGNING_KEY_PEM: PEM,
    });
    for (const rendering of [
      JSON.stringify(config),
      inspect(config, { depth: 10 }),
      String(config.secrets.videoProviders.cloudflareStream?.apiToken),
    ]) {
      expect(rendering).not.toContain(TOKEN);
      expect(rendering).not.toContain("BEGIN PRIVATE KEY");
    }
    expect(
      videoProviderConfigStatus(config.secrets.videoProviders).missing,
    ).toEqual(["CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN"]);
  });
});
