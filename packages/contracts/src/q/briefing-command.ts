import { z } from "zod";

/**
 * The arrival briefing's free-form words (Zino, 2026-10-08: "I can use
 * any words I like to tell it what I want done, and it does it").
 *
 * `POST`: the person's own words (their typing, or the voice provider's
 * transcript of their turn -- never the voice model's paraphrase) and the
 * cards on their screen, read by a model into typed card verbs. Nothing is
 * done here: the browser runs each verb through the card sequence's own
 * code, which checks it against the words, binds approvals to the exact
 * payload shown and asks "Send this exact message?" before any changed
 * text can go.
 */
export const Q_BRIEFING_COMMAND_PATH = "/v1/q/briefing/command" as const;

export const BRIEFING_COMMAND_VERBS = [
  "SEND",
  "DISMISS",
  "LATER",
  "RETRY",
  "REWRITE",
  "SHOW",
] as const;

const Ref = z.string().regex(/^c[1-8]$/u);

export const BriefingCommandCardSchema = z
  .object({
    ref: Ref,
    kind: z.enum(["APPROVAL", "HELD"]),
    to: z.string().trim().max(200).nullable(),
    theyWrote: z.string().max(600).nullable(),
    message: z.string().max(4_000).nullable(),
    summary: z.string().max(400),
  })
  .strict();

export const BriefingCommandRequestSchema = z
  .object({
    words: z.string().trim().min(1).max(700),
    /** Their zone, for "Thursday" (IANA); null: UTC. */
    timeZone: z.string().max(64).nullable(),
    cards: z.array(BriefingCommandCardSchema).min(1).max(8),
  })
  .strict();
export type BriefingCommandRequest = z.infer<
  typeof BriefingCommandRequestSchema
>;

export const BriefingCommandResultDtoSchema = z
  .object({
    actions: z
      .array(
        z
          .object({
            ref: Ref,
            verb: z.enum(BRIEFING_COMMAND_VERBS),
            rewrite: z.string().max(3_800).nullable(),
          })
          .strict(),
      )
      .max(8),
    unclear: z.boolean(),
  })
  .strict();
export type BriefingCommandResultDto = z.infer<
  typeof BriefingCommandResultDtoSchema
>;
