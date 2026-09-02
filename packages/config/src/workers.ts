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

const workerEnvSchema = z.object({
  ...runtimeEnvShape,
  ...observabilityEnvShape,
});

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
  readonly public: WorkerPublicConfig;
  readonly secrets: WorkerSecrets;
};

export function parseWorkerConfig(env: EnvironmentInput): WorkerConfig {
  const parsed = parseConfig("workers", workerEnvSchema, env);
  const runtime = toRuntimeConfig(parsed);

  return {
    runtime,
    observability: toObservabilityConfig(parsed, runtime),
    public: {},
    secrets: {},
  };
}

/** Call once at worker startup, never per job. */
export function loadWorkerConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}
