import "server-only";

import { cache } from "react";

import { translate, type UiLanguage } from "./messages";

/**
 * The interface language for synchronous server components (multilingual
 * Q). A page awaits `serverT()` (or `serverUiLanguage()`) once, which
 * remembers the person's language for this request; every server
 * component it renders below can then translate without becoming async.
 * React's `cache` scopes the value to one request on the server and is a
 * pass-through outside one (component tests), where screens stay English.
 */
const requestLanguage = cache((): { current: UiLanguage | null } => ({
  current: null,
}));

export function rememberServerLanguage(language: UiLanguage): void {
  requestLanguage().current = language;
}

/** `t()` for a synchronous server component rendered below a page. */
export function serverTNow(): (english: string) => string {
  const language = requestLanguage().current ?? "en";
  return (english) => translate(language, english);
}
