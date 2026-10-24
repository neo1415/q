import "server-only";

import { headers } from "next/headers";

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
    language = uiLanguageOf(standing?.language, await deviceLanguages());
  } catch {
    language = "en";
  }
  // Q's machine translations, registered for this render (none for English).
  await machineUiText(language);
  // Synchronous server components below read it (serverTNow).
  rememberServerLanguage(language);
  return language;
}

/**
 * The browser's languages, for Automatic (QO-45). Read from the request;
 * none (a prerender, a missing header) is English.
 */
export async function deviceLanguages(): Promise<string | null> {
  try {
    return (await headers()).get("accept-language");
  } catch {
    return null;
  }
}

/** A translator for a server component. */
export async function serverT(): Promise<(english: string) => string> {
  const language = await serverUiLanguage();
  return (english) => translate(language, english);
}
