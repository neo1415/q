import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { QArtifactIdSchema, QRunIdSchema } from "./ids.js";
import { QPublicFindingSchema } from "./finding.js";
import { QSubjectRefSchema } from "./subject.js";

/**
 * What Q prepares for somebody to read, keep and change (QX-003).
 *
 * An artifact is derived material: Q's own composition over what Capital Q
 * already holds. The invariant that governs every line below is that this
 * is a fourth thing, distinct from the three it is easy to collapse it
 * into:
 *
 *   generated artifact ≠ canonical truth ≠ verified evidence ≠ disclosure
 *
 * A brief saying a company has forty customers does not make that a fact
 * about the company, does not become evidence for it, and does not show it
 * to anybody. It records that Q wrote that sentence, from material the
 * reader was already authorised to see, at a moment in time. Findings
 * inside a section keep their own truth class, evidence status and
 * confidence exactly as they had them, so a reader can see which
 * sentences rest on what.
 *
 * Versions are rows, never an overwritten column. "Edit with Q" composes a
 * new version and the previous one stays readable, because somebody who
 * sent a brief to an investor last week needs to see what they sent.
 */

/**
 * What kind of thing Q prepared.
 *
 * Reference data, not a Postgres or TypeScript enum: the set grows, and a
 * deployment that has not heard of a type must be able to store and return
 * one rather than fail validation. `PITCH_DECK` is named here as the
 * extension point QX-004 fills; nothing in this packet generates one.
 */
export const Q_ARTIFACT_TYPES = ["INVESTMENT_BRIEF", "PITCH_DECK"] as const;
export type QArtifactType = (typeof Q_ARTIFACT_TYPES)[number];
export const QArtifactTypeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,47}$/, "expected an artifact type code");

/**
 * Whether it is ready to read.
 *
 * Preparation is a state of the artifact, not a spinner the browser
 * invents: a person who closes the tab while Q is composing comes back to
 * an artifact that says what it is doing. FAILED is a real resting state —
 * an artifact that could not be composed is not silently absent.
 */
export const Q_ARTIFACT_STATUSES = ["PREPARING", "READY", "FAILED"] as const;
export type QArtifactStatus = (typeof Q_ARTIFACT_STATUSES)[number];
export const QArtifactStatusSchema = z.enum(Q_ARTIFACT_STATUSES);

export const Q_ARTIFACT_TITLE_MAX = 160;
export const Q_ARTIFACT_SUMMARY_MAX = 600;
export const Q_ARTIFACT_SECTION_BODY_MAX = 6_000;
export const Q_ARTIFACT_SECTIONS_MAX = 24;
export const Q_ARTIFACT_FINDINGS_PER_SECTION_MAX = 12;
/** What a person may say when they ask Q to change one. */
export const Q_ARTIFACT_INSTRUCTION_MAX = 2_000;

/**
 * One section of a composed artifact.
 *
 * Prose and the findings it rests on, kept apart. The body is plain text
 * for the same reason a TEXT result block is: no sanitising renderer
 * exists, so no markup contract is promised, and a client escapes what it
 * is given. The findings are the public finding projection — the same one
 * a live answer uses — so a section can show which of its sentences are
 * verified, which are somebody's claim and which Q inferred.
 */
export const QArtifactSectionSchema = z
  .object({
    heading: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
    body: z.string().trim().min(1).max(Q_ARTIFACT_SECTION_BODY_MAX),
    /**
     * What this section rests on. Empty is meaningful and common: a
     * section Q could write nothing grounded for says so rather than
     * being filled in convincingly.
     */
    findings: z
      .array(QPublicFindingSchema)
      .max(Q_ARTIFACT_FINDINGS_PER_SECTION_MAX)
      .default([]),
  })
  .strict();
export type QArtifactSection = z.infer<typeof QArtifactSectionSchema>;

/**
 * The whole of one version's content.
 *
 * Bounded on every axis, and expressible only in these members. That is
 * the same guarantee the persisted result blocks give: what cannot be said
 * in this contract cannot be stored, so a provider payload, a retrieval
 * chunk, a tool scratchpad or anything resembling chain-of-thought has no
 * member to arrive in.
 */
export const QArtifactContentSchema = z
  .object({
    sections: z
      .array(QArtifactSectionSchema)
      .min(1)
      .max(Q_ARTIFACT_SECTIONS_MAX),
    /**
     * What Q could not establish, in its own words. Kept out of the
     * sections so it cannot be mistaken for content and so a reader can
     * see the shape of the gap at a glance. Unknown stays unknown.
     */
    gaps: z.array(z.string().trim().min(1).max(300)).max(24).default([]),
  })
  .strict();
export type QArtifactContent = z.infer<typeof QArtifactContentSchema>;

/** One composed version. Append-only: a later version never edits this one. */
export const QArtifactVersionSchema = z
  .object({
    artifactId: QArtifactIdSchema,
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
    summary: z.string().trim().min(1).max(Q_ARTIFACT_SUMMARY_MAX),
    content: QArtifactContentSchema,
    /**
     * What the person asked for, when this version exists because they
     * asked for a change. Absent on the first version, which nobody
     * revised into being.
     */
    instruction: z.string().trim().max(Q_ARTIFACT_INSTRUCTION_MAX).optional(),
    /** The Q run that composed it. Provenance, never authorisation. */
    composedByRunId: QRunIdSchema.optional(),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type QArtifactVersion = z.infer<typeof QArtifactVersionSchema>;

/** Enough to render a card or a list row, and nothing more. */
export const QArtifactSummarySchema = z
  .object({
    artifactId: QArtifactIdSchema,
    type: QArtifactTypeSchema,
    status: QArtifactStatusSchema,
    title: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
    /** Absent while it is still being prepared, or if preparing failed. */
    summary: z.string().trim().max(Q_ARTIFACT_SUMMARY_MAX).optional(),
    /** What it is about. A reference the reader resolves under their own permissions. */
    subject: QSubjectRefSchema.optional(),
    currentVersion: z.number().int().min(0),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type QArtifactSummary = z.infer<typeof QArtifactSummarySchema>;

/** The artifact, its current version, and what came before it. */
export const QArtifactDetailSchema = z
  .object({
    artifact: QArtifactSummarySchema,
    /** Absent while PREPARING, and when preparing failed. */
    current: QArtifactVersionSchema.optional(),
    /**
     * Every version, newest first, without their content: a history list
     * should not carry the whole of every draft ever written.
     */
    history: z
      .array(
        z
          .object({
            version: z.number().int().min(1),
            title: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
            instruction: z
              .string()
              .trim()
              .max(Q_ARTIFACT_INSTRUCTION_MAX)
              .optional(),
            createdAt: UtcTimestampSchema,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type QArtifactDetail = z.infer<typeof QArtifactDetailSchema>;

export const Q_ARTIFACTS_PATH = "/v1/q/artifacts" as const;
export const qArtifactPath = (artifactId: string) =>
  `${Q_ARTIFACTS_PATH}/${encodeURIComponent(artifactId)}`;
export const Q_ARTIFACT_VERSIONS_SUFFIX = "/versions" as const;

/**
 * PUBLIC. What a client may say when it asks Q to prepare one.
 *
 * What it may not say, and what fails validation if it tries: who it is,
 * which tenant or organisation owns the result, what it may read, or what
 * the content should be. Ownership and authority are resolved on the
 * server from the session; the subject is checked against them.
 */
export const CreateQArtifactRequestSchema = z
  .object({
    type: QArtifactTypeSchema,
    /** What it should be about. The server checks this is theirs to ask about. */
    subject: QSubjectRefSchema,
    /** Optional steer, in the person's own words. Never instructions to the system. */
    instruction: z.string().trim().max(Q_ARTIFACT_INSTRUCTION_MAX).optional(),
  })
  .strict();
export type CreateQArtifactRequest = z.infer<
  typeof CreateQArtifactRequestSchema
>;

/** PUBLIC. "Edit with Q": what to change, in the person's own words. */
export const ReviseQArtifactRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(Q_ARTIFACT_INSTRUCTION_MAX),
  })
  .strict();
export type ReviseQArtifactRequest = z.infer<
  typeof ReviseQArtifactRequestSchema
>;

export const ListQArtifactsResponseSchema = z
  .object({
    items: z.array(QArtifactSummarySchema).max(100),
    /** Cursor, never an offset: the list changes under the reader. */
    nextBefore: UtcTimestampSchema.optional(),
  })
  .strict();
export type ListQArtifactsResponse = z.infer<
  typeof ListQArtifactsResponseSchema
>;

export const ListQArtifactsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: UtcTimestampSchema.optional(),
    subjectId: UuidSchema.optional(),
  })
  .strict();
export type ListQArtifactsQuery = z.infer<typeof ListQArtifactsQuerySchema>;
