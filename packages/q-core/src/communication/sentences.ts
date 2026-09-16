/**
 * Cutting a stream of text into whole sentences as it arrives.
 *
 * A sentence is the unit an answer can safely leave in. Below it, the
 * deterministic guards cannot do their work: the one that removes an
 * invented recommendation removes a whole sentence, and half a sentence
 * cannot be judged. Above it, a person waits for no reason.
 *
 * So text is buffered until a sentence closes, the guards run on that
 * sentence, and only then does it go out. A person hears the first
 * sentence about a second in, and every sentence they hear has been
 * through the same checks as one they would have read.
 *
 * Nothing is emitted twice and nothing is lost: whatever is still in the
 * buffer when the text ends comes out on `rest`.
 */

/**
 * The end of a sentence, as opposed to a decimal point, an abbreviation or
 * an initial: a terminator, then space, then something that starts a
 * sentence. Deliberately conservative — a cut too late costs a moment, a
 * cut too early cuts "$1.5m" in half.
 */
const BOUNDARY = /(?<=[.!?…])["')\]]?\s+(?=[A-Z0-9"'(“])/g;

/** A paragraph break ends a sentence even without punctuation. */
const PARAGRAPH = /\n{2,}/g;

export type SentenceCutter = {
  /** Add text; returns whatever whole sentences that completed. */
  readonly push: (text: string) => readonly string[];
  /** Whatever is left, once there is no more text. Empties the buffer. */
  readonly rest: () => string | null;
};

export function createSentenceCutter(): SentenceCutter {
  let buffer = "";
  return {
    push: (text) => {
      buffer += text;
      const out: string[] = [];
      for (;;) {
        const cut = firstBoundary(buffer);
        if (cut < 0) {
          break;
        }
        const sentence = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut);
        if (sentence.length > 0) {
          out.push(sentence);
        }
      }
      return out;
    },
    rest: () => {
      const left = buffer.trim();
      buffer = "";
      return left.length > 0 ? left : null;
    },
  };
}

/**
 * Things that end in a full stop and are not the end of a sentence. An
 * initial is the general case (one letter, a stop, a capitalised surname);
 * the rest are the abbreviations that actually turn up in this writing.
 */
const INITIAL = /(?:^|[\s(“"'])[A-Z]\.$/;
const ABBREVIATIONS =
  /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|inc|ltd|llc|plc|co|corp|vs|no|approx|est|fig|al|e\.g|i\.e)\.$/i;

function endsMidSentence(before: string): boolean {
  return INITIAL.test(before) || ABBREVIATIONS.test(before);
}

function firstBoundary(text: string): number {
  let best = -1;
  BOUNDARY.lastIndex = 0;
  for (
    let found = BOUNDARY.exec(text);
    found !== null;
    found = BOUNDARY.exec(text)
  ) {
    // Everything up to and including the terminator — the match itself
    // begins after it — which is what says whether this stop ended a
    // sentence or an abbreviation.
    if (endsMidSentence(text.slice(0, found.index))) {
      continue;
    }
    best = found.index + found[0].length;
    break;
  }
  PARAGRAPH.lastIndex = 0;
  const paragraph = PARAGRAPH.exec(text);
  if (paragraph !== null) {
    const at = paragraph.index + paragraph[0].length;
    if (best < 0 || at < best) {
      best = at;
    }
  }
  return best;
}
