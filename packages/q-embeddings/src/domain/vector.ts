import { createHash } from "node:crypto";

import {
  EmbeddingProviderFailure,
  type EmbeddingConfiguration,
  type EmbeddingProviderCode,
} from "../contracts/index.js";

/**
 * Vector validation at the runtime trust boundary (CQ-RAG-002 §28).
 *
 * Whatever the runtime returns is untrusted input. A vector of the wrong
 * length, a NaN, an infinity or a vector that is not normalised when the
 * configuration says it must be are all refused here, loudly, rather than
 * carried into storage where the defect becomes silent and permanent.
 *
 * Nothing is repaired: a short vector is never padded, a long one is never
 * truncated and a raw one is never normalised behind the configuration's
 * back. Repairing would hide the disagreement that caused it.
 */

/**
 * Float32 accumulation over 1024 terms leaves a unit norm a little short of
 * exactly 1. This tolerance is wide enough for that and far too narrow to
 * admit an unnormalised vector.
 */
export const UNIT_NORM_TOLERANCE = 1e-3;

export function vectorNorm(vector: readonly number[]): number {
  let total = 0;
  for (const value of vector) {
    total += value * value;
  }
  return Math.sqrt(total);
}

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length !== b.length || a.length === 0) {
    throw new TypeError("cosine similarity needs two vectors of equal length");
  }
  let dot = 0;
  for (let at = 0; at < a.length; at += 1) {
    dot += (a[at] ?? 0) * (b[at] ?? 0);
  }
  const magnitude = vectorNorm(a) * vectorNorm(b);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/** Hex SHA-256 of the embedded text: a safe reference that is not the text. */
export function inputHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Refuses anything that is not a usable vector under this configuration.
 * Returns the vector unchanged when it is.
 */
export function assertValidVector(
  value: unknown,
  configuration: EmbeddingConfiguration,
  providerCode: EmbeddingProviderCode,
): readonly number[] {
  const fail = (message: string): never => {
    throw new EmbeddingProviderFailure(message, {
      failureClass: "INVALID_VECTOR",
      providerCode,
    });
  };
  if (!Array.isArray(value)) {
    return fail("the embedding runtime did not return a vector");
  }
  if (value.length === 0) {
    return fail("the embedding runtime returned an empty vector");
  }
  if (value.length !== configuration.dimension) {
    // Never resized. A dimension disagreement means the runtime is serving
    // something other than what this configuration describes.
    return fail(
      `the embedding runtime returned ${String(value.length)} values where the configuration requires ${String(configuration.dimension)}`,
    );
  }
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return fail(
        "the embedding runtime returned a non-finite value in a vector",
      );
    }
  }
  const vector = value as readonly number[];
  if (configuration.normalization === "L2_UNIT") {
    const norm = vectorNorm(vector);
    if (Math.abs(norm - 1) > UNIT_NORM_TOLERANCE) {
      // The configuration promises unit vectors to everything downstream,
      // and cosine retrieval will assume it. A runtime that stopped
      // normalising must be found here, not in a ranking anomaly later.
      return fail(
        "the embedding runtime returned a vector that is not unit length under a normalised configuration",
      );
    }
  }
  return vector;
}
