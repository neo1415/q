import { describe, expect, it } from "vitest";

import {
  isPrivateEmbeddingHost,
  parseEmbeddingConfig,
  EMBEDDING_ENV_NAMES,
} from "../src/embeddings.js";
import { ConfigurationError } from "../src/errors.js";

/**
 * Embedding configuration (CQ-RAG-002 §13).
 *
 * Two properties matter here. Every variable is non-secret, so nothing in
 * this module may ever become a credential. And the runtime holds
 * confidential document text while it embeds it, so its endpoint must be
 * loopback or a private network — a public address is refused at
 * configuration time, where a typo would otherwise create the exposure.
 */

const base = { NODE_ENV: "test", CAPITAL_Q_ENV: "local" } as const;

describe("embedding configuration", () => {
  it("defaults to the local runtime with bounded requests", () => {
    const config = parseEmbeddingConfig(base);
    expect(config).toMatchObject({
      provider: "local-tei",
      baseUrl: "http://127.0.0.1:8080",
      timeoutMs: 60_000,
      maxBatchItems: 16,
    });
  });

  it("declares no secret: every variable is operational", () => {
    // A credential appearing here later would be a decision to review, not
    // a default to inherit.
    for (const name of EMBEDDING_ENV_NAMES) {
      expect(name).toMatch(/^Q_EMBEDDING_/);
      expect(name).not.toMatch(/KEY|TOKEN|SECRET|PASSWORD/);
    }
    expect(Object.keys(parseEmbeddingConfig(base))).not.toContain("secrets");
  });

  it("accepts loopback, private ranges and container names", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "10.0.0.7",
      "192.168.1.20",
      "172.16.4.4",
      "embeddings",
      "capital-q-embeddings",
    ]) {
      expect(isPrivateEmbeddingHost(host)).toBe(true);
      expect(
        parseEmbeddingConfig({
          ...base,
          Q_EMBEDDING_BASE_URL: `http://${host}:8080`,
        }).baseUrl,
      ).toBe(`http://${host}:8080`);
    }
  });

  it("refuses a public endpoint, because the runtime sees confidential text", () => {
    for (const url of [
      "http://api.example.com",
      "https://embeddings.some-vendor.io:443",
      "http://8.8.8.8:8080",
      "https://huggingface.co",
    ]) {
      expect(isPrivateEmbeddingHost(new URL(url).hostname)).toBe(false);
      expect(() =>
        parseEmbeddingConfig({ ...base, Q_EMBEDDING_BASE_URL: url }),
      ).toThrow(ConfigurationError);
    }
  });

  it("names the offending variable without echoing its value", () => {
    try {
      parseEmbeddingConfig({
        ...base,
        Q_EMBEDDING_BASE_URL: "https://embeddings.some-vendor.io",
      });
      expect.unreachable("a public endpoint is refused");
    } catch (error: unknown) {
      const failure = error as ConfigurationError;
      expect(failure.issues[0]?.variable).toBe("Q_EMBEDDING_BASE_URL");
      expect(failure.message).not.toContain("some-vendor");
    }
  });

  it("refuses a non-http scheme and an out-of-range bound", () => {
    expect(() =>
      parseEmbeddingConfig({
        ...base,
        Q_EMBEDDING_BASE_URL: "ftp://127.0.0.1:8080",
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseEmbeddingConfig({ ...base, Q_EMBEDDING_TIMEOUT_MS: "0" }),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseEmbeddingConfig({ ...base, Q_EMBEDDING_MAX_BATCH_ITEMS: "9999" }),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseEmbeddingConfig({ ...base, Q_EMBEDDING_PROVIDER: "openai" }),
    ).toThrow(ConfigurationError);
  });
});
