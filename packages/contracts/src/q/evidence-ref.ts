import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * A safe pointer to evidence, never the evidence (doc 12 §2.5, §46.3;
 * doc 22 §192).
 *
 * Carries identifiers of objects the Evidence context owns, and at most a
 * page number to locate a citation inside a document. It never carries
 * document text, an excerpt, a filename, a title, a source URL, a storage
 * key, a signed URL or any metadata: those are the evidence, and whether
 * this person may see them is decided by disclosure at render time, not
 * pre-decided by whatever produced the reference.
 *
 * A reference existing inside a run is not permission to show it. The
 * Context Firewall and disclosure layer decide which references survive into
 * a public projection; a reference that reaches a client is one they may
 * follow. The existence of a source can itself be confidential, which is why
 * even a bare SOURCE reference is subject to that decision.
 *
 * Identifiers are plain UUIDs on the wire; the branded EvidenceItemId,
 * ClaimId, DocumentId, DocumentVersionId and EvidenceSourceId live in
 * @capital-q/evidence, which depends on this package.
 */
export const Q_EVIDENCE_REF_KINDS = [
  "EVIDENCE_ITEM",
  "CLAIM",
  "DOCUMENT",
  "SOURCE",
] as const;

export type QEvidenceRefKind = (typeof Q_EVIDENCE_REF_KINDS)[number];

export const QEvidenceRefKindSchema = z.enum(Q_EVIDENCE_REF_KINDS);

export const QEvidenceItemRefSchema = z
  .object({ kind: z.literal("EVIDENCE_ITEM"), evidenceItemId: UuidSchema })
  .strict();

export const QClaimRefSchema = z
  .object({ kind: z.literal("CLAIM"), claimId: UuidSchema })
  .strict();

export const QDocumentRefSchema = z
  .object({
    kind: z.literal("DOCUMENT"),
    documentId: UuidSchema,
    /** The immutable version cited, when the citation is version-specific. */
    documentVersionId: UuidSchema.optional(),
    /** A page number is a locator, not content. */
    page: z.number().int().min(1).optional(),
  })
  .strict();

export const QSourceRefSchema = z
  .object({ kind: z.literal("SOURCE"), sourceId: UuidSchema })
  .strict();

export const QEvidenceRefSchema = z.discriminatedUnion("kind", [
  QEvidenceItemRefSchema,
  QClaimRefSchema,
  QDocumentRefSchema,
  QSourceRefSchema,
]);

export type QEvidenceRef = z.infer<typeof QEvidenceRefSchema>;

/** Citations per finding or block. A V1 technical bound. */
export const Q_EVIDENCE_REFS_MAX = 50;

export const QEvidenceRefsSchema = z
  .array(QEvidenceRefSchema)
  .max(Q_EVIDENCE_REFS_MAX);
