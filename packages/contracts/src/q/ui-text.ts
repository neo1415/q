import { z } from "zod";

import { QLanguageCodeSchema } from "./conduct.js";

/**
 * `GET /v1/q/ui-text/{language}`: the interface's machine translations for
 * one language (any-language interface, 2026-10-16). What is cached so
 * far; until `complete`, the server is translating the rest in the
 * background and the screen shows English for what is missing. Capital Q's
 * own product copy, the same for everyone; hand catalogues (Arabic) win
 * over these in the web.
 */
/**
 * The translation method's version (instructions and checks). A change to
 * either is a new version, so rows from the old method are never served
 * as the new one. Shared by the translator (q-api) and every reader of
 * q_runtime.ui_translations (the email sender).
 */
// v2 (live 2026-10-16): a product glossary in the instructions; v1 read
// "Board" (Q's board of cards) as a board of directors in French and Spanish.
export const UI_TEXT_CATALOG_VERSION = "ui-text.v2" as const;

export const Q_UI_TEXT_PATH = "/v1/q/ui-text/:language" as const;

export function qUiTextPath(language: string): string {
  return `/v1/q/ui-text/${encodeURIComponent(language)}`;
}

export const QUiTextDtoSchema = z
  .object({
    language: QLanguageCodeSchema,
    /** The translation method's version the entries were made with. */
    version: z.string().min(1).max(32),
    /** English source string -> its translation. */
    entries: z.record(z.string().max(4_000), z.string().max(8_000)),
    /** Strings this language needs and how many are settled (translated or refused). */
    total: z.number().int().min(0),
    settled: z.number().int().min(0),
    complete: z.boolean(),
    /**
     * Why the rest is not being translated right now, when it is not:
     * the day's translation budget is spent, or no model route exists.
     */
    paused: z.enum(["DAILY_BUDGET", "UNAVAILABLE"]).nullable(),
  })
  .strict();
export type QUiTextDto = z.infer<typeof QUiTextDtoSchema>;
