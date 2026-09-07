import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import { QMessageIdSchema, QRunIdSchema } from "./ids.js";
import { Q_MESSAGE_TEXT_MAX_LENGTH } from "./request.js";
import { QResultBlocksSchema } from "./result-block.js";

/**
 * One turn in a Q run's history, in Capital Q's own vocabulary
 * (doc 12 §22.1; doc 22 §76).
 *
 * Two roles: the person, and Q. No `assistant`, `developer`, `system` or
 * `tool` -- those are one provider's wire format, and mirroring them would
 * make a provider's message model the product's. Tool activity has its own
 * typed record; prompts are never messages; and there is no role a client
 * could use to author text that the runtime would treat as instruction.
 *
 * A message carries what was said and what was returned. It has no
 * metadata bag, no provider payload, no prompt and no reasoning, and it
 * cannot acquire them without a new named, typed field.
 */
export const Q_MESSAGE_ROLES = ["USER", "Q"] as const;

export type QMessageRole = (typeof Q_MESSAGE_ROLES)[number];

export const QMessageRoleSchema = z.enum(Q_MESSAGE_ROLES);

/**
 * Q's turn may be longer than a person's: a full analysis is bounded, but
 * not by the size of a question. A V1 technical bound.
 */
export const Q_RESPONSE_TEXT_MAX_LENGTH = 32_000;

export const QUserMessageSchema = z
  .object({
    messageId: QMessageIdSchema,
    runId: QRunIdSchema,
    role: z.literal("USER"),
    text: z.string().trim().min(1).max(Q_MESSAGE_TEXT_MAX_LENGTH),
    createdAt: UtcTimestampSchema,
  })
  .strict();

export type QUserMessage = z.infer<typeof QUserMessageSchema>;

/**
 * Q's response: plain text, structured blocks, or both. At least one, so an
 * empty response cannot be recorded as a message.
 */
export const QResponseMessageSchema = z
  .object({
    messageId: QMessageIdSchema,
    runId: QRunIdSchema,
    role: z.literal("Q"),
    text: z.string().min(1).max(Q_RESPONSE_TEXT_MAX_LENGTH).optional(),
    blocks: QResultBlocksSchema.optional(),
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (message) =>
      message.text !== undefined ||
      (message.blocks !== undefined && message.blocks.length > 0),
    {
      message: "a Q message carries text, blocks, or both",
      path: ["text"],
    },
  );

export type QResponseMessage = z.infer<typeof QResponseMessageSchema>;

export const QMessageSchema = z.discriminatedUnion("role", [
  QUserMessageSchema,
  QResponseMessageSchema,
]);

export type QMessage = z.infer<typeof QMessageSchema>;
