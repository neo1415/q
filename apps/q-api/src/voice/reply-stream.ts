/**
 * The final reply of an interview Q run, as sentences while it is written
 * (P0-3: the streaming interface VN2 wires to speech).
 *
 * The loop's final round writes a JSON object {"reply": "...", ...}. This
 * reads the reply field out of the text as it streams, character by
 * character, and hands each complete sentence to the caller once. It is a
 * reader of a known output shape, not of meaning: a sentence ends where a
 * full stop, question or exclamation mark is followed by space.
 *
 * `finish` receives the reply the run settled on. Anything not yet said is
 * said then; if the settled reply is not the text already streamed (a
 * round whose text was refused and answered again), nothing more is sent,
 * and `diverged` says so, so the caller can decide what to do.
 *
 * `lead` is a sentence code said before the model wrote anything (the save
 * receipt). It goes out through this stream, so the stream knows it was
 * said: the settled reply opens with it, and `finish` sends only what
 * follows it. Production 2026-11-07: the receipt was said beside the
 * stream, `finish` saw nothing streamed and sent the whole reply, and the
 * voice said "I've saved…" twice while the stored turn held it once.
 * A model sentence that only restates the lead (`restates`) is not sent
 * either: once spoken it cannot be taken back.
 */
export type ReplySentenceStream = {
  readonly push: (delta: string) => void;
  readonly lead: (
    sentence: string,
    restates?: (sentence: string) => boolean,
  ) => void;
  readonly finish: (reply: string) => { readonly diverged: boolean };
};

const collapsed = (text: string) => text.replace(/\s+/g, " ").trim();

const FIELD = '"reply"';
/** Where a sentence ends: terminal punctuation, a closing mark, then space. */
const SENTENCE_END = /[.!?]["')\]]?\s/;

export function createReplySentenceStream(
  onSentence: (sentence: string) => void,
): ReplySentenceStream {
  let raw = "";
  /** Index in `raw` where the reply's string content begins, once found. */
  let start = -1;
  /** How far into the reply's content has been decoded. */
  let cursor = 0;
  let closed = false;
  let escape = false;
  let emitted = "";
  let pending = "";
  /** The sentence code said first, if any; never counted in `emitted`. */
  let leadSaid: string | null = null;
  let restatesLead: ((sentence: string) => boolean) | null = null;

  const emit = (sentence: string) => {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) return;
    if (
      leadSaid !== null &&
      (collapsed(trimmed) === collapsed(leadSaid) ||
        restatesLead?.(trimmed) === true)
    ) {
      // Already said, in code's words: dropped, and not counted as said,
      // because the settled reply drops it too.
      return;
    }
    emitted += sentence;
    onSentence(trimmed);
  };

  const flushComplete = () => {
    for (;;) {
      const match = SENTENCE_END.exec(pending);
      if (match === null) return;
      const end = match.index + match[0].length;
      emit(pending.slice(0, end));
      pending = pending.slice(end);
    }
  };

  const decode = (from: number) => {
    for (let i = from; i < raw.length && !closed; i += 1) {
      const ch = raw[i] ?? "";
      if (escape) {
        escape = false;
        const mapped =
          ch === "n" ? "\n" : ch === "t" ? "\t" : ch === "u" ? "" : ch;
        if (ch === "u") {
          const hex = raw.slice(i + 1, i + 5);
          if (hex.length < 4) {
            // Wait for the rest of the escape: resume at its backslash.
            escape = false;
            cursor = i - 1;
            return;
          }
          pending += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
          cursor = i + 1;
          continue;
        }
        pending += mapped;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        closed = true;
      } else {
        pending += ch;
      }
      cursor = i + 1;
    }
    flushComplete();
  };

  return {
    push: (delta) => {
      if (closed) return;
      raw += delta;
      if (start === -1) {
        const at = raw.indexOf(FIELD);
        if (at === -1) return;
        const quote = raw.indexOf('"', at + FIELD.length);
        if (quote === -1) return;
        start = quote + 1;
        cursor = start;
      }
      decode(cursor);
    },
    lead: (sentence, restates) => {
      const trimmed = sentence.trim();
      if (closed || leadSaid !== null || trimmed.length === 0) return;
      leadSaid = trimmed;
      restatesLead = restates ?? null;
      onSentence(trimmed);
    },
    finish: (settled) => {
      closed = true;
      // The lead was said: what is left to say follows it.
      const reply =
        leadSaid !== null && settled.startsWith(leadSaid)
          ? settled.slice(leadSaid.length).trimStart()
          : settled;
      const said = emitted.trimStart();
      if (!reply.startsWith(said)) return { diverged: true };
      let rest = reply.slice(said.length);
      for (;;) {
        const match = SENTENCE_END.exec(rest);
        if (match === null) break;
        const end = match.index + match[0].length;
        emit(rest.slice(0, end));
        rest = rest.slice(end);
      }
      emit(rest);
      return { diverged: false };
    },
  };
}
