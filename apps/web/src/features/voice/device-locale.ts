/**
 * The browser's language, when it is a well-formed tag, for a voice
 * session request: the Q API picks the recogniser and the spoken language
 * from it (a non-English locale hears and speaks "multi"). Shared by Home
 * voice and the rehearsal room so neither defaults to English.
 */
export function deviceLocale(
  language: string | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.language,
): { readonly locale?: string } {
  if (language === undefined) return {};
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) &&
    language.length <= 35
    ? { locale: language }
    : {};
}
