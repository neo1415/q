import { z } from "zod";

/**
 * Security sensitivity of a message payload (doc 15).
 *
 * This answers "how damaging would exposure of this content be", and it drives
 * handling: where a payload may be stored, logged, replicated or sent.
 *
 * It is NOT the same axis as ADR-001's disclosure scopes -- personal_private,
 * organisation_private, founder_private, investor_private, relationship_shared,
 * specifically_shared, network_visible, public_external -- which answer "who is
 * permitted to see this". A founder_private note and an investor_private note
 * share a disclosure question but may carry different sensitivity, and a
 * network_visible profile is not the same statement as PUBLIC.
 *
 * The two vocabularies must never be merged into one enum. Collapsing them
 * loses one of the two questions, and it is always the permission question that
 * quietly disappears.
 */
export const MESSAGE_SENSITIVITIES = [
  "PUBLIC",
  "NETWORK_VISIBLE",
  "INTERNAL",
  "CONFIDENTIAL",
  "HIGHLY_CONFIDENTIAL",
  "RESTRICTED",
] as const;

export type MessageSensitivity = (typeof MESSAGE_SENSITIVITIES)[number];

export const MessageSensitivitySchema = z.enum(MESSAGE_SENSITIVITIES);
