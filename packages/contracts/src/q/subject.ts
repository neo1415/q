import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * Typed references to the canonical entities a Q request or result is about
 * (doc 12 §8 `subject`, §9.3 `subjectRefs`).
 *
 * A discriminated union with a distinct field name per kind, deliberately not
 * `{ type: string; id: string }`. The generic shape reads as harmless and is
 * not: it invites a table lookup keyed on the type somewhere downstream, and
 * it lets a company id travel where an investor id was meant. Each kind here
 * maps to exactly one canonical entity owned by exactly one bounded context,
 * and a subject is resolved through that context's typed query port -- never
 * through dynamic SQL keyed on the discriminator.
 *
 * Only entities that are canonical in the repository today are listed. A
 * meeting subject is absent because no Meeting context exists yet; it arrives
 * with the meetings packet as an additive member, not as a placeholder.
 *
 * A reference is a selection, not authority. The caller naming a company does
 * not prove they may read it; the Context Firewall (CQ-Q-004) decides that.
 *
 * Identifiers are plain UUIDs on the wire, as every DTO in this package
 * carries them. The branded domain types (CompanyId, RelationshipId, ...) are
 * declared by their owning packages, which depend on this one, so the kind
 * plus the field name is what makes the reference typed here.
 */
export const Q_SUBJECT_KINDS = [
  "COMPANY",
  "INVESTOR_ORGANISATION",
  "RELATIONSHIP",
  "CAPITAL_OBJECTIVE",
  "DOCUMENT",
  "USER",
  "ORGANISATION",
] as const;

export type QSubjectKind = (typeof Q_SUBJECT_KINDS)[number];

export const QSubjectKindSchema = z.enum(Q_SUBJECT_KINDS);

export const QCompanySubjectSchema = z
  .object({ kind: z.literal("COMPANY"), companyId: UuidSchema })
  .strict();

export const QInvestorOrganisationSubjectSchema = z
  .object({
    kind: z.literal("INVESTOR_ORGANISATION"),
    investorOrganisationId: UuidSchema,
  })
  .strict();

export const QRelationshipSubjectSchema = z
  .object({ kind: z.literal("RELATIONSHIP"), relationshipId: UuidSchema })
  .strict();

export const QCapitalObjectiveSubjectSchema = z
  .object({
    kind: z.literal("CAPITAL_OBJECTIVE"),
    capitalObjectiveId: UuidSchema,
  })
  .strict();

export const QDocumentSubjectSchema = z
  .object({ kind: z.literal("DOCUMENT"), documentId: UuidSchema })
  .strict();

export const QUserSubjectSchema = z
  .object({ kind: z.literal("USER"), userId: UuidSchema })
  .strict();

export const QOrganisationSubjectSchema = z
  .object({ kind: z.literal("ORGANISATION"), organisationId: UuidSchema })
  .strict();

export const QSubjectRefSchema = z.discriminatedUnion("kind", [
  QCompanySubjectSchema,
  QInvestorOrganisationSubjectSchema,
  QRelationshipSubjectSchema,
  QCapitalObjectiveSubjectSchema,
  QDocumentSubjectSchema,
  QUserSubjectSchema,
  QOrganisationSubjectSchema,
]);

export type QSubjectRef = z.infer<typeof QSubjectRefSchema>;

/**
 * Upper bound on subjects per request or result. A comparison of six
 * companies is a large request; a list of a hundred is a bulk export
 * pretending to be a question. A V1 technical bound, not a product rule.
 */
export const Q_SUBJECTS_MAX = 20;

export const QSubjectRefsSchema = z
  .array(QSubjectRefSchema)
  .max(Q_SUBJECTS_MAX);
