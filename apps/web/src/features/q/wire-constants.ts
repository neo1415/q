/**
 * Q room W7: the few plain values the first paint needs from the
 * contracts, copied here because every contracts module also builds Zod
 * schemas, and importing one value brought Zod into the first-load script.
 * test/wire-constants.test.ts holds each copy equal to its contract, so
 * a change there fails the suite rather than drifting.
 */

import type {
  QArtifactExportFormat,
  QConfidenceLevel,
  QConversationId,
} from "@capital-q/contracts";

/** GOOGLE_RECONNECT_PATH (http/integrations). */
export const GOOGLE_RECONNECT_PATH = "/settings/reconnect/google" as const;

/** Q_SPEECH_MAX_CHARS (q/voice): the most of an answer read aloud. */
export const Q_SPEECH_MAX_CHARS = 600;

/** Q_CONFIDENCE_LABELS (q/confidence): a finding's confidence, in words. */
export const Q_CONFIDENCE_LABELS: Readonly<Record<QConfidenceLevel, string>> = {
  HIGH: "High confidence",
  MODERATE: "Moderate confidence",
  LOW: "Low confidence",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  CONFLICTING_EVIDENCE: "Conflicting evidence",
};

/** qArtifactExportFormats (q/artifact): what a card offers for a type. */
export function qArtifactExportFormats(
  type: string,
): readonly QArtifactExportFormat[] {
  return type === "PITCH_DECK" ? ["pdf", "pptx"] : ["pdf"];
}

/** The page manifest's bounds (q/screen-manifest). */
export const Q_MANIFEST_SECTIONS_MAX = 12;
export const Q_MANIFEST_SECTION_REFS_MAX = 12;
export const Q_MANIFEST_DIALOGS_MAX = 3;
export const Q_MANIFEST_DIALOG_REFS_MAX = 4;

/** The manifest's filter keys, and the shape of a value (q/screen-manifest). */
export const Q_MANIFEST_FILTER_KEYS = [
  "sector",
  "stage",
  "country",
  "raise",
  "verified",
  "pitch",
  "view",
] as const;
export type QManifestFilterKey = (typeof Q_MANIFEST_FILTER_KEYS)[number];
export const MANIFEST_FILTER_VALUE = /^[A-Za-z0-9_.,:-]{1,64}$/u;

/** Q_VOICE_LISTENING_LEVELS and its default (q/voice). */
export const Q_VOICE_LISTENING_LEVELS = ["OFF", "SUBTLE", "NATURAL"] as const;
export const Q_VOICE_LISTENING_DEFAULT = "SUBTLE" as const;

/**
 * A UUID as the contracts' `z.uuid()` accepts it (RFC 9562 versions 1-8
 * with the RFC variant, or the nil and max UUIDs), for ids read from the
 * URL or storage before the full contracts are loaded. The server checks
 * every id again.
 */
const UUID =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/u;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A conversation id read from the URL or storage, as QConversationIdSchema reads it. */
export function conversationIdOf(value: unknown): QConversationId | undefined {
  // The brand is the contracts' own (`UuidSchema.brand()`): the same check.
  return isUuid(value) ? (value as QConversationId) : undefined;
}
