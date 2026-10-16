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
 * The language this person wants Q to use (owner directive 2026-10-16:
 * "a language setting, any language, switch between any two"). AUTO
 * follows the device and the language they speak; otherwise a canonical
 * BCP 47 tag ("fr", "pt-BR", "sw", "ar-AE"). There is no list of
 * languages here and no per-language code anywhere: which tags Capital Q
 * offers is decided by `@capital-q/q-core`'s language registry from the
 * runtime's own Intl data, and each voice/video channel's support by its
 * provider capability table. The stored column accepts the same shape
 * (supabase/migrations/20261228101500_q_runtime_person_language.sql).
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

/** The canonical form of a BCP 47 tag ("PT-br" -> "pt-BR"), or null when malformed. */
export function canonicalLanguageTag(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 35) return null;
  try {
    const canonical = Intl.getCanonicalLocales(trimmed)[0];
    return canonical !== undefined &&
      canonical.length <= 35 &&
      LANGUAGE_TAG.test(canonical)
      ? canonical
      : null;
  } catch {
    return null;
  }
}

/**
 * Scripts written right to left (Unicode bidi class R/AL). Used only where
 * a runtime has no Intl.Locale text info.
 */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  "Adlm",
  "Arab",
  "Aran",
  "Hebr",
  "Mand",
  "Mend",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

type TextInfoLocale = Intl.Locale & {
  readonly getTextInfo?: () => { readonly direction?: string };
  readonly textInfo?: { readonly direction?: string };
};

/**
 * Writing direction of a tag, from the runtime's own data: Intl.Locale's
 * text info where the runtime has it, else the script the locale is
 * likely written in. Left to right for anything unknown. No language is
 * named here: Arabic, Urdu, Hebrew, Dhivehi and every other right-to-left
 * language come out of the same lookup.
 */
export function languageDirectionOf(
  value: string | null | undefined,
): "ltr" | "rtl" {
  if (value === null || value === undefined) return "ltr";
  const tag = canonicalLanguageTag(value);
  if (tag === null) return "ltr";
  try {
    const locale = new Intl.Locale(tag) as TextInfoLocale;
    const info =
      typeof locale.getTextInfo === "function"
        ? locale.getTextInfo()
        : locale.textInfo;
    if (info?.direction === "rtl" || info?.direction === "ltr")
      return info.direction;
    const script = locale.script ?? locale.maximize().script;
    return script !== undefined && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}

/** A canonical, well-formed BCP 47 tag. Whether Capital Q offers it is the registry's call. */
export const QLanguageCodeSchema = z
  .string()
  .min(2)
  .max(35)
  .refine((value) => canonicalLanguageTag(value) === value, {
    message: "a canonical BCP 47 language tag",
  });
export type QLanguageCode = z.infer<typeof QLanguageCodeSchema>;

export const QLanguagePreferenceSchema = z.union([
  z.literal("AUTO"),
  QLanguageCodeSchema,
]);
export type QLanguagePreference = z.infer<typeof QLanguagePreferenceSchema>;

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
