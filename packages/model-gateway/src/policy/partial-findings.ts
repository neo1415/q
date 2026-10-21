/**
 * The findings, as each one is finished (turn latency round 5;
 * progressive findings with lane 3).
 *
 * The analyst writes its findings after the answer, inside the same JSON
 * object, and a person waited for the whole object before seeing any of
 * them. This reads the root `findings` array out of the document while it
 * is still being written and returns each element once its closing brace
 * arrives, as the parsed JSON value. It is a scanner like
 * `partial-answer.ts`: it reports only what is certain (a whole element),
 * never guesses, and never reports an element twice.
 *
 * Validation is the caller's: an element that is not a finding is simply
 * not shown early, and the completed message stays authoritative.
 */

/** The array's opening: a root-level key, not text inside a string. */
const KEY = /(?:^|[{,])\s*"findings"\s*:\s*\[/u;

export type PartialFindingsReader = {
  /** Feed everything written so far; returns the elements newly finished. */
  readonly push: (accumulated: string) => readonly unknown[];
};

export function createPartialFindingsReader(): PartialFindingsReader {
  /** The next character to scan, once the array has been found. */
  let at = -1;
  /** Where the element being read began. */
  let elementStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let done = false;
  return {
    push: (accumulated) => {
      if (done) return [];
      if (at < 0) {
        const found = KEY.exec(accumulated);
        if (found === null) return [];
        at = found.index + found[0].length;
      }
      const finished: unknown[] = [];
      for (; at < accumulated.length; at += 1) {
        const char = accumulated[at];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === "{" || char === "[") {
          if (depth === 0) elementStart = at;
          depth += 1;
          continue;
        }
        if (char === "}" || char === "]") {
          if (depth === 0) {
            // The array itself closed.
            done = true;
            at += 1;
            break;
          }
          depth -= 1;
          if (depth === 0 && elementStart >= 0) {
            try {
              finished.push(
                JSON.parse(accumulated.slice(elementStart, at + 1)),
              );
            } catch {
              // Not JSON after all: nothing more here can be trusted.
              done = true;
              at += 1;
              break;
            }
            elementStart = -1;
          }
        }
      }
      return finished;
    },
  };
}
