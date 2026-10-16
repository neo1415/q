import { z } from "zod";

/**
 * Q's patience after a turn (founder direction 2026-09-30). Code decides
 * it from Q's reading of the turn; the screen follows it: ROUTE_AWAY sends
 * the person to look around until they are ready, SUSPEND shows the
 * account paused, and the mood colours Q (CALM, IMPATIENT orange, STERN
 * red).
 */
export const Q_CONDUCT_ACTIONS = [
  "NONE",
  "STEER_BACK",
  "STEER_BACK_FIRMLY",
  "ROUTE_AWAY",
  "SUSPEND",
] as const;
export const Q_CONDUCT_MOODS = ["CALM", "IMPATIENT", "STERN"] as const;

export const QConductSchema = z
  .object({
    action: z.enum(Q_CONDUCT_ACTIONS),
    mood: z.enum(Q_CONDUCT_MOODS),
  })
  .strict();
export type QConduct = z.infer<typeof QConductSchema>;
export type QConductMood = QConduct["mood"];

/** Who Q is with this person; AUTO reads the person turn by turn. */
export const Q_PERSONALITIES = [
  "AUTO",
  "WARM",
  "WITTY",
  "SHARP",
  "CALM",
] as const;
export const QPersonalitySchema = z.enum(Q_PERSONALITIES);
export type QPersonality = z.infer<typeof QPersonalitySchema>;

/**
 * The language this person wants Q to use (owner directive 2026-10-16,
 * Arabic first). AUTO follows the device and the language they speak; a
 * code pins text, voice, rehearsals and onboarding to it. Codes are BCP 47
 * primary subtags; the stored column accepts any well-formed tag, so a new
 * language is a change here, not a migration. See
 * docs/ai-handoff/MULTILINGUAL-2026-10-16.md for what each provider supports.
 */
export const Q_LANGUAGE_PREFERENCES = ["AUTO", "en", "ar"] as const;
export const QLanguagePreferenceSchema = z.enum(Q_LANGUAGE_PREFERENCES);
export type QLanguagePreference = z.infer<typeof QLanguagePreferenceSchema>;
export type QLanguageCode = Exclude<QLanguagePreference, "AUTO">;

/** Writing direction per supported language, for `dir` on the document. */
export const Q_LANGUAGE_DIRECTION: Readonly<
  Record<QLanguageCode, "ltr" | "rtl">
> = { en: "ltr", ar: "rtl" };

/** `GET /v1/q/standing`: the person's own Q settings and standing. */
export const Q_STANDING_PATH = "/v1/q/standing" as const;
/** `PUT /v1/q/standing/personality`: choose who Q is with them. */
export const Q_STANDING_PERSONALITY_PATH =
  "/v1/q/standing/personality" as const;
/** `PUT /v1/q/standing/language`: choose the language Q uses with them. */
export const Q_STANDING_LANGUAGE_PATH = "/v1/q/standing/language" as const;

export const QStandingDtoSchema = z
  .object({
    personality: QPersonalitySchema,
    /** Their language for Q; AUTO when never chosen. */
    language: QLanguagePreferenceSchema.default("AUTO"),
    /** True once Q paused the account; a person at Capital Q reinstates it. */
    paused: z.boolean(),
  })
  .strict();
export type QStandingDto = z.infer<typeof QStandingDtoSchema>;

export const SetQPersonalityRequestSchema = z
  .object({ personality: QPersonalitySchema })
  .strict();

export const SetQLanguageRequestSchema = z
  .object({ language: QLanguagePreferenceSchema })
  .strict();
