import { isConnective, tokenise } from "./egress.js";

/** Titles that are not part of whom a page must name. */
const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "professor",
  "sir",
  "dame",
  "chief",
  "captain",
  "capt",
  "engr",
  "alhaji",
  "hon",
]);

/**
 * The words a page must carry to be about a named company or person: the
 * name's words without titles ("Captain") or joining words ("of").
 */
export function nameWords(name: string): readonly string[] {
  return wordsOf(name).filter(
    (word) => !HONORIFICS.has(word) && !isConnective(word),
  );
}

/**
 * Words with hyphens split too (live 2026-10-23: "Zino Mario-Ghae, Chief
 * Executive Officer" did not name "Zino Mario" while "mario-ghae" stayed
 * one word).
 */
function wordsOf(text: string): readonly string[] {
  return tokenise(text).flatMap((token) =>
    token.split("-").filter((part) => part.length > 0),
  );
}

/**
 * Whether some text names them: every name word in it, or the name run
 * together in a domain ("zinoaviation.com").
 */
export function textNamesEntity(
  name: string,
  text: string,
  domain: string | null = null,
): boolean {
  const words = nameWords(name);
  if (words.length === 0) return true;
  const seen = new Set(wordsOf(text));
  if (words.every((word) => seen.has(word))) return true;
  const joined = words.join("");
  const bare = domain?.toLowerCase().replace(/[^a-z0-9]/gu, "") ?? "";
  return joined.length >= 4 && bare.includes(joined);
}
