/**
 * Whether words could be a record's name, read by code alone. Apart from
 * named-record-request.ts (server-side name scoring) so the web's code-only
 * tab reader can use it without a server package.
 */

/** Words no company or investor name is made of. */
const NOT_NAME_WORD = new Set([
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "us",
  "it",
  "its",
  "that",
  "this",
  "these",
  "those",
  "then",
  "there",
  "here",
  "where",
  "what",
  "which",
  "who",
  "when",
  "how",
  "why",
  "can",
  "could",
  "would",
  "should",
  "will",
  "review",
  "see",
  "look",
  "yes",
  "no",
  "yeah",
  "okay",
  "ok",
  "please",
  "for",
  "tab",
  "about",
  "is",
  "are",
  "was",
  "be",
  "do",
  "did",
  "if",
  "so",
  "but",
  "just",
  "maybe",
  "guess",
  "think",
  "want",
  "need",
  "them",
  "they",
  "him",
  "her",
]);

/**
 * Whether words could be a record's name: a few words, none of them the
 * words a sentence is made of, none repeated. Live 2026-10-09 Q answered
 * `I can't find "where I can review it then"`: a phrase that is not a
 * name is left to Q silently, never quoted back as one.
 */
export function plausibleName(name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/u, "")
    .split(/[^\p{L}\p{N}&'-]+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0 || words.length > 4) return false;
  if (new Set(words).size !== words.length) return false;
  return words.every((word) => !NOT_NAME_WORD.has(word.replace(/'s$/u, "")));
}
