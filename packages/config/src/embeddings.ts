import { z } from "zod";

import {
  parseConfig,
  runtimeEnvShape,
  toRuntimeConfig,
  type EnvironmentInput,
  type RuntimeConfig,
} from "./common.js";
import { ConfigurationError } from "./errors.js";

/**
 * Embedding runtime configuration (CQ-RAG-002 §13).
 *
 * Every value here is NON-SECRET: which adapter to use, where the private
 * embedding runtime listens, and the bounds one request runs under. There is
 * no credential, because the configured model is open-weight and served by a
 * runtime Capital Q operates. If an embedding provider ever needs a key, it
 * arrives as a reviewed decision with its own secret handling, not as a
 * quiet addition here.
 */

export const EMBEDDING_PROVIDERS = ["local-tei"] as const;
export type EmbeddingProviderSetting = (typeof EMBEDDING_PROVIDERS)[number];

export const EMBEDDING_ENV_NAMES = [
  "Q_EMBEDDING_PROVIDER",
  "Q_EMBEDDING_BASE_URL",
  "Q_EMBEDDING_TIMEOUT_MS",
  "Q_EMBEDDING_MAX_BATCH_ITEMS",
] as const;

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";

function boundedInt(defaultValue: number, min: number, max: number) {
  const expectation = `expected an integer between ${String(min)} and ${String(max)}`;
  return z.preprocess(
    (value) => (value === undefined || value === "" ? defaultValue : value),
    z.coerce
      .number(expectation)
      .int(expectation)
      .min(min, expectation)
      .max(max, expectation),
  );
}

const PRIVATE_IPV4 =
  /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

/**
 * Whether a host is one the embedding runtime may legitimately live on.
 *
 * The runtime holds confidential document text while it embeds it, so it is
 * reachable on loopback, on a private network, or by a container/service
 * name inside one — never at a public address. This is a deployment control
 * expressed where a typo would otherwise create an exposure.
 */
export function isPrivateEmbeddingHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (name === "localhost" || name === "::1" || name === "0.0.0.0") return true;
  if (PRIVATE_IPV4.test(name)) return true;
  if (name.startsWith("fd") || name.startsWith("fc")) return true;
  // A single-label name is a container or service on an internal network;
  // anything with a dot resolves through public DNS.
  return !name.includes(".") && name.length > 0;
}

const embeddingEnvSchema = z.object({
  ...runtimeEnvShape,
  Q_EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDERS).default("local-tei"),
  Q_EMBEDDING_BASE_URL: z
    .string()
    .url("expected an http(s) URL for the embedding runtime")
    .default(DEFAULT_BASE_URL),
  // Long enough for a cold CPU model to answer, short enough that a stuck
  // runtime does not hold a worker open.
  Q_EMBEDDING_TIMEOUT_MS: boundedInt(60_000, 1_000, 300_000),
  Q_EMBEDDING_MAX_BATCH_ITEMS: boundedInt(16, 1, 128),
});

export type EmbeddingConfig = {
  readonly runtime: RuntimeConfig;
  readonly provider: EmbeddingProviderSetting;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxBatchItems: number;
};

export function parseEmbeddingConfig(env: EnvironmentInput): EmbeddingConfig {
  const parsed = parseConfig("embeddings", embeddingEnvSchema, env);
  const url = new URL(parsed.Q_EMBEDDING_BASE_URL);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigurationError("embeddings", [
      {
        variable: "Q_EMBEDDING_BASE_URL",
        reason: "expected an http:// or https:// URL",
      },
    ]);
  }
  if (!isPrivateEmbeddingHost(url.hostname)) {
    throw new ConfigurationError("embeddings", [
      {
        variable: "Q_EMBEDDING_BASE_URL",
        reason:
          "expected a loopback or private-network host: the embedding runtime holds confidential document text and is never reachable at a public address",
      },
    ]);
  }
  return {
    runtime: toRuntimeConfig(parsed),
    provider: parsed.Q_EMBEDDING_PROVIDER,
    baseUrl: parsed.Q_EMBEDDING_BASE_URL,
    timeoutMs: parsed.Q_EMBEDDING_TIMEOUT_MS,
    maxBatchItems: parsed.Q_EMBEDDING_MAX_BATCH_ITEMS,
  };
}

/** Call once at a composition root, never per request. */
export function loadEmbeddingConfig(): EmbeddingConfig {
  return parseEmbeddingConfig(process.env);
}
