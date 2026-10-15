import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Private notes on a relationship record (CRM S3, research 2026-10-15 §2:
 * "no free-form private note on a record").
 *
 *   a note ≠ evidence, a claim, Q memory, an audit entry or a message
 *
 * A note is its author's side's own: an investor's notes stay with the
 * investor organisation, a founder's with the company. The other party
 * never reads them, and no ranking, fit or Q context reads them (CLAUDE.md
 * Context Firewall). Append-only: a correction is a new note naming the
 * one it replaces, and the replaced note stays in history.
 */

export const RELATIONSHIP_NOTE_MAX_LENGTH = 4000;
/** One read returns at most this many current notes, newest first. */
export const RELATIONSHIP_NOTE_LIMIT = 50;

export const RelationshipNoteBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(RELATIONSHIP_NOTE_MAX_LENGTH);

export const RelationshipNoteSchema = z
  .object({
    id: UuidSchema,
    body: z.string().min(1).max(RELATIONSHIP_NOTE_MAX_LENGTH),
    /** The author's display name when known; null otherwise, never guessed. */
    authorName: z.string().max(200).nullable(),
    authoredByMe: z.boolean(),
    createdAt: UtcTimestampSchema,
    /** The note this one corrects; that note is history, not current. */
    supersedesNoteId: UuidSchema.nullable(),
  })
  .strict();
export type RelationshipNote = z.infer<typeof RelationshipNoteSchema>;

export const RelationshipNoteListSchema = z
  .object({
    items: z.array(RelationshipNoteSchema).max(RELATIONSHIP_NOTE_LIMIT),
    /** Who can read these: the author's own organisation, never the counterpart. */
    visibility: z.enum(["organisation_private"]),
  })
  .strict();
export type RelationshipNoteList = z.infer<typeof RelationshipNoteListSchema>;

export const CreateRelationshipNoteRequestSchema = z
  .object({
    body: RelationshipNoteBodySchema,
    supersedesNoteId: UuidSchema.optional(),
  })
  .strict();
export type CreateRelationshipNoteRequest = z.infer<
  typeof CreateRelationshipNoteRequestSchema
>;

/** An investor's notes on one of its relationships. */
export const NETWORK_RELATIONSHIP_NOTES_PATH =
  "/v1/network/relationships/:relationshipId/notes" as const;
export const NETWORK_RELATIONSHIP_NOTE_PATH =
  "/v1/network/relationships/:relationshipId/notes/:noteId" as const;
/** A founder's notes, under their company (the id is checked, never proof). */
export const NETWORK_COMPANY_RELATIONSHIP_NOTES_PATH =
  "/v1/network/companies/:companyId/relationships/:relationshipId/notes" as const;
export const NETWORK_COMPANY_RELATIONSHIP_NOTE_PATH =
  "/v1/network/companies/:companyId/relationships/:relationshipId/notes/:noteId" as const;
