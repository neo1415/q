import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";

/**
 * `GET /v1/q/profile-findings` — what Q found about the person's own
 * profile subject on the public web (BIZ-002).
 *
 * The profile page shows three things apart and never merges them: what
 * the person declared, what Q found (this), and what Capital Q verified.
 * A finding is Q's reading of a public page the person's own presence
 * build cited: it carries ADR-001's three axes as recorded, the page it
 * came from and when it was read, and nothing that would present it as
 * fact. No confidence percentage exists on this shape.
 *
 * Only the actor's own subjects: themselves, their company, their investor
 * organisation. Anything else is one "not found". Reading is authorised by
 * the Context Firewall before any row is touched.
 */
export const Q_PROFILE_FINDINGS_PATH = "/v1/q/profile-findings" as const;

export const PROFILE_FINDING_SUBJECT_TYPES = [
  "PERSON",
  "COMPANY",
  "INVESTOR_ORGANISATION",
] as const;
export const ProfileFindingSubjectTypeSchema = z.enum(
  PROFILE_FINDING_SUBJECT_TYPES,
);
export type ProfileFindingSubjectType = z.infer<
  typeof ProfileFindingSubjectTypeSchema
>;

export const ProfileFindingsQuerySchema = z
  .object({
    subjectType: ProfileFindingSubjectTypeSchema,
    subjectId: UuidSchema,
  })
  .strict();
export type ProfileFindingsQuery = z.infer<typeof ProfileFindingsQuerySchema>;

/**
 * The kinds of finding a profile shows. Observed-signal understandings
 * (what someone publishes about, how they sound) are deliberately absent:
 * they are about a person's public voice, not their profile.
 */
export const PROFILE_FINDING_KEYS = [
  "presence.self_description",
  "presence.what_they_do",
  "presence.location",
  "presence.milestone",
] as const;
export const ProfileFindingKeySchema = z.enum(PROFILE_FINDING_KEYS);
export type ProfileFindingKey = z.infer<typeof ProfileFindingKeySchema>;

export const ProfileFindingSourceSchema = z
  .object({
    title: z.string().max(200).nullable(),
    /** The page Q read. Provenance only; Capital Q does not vouch for it. */
    url: z.string().max(2048),
    retrievedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type ProfileFindingSource = z.infer<typeof ProfileFindingSourceSchema>;

export const ProfileFindingSchema = z
  .object({
    id: UuidSchema,
    key: ProfileFindingKeySchema,
    statement: z.string().min(1).max(2000),
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    lifecycleStatus: LifecycleStatusSchema,
    recordedAt: UtcTimestampSchema,
    sources: z.array(ProfileFindingSourceSchema).max(5),
  })
  .strict();
export type ProfileFinding = z.infer<typeof ProfileFindingSchema>;

export const ProfileFindingsResponseSchema = z
  .object({
    subjectType: ProfileFindingSubjectTypeSchema,
    subjectId: UuidSchema,
    findings: z.array(ProfileFindingSchema).max(20),
  })
  .strict();
export type ProfileFindingsResponse = z.infer<
  typeof ProfileFindingsResponseSchema
>;
