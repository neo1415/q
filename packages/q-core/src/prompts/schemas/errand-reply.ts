import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * ERRAND_REPLY — Q answering the other side of a relationship on the
 * person's behalf, inside an errand they approved (founder direction
 * 2026-09-29).
 *
 * The only facts Q may state are the brief the person approved word for
 * word when they started the errand: the Context Firewall for this reply
 * is the approval itself, so nothing else the person's Q knows (their
 * private numbers, other relationships, memory) can reach the other side.
 * Anything the brief does not answer goes back to the person.
 */

export const ERRAND_REPLY_SCHEMA_NAME = "ErrandReplyResult";
export const ERRAND_REPLY_SCHEMA_VERSION = 1;

export const ErrandReplyVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The person Q speaks for. Trusted (their own profile). */
    principalName: z.string().max(120),
    /** Who Q is replying to. UNTRUSTED (the other side's own name). */
    counterpartName: z.string().max(200),
    /** What the person approved Q may say. Trusted: approved word for word. */
    brief: z.string().max(2_000),
    /** Whether Q will book a call next, so it can say so. Trusted. */
    callComing: z.boolean(),
    /** The thread, oldest first, "Name: words" per line. UNTRUSTED. */
    thread: z.string().max(12_000),
  })
  .strict();
export type ErrandReplyVariables = z.infer<typeof ErrandReplyVariablesSchema>;

export const ERRAND_REPLY_UNTRUSTED = ["counterpartName", "thread"] as const;

export const ErrandReplyResultSchema = z
  .object({
    /** The message to post, or null when nothing needs saying. */
    reply: z.string().trim().min(1).max(1_200).nullable(),
    /** Questions the brief does not answer, for the person, in plain words. */
    forPerson: z.array(z.string().trim().min(3).max(300)).max(5),
  })
  .strict();
export type ErrandReplyResult = z.infer<typeof ErrandReplyResultSchema>;
