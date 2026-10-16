import "server-only";

import { resolveQStanding } from "@/features/q/context";

import { translate, uiLanguageOf, type UiLanguage } from "./messages";

/** The person's interface language, from their saved choice (cached per request). */
export async function serverUiLanguage(): Promise<UiLanguage> {
  // English whenever the choice cannot be read: a page never fails over it.
  try {
    const standing = await resolveQStanding();
    return uiLanguageOf(standing?.language);
  } catch {
    return "en";
  }
}

/** A translator for a server component. */
export async function serverT(): Promise<(english: string) => string> {
  const language = await serverUiLanguage();
  return (english) => translate(language, english);
}
