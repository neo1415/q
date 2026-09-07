import { createHash } from "node:crypto";

import {
  EmbeddingConfigurationSchema,
  EmbeddingProviderFailure,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  instructionFor,
  type EmbedDocumentsRequest,
  type EmbeddingBatchResult,
  type EmbeddingConfiguration,
  type EmbeddingFailureClass,
  type EmbeddingProviderDescriptor,
  type EmbeddingProviderHealth,
  type EmbeddingResult,
  type EmbedQueryRequest,
} from "../contracts/index.js";
import type {
  EmbeddingExecutionContext,
  EmbeddingProvider,
} from "../application/ports.js";
import { inputHash, vectorNorm } from "../domain/vector.js";

/**
 * The deterministic test provider (CQ-RAG-002 §47).
 *
 * `pnpm test` must stay free, offline and fast: no Docker, no model
 * download, no GPU, no network. Software tests therefore prove the service,
 * the validation and every failure path against the EmbeddingProvider port
 * with scripted behaviour, exactly as the Model Gateway's fake proves
 * routing without an SDK.
 *
 * Its vectors are a deterministic hash expansion, so the same text always
 * yields the same unit vector and identical text scores 1.0 against itself.
 * They carry no semantics: only the live local model can show that a
 * relevant passage outranks an unrelated one.
 */

export const FAKE_EMBEDDING_PROVIDER_CODE = "fake" as const;

export const FAKE_EMBEDDING_CONFIGURATION: EmbeddingConfiguration =
  EmbeddingConfigurationSchema.parse({
    configurationVersion: "capital-q-fake-embedding-v1",
    providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
    runtime: "IN_PROCESS_FAKE",
    modelCode: "fake/deterministic-hash",
    modelFamily: "fake",
    modelRevision: null,
    dimension: 8,
    maxDimension: 8,
    normalization: "L2_UNIT",
    instructionStrategy: "QUERY_ONLY",
    maxInputCharacters: 4_000,
    maxBatchItems: 8,
    maxBatchCharacters: 16_000,
  });

export type FakeEmbeddingBehaviour =
  | { readonly kind: "OK" }
  /** Returns a vector of the wrong length; the caller must refuse it. */
  | { readonly kind: "WRONG_DIMENSION"; readonly dimension: number }
  | { readonly kind: "NAN" }
  | { readonly kind: "INFINITY" }
  /** Returns an unnormalised vector under a normalised configuration. */
  | { readonly kind: "UNNORMALIZED" }
  /** Waits, so a caller can cancel or time out. */
  | { readonly kind: "DELAY"; readonly delayMs: number }
  | { readonly kind: "FAILURE"; readonly failureClass: EmbeddingFailureClass };

export type FakeEmbeddingProviderOptions = {
  readonly configuration?: EmbeddingConfiguration | undefined;
  readonly behaviour?: FakeEmbeddingBehaviour | undefined;
  readonly health?: EmbeddingProviderHealth["state"] | undefined;
};

export type FakeEmbeddingProvider = EmbeddingProvider & {
  /** What the provider was asked to embed, for privacy assertions. */
  readonly inputs: readonly string[];
  readonly calls: () => number;
  readonly setBehaviour: (behaviour: FakeEmbeddingBehaviour) => void;
};

/** A deterministic unit vector derived from the text. No semantics implied. */
export function deterministicVector(
  text: string,
  dimension: number,
): readonly number[] {
  const values: number[] = [];
  let counter = 0;
  while (values.length < dimension) {
    const digest = createHash("sha256")
      .update(`${String(counter)}:${text}`, "utf8")
      .digest();
    for (
      let at = 0;
      at + 1 < digest.length && values.length < dimension;
      at += 2
    ) {
      values.push((digest.readUInt16BE(at) / 65_535) * 2 - 1);
    }
    counter += 1;
  }
  const norm = vectorNorm(values);
  return norm === 0 ? values : values.map((value) => value / norm);
}

export function createFakeEmbeddingProvider(
  options: FakeEmbeddingProviderOptions = {},
): FakeEmbeddingProvider {
  const configuration = options.configuration ?? FAKE_EMBEDDING_CONFIGURATION;
  let behaviour: FakeEmbeddingBehaviour = options.behaviour ?? { kind: "OK" };
  const inputs: string[] = [];
  let calls = 0;

  const wait = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(
            new EmbeddingProviderFailure(
              "the embedding request was cancelled",
              {
                failureClass: "CANCELLED",
                providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
              },
            ),
          );
        },
        { once: true },
      );
    });

  async function vectorFor(
    text: string,
    context: EmbeddingExecutionContext,
  ): Promise<readonly number[]> {
    calls += 1;
    inputs.push(text);
    switch (behaviour.kind) {
      case "OK":
        return deterministicVector(text, configuration.dimension);
      case "WRONG_DIMENSION":
        return deterministicVector(text, behaviour.dimension);
      case "NAN":
        return Array.from(
          { length: configuration.dimension },
          () => Number.NaN,
        );
      case "INFINITY":
        return [
          Number.POSITIVE_INFINITY,
          ...deterministicVector(text, configuration.dimension - 1),
        ];
      case "UNNORMALIZED":
        return deterministicVector(text, configuration.dimension).map(
          (value) => value * 7,
        );
      case "DELAY":
        await wait(behaviour.delayMs, context.signal);
        return deterministicVector(text, configuration.dimension);
      case "FAILURE":
        throw new EmbeddingProviderFailure(
          "the fake embedding provider was scripted to fail",
          {
            failureClass: behaviour.failureClass,
            providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
          },
        );
    }
  }

  const toResult = (
    vector: readonly number[],
    input: string,
    instructionVersion: string,
  ): EmbeddingResult => ({
    vector,
    dimension: vector.length,
    providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
    modelCode: configuration.modelCode,
    modelRevision: configuration.modelRevision,
    configurationVersion: configuration.configurationVersion,
    instructionVersion,
    inputSha256: inputHash(input),
    inputCharacters: input.length,
    latencyMs: 0,
  });

  const describe = (): EmbeddingProviderDescriptor => ({
    providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
    configuration,
    endpoint: null,
  });

  return {
    code: FAKE_EMBEDDING_PROVIDER_CODE,
    describe,
    inputs,
    calls: () => calls,
    setBehaviour: (next) => {
      behaviour = next;
    },

    embedDocuments: async (
      request: EmbedDocumentsRequest,
      context: EmbeddingExecutionContext = {},
    ): Promise<EmbeddingBatchResult> => {
      if (request.inputs.length > configuration.maxBatchItems) {
        throw new EmbeddingProviderFailure("the batch is too large", {
          failureClass: "INPUT_TOO_LARGE",
          providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
        });
      }
      const embeddings: EmbeddingResult[] = [];
      for (const input of request.inputs) {
        if (input.length > configuration.maxInputCharacters) {
          throw new EmbeddingProviderFailure("the input is too large", {
            failureClass: "INPUT_TOO_LARGE",
            providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
          });
        }
        embeddings.push(
          toResult(
            await vectorFor(input, context),
            input,
            EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
          ),
        );
      }
      return {
        embeddings,
        batchSize: request.inputs.length,
        latencyMs: 0,
      };
    },

    embedQuery: async (
      request: EmbedQueryRequest,
      context: EmbeddingExecutionContext = {},
    ): Promise<EmbeddingResult> => {
      const profile = instructionFor(request.task);
      const input =
        configuration.instructionStrategy === "QUERY_ONLY"
          ? `Instruct: ${profile.instruction}\nQuery:${request.query}`
          : request.query;
      return toResult(
        await vectorFor(input, context),
        input,
        profile.instructionVersion,
      );
    },

    health: (): Promise<EmbeddingProviderHealth> =>
      Promise.resolve({
        state: options.health ?? "READY",
        providerCode: FAKE_EMBEDDING_PROVIDER_CODE,
        endpoint: null,
        reportedModelCode: configuration.modelCode,
        reportedModelRevision: configuration.modelRevision,
        reportedMaxInputTokens: null,
        runtimeVersion: "fake",
        expectedModelCode: configuration.modelCode,
        expectedDimension: configuration.dimension,
        latencyMs: 0,
        detail: "deterministic in-process provider",
      }),
  };
}
