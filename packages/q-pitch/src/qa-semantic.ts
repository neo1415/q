import { z } from "zod";

import {
  QA_BANK,
  clarifyPrompt,
  type QaEntry,
  type QaMatch,
  type QaSide,
} from "./qa-bank.js";

/**
 * Q Story ending, tier 2: meaning by embedding, for the spoken questions the
 * word matcher (tier 1, `buildQaIndex`) is not sure of.
 *
 * Each stored wording of the bank is embedded once, offline, through the
 * reviewed embedding adapter (`@capital-q/q-embeddings`, the one retrieval
 * and the recommendation worker use) and committed as a vectors file. At
 * question time the server embeds the question through the same adapter and
 * model, and this module compares it with the bank's vectors. Nothing here
 * calls a provider; it is pure arithmetic over vectors it is given.
 *
 * The thresholds are not constants in code: they are calibrated with the
 * vectors (no unrelated question answered on the calibration set) and travel
 * in the same file, so a file without them cannot answer. A file built from
 * a different bank is stale: its content hash no longer matches, and tier 2
 * stays off until it is rebuilt.
 */

export const QA_VECTORS_FORMAT = "capital-q.qa-bank-vectors.v1" as const;

export const QaSemanticThresholdsSchema = z
  .object({
    /** Cosine at which tier 2 answers. */
    answer: z.number().min(0).max(1),
    /** How far the best entry must lead the runner-up. */
    margin: z.number().min(0).max(1),
    /** Between this and `answer`, Q asks "Do you mean …?". */
    clarifyFloor: z.number().min(0).max(1),
  })
  .strict()
  .refine((t) => t.clarifyFloor <= t.answer, {
    message: "the clarify floor is at most the answer threshold",
  });
export type QaSemanticThresholds = z.infer<typeof QaSemanticThresholdsSchema>;

export const QaVectorsFileSchema = z
  .object({
    format: z.literal(QA_VECTORS_FORMAT),
    /** The embedding configuration and model the vectors were made with. */
    configurationVersion: z.string().min(1).max(120),
    modelCode: z.string().min(1).max(120),
    /** Stored dimension (a prefix of the model's, renormalised). */
    dimension: z.number().int().min(16).max(4096),
    /** `qaBankContentHash(QA_BANK)` when the vectors were made. */
    contentHash: z.string().regex(/^[0-9a-f]{16}$/u),
    createdAt: z.string().min(10).max(40),
    thresholds: QaSemanticThresholdsSchema,
    /** What the calibration measured, for the record. */
    calibration: z.record(z.string(), z.union([z.number(), z.string()])),
    /** Per entry, one base64 int8 vector per stored wording. */
    entries: z.array(
      z
        .object({
          id: z.string().min(1),
          vectors: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type QaVectorsFile = z.infer<typeof QaVectorsFileSchema>;

/**
 * A fingerprint of every entry's id, side and wordings (not the answers: an
 * answer may be reworded without re-embedding). FNV-1a, 64 bits; this only
 * detects a stale file, it protects nothing.
 */
export function qaBankContentHash(bank: readonly QaEntry[] = QA_BANK): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const text = [...bank]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e) => [e.id, e.side, e.question, ...e.paraphrases].join("\u0001"))
    .join("\u0002");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The stored wordings, in the order a vectors file lists them. */
export function qaWordings(entry: QaEntry): readonly string[] {
  return [entry.question, ...entry.paraphrases];
}

/** Unit vector → base64 int8 (a quarter of the size, cosine kept to ~1%). */
export function encodeQaVector(vector: readonly number[]): string {
  const bytes = new Int8Array(vector.length);
  const top = Math.max(...vector.map((v) => Math.abs(v)), 1e-9);
  for (const [i, v] of vector.entries()) {
    bytes[i] = Math.max(-127, Math.min(127, Math.round((v / top) * 127)));
  }
  let binary = "";
  for (const b of new Uint8Array(bytes.buffer)) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** base64 int8 → unit vector. */
export function decodeQaVector(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = (binary.charCodeAt(i) << 24) >> 24;
  }
  return unit(Float32Array.from(bytes));
}

/** The first `dimension` values, renormalised (text-embedding-3 keeps meaning in its prefix). */
export function shortenQaVector(
  vector: readonly number[],
  dimension: number,
): Float32Array {
  return unit(Float32Array.from(vector.slice(0, dimension)));
}

function unit(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const v of vector) norm += v * v;
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  return vector.map((v) => v * scale);
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

export type QaSemanticIndex = {
  readonly dimension: number;
  readonly thresholds: QaSemanticThresholds;
  /** Closest entries by their best wording, best first. */
  readonly rank: (
    query: Float32Array,
  ) => readonly { readonly entry: QaEntry; readonly score: number }[];
  /** ANSWER, CLARIFY or LEAVE_TO_Q for an already embedded question. */
  readonly decide: (query: Float32Array) => QaMatch;
};

export type QaVectorsStatus =
  | { readonly kind: "READY"; readonly file: QaVectorsFile }
  | { readonly kind: "INVALID"; readonly reason: string }
  | {
      readonly kind: "STALE";
      readonly expected: string;
      readonly found: string;
    };

/** Whether a vectors file may be used with this bank. */
export function checkQaVectors(
  raw: unknown,
  bank: readonly QaEntry[] = QA_BANK,
): QaVectorsStatus {
  const parsed = QaVectorsFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "INVALID", reason: parsed.error.message.slice(0, 300) };
  }
  const expected = qaBankContentHash(bank);
  if (parsed.data.contentHash !== expected) {
    return { kind: "STALE", expected, found: parsed.data.contentHash };
  }
  const byId = new Map(bank.map((e) => [e.id, e]));
  for (const row of parsed.data.entries) {
    const entry = byId.get(row.id);
    if (
      entry === undefined ||
      row.vectors.length !== qaWordings(entry).length
    ) {
      return { kind: "STALE", expected, found: parsed.data.contentHash };
    }
  }
  return { kind: "READY", file: parsed.data };
}

/**
 * The tier-2 index for one side, over a READY file. Same decision shape as
 * tier 1: answer when close and clearly ahead, ask on a close call, else
 * leave to normal Q.
 */
export function buildQaSemanticIndex(
  side: Exclude<QaSide, "BOTH">,
  file: QaVectorsFile,
  bank: readonly QaEntry[] = QA_BANK,
): QaSemanticIndex {
  const byId = new Map(bank.map((e) => [e.id, e]));
  const rows = file.entries.flatMap((row) => {
    const entry = byId.get(row.id);
    if (entry === undefined) return [];
    if (entry.side !== "BOTH" && entry.side !== side) return [];
    return row.vectors.map((v) => ({ entry, vector: decodeQaVector(v) }));
  });
  const { thresholds } = file;
  const rank = (query: Float32Array) => {
    const best = new Map<QaEntry, number>();
    for (const { entry, vector } of rows) {
      const score = dot(query, vector);
      if (score > (best.get(entry) ?? -1)) best.set(entry, score);
    }
    return [...best.entries()]
      .map(([entry, score]) => ({ entry, score }))
      .sort((a, b) => b.score - a.score);
  };
  const decide = (query: Float32Array): QaMatch => {
    const [first, second] = rank(query);
    if (first === undefined || first.score < thresholds.clarifyFloor) {
      return { kind: "LEAVE_TO_Q" };
    }
    const lead = first.score - (second?.score ?? 0);
    if (first.score >= thresholds.answer && lead >= thresholds.margin) {
      return { kind: "ANSWER", entry: first.entry, score: first.score };
    }
    const candidates: [QaEntry, ...QaEntry[]] =
      second !== undefined &&
      second.score >= thresholds.clarifyFloor &&
      lead < thresholds.margin
        ? [first.entry, second.entry]
        : [first.entry];
    return { kind: "CLARIFY", candidates, prompt: clarifyPrompt(candidates) };
  };
  return { dimension: file.dimension, thresholds, rank, decide };
}

/**
 * Tier 1 then tier 2: a confident word match stands; otherwise a confident
 * meaning match answers; otherwise either tier's "Do you mean …?" (meaning
 * first); otherwise normal Q. Tier 2 never overrules a confident tier 1.
 */
export function combineQaTiers(tier1: QaMatch, tier2: QaMatch | null): QaMatch {
  if (tier1.kind === "ANSWER" || tier2 === null) return tier1;
  if (tier2.kind === "ANSWER") return tier2;
  if (tier2.kind === "CLARIFY") return tier2;
  return tier1;
}
