import { describe, expect, it } from "vitest";

import {
  recognitionQuestion,
  RIGHT_PERSON_LINE,
  WRONG_PERSON_LINE,
} from "../src/voice/recognise.js";

/**
 * Q showing somebody it already knows who they are, and giving them the
 * chance to say it has the wrong person.
 */
describe("checking Q has the right person", () => {
  it("says what was found, where from, and asks one question", () => {
    const question = recognitionQuestion({
      name: "Ada Okafor",
      statements: [
        "Ada Okafor is a co-founder of The Vaultlyne.",
        "She writes about payments infrastructure in West Africa.",
      ],
      domains: ["thevaultlyne.com", "linkedin.com"],
    });
    expect(question).not.toBeNull();
    if (question === null) return;
    expect(question.line).toContain("thevaultlyne.com");
    expect(question.line).toContain("linkedin.com");
    expect(question.line).toContain("co-founder of The Vaultlyne");
    expect(question.line).toMatch(/right person\?$/);
    expect(question.options.map((o) => o.label)).toEqual([
      "That's me",
      "That's someone else",
    ]);
  });

  it("says it plainly when there is nowhere to attribute it to", () => {
    const question = recognitionQuestion({
      name: "Ada Okafor",
      statements: ["Ada Okafor founded a payments company."],
      domains: [],
    });
    expect(question?.line).toContain("under your name.");
    expect(question?.line).not.toContain(" on .");
  });

  it("stops at a sentence rather than reading out a dossier", () => {
    const question = recognitionQuestion({
      name: "Ada Okafor",
      statements: [
        "A".repeat(150),
        "B".repeat(150),
        "C".repeat(150),
        "D".repeat(150),
      ],
      domains: ["example.com"],
    });
    expect(question).not.toBeNull();
    if (question === null) return;
    expect(question.line).toContain("A".repeat(150));
    expect(question.line).not.toContain("B".repeat(150));
  });

  it("asks nothing when nothing was found", () => {
    expect(
      recognitionQuestion({ name: "Ada", statements: [], domains: [] }),
    ).toBeNull();
    expect(
      recognitionQuestion({
        name: "Ada",
        statements: ["  ", ""],
        domains: ["example.com"],
      }),
    ).toBeNull();
  });

  it("takes a no as final, and says so", () => {
    // Their word settles it: what was found under a name that is not
    // theirs is not theirs, and Q says it will leave it out.
    expect(WRONG_PERSON_LINE).toMatch(/leave that out/i);
    expect(WRONG_PERSON_LINE).toMatch(/won't use it/i);
    expect(RIGHT_PERSON_LINE.length).toBeGreaterThan(0);
  });
});
