import "server-only";

import { resolveQStanding } from "@/features/q/context";

import { machineUiText } from "./machine";
import { translate, uiLanguageOf, type UiLanguage } from "./messages";
import { rememberServerLanguage } from "./server-now";

/** The person's interface language, from their saved choice (cached per request). */
export async function serverUiLanguage(): Promise<UiLanguage> {
  // English whenever the choice cannot be read: a page never fails over it.
  let language: UiLanguage;
  try {
    const standing = await resolveQStanding();
    language = uiLanguageOf(standing?.language);
  } catch {
    language = "en";
  }
  // Q's machine translations, registered for this render (none for English).
  await machineUiText(language);
  // Synchronous server components below read it (serverTNow).
  rememberServerLanguage(language);
  return language;
}

/** A translator for a server component. */
export async function serverT(): Promise<(english: string) => string> {
  const language = await serverUiLanguage();
  return (english) => translate(language, english);
}
