import { createHash } from "node:crypto";

/**
 * Deterministic reference identifiers.
 *
 * Platform taxonomy rows must carry the same UUID in local, test, staging
 * and production so fixtures, evals, demo data and API consumers can name
 * the same concept everywhere. Identifiers are RFC 4122 version-5 UUIDs
 * (SHA-1) over a fixed Capital Q taxonomy namespace and the concept's
 * stable name -- never a random value generated at seed time, and never
 * derived from a display label.
 *
 * The name is the vocabulary code and canonical code. Renaming a display
 * name therefore never moves an id; changing a canonical code is a
 * deliberate replacement (new node + successor edge), not a rename.
 */
export const TAXONOMY_REFERENCE_NAMESPACE =
  "5b1c0f2e-4d3a-4c8e-9f21-7a6e2b9d1c40";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 4122 v5 UUID of `name` under `namespace`. */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

export function stableVocabularyId(vocabularyCode: string): string {
  return uuidV5(TAXONOMY_REFERENCE_NAMESPACE, `vocabulary:${vocabularyCode}`);
}

export function stableNodeId(
  vocabularyCode: string,
  canonicalCode: string,
): string {
  return uuidV5(
    TAXONOMY_REFERENCE_NAMESPACE,
    `node:${vocabularyCode}/${canonicalCode}`,
  );
}

export function stableAliasId(
  vocabularyCode: string,
  canonicalCode: string,
  locale: string,
  normalizedAlias: string,
): string {
  return uuidV5(
    TAXONOMY_REFERENCE_NAMESPACE,
    `alias:${vocabularyCode}/${canonicalCode}:${locale}:${normalizedAlias}`,
  );
}
