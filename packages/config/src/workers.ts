import { z } from "zod";
import {
  observabilityEnvShape,
  parseConfig,
  runtimeEnvShape,
  toObservabilityConfig,
  toRuntimeConfig,
  type EnvironmentInput,
  type ObservabilityConfig,
  type RuntimeConfig,
} from "./common.js";

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

const workerEnvSchema = z.object({
  ...runtimeEnvShape,
  ...observabilityEnvShape,
  // Outbox publisher runner. Bounded so a typo cannot produce an unbounded
  // batch or a busy loop. Queue identity is a code constant, not config.
  OUTBOX_PUBLISH_BATCH_SIZE: boundedInt(25, 1, 100),
  OUTBOX_POLL_INTERVAL_MS: boundedInt(750, 250, 10_000),
  OUTBOX_MAX_ATTEMPTS: boundedInt(10, 1, 50),
});

export type OutboxRunnerConfig = {
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly maxAttempts: number;
};

/**
 * Queue connection and provider credentials arrive with the packet that
 * integrates Supabase Queues/pgmq. No queue configuration is invented here.
 */
export type WorkerSecrets = Readonly<Record<string, never>>;

export type WorkerPublicConfig = Readonly<Record<string, never>>;

/**
 * The worker deployable is a private workload with no public endpoint, so it
 * has no network configuration. It also receives no web or API configuration --
 * each deployable validates only its own variables.
 */
export type WorkerConfig = {
  readonly runtime: RuntimeConfig;
  readonly observability: ObservabilityConfig;
  readonly outbox: OutboxRunnerConfig;
  readonly public: WorkerPublicConfig;
  readonly secrets: WorkerSecrets;
};

export function parseWorkerConfig(env: EnvironmentInput): WorkerConfig {
  const parsed = parseConfig("workers", workerEnvSchema, env);
  const runtime = toRuntimeConfig(parsed);

  return {
    runtime,
    observability: toObservabilityConfig(parsed, runtime),
    outbox: {
      batchSize: parsed.OUTBOX_PUBLISH_BATCH_SIZE,
      pollIntervalMs: parsed.OUTBOX_POLL_INTERVAL_MS,
      maxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
    },
    public: {},
    secrets: {},
  };
}

/** Call once at worker startup, never per job. */
export function loadWorkerConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}
