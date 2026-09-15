/**
 * Text as Q speaks it (CQ-Q-VOICE-001 C §39, D §57, §66).
 *
 * The Speech Engine synthesises whatever it is sent. What it is sent is
 * conversational text only: markdown structure, citations in brackets,
 * URLs and source lists read badly aloud and carry nothing a listener
 * needs. Long material is never read out; a spoken answer is bounded and
 * the full text stays on screen.
 */

/** A spoken turn stops here; the rest is on screen (§66). */
export const SPOKEN_MAX_CHARS = 1_200;

/** Markdown and machine punctuation → plain sentences. */
export function speakable(text: string): string {
  return (
    text
      // Headings, list bullets, block quotes.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      // Emphasis and code.
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2")
      .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
      // Links: keep the words, drop the address.
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]*\)/g, "$1")
      .replace(/\bhttps?:\/\/\S+/g, "")
      // Bracketed citations and source markers.
      .replace(/\s*\((?:public web )?source\s+S\d{1,2}\)/gi, "")
      .replace(/\s*\[(?:S\d{1,2}|\d{1,2})\]/g, "")
      // Tables become nothing a voice can carry.
      .replace(/^\s*\|.*\|\s*$/gm, "")
      .replace(/[ \t]+/g, " ")
      // A removed address leaves no orphaned space before punctuation.
      .replace(/ +([.,;:!?])/g, "$1")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/** Bound a spoken answer to what a listener can take in (§66). */
export function bounded(text: string, max = SPOKEN_MAX_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const end = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("! "),
  );
  return `${(end > max / 2 ? cut.slice(0, end + 1) : cut).trim()} The rest is on your screen.`;
}

/**
 * Split text into sentence-sized chunks, so a stream can be spoken as it
 * arrives and an interruption loses at most one sentence.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?=[A-Z0-9"'(])/g;

export function sentences(text: string): readonly string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Re-chunk a stream of arbitrary text deltas into sentences, yielding each
 * as soon as it is complete and flushing the remainder at the end. Stops
 * when the signal aborts: a chunk that was not yielded is never spoken.
 */
export async function* bySentence(
  deltas: AsyncIterable<string>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let buffer = "";
  for await (const delta of deltas) {
    if (signal?.aborted === true) {
      return;
    }
    buffer += delta;
    // Everything up to the last completed sentence boundary is ready; the
    // remainder stays exactly as received so a word is never split.
    let cut = -1;
    for (const match of buffer.matchAll(SENTENCE_BOUNDARY)) {
      cut = match.index + match[0].length;
    }
    if (cut > 0) {
      for (const part of sentences(buffer.slice(0, cut))) {
        yield part;
      }
      buffer = buffer.slice(cut);
    }
  }
  if (signal?.aborted !== true && buffer.trim().length > 0) {
    yield buffer.trim();
  }
}
