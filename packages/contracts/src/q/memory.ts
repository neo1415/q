import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * What Q remembers about the person (ADR 0012), for them to read and
 * correct (founder live 2026-09-29: "if I tell it something I don't want
 * to have to remind it"; and a misheard name Q kept repeating).
 *
 *   `GET  /v1/q/memory` — the person's own live memory items.
 *   `POST /v1/q/memory/:memoryItemId/forget` — forget one. Idempotent: an
 *   item already forgotten, or not theirs, is the same 404.
 *
 * Only the actor's own memory: the owner is resolved from the session,
 * never from the request.
 */
export const Q_MEMORY_PATH = "/v1/q/memory" as const;
export const Q_MEMORY_FORGET_PATH =
  "/v1/q/memory/:memoryItemId/forget" as const;

export const Q_MEMORY_KINDS = [
  "fact",
  "preference",
  "correction",
  "pronunciation",
] as const;

export const QMemoryItemDtoSchema = z
  .object({
    memoryItemId: UuidSchema,
    /** fact, preference, correction, pronunciation; reference data, so any code. */
    kind: z.string().min(1).max(40),
    /** In Q's words, as it recalls it. */
    content: z.string().min(1).max(2_000),
    /** The person's own words it was learned from, when kept. */
    quote: z.string().max(2_000).nullable(),
    about: z.enum(["YOU", "COMPANY"]),
    learnedAt: UtcTimestampSchema,
  })
  .strict();
export type QMemoryItemDto = z.infer<typeof QMemoryItemDtoSchema>;

export const QMemoryListDtoSchema = z
  .object({ items: z.array(QMemoryItemDtoSchema).max(200) })
  .strict();
export type QMemoryListDto = z.infer<typeof QMemoryListDtoSchema>;
