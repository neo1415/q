import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isPlainLine, plainLineProblems } from "../src/index.js";

/**
 * Every sentence a person can read or hear, held to one rule.
 *
 * The reliability audit found there was no inventory of these lines, so
 * the rule that they are written in Q's voice was followed unevenly: one
 * of them reached a person with a provider's failure class in brackets.
 * This is the inventory, as a scan of the files that hold the lines, so a
 * new one cannot quietly break the rule.
 *
 * It reads source rather than importing it because most of these tables
 * are private to their module, and making them public so a test could see
 * them would be the test changing the design. A string literal in one of
 * these files, long enough to be a sentence and punctuated like one, is a
 * line a person sees.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");

/** Where person-facing wording lives. Add a file when it starts holding lines. */
const SURFACES: readonly string[] = [
  "packages/contracts/src/q/failure.ts",
  "apps/q-api/src/voice/navigation.ts",
  "apps/q-api/src/voice/think.ts",
  "apps/q-api/src/voice/welcome.ts",
  "apps/q-api/src/voice/interviewer.ts",
  "apps/web/src/features/voice/provider/deepgram-session.ts",
  "apps/web/src/features/voice/provider/elevenlabs-session.ts",
  "apps/web/src/features/voice/use-voice-interview.ts",
  "apps/web/src/features/voice/actions.ts",
  "apps/web/src/features/q/conversation.ts",
  "apps/web/src/features/q/actions.ts",
  "apps/web/src/auth/auth-errors.ts",
  "apps/web/src/features/company/visibility-actions.ts",
  "apps/web/src/features/investor/visibility-actions.ts",
];

/**
 * A sentence, as opposed to a key, a class name or a fragment: long
 * enough to say something, with a space in it, ending the way a sentence
 * ends. Template literals are excluded on purpose — a line assembled at
 * runtime is the thing this rule exists to prevent, and the scan would
 * only see the parts.
 */
const SENTENCE = /"([^"\\\n]{24,400})"/g;
const LOOKS_LIKE_A_SENTENCE = /^[A-Z“'"].* .*[.!?…]$/;

function linesIn(relative: string): readonly string[] {
  const source = readFileSync(join(ROOT, relative), "utf8");
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const match of withoutComments.matchAll(SENTENCE)) {
    const candidate = match[1];
    if (candidate !== undefined && LOOKS_LIKE_A_SENTENCE.test(candidate)) {
      found.push(candidate);
    }
  }
  return found;
}

describe("the lines a person reads", () => {
  it("finds the lines at all, so an empty scan cannot pass by accident", () => {
    const counts = SURFACES.map(
      (file) => [file, linesIn(file).length] as const,
    );
    for (const [file, count] of counts) {
      expect(
        count,
        `${file} yielded no person-facing sentences`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(SURFACES)("says nothing about our internals: %s", (file) => {
    const offences = linesIn(file)
      .map((line) => ({ line, problems: plainLineProblems(line) }))
      .filter((entry) => entry.problems.length > 0)
      .map(
        (entry) =>
          `${entry.problems.map((p) => `${p.reason} ("${p.pattern}")`).join("; ")}\n    ${entry.line}`,
      );
    expect(offences, `${file}\n  ${offences.join("\n  ")}`).toEqual([]);
  });

  it("catches the shapes that have actually reached people", () => {
    // The one that prompted this: a provider's failure class in brackets.
    expect(
      isPlainLine("Voice isn't working right now. You can keep typing."),
    ).toBe(true);
    expect(
      isPlainLine(
        "Voice isn't working right now. You can keep typing. (FAILED_TO_THINK)",
      ),
    ).toBe(false);

    expect(isPlainLine("Deepgram returned an error.")).toBe(false);
    expect(isPlainLine("The request failed with status 503.")).toBe(false);
    expect(isPlainLine("Something went wrong: undefined")).toBe(false);
    expect(isPlainLine("[object Object]")).toBe(false);

    // And the ordinary ones still pass.
    expect(
      isPlainLine("That one didn't finish. Ask again and I'll start it fresh."),
    ).toBe(true);
    expect(
      isPlainLine(
        "I lost the line there. Give me a second and I'll pick it back up.",
      ),
    ).toBe(true);
  });
});
