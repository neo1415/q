import "server-only";

import { resolveQStanding } from "@/features/q/context";

import { translate, uiLanguageOf, type UiLanguage } from "./messages";
import { rememberServerLanguage } from "./server-now";

/** The person's interface language, from their saved choice (cached per request). */
export async function serverUiLanguage(): Promise<UiLanguage> {
  // A failure to read the standing (even a synchronous one) means English,
  // never a broken page.
  const standing = await Promise.resolve()
    .then(() => resolveQStanding())
    .catch(() => null);
  const language = uiLanguageOf(standing?.language);
  // Synchronous server components below read it (serverTNow).
  rememberServerLanguage(language);
  return language;
}

/** A translator for a server component. */
export async function serverT(): Promise<(english: string) => string> {
  const language = await serverUiLanguage();
  return (english) => translate(language, english);
}
