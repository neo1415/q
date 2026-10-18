import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * BRIEFING_COMMAND -- the person's own words about the decision cards on
 * their screen, read into typed card verbs (Zino, 2026-10-08: "I can use
 * any words I like to tell it what I want done, and it does it").
 *
 * The words are the person's own transcript or typing, never the voice
 * model's paraphrase. The model only maps them: which card, which verb,
 * and for a change, the whole new message. Code then checks every verb
 * against the words (a send needs a plain wish to send, with no "don't"),
 * and any changed message is shown in full for "Send this exact
 * message?" before it can go.
 */

export const BRIEFING_COMMAND_SCHEMA_NAME = "BriefingCommandResult";
export const BRIEFING_COMMAND_SCHEMA_VERSION = 1;

export const BriefingCommandVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The person Q works for. Trusted. */
    principalName: z.string().max(120),
    /** Today, in their zone, with the weekday ("Thursday 8 October 2026"). Trusted. */
    today: z.string().max(80),
    /** What the person said or typed. UNTRUSTED. */
    words: z.string().trim().min(1).max(700),
    /** The cards on screen, as JSON (ref, kind, to, theyWrote, message). UNTRUSTED. */
    cards: z.string().trim().min(2).max(12_000),
  })
  .strict();
export type BriefingCommandVariables = z.infer<
  typeof BriefingCommandVariablesSchema
>;

export const BRIEFING_COMMAND_UNTRUSTED = ["words", "cards"] as const;

export const BRIEFING_VERBS = [
  /** Send (or approve) the card's message exactly as shown. */
  "SEND",
  /** Drop it; nothing is sent. */
  "DISMISS",
  /** Leave it for later. */
  "LATER",
  /** Ask Q to write and review a held message again. */
  "RETRY",
  /** Change the message as they asked; `rewrite` is the whole new text. */
  "REWRITE",
  /** Just look at it: bring it forward. */
  "SHOW",
] as const;
export type BriefingVerb = (typeof BRIEFING_VERBS)[number];

export const BriefingCommandResultSchema = z
  .object({
    actions: z
      .array(
        z
          .object({
            ref: z.string().trim().min(1).max(8),
            verb: z.enum(BRIEFING_VERBS),
            /** REWRITE only: the whole new message, as it would be sent. */
            rewrite: z.string().trim().min(1).max(3_800).nullable(),
          })
          .strict(),
      )
      .max(8),
    /** Their words are about something else, or too unclear to act on. */
    unclear: z.boolean(),
  })
  .strict();
export type BriefingCommandResult = z.infer<typeof BriefingCommandResultSchema>;
