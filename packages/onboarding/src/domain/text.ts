/**
 * The runtime's one reading of plain words (CQ-Q-VOICE-001 A): lower-case,
 * sentence punctuation gone, a decimal point inside a figure kept. Every
 * matcher in the interview — option labels, aliases, taxonomy phrases,
 * negation — reads through these helpers so they agree on what a word is.
 */

export function normalise(text: string): string {
  return (
    text
      .toLowerCase()
      // Sentence punctuation goes; a decimal point inside a figure stays.
      .replace(/[.,!?;:]+(?=\s|$)/g, "")
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9'+&/ .$£€-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function wordsOf(text: string): readonly string[] {
  return normalise(text)
    .split(" ")
    .filter((w) => w.length > 0);
}

/** True when `phrase` occurs in `text` as whole words. */
export function mentions(text: string, phrase: string): boolean {
  const needle = normalise(phrase);
  if (needle.length === 0) {
    return false;
  }
  const hay = ` ${normalise(text)} `;
  return hay.includes(` ${needle} `);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
