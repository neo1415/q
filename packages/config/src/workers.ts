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
import { ConfigurationError } from "./errors.js";
import {
  supabaseAuthEnvShape,
  supabaseSecretKeySchema,
} from "./supabase-auth.js";

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

  // Document processing (CQ-EVD-003). Storage authority is optional at parse
  // time: without it the pipeline does not start at all, rather than running
  // in a degraded shape that looks like it works.
  SUPABASE_URL: supabaseAuthEnvShape.SUPABASE_URL.optional(),
  SUPABASE_SECRET_KEY: supabaseSecretKeySchema.optional(),
  // One pipeline version per deployment. Extraction is keyed by it, so a
  // change here produces new artifacts instead of rewriting old ones.
  CQ_PIPELINE_VERSION: z
    .string()
    .regex(/^[a-z][a-z0-9-]*-v[0-9]+$/)
    .max(64)
    .default("evidence-processing-v1"),
  /**
   * REQUIRE_CLEAN is the only setting permitted outside development: no
   * scanner verdict, no parsing. ALLOW_UNSCANNED exists so a local stack can
   * exercise the pipeline, and the run it produces records that no scan ran.
   */
  CQ_MALWARE_POLICY: z
    .enum(["REQUIRE_CLEAN", "ALLOW_UNSCANNED"])
    .default("REQUIRE_CLEAN"),
  CQ_DOCUMENTS_BATCH_SIZE: boundedInt(5, 1, 50),
  CQ_DOCUMENTS_POLL_INTERVAL_MS: boundedInt(1_000, 250, 30_000),
  // Bounds on one parse. Every one of these is a security control, not a
  // tuning knob: they are what stops a crafted file from consuming the
  // worker.
  CQ_PARSER_TIMEOUT_MS: boundedInt(30_000, 1_000, 300_000),
  CQ_PARSER_MAX_OUTPUT_BYTES: boundedInt(16 * 1024 * 1024, 65_536, 67_108_864),
  CQ_PARSER_MAX_OLD_SPACE_MB: boundedInt(512, 128, 4_096),
  CQ_DOCUMENT_MAX_BYTES: boundedInt(52_428_800, 1_024, 52_428_800),
});

export type OutboxRunnerConfig = {
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly maxAttempts: number;
};

/**
 * Server-only credentials. Never logged, never emitted, never handed to a
 * parser process. Queue identity remains a code constant, not configuration.
 */
export type WorkerSecrets = {
  /** Privileged Supabase key for private document storage (CQ-EVD-003). */
  readonly supabaseSecretKey: string | undefined;
};

/** Non-secret operational values, safe in diagnostics. */
export type WorkerPublicConfig = {
  readonly supabaseUrl: string | undefined;
};

export type DocumentProcessingConfig = {
  readonly pipelineVersion: string;
  readonly malwarePolicy: "REQUIRE_CLEAN" | "ALLOW_UNSCANNED";
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly parserTimeoutMs: number;
  readonly parserMaxOutputBytes: number;
  readonly parserMaxOldSpaceMb: number;
  readonly maxDocumentBytes: number;
};

/**
 * The worker deployable is a private workload with no public endpoint, so it
 * has no network configuration. It also receives no web or API configuration --
 * each deployable validates only its own variables.
 */
export type WorkerConfig = {
  readonly runtime: RuntimeConfig;
  readonly observability: ObservabilityConfig;
  readonly outbox: OutboxRunnerConfig;
  readonly documents: DocumentProcessingConfig;
  readonly public: WorkerPublicConfig;
  readonly secrets: WorkerSecrets;
};

export function parseWorkerConfig(env: EnvironmentInput): WorkerConfig {
  const parsed = parseConfig("workers", workerEnvSchema, env);
  const runtime = toRuntimeConfig(parsed);

  // Refused here rather than at the gate: a deployment must not be able to
  // turn the malware requirement off in a hosted environment by setting one
  // variable.
  if (
    parsed.CQ_MALWARE_POLICY === "ALLOW_UNSCANNED" &&
    runtime.deploymentEnvironment !== "local"
  ) {
    throw new ConfigurationError("workers", [
      {
        variable: "CQ_MALWARE_POLICY",
        reason: "ALLOW_UNSCANNED is permitted only in a local environment",
      },
    ]);
  }

  return {
    runtime,
    observability: toObservabilityConfig(parsed, runtime),
    outbox: {
      batchSize: parsed.OUTBOX_PUBLISH_BATCH_SIZE,
      pollIntervalMs: parsed.OUTBOX_POLL_INTERVAL_MS,
      maxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
    },
    documents: {
      pipelineVersion: parsed.CQ_PIPELINE_VERSION,
      malwarePolicy: parsed.CQ_MALWARE_POLICY,
      batchSize: parsed.CQ_DOCUMENTS_BATCH_SIZE,
      pollIntervalMs: parsed.CQ_DOCUMENTS_POLL_INTERVAL_MS,
      parserTimeoutMs: parsed.CQ_PARSER_TIMEOUT_MS,
      parserMaxOutputBytes: parsed.CQ_PARSER_MAX_OUTPUT_BYTES,
      parserMaxOldSpaceMb: parsed.CQ_PARSER_MAX_OLD_SPACE_MB,
      maxDocumentBytes: parsed.CQ_DOCUMENT_MAX_BYTES,
    },
    public: { supabaseUrl: parsed.SUPABASE_URL },
    secrets: { supabaseSecretKey: parsed.SUPABASE_SECRET_KEY },
  };
}

/** Call once at worker startup, never per job. */
export function loadWorkerConfig(): WorkerConfig {
  return parseWorkerConfig(process.env);
}
