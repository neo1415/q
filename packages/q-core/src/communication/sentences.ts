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

/**
 * Whole text, cut into its sentences by the same boundary the stream
 * uses. Each piece keeps its own surrounding whitespace, so joining them
 * back with "" gives the original text exactly: a caller that keeps a
 * prefix never re-spaces what it keeps. A decimal ("3.8%", "8.8/10"), a
 * version ("v2.1") or a URL ("capitalq.com/x") has no space after its
 * stop, so it is never a boundary (D9: "3. 8%" reached a revised memo
 * from a per-stop splitter that rejoined with a space).
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (;;) {
    const cut = firstBoundary(rest);
    if (cut <= 0 || cut >= rest.length) break;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/**
 * Text cut to `max` characters for a person to read, never mid-word: the
 * last whole sentence that fits (when that keeps at least half the room),
 * else the last whole word with an ellipsis. Live 2026-10-30: reviewer
 * notes reached the person as "risks soundin", "contracts with cust" and
 * plan fixes as "source-", "Ledge" -- a character slice on prose. Anything
 * shown that has a length cap is cut here.
 */
export function clipAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, Math.max(0, max - 1));
  let end = -1;
  for (const match of room.matchAll(/[.!?](?=\s|$)/gu)) {
    end = match.index + 1;
  }
  if (end >= Math.floor(max / 2)) return room.slice(0, end);
  const space = room.lastIndexOf(" ");
  const cut = space > 0 ? space : room.length;
  return `${room.slice(0, cut).replace(/[\s,;:\-–—]+$/u, "")}…`;
}

/**
 * Text cut to at most `max` characters at its last whole word, with an
 * ellipsis; its own whitespace (line breaks included) is kept. For a cap
 * on text that is not prose to be re-sentenced (a profile line, a card's
 * about, a record's field). Live 2026-10-30: such caps cut mid-word.
 */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, Math.max(0, max - 1));
  const whole = room.replace(/\s+\S*$/u, "");
  return `${(whole.length > 0 ? whole : room).replace(/[\s,;:\-–—]+$/u, "")}…`;
}
