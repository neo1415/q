import { z } from "zod";

import { UtcTimestampSchema } from "@capital-q/contracts";
import { TenantIdSchema } from "@capital-q/security";

/**
 * Q memory (doc 13 §40; doc 14 §55-§61, §130-§131; ADR 0012).
 *
 *   Q Memory ≠ Q Knowledge ≠ Audit History
 *
 * A memory is what a person told Q about themselves and how they want
 * to be dealt with, kept so Q behaves as told next time. It is never
 * evidence about a company (the Knowledge Write Gate owns that), never a
 * record of who did what (audit owns that), and never authority: a
 * remembered "call me Dan" changes what Q says, not what anyone may do.
 *
 * The candidate shape is deliberately narrow. There is no field for
 * tenant, owner, status, visibility, sensitivity or write mode: the
 * service derives every one of those from the actor and the command, so
 * a model that fills a candidate cannot reach any of them.
 */

export const MEMORY_OWNER_CONTEXT_TYPES = [
  "user",
  "organisation",
  "company",
  "investor",
  "relationship",
  "capital_objective",
  "meeting",
] as const;
export const MemoryOwnerContextTypeSchema = z.enum(MEMORY_OWNER_CONTEXT_TYPES);
export type MemoryOwnerContextType = z.infer<
  typeof MemoryOwnerContextTypeSchema
>;

export const MEMORY_TYPES = [
  "preference",
  "pronunciation",
  "correction",
  "fact",
  "episodic",
] as const;
export const MemoryTypeSchema = z.enum(MEMORY_TYPES);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MEMORY_STATUSES = [
  "candidate",
  "confirmed",
  "active",
  "superseded",
  "forgotten",
  "revoked",
  "archived",
] as const;
export const MemoryStatusSchema = z.enum(MEMORY_STATUSES);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

/** The statuses a recall reads. A candidate is proposed, not remembered. */
export const LIVE_MEMORY_STATUSES = ["active", "confirmed"] as const;

export const MEMORY_WRITE_MODES = [
  "AUTOMATIC_SYSTEM",
  "USER_CONFIRMED",
  "Q_PROPOSED",
  "ADMIN_VERIFIED",
  "DERIVED",
] as const;
export const MemoryWriteModeSchema = z.enum(MEMORY_WRITE_MODES);
export type MemoryWriteMode = z.infer<typeof MemoryWriteModeSchema>;

export const MEMORY_SUBJECT_TYPES = [
  "PERSON",
  "COMPANY",
  "INVESTOR_ORGANISATION",
] as const;
export const MemorySubjectRefSchema = z
  .object({
    subjectType: z.enum(MEMORY_SUBJECT_TYPES),
    subjectId: z.string().uuid(),
  })
  .strict();
export type MemorySubjectRef = z.infer<typeof MemorySubjectRefSchema>;

export const MemoryKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_-]*){0,3}$/)
  .max(96);

export const MEMORY_CONTENT_MAX = 1_000;
export const MEMORY_QUOTE_MAX = 400;

/** What may be PROPOSED. Everything else is the service's to derive. */
export const MemoryCandidateSchema = z
  .object({
    memoryType: MemoryTypeSchema,
    memoryKey: MemoryKeySchema,
    content: z.string().trim().min(1).max(MEMORY_CONTENT_MAX),
    /** The person's own words, verbatim. Required unless the write is a deterministic platform fact. */
    quote: z.string().trim().min(3).max(MEMORY_QUOTE_MAX).nullable(),
    subject: MemorySubjectRefSchema.nullable().default(null),
    structuredValue: z
      .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.unknown())
      .refine(
        (value) => JSON.stringify(value).length <= 8_192,
        "at most 8192 bytes",
      )
      .default({}),
  })
  .strict();
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export type MemoryOwner = {
  readonly ownerContextType: MemoryOwnerContextType;
  readonly ownerContextId: string;
};

export const MemoryItemSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: TenantIdSchema,
    ownerContextType: MemoryOwnerContextTypeSchema,
    ownerContextId: z.string().uuid(),
    subject: MemorySubjectRefSchema.nullable(),
    memoryType: MemoryTypeSchema,
    memoryKey: MemoryKeySchema,
    content: z.string(),
    structuredValue: z.record(z.string(), z.unknown()),
    quote: z.string().nullable(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    sourceConversationId: z.string().uuid().nullable(),
    sourceRunId: z.string().uuid().nullable(),
    writeMode: MemoryWriteModeSchema,
    status: MemoryStatusSchema,
    supersededBy: z.string().uuid().nullable(),
    validFrom: UtcTimestampSchema,
    validTo: UtcTimestampSchema.nullable(),
    lastUsedAt: UtcTimestampSchema.nullable(),
    useCount: z.number().int().min(0),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const MEMORY_WRITE_REASONS = [
  "RECORDED",
  "SUPERSEDED_EARLIER",
  "ALREADY_REMEMBERED",
  "QUOTE_NOT_IN_TURNS",
  "QUOTE_REQUIRED",
  "INVALID_CANDIDATE",
  "SENSITIVE_CONTENT",
  "NOT_ALLOWED",
] as const;
export type MemoryWriteReason = (typeof MEMORY_WRITE_REASONS)[number];

export type MemoryWriteResult =
  | {
      readonly outcome: "REMEMBERED";
      readonly reason: "RECORDED" | "SUPERSEDED_EARLIER";
      readonly item: MemoryItem;
    }
  | {
      readonly outcome: "UNCHANGED";
      readonly reason: "ALREADY_REMEMBERED";
      readonly item: MemoryItem;
    }
  | {
      readonly outcome: "REFUSED";
      readonly reason: Exclude<
        MemoryWriteReason,
        "RECORDED" | "SUPERSEDED_EARLIER" | "ALREADY_REMEMBERED"
      >;
    };

/**
 * What a recall returns (doc 14 §131): typed sections, never one string.
 * Rendering into prompt text is a separate, bounded step.
 */
export type MemoryBundle = {
  readonly person: readonly MemoryItem[];
  readonly company: readonly MemoryItem[];
  /** This conversation's own summary, when the run belongs to one. */
  readonly thisConversation: {
    readonly title: string | null;
    readonly summary: string;
  } | null;
  /** Other recent conversations of the same person: title and summary only. */
  readonly otherConversations: readonly {
    readonly conversationId: string;
    readonly title: string | null;
    readonly summary: string;
    readonly lastMessageAt: string;
  }[];
};
