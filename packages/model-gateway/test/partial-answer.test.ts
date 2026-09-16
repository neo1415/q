import { describe, expect, it } from "vitest";

import { createPartialAnswerReader } from "../src/policy/partial-answer.js";

/**
 * Reading the answer out of a JSON document that is still being written.
 * Nothing guessed, nothing reported twice, and nothing reported that the
 * next character could still change.
 */

/** Feed the document one character at a time, as a stream would. */
function readByCharacter(document: string): string {
  const reader = createPartialAnswerReader();
  let out = "";
  let seen = "";
  for (const char of document) {
    seen += char;
    out += reader.push(seen);
  }
  return out;
}

/** Feed it in arbitrary lumps, as a provider actually would. */
function readByChunks(document: string, size: number): string {
  const reader = createPartialAnswerReader();
  let out = "";
  let seen = "";
  for (let at = 0; at < document.length; at += size) {
    seen += document.slice(at, at + size);
    out += reader.push(seen);
  }
  return out;
}

const OPEN = '{"answer":"';

describe("the answer, as far as it has been written", () => {
  it("reads the same text however the document is cut up", () => {
    const answer = "Paystack is a Nigerian payments company.";
    const document = JSON.stringify({
      answer,
      responseShape: "CONCISE",
      insufficientEvidence: false,
    });
    expect(readByCharacter(document)).toBe(answer);
    for (const size of [1, 2, 3, 7, 16, 64, 1000]) {
      expect(readByChunks(document, size), `chunk ${String(size)}`).toBe(
        answer,
      );
    }
  });

  it("decodes what JSON escapes mean, never the escape itself", () => {
    const answer = [
      'They said "yes".',
      "Then: 50% " + String.fromCharCode(92) + " done — café",
    ].join("\n");
    const document = JSON.stringify({ answer, responseShape: "CONCISE" });
    expect(readByCharacter(document)).toBe(answer);
    expect(readByChunks(document, 3)).toBe(answer);
  });

  it("never reports a half-written escape", () => {
    const reader = createPartialAnswerReader();
    const backslash = String.fromCharCode(92);
    // The document so far ends on a backslash: what it means depends on
    // the next character, so nothing about it may be reported yet.
    expect(reader.push(`${OPEN}He said `)).toBe("He said ");
    expect(reader.push(`${OPEN}He said ${backslash}`)).toBe("");
    expect(reader.push(`${OPEN}He said ${backslash}"`)).toBe('"');
  });

  it("never reports a half-written unicode escape", () => {
    const reader = createPartialAnswerReader();
    const u = `${String.fromCharCode(92)}u00`;
    expect(reader.push(`${OPEN}caf`)).toBe("caf");
    expect(reader.push(`${OPEN}caf${u}`)).toBe("");
    expect(reader.push(`${OPEN}caf${u}e`)).toBe("");
    expect(reader.push(`${OPEN}caf${u}e9`)).toBe("é");
  });

  it("reports each character exactly once", () => {
    const reader = createPartialAnswerReader();
    expect(reader.push(`${OPEN}Hello`)).toBe("Hello");
    expect(reader.push(`${OPEN}Hello`)).toBe("");
    expect(reader.push(`${OPEN}Hello there`)).toBe(" there");
    expect(reader.push(`${OPEN}Hello there"`)).toBe("");
    expect(reader.complete()).toBe(true);
  });

  it("stops at the closing quote and ignores the rest of the object", () => {
    const document = `${OPEN}Short.","responseShape":"CONCISE","findings":[{"x":"not the answer"}]}`;
    expect(readByCharacter(document)).toBe("Short.");
  });

  it("reports nothing when the answer is not the field being written", () => {
    // Fields in another order, prose instead of an object, a fenced
    // object: each is a case where nothing can be said with certainty, so
    // nothing is said and the complete text still arrives at the end.
    const reader = createPartialAnswerReader();
    expect(reader.push('{"responseShape":"CONCISE","find')).toBe("");
    expect(createPartialAnswerReader().push("I think the answer is 42.")).toBe(
      "",
    );
    expect(createPartialAnswerReader().push('```json\n{"ans')).toBe("");
  });

  it("stops reporting once the document stops being JSON", () => {
    const reader = createPartialAnswerReader();
    const notAnEscape = `${String.fromCharCode(92)}q`;
    expect(reader.push(`${OPEN}Fine so far`)).toBe("Fine so far");
    expect(reader.push(`${OPEN}Fine so far${notAnEscape}`)).toBe("");
    expect(reader.complete()).toBe(true);
    expect(reader.push(`${OPEN}Fine so far${notAnEscape} more"`)).toBe("");
  });
});
