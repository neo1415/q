/**
 * The answer, as far as it has been written.
 *
 * The analyst replies with one JSON object whose `answer` field is the
 * prose a person reads. That object is only valid once it closes, so
 * waiting for it means waiting for the whole turn: the sentence a person
 * could have heard at a second and a half arrives at four.
 *
 * This reads the `answer` string out of a JSON document that is still
 * being written, one character at a time, and returns what it can be sure
 * of. It is deliberately a scanner and not a parser: a parser needs a
 * complete document, which is the thing we do not have.
 *
 * Certainty is the whole point. A trailing backslash might begin an escape
 * and a trailing `\\u00` might become an é, so neither is reported until
 * the next characters settle it. Nothing is guessed and nothing is
 * reported twice.
 *
 * When the model writes its fields in another order, or fences the object,
 * or writes prose instead, this simply never finds an answer and reports
 * nothing. The complete text still arrives the ordinary way at the end, so
 * the failure mode is the behaviour we had before streaming.
 */

const KEY = /"answer"\s*:\s*"/;

export type PartialAnswerReader = {
  /**
   * Feed everything written so far. Returns the NEW characters of the
   * answer since the last call: "" when there are none.
   */
  readonly push: (accumulated: string) => string;
  /** True once the answer's closing quote has been seen. */
  readonly complete: () => boolean;
};

export function createPartialAnswerReader(): PartialAnswerReader {
  /** Where the answer's opening quote sits, once found. */
  let start = -1;
  /** How much of the answer we have already reported. */
  let reported = 0;
  let closed = false;

  return {
    complete: () => closed,
    push: (accumulated) => {
      if (closed) {
        return "";
      }
      if (start < 0) {
        const found = KEY.exec(accumulated);
        if (found === null) {
          return "";
        }
        start = found.index + found[0].length;
      }

      // Decode from the opening quote to wherever we can be certain the
      // string continues, stopping at anything that could still change
      // meaning when the next character arrives.
      let out = "";
      let index = start;
      while (index < accumulated.length) {
        const char = accumulated[index] ?? "";
        if (char === '"') {
          closed = true;
          break;
        }
        if (char !== "\\") {
          out += char;
          index += 1;
          continue;
        }
        // An escape. Without the character after it we cannot know what
        // it means, so the report stops here and resumes next time.
        const next = accumulated[index + 1];
        if (next === undefined) {
          break;
        }
        if (next === "u") {
          const hex = accumulated.slice(index + 2, index + 6);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            break;
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          index += 6;
          continue;
        }
        const simple = SIMPLE_ESCAPES[next];
        if (simple === undefined) {
          // Not an escape JSON defines. The document is malformed, so
          // nothing more can be trusted: stop reporting and let the
          // ordinary parse at the end decide what happened.
          closed = true;
          break;
        }
        out += simple;
        index += 2;
      }

      const fresh = out.slice(reported);
      reported = out.length;
      return fresh;
    },
  };
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
