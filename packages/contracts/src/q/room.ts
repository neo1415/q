import { z } from "zod";

import { QConversationIdSchema, QRunIdSchema } from "./ids.js";
import { QResponseMessageSchema } from "./message.js";

/**
 * The person's Q room feed (voice-cards, founder 2026-10-08): every Q run
 * of theirs that finishes with an answer -- typed, spoken on the standard
 * line, or asked through the duplex line's ask_q -- is published here by
 * the Q API itself, keyed by run, in order. The Q page and every page's
 * dock read it while a voice line is open and render the answer's blocks
 * (cards above all) from it, so what reaches the screen never depends on
 * the voice model or a transcript carrying anything.
 *
 * Process-local on the Q API, like the voice turn board: `epoch` names
 * the process, and a reader whose epoch changed starts again from 0.
 * Nothing here is authority: entries are the person's own answers, read
 * under their own session; the message is the one already recorded.
 */
export const Q_ROOM_PATH = "/v1/q/room" as const;

/** Entries kept per person (the newest); a reader further behind skips. */
export const Q_ROOM_KEPT = 20;
/** How long a read is held open when nothing new has landed. */
export const Q_ROOM_HOLD_MS = 20_000;

export const QRoomSourceSchema = z.enum(["TYPED", "VOICE"]);
export type QRoomSource = z.infer<typeof QRoomSourceSchema>;

export const QRoomEntrySchema = z
  .object({
    /** Increments per published answer, per person, within one epoch. */
    sequence: z.number().int().min(1),
    runId: QRunIdSchema,
    conversationId: QConversationIdSchema.nullable(),
    source: QRoomSourceSchema,
    /** The recorded answer, exactly as the run's completion carried it. */
    message: QResponseMessageSchema,
  })
  .strict();
export type QRoomEntry = z.infer<typeof QRoomEntrySchema>;

export const QRoomReadQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
    epoch: z.string().trim().max(64).optional(),
    /** 0: answer at once (a first read); otherwise hold up to Q_ROOM_HOLD_MS. */
    wait: z.coerce.number().int().min(0).max(1).default(1),
  })
  .strict();
export type QRoomReadQuery = z.infer<typeof QRoomReadQuerySchema>;

export const QRoomReadSchema = z
  .object({
    epoch: z.string().min(1).max(64),
    /** The newest sequence this read covers; the next read is `after` it. */
    cursor: z.number().int().min(0),
    entries: z.array(QRoomEntrySchema).max(Q_ROOM_KEPT),
  })
  .strict();
export type QRoomRead = z.infer<typeof QRoomReadSchema>;
