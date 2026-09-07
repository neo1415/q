import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Embedding contracts (CQ-RAG-002; doc 14 §15, §115, §119-§122).
 *
 *   embedding ≠ evidence ≠ claim ≠ knowledge ≠ company truth
 *   embedding ≠ permission;   vector ≠ public
 *
 * An embedding is a disposable derived index over content Capital Q already
 * holds. Re-embedding the same chunk with another model changes nothing
 * about what the source says, which is why provider, model and
 * configuration are three separate things here and why every result carries
 * the identity of the run that produced it.
 */

// ---------------------------------------------------------------------------
// Provider, model, configuration — three distinct identities (§7)
// ---------------------------------------------------------------------------

/**
 * Which adapter produced a vector. `local-tei` is a Text Embeddings
 * Inference server on a private network; a hosted provider would be another
 * code behind the same port, added only by an explicit decision.
 */
export const EMBEDDING_PROVIDER_CODES = ["local-tei", "fake"] as const;
export const EmbeddingProviderCodeSchema = z.enum(EMBEDDING_PROVIDER_CODES);
export type EmbeddingProviderCode = z.infer<typeof EmbeddingProviderCodeSchema>;

/** How the model is served. A deployment fact, never a security fact. */
export const EMBEDDING_RUNTIME_KINDS = [
  "LOCAL_HTTP",
  "PRIVATE_NETWORK_HTTP",
  "IN_PROCESS_FAKE",
] as const;
export const EmbeddingRuntimeKindSchema = z.enum(EMBEDDING_RUNTIME_KINDS);
export type EmbeddingRuntimeKind = z.infer<typeof EmbeddingRuntimeKindSchema>;

/** Hugging Face style `owner/model`, or a local test identity. */
export const EmbeddingModelCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/);
export type EmbeddingModelCode = z.infer<typeof EmbeddingModelCodeSchema>;

/** A git commit on the model repository. Absent when the runtime cannot say. */
export const EmbeddingModelRevisionSchema = z.string().regex(/^[0-9a-f]{40}$/);

/** Repository version convention: `name-vN`. */
export const EmbeddingVersionSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*-v[0-9]+$/)
  .max(64);

/**
 * How a runtime returns vectors.
 *
 *   L2_UNIT  the runtime normalises; Capital Q must not normalise again
 *   RAW      no guarantee; a caller that needs unit vectors must say so
 */
export const EMBEDDING_NORMALIZATIONS = ["L2_UNIT", "RAW"] as const;
export const EmbeddingNormalizationSchema = z.enum(EMBEDDING_NORMALIZATIONS);
export type EmbeddingNormalization = z.infer<
  typeof EmbeddingNormalizationSchema
>;

/**
 * Which inputs the model wants an instruction on. Qwen3 embedding models
 * are instruction-aware for queries and explicitly ask for none on
 * retrieval documents.
 */
export const EMBEDDING_INSTRUCTION_STRATEGIES = ["QUERY_ONLY", "NONE"] as const;
export const EmbeddingInstructionStrategySchema = z.enum(
  EMBEDDING_INSTRUCTION_STRATEGIES,
);
export type EmbeddingInstructionStrategy = z.infer<
  typeof EmbeddingInstructionStrategySchema
>;

/**
 * One versioned embedding configuration: the provider, the model, the
 * revision, the dimension and the semantics that together decide what a
 * vector means. A change to any of them is a new configuration version, and
 * vectors from two versions are never comparable.
 */
export const EmbeddingConfigurationSchema = z
  .object({
    configurationVersion: EmbeddingVersionSchema,
    providerCode: EmbeddingProviderCodeSchema,
    runtime: EmbeddingRuntimeKindSchema,
    modelCode: EmbeddingModelCodeSchema,
    /** The model family, for catalogue reporting; never the whole identity. */
    modelFamily: z.string().min(1).max(64),
    /** Pinned where the runtime can report or accept one. */
    modelRevision: EmbeddingModelRevisionSchema.nullable(),
    dimension: z.number().int().min(1).max(8192),
    /** The model's native maximum; MRL truncation below it is not adopted. */
    maxDimension: z.number().int().min(1).max(8192),
    normalization: EmbeddingNormalizationSchema,
    instructionStrategy: EmbeddingInstructionStrategySchema,
    /** Provider-level ceiling on one input, in characters. */
    maxInputCharacters: z.number().int().min(1),
    maxBatchItems: z.number().int().min(1),
    maxBatchCharacters: z.number().int().min(1),
  })
  .strict();
export type EmbeddingConfiguration = z.infer<
  typeof EmbeddingConfigurationSchema
>;

// ---------------------------------------------------------------------------
// The V1 configuration (§8-§10)
// ---------------------------------------------------------------------------

export const QWEN3_EMBEDDING_MODEL_CODE = "Qwen/Qwen3-Embedding-0.6B" as const;

/**
 * The model repository commit this configuration is pinned to. Recorded so a
 * vector can always be attributed to exactly the weights that produced it;
 * the runtime's reported `model_sha` is checked against it.
 */
export const QWEN3_EMBEDDING_MODEL_REVISION =
  "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3" as const;

/**
 * Capital Q's first embedding configuration.
 *
 * 1024 is the model's native dimension. Matryoshka truncation to 512 or 256
 * is deliberately not adopted: doc 14 asks for it to be evaluated before
 * adoption, and this packet has no retrieval quality baseline to evaluate
 * it against. The dimension lives here, never in the chunk schema.
 */
export const QWEN3_EMBEDDING_CONFIGURATION: EmbeddingConfiguration =
  EmbeddingConfigurationSchema.parse({
    configurationVersion: "capital-q-qwen3-embedding-0-6b-1024-v1",
    providerCode: "local-tei",
    runtime: "LOCAL_HTTP",
    modelCode: QWEN3_EMBEDDING_MODEL_CODE,
    modelFamily: "qwen3-embedding",
    modelRevision: QWEN3_EMBEDDING_MODEL_REVISION,
    dimension: 1024,
    maxDimension: 1024,
    // TEI is asked for `normalize: true`; Capital Q never normalises again.
    normalization: "L2_UNIT",
    instructionStrategy: "QUERY_ONLY",
    // Deliberately expressed in CHARACTERS and set below the runtime's
    // token ceiling, because a token is never shorter than a character:
    // 4,000 characters can never tokenise to more than 4,000 tokens, so an
    // input can never reach the size at which a runtime would truncate it.
    // The health check enforces that relationship against what the runtime
    // actually reports, so raising one without the other is caught.
    maxInputCharacters: 4_000,
    maxBatchItems: 16,
    maxBatchCharacters: 64_000,
  });

// ---------------------------------------------------------------------------
// Tasks and instructions (§21-§25)
// ---------------------------------------------------------------------------

/**
 * What a piece of text is being embedded for. A document is embedded as it
 * is; a query is embedded with the instruction its task registers.
 */
export const EMBEDDING_QUERY_TASKS = ["EVIDENCE_RETRIEVAL"] as const;
export const EmbeddingQueryTaskSchema = z.enum(EMBEDDING_QUERY_TASKS);
export type EmbeddingQueryTask = z.infer<typeof EmbeddingQueryTaskSchema>;

/**
 * The canonical marker recorded against a document embedding: no instruction
 * was applied, under version 1 of that policy. It is not an instruction and
 * never becomes one; it exists so a stored embedding's identity is complete.
 */
export const EMBEDDING_DOCUMENT_INSTRUCTION_VERSION = "none-v1" as const;

export type EmbeddingInstructionProfile = {
  readonly task: EmbeddingQueryTask;
  readonly instructionVersion: string;
  /** The task description only. Never a permission, prompt or persona. */
  readonly instruction: string;
};

/**
 * The V1 query instruction.
 *
 * One task, because one hybrid retrieval flow exists to serve. It describes
 * the retrieval task and nothing else: no tenant, no scope, no policy, no Q
 * personality. Authorisation happens long before and long after this string,
 * never inside the embedding model.
 */
export const EVIDENCE_RETRIEVAL_INSTRUCTION: EmbeddingInstructionProfile = {
  task: "EVIDENCE_RETRIEVAL",
  instructionVersion: "capital-q-evidence-retrieval-v1",
  instruction:
    "Given an investment intelligence question, retrieve document passages and company information that help answer it.",
};

const INSTRUCTIONS: Readonly<
  Record<EmbeddingQueryTask, EmbeddingInstructionProfile>
> = {
  EVIDENCE_RETRIEVAL: EVIDENCE_RETRIEVAL_INSTRUCTION,
};

export function instructionFor(
  task: EmbeddingQueryTask,
): EmbeddingInstructionProfile {
  return INSTRUCTIONS[task];
}

export const EMBEDDING_INSTRUCTION_PROFILES: readonly EmbeddingInstructionProfile[] =
  Object.values(INSTRUCTIONS);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const EmbedDocumentsRequestSchema = z
  .object({
    /** Canonical derived text, in caller order. Never re-ordered. */
    inputs: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type EmbedDocumentsRequest = z.infer<typeof EmbedDocumentsRequestSchema>;

export const EmbedQueryRequestSchema = z
  .object({
    query: z.string().min(1),
    task: EmbeddingQueryTaskSchema,
  })
  .strict();
export type EmbedQueryRequest = z.infer<typeof EmbedQueryRequestSchema>;

// ---------------------------------------------------------------------------
// Results (§27)
// ---------------------------------------------------------------------------

/**
 * One vector and the identity that explains it. Deliberately absent: the
 * embedded text, the raw provider payload, any credential, any server
 * internal. The vector itself is derived sensitive data and inherits the
 * source's sensitivity (§44); nothing here may be logged or serialised to a
 * client.
 */
export type EmbeddingResult = {
  readonly vector: readonly number[];
  readonly dimension: number;
  readonly providerCode: EmbeddingProviderCode;
  readonly modelCode: string;
  readonly modelRevision: string | null;
  readonly configurationVersion: string;
  /** The query instruction applied, or the canonical document marker. */
  readonly instructionVersion: string;
  /** A safe reference to what was embedded. Never the text. */
  readonly inputSha256: string;
  readonly inputCharacters: number;
  readonly latencyMs: number;
};

export type EmbeddingBatchResult = {
  /** One result per input, in input order. */
  readonly embeddings: readonly EmbeddingResult[];
  readonly batchSize: number;
  readonly latencyMs: number;
};

export type EmbeddingProviderDescriptor = {
  readonly providerCode: EmbeddingProviderCode;
  readonly configuration: EmbeddingConfiguration;
  /** Where the runtime lives, host and port only. Never a credential. */
  readonly endpoint: string | null;
};

export const EMBEDDING_HEALTH_STATES = [
  "READY",
  "UNAVAILABLE",
  "MISCONFIGURED",
] as const;
export type EmbeddingHealthState = (typeof EMBEDDING_HEALTH_STATES)[number];

export type EmbeddingProviderHealth = {
  readonly state: EmbeddingHealthState;
  readonly providerCode: EmbeddingProviderCode;
  readonly endpoint: string | null;
  /** What the runtime says it is serving, when it answers. */
  readonly reportedModelCode: string | null;
  readonly reportedModelRevision: string | null;
  readonly reportedMaxInputTokens: number | null;
  readonly runtimeVersion: string | null;
  readonly expectedModelCode: string;
  readonly expectedDimension: number;
  readonly latencyMs: number;
  /** A safe sentence; never a stack trace, container id or filesystem path. */
  readonly detail: string;
};

// ---------------------------------------------------------------------------
// Failures (§39)
// ---------------------------------------------------------------------------

export const EMBEDDING_FAILURE_CLASSES = [
  /** The runtime could not be reached, is starting, or is overloaded. */
  "UNAVAILABLE",
  "TIMEOUT",
  "CANCELLED",
  /** Wrong dimension, non-finite value, or a norm the configuration forbids. */
  "INVALID_VECTOR",
  "INPUT_TOO_LARGE",
  /** The runtime is serving another model, revision or dimension. */
  "MODEL_MISMATCH",
  "CONFIGURATION_ERROR",
  /** The runtime answered with something that is not an embedding response. */
  "INVALID_RESPONSE",
] as const;
export const EmbeddingFailureClassSchema = z.enum(EMBEDDING_FAILURE_CLASSES);
export type EmbeddingFailureClass = z.infer<typeof EmbeddingFailureClassSchema>;

/** Only these are worth another attempt; everything else repeats forever. */
const RETRYABLE: ReadonlySet<EmbeddingFailureClass> = new Set([
  "UNAVAILABLE",
  "TIMEOUT",
]);

export function isRetryableEmbeddingFailure(
  failureClass: EmbeddingFailureClass,
): boolean {
  return RETRYABLE.has(failureClass);
}

export type EmbeddingProviderFailureOptions = {
  readonly failureClass: EmbeddingFailureClass;
  readonly providerCode: EmbeddingProviderCode;
  /** The runtime's HTTP status, for private diagnostics only. */
  readonly status?: number | undefined;
  /** The runtime's stable error token (never its message). */
  readonly runtimeErrorType?: string | undefined;
  readonly cause?: unknown;
};

/**
 * The only error an adapter throws. Its message is the adapter's own safe
 * wording; the runtime's exception travels as `cause` for private
 * diagnostics and is never interpolated into anything that leaves the
 * process.
 */
export class EmbeddingProviderFailure extends Error {
  readonly failureClass: EmbeddingFailureClass;
  readonly providerCode: EmbeddingProviderCode;
  readonly status: number | undefined;
  readonly runtimeErrorType: string | undefined;

  constructor(message: string, options: EmbeddingProviderFailureOptions) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "EmbeddingProviderFailure";
    this.failureClass = options.failureClass;
    this.providerCode = options.providerCode;
    this.status = options.status;
    this.runtimeErrorType = options.runtimeErrorType;
  }

  get retryable(): boolean {
    return isRetryableEmbeddingFailure(this.failureClass);
  }
}

// ---------------------------------------------------------------------------
// Work identity (§31-§32)
// ---------------------------------------------------------------------------

export type EmbeddingWorkIdentity = {
  /** The chunk's content hash, never its text. */
  readonly contentSha256: string;
  readonly modelCode: string;
  readonly dimension: number;
  readonly instructionVersion: string;
};

/**
 * The deterministic identity of one unit of embedding work: the same content
 * under the same model, dimension and instruction is the same work.
 *
 * This is NOT a cache key and NOT an authorisation key. It deliberately
 * carries no tenant, because it describes work, not ownership: storage in
 * CQ-RAG-003 scopes rows by tenant, and two tenants holding identical text
 * must remain two owned rows that cannot observe each other. Using this
 * value alone to address a shared store would let one tenant learn that
 * another embedded the same secret.
 */
export function embeddingWorkKey(identity: EmbeddingWorkIdentity): string {
  return createHash("sha256")
    .update(
      [
        identity.contentSha256,
        identity.modelCode,
        String(identity.dimension),
        identity.instructionVersion,
      ].join(" "),
      "utf8",
    )
    .digest("hex");
}
