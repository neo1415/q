import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { LocalDateSchema, UtcTimestampSchema } from "../common/time.js";

/**
 * The work board (owner 2026-10-23, QA F-14/F-26): the person's own items --
 * a document, a company, a task, a note, a piece of Q's work -- each TODO,
 * DOING or DONE, in the order they choose. Q reads and changes it for them
 * through the same service the page calls.
 *
 *   a board item ≠ evidence, a claim, a disclosure, a relationship state or
 *   an approval
 *
 * personal_private: only the person themselves reads their board. Pointing
 * at a company or a document grants nothing about it; opening it is still
 * authorised by its own owner. Every change is the item's next revision and
 * kept in its history; removing an item archives it.
 */

/** Reference values (CLAUDE.md: never a Postgres or TypeScript enum). */
export const BOARD_ITEM_KINDS = [
  "DOCUMENT",
  "COMPANY",
  "TASK",
  "NOTE",
  "WORK_JOB",
] as const;
export const BoardItemKindSchema = z.enum(BOARD_ITEM_KINDS);
export type BoardItemKind = z.infer<typeof BoardItemKindSchema>;

/** The board's columns, in the order they are shown. */
export const BOARD_COLUMNS = ["TODO", "DOING", "DONE"] as const;
export const BoardItemStatusSchema = z.enum(BOARD_COLUMNS);
export type BoardItemStatus = z.infer<typeof BoardItemStatusSchema>;

/** The kinds that are a pointer and so must name what they point at. */
export const BOARD_POINTER_KINDS: readonly BoardItemKind[] = [
  "DOCUMENT",
  "COMPANY",
  "WORK_JOB",
];

export const BOARD_TITLE_MAX_LENGTH = 300;
export const BOARD_NOTES_MAX_LENGTH = 8000;
/** One board holds at most this many current items. */
export const BOARD_ITEM_LIMIT = 500;

export const BoardItemTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(BOARD_TITLE_MAX_LENGTH);
export const BoardItemNotesSchema = z
  .string()
  .trim()
  .max(BOARD_NOTES_MAX_LENGTH);
/** A document, company or job id, as the owning context writes it. */
export const BoardItemRefSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u);

export const BoardItemSchema = z
  .object({
    id: UuidSchema,
    kind: BoardItemKindSchema,
    refId: BoardItemRefSchema.nullable(),
    title: z.string().min(1).max(BOARD_TITLE_MAX_LENGTH),
    notes: z.string().max(BOARD_NOTES_MAX_LENGTH).nullable(),
    status: BoardItemStatusSchema,
    /** Its order within the column, as a decimal string (never a float). */
    position: z.string().regex(/^-?\d+(\.\d+)?$/u),
    dueOn: LocalDateSchema.nullable(),
    /** Q's job working on this item, when Q was asked to. */
    workJobId: UuidSchema.nullable(),
    /** PERSON: they added it. Q: Q added it for them, as asked. */
    createdBy: z.enum(["PERSON", "Q"]),
    revision: z.number().int().min(1),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type BoardItem = z.infer<typeof BoardItemSchema>;

export const BoardListSchema = z
  .object({
    /** Current items, by column then position. */
    items: z.array(BoardItemSchema).max(BOARD_ITEM_LIMIT),
    columns: z.array(BoardItemStatusSchema),
    visibility: z.enum(["personal_private"]),
  })
  .strict();
export type BoardList = z.infer<typeof BoardListSchema>;

export const AddBoardItemRequestSchema = z
  .object({
    kind: BoardItemKindSchema,
    refId: BoardItemRefSchema.optional(),
    title: BoardItemTitleSchema,
    notes: BoardItemNotesSchema.optional(),
    dueOn: LocalDateSchema.optional(),
    /** Where it starts; TODO when not said. It goes to the column's end. */
    status: BoardItemStatusSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !BOARD_POINTER_KINDS.includes(value.kind) || value.refId !== undefined,
    { message: "This kind of item names what it points at.", path: ["refId"] },
  );
export type AddBoardItemRequest = z.infer<typeof AddBoardItemRequestSchema>;

export const UpdateBoardItemRequestSchema = z
  .object({
    /** The revision this change is made to; a stale one is a conflict. */
    revision: z.number().int().min(1),
    title: BoardItemTitleSchema.optional(),
    notes: BoardItemNotesSchema.nullable().optional(),
    dueOn: LocalDateSchema.nullable().optional(),
    /** Remove it from the board (archived; its history stays). */
    archived: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.notes !== undefined ||
      value.dueOn !== undefined ||
      value.archived !== undefined,
    { message: "Say what changes." },
  );
export type UpdateBoardItemRequest = z.infer<
  typeof UpdateBoardItemRequestSchema
>;

export const MoveBoardItemRequestSchema = z
  .object({
    /** When given, a stale revision is a conflict rather than a move. */
    revision: z.number().int().min(1).optional(),
    status: BoardItemStatusSchema,
    /** Its place in that column after the move, from 0; past the end is the end. */
    index: z.number().int().min(0).max(BOARD_ITEM_LIMIT),
  })
  .strict();
export type MoveBoardItemRequest = z.infer<typeof MoveBoardItemRequestSchema>;

export const BOARD_PATH = "/v1/board" as const;
export const BOARD_ITEMS_PATH = "/v1/board/items" as const;
export const BOARD_ITEM_PATH = "/v1/board/items/:itemId" as const;
export const BOARD_ITEM_MOVE_PATH = "/v1/board/items/:itemId/move" as const;
