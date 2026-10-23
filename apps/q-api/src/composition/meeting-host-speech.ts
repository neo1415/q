/**
 * 2026-10-20 (meetings speed): Q's answer in a call is said while the model
 * is still writing it.
 *
 * The meeting turn is one structured reply ({"kind", "line", ...}). Waiting
 * for all of it before saying a word cost the whole generation on top of
 * synthesis. This reads the reply as it streams: once its kind is known to
 * be one Q says in the model's own words (ANSWER, RECAP) and the line holds
 * a complete first sentence, that sentence is handed on to be said. Every
 * other kind (a refusal, a proposal, a note, quiet) is spoken in Capital Q's
 * fixed words after the reply is complete, exactly as before; nothing is
 * decided from a partial reply except "say this first sentence now".
 */

/** Kinds whose line Q says in the model's words, so it may start early. */
const STREAMED_KINDS = new Set(["ANSWER", "RECAP"]);

/** As in speechPieces: a very short first sentence rides with the next. */
const MIN_PIECE = 25;
/** As in speechPieces: a long first sentence is said up to its first comma. */
const FIRST_PIECE_MAX = 70;

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The first piece of a line still being written, once it is complete: a
 * sentence of at least MIN_PIECE characters, or the words up to the first
 * comma of a long first sentence. Null until then.
 */
export function firstSpeechPiece(partial: string): string | null {
  const text = partial.replace(/^\s+/, "");
  const boundary = /[.!?;](?=\s)/g;
  for (let match = boundary.exec(text); match !== null;) {
    const piece = flat(text.slice(0, match.index + 1));
    if (piece.length >= MIN_PIECE) {
      return piece.length > FIRST_PIECE_MAX
        ? (commaPiece(piece) ?? piece)
        : piece;
    }
    match = boundary.exec(text);
  }
  // No sentence end yet, but already long: its first comma is enough.
  if (text.length > FIRST_PIECE_MAX) return commaPiece(text);
  return null;
}

function commaPiece(text: string): string | null {
  const comma = text.indexOf(", ", 24);
  if (comma > 0 && comma < FIRST_PIECE_MAX && text.length - comma > 20) {
    return flat(text.slice(0, comma + 1));
  }
  return null;
}

/** The JSON string that starts at `from`, decoded as far as it has arrived. */
function decodeJsonString(
  raw: string,
  from: number,
): { readonly text: string; readonly closed: boolean } {
  let text = "";
  for (let i = from; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') return { text, closed: true };
    if (char !== "\\") {
      text += char;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      const code = Number.parseInt(hex, 16);
      if (Number.isFinite(code)) text += String.fromCharCode(code);
      i += 5;
      continue;
    }
    const simple: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      b: "",
      f: "",
      '"': '"',
      "\\": "\\",
      "/": "/",
    };
    text += simple[next] ?? next;
    i += 1;
  }
  return { text, closed: false };
}

export type SpokenLineReader = {
  /** One fragment of the model's raw output, in order. */
  readonly feed: (fragment: string) => void;
  /** The first piece handed on, if any (to subtract from the full line). */
  readonly said: () => string | null;
};

/**
 * Reads a streaming MEETING_HOST_TURN reply and calls `onFirstPiece` at most
 * once, with the line's first sentence, when the kind is one said in the
 * model's words. Never throws into the stream.
 */
export function createSpokenLineReader(
  onFirstPiece: (piece: string) => void,
): SpokenLineReader {
  let raw = "";
  let kind: string | null = null;
  let lineFrom: number | null = null;
  let said: string | null = null;
  let done = false;
  return {
    feed: (fragment) => {
      if (done) return;
      raw += fragment;
      if (raw.length > 8_000) {
        done = true;
        return;
      }
      if (kind === null) {
        const found = /"kind"\s*:\s*"([A-Za-z_]+)"/.exec(raw);
        if (found?.[1] !== undefined) kind = found[1].toUpperCase();
      }
      if (lineFrom === null) {
        const found = /"line"\s*:\s*"/.exec(raw);
        if (found !== null) lineFrom = found.index + found[0].length;
      }
      if (kind === null || lineFrom === null) return;
      if (!STREAMED_KINDS.has(kind)) {
        done = true;
        return;
      }
      const line = decodeJsonString(raw, lineFrom);
      const piece = firstSpeechPiece(line.closed ? `${line.text} ` : line.text);
      if (piece !== null) {
        done = true;
        said = piece;
        try {
          onFirstPiece(piece);
        } catch {
          // The rest of the answer is still said when it is complete.
        }
      } else if (line.closed) {
        done = true;
      }
    },
    said: () => said,
  };
}

/**
 * What is left to say of the full line after its first piece was said.
 * Empty when the line does not begin with what was said (nothing is
 * repeated aloud).
 */
export function restAfter(full: string, said: string): string {
  const line = flat(full);
  const head = flat(said);
  return line.startsWith(head) ? line.slice(head.length).trim() : "";
}

/**
 * 2026-10-23 (rehearsal R7): the same streaming read for a reply with no
 * `kind`, gated by the caller. `ready` sees the raw output so far and says
 * whether the first sentence may be said now (true), never (false), or not
 * yet (null: a field it needs has not arrived). Never throws into the
 * stream; at most one piece.
 */
export function createGatedLineReader(
  onFirstPiece: (piece: string) => void,
  ready: (raw: string) => boolean | null,
): SpokenLineReader {
  let raw = "";
  let lineFrom: number | null = null;
  let said: string | null = null;
  let done = false;
  return {
    feed: (fragment) => {
      if (done) return;
      raw += fragment;
      if (raw.length > 8_000) {
        done = true;
        return;
      }
      if (lineFrom === null) {
        const found = /"line"\s*:\s*"/.exec(raw);
        if (found !== null) lineFrom = found.index + found[0].length;
      }
      if (lineFrom === null) return;
      const line = decodeJsonString(raw, lineFrom);
      const piece = firstSpeechPiece(line.closed ? `${line.text} ` : line.text);
      if (piece === null) {
        if (line.closed) done = true;
        return;
      }
      let go: boolean | null;
      try {
        go = ready(raw);
      } catch {
        go = false;
      }
      if (go === null) return;
      done = true;
      if (!go) return;
      said = piece;
      try {
        onFirstPiece(piece);
      } catch {
        // The whole line is still said when it is complete.
      }
    },
    said: () => said,
  };
}
