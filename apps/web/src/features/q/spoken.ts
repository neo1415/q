/**
 * Spoken lines beside the stored thread.
 *
 * A spoken line is shown only until the same words arrive as a stored
 * turn. Every voice turn becomes a stored turn, so without this each
 * thing the person said appeared twice: once from the transcript as
 * they said it, once from the conversation when it was recorded.
 *
 * Compared as words, not characters: the recogniser's transcript and
 * the recorded turn differ in punctuation, casing and spacing, and a
 * person's sentence shown twice for that was the most-noticed thing on
 * the screen (2026-09-17).
 */

export type SpokenLine = {
  readonly id: string;
  readonly role: "user" | "q";
  readonly text: string;
};

function asWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function spokenNotYetStored(
  spoken: readonly SpokenLine[],
  storedTexts: readonly string[],
): readonly SpokenLine[] {
  const stored = new Set(storedTexts.map(asWords));
  const seen = new Set<string>();
  return spoken.filter((line) => {
    const words = asWords(line.text);
    if (words.length === 0 || stored.has(words)) {
      return false;
    }
    // The same words twice from the transcript itself is one line.
    const key = `${line.role}:${words}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
