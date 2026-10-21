import { describe, expect, it } from "vitest";

import { createPartialFindingsReader } from "../src/policy/partial-findings.js";

const object = {
  answer: 'Seed stage. It says "findings": [ often } in prose.',
  responseShape: "ANALYTICAL",
  findings: [
    {
      type: "TRACTION",
      statement: 'Revenue grew {fast} and "steady".',
      basis: ["F1", "a [bracketed] note"],
    },
    { type: "RISK", statement: "Runway is unknown.", basis: [] },
  ],
  insufficientEvidence: false,
};

describe("findings read while the answer is still being written", () => {
  it("returns each finding once, as soon as it closes, whatever the chunking", () => {
    const text = JSON.stringify(object);
    for (const size of [1, 3, 7, 50, text.length]) {
      const reader = createPartialFindingsReader();
      const seen: unknown[] = [];
      for (let at = size; at < text.length + size; at += size) {
        seen.push(...reader.push(text.slice(0, at)));
      }
      expect(seen).toEqual(object.findings);
    }
  });

  it("reports nothing before a finding has closed", () => {
    const text = JSON.stringify(object);
    const reader = createPartialFindingsReader();
    const cut = text.indexOf("Runway");
    expect(reader.push(text.slice(0, cut))).toEqual([object.findings[0]]);
    expect(reader.push(text.slice(0, cut))).toEqual([]);
  });

  it("finds nothing in an object with no findings array", () => {
    const reader = createPartialFindingsReader();
    expect(
      reader.push(JSON.stringify({ answer: "Hi.", findings_note: [] })),
    ).toEqual([]);
  });
});
