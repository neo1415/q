/**
 * The complete part of a structured answer that was cut off at its output
 * ceiling.
 *
 * Production 2026-10-30/31 (ai_ops.model_usage): research plans either
 * finished in at most 889 output tokens (7 days, every success) or ran to
 * whatever ceiling they were given -- 4,000, then 8,000 on the doubled
 * retry -- 7 times on 10-31 alone. No answer the plan's schema accepts is
 * that long (16 questions at their longest are about 2,600 tokens), so
 * more room never helps such a run: it is a runaway, not a long answer.
 * What it wrote before running away is often whole: the list elements it
 * finished. This finds them.
 *
 * It is a scanner, not a repair. It returns the text up to the end of the
 * last value that closed inside a list or at the root, then closes the
 * containers still open there. Nothing is rewritten, completed or guessed:
 * an element half written is left out, never finished. The result is
 * validated by the caller's schema exactly as a whole answer would be.
 */
export type CutOffSalvage = {
  /** The closed JSON text, ready to decode and validate. */
  readonly text: string;
  /** Whole list elements kept, across every list. */
  readonly items: number;
};

type Open = {
  readonly kind: "object" | "array";
  /** Array: elements completed so far. */
  count: number;
};

export function salvageCutOff(
  text: string,
  options: {
    /** At most this many elements of any one list are kept. */
    readonly keepItems: number;
  },
): CutOffSalvage | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const stack: Open[] = [];
  let inString = false;
  let escaped = false;
  /** In a scalar outside a string (a number, true, false, null). */
  let inBare = false;
  let best: { end: number; closers: string; items: number } | null = null;
  let items = 0;

  const { keepItems } = options;
  const full = () =>
    stack.some((open) => open.kind === "array" && open.count >= keepItems);

  // A value just closed at `end` (exclusive): note a cut point when its
  // container is a list, or the root object, and no list is already full.
  const closed = (end: number) => {
    const parent = stack[stack.length - 1];
    if (parent === undefined) return;
    if (full()) return;
    if (parent.kind === "array") {
      parent.count += 1;
      items += 1;
    } else if (stack.length !== 1) {
      return;
    }
    best = {
      end,
      closers: stack
        .slice()
        .reverse()
        .map((open) => (open.kind === "array" ? "]" : "}"))
        .join(""),
      items,
    };
  };

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        inString = false;
        // A key is not a value: it is followed by a colon. A string at the
        // very end could be either, so it is not counted.
        let next = index + 1;
        while (next < text.length && /\s/u.test(text[next] ?? "")) next += 1;
        if (next < text.length && text[next] !== ":") closed(index + 1);
      }
      continue;
    }
    if (inBare) {
      if (/[\s,\]}]/u.test(char ?? "")) {
        inBare = false;
        closed(index);
      } else continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      stack.push({ kind: "object", count: 0 });
    } else if (char === "[") {
      stack.push({ kind: "array", count: 0 });
    } else if (char === "}" || char === "]") {
      stack.pop();
      if (stack.length === 0) return null; // closed whole: not a cut-off
      closed(index + 1);
    } else if (/[-0-9tfn]/u.test(char ?? "")) {
      inBare = true;
    }
  }
  if (best === null) return null;
  const found: { end: number; closers: string; items: number } = best;
  if (found.items === 0) return null;
  return {
    text: `${text.slice(start, found.end)}${found.closers}`,
    items: found.items,
  };
}
