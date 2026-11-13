import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V28,
  COMPANY_ANALYST_V29,
  createDefaultPromptRegistry,
  V29_CHANGES,
} from "../src/index.js";

/**
 * COMPANY_ANALYST v29 (live Q-IQ gaps, 2026-11-06): the answer names what
 * it is about, reads a fact in the facts as on record, shows a worked
 * figure's inputs, takes "same question" as the last one, and says two
 * conflicting figures side by side. Every v28 rule stays.
 */
describe("COMPANY_ANALYST v29: the live Q-IQ gaps", () => {
  it("was active (now v30), on v28's output, and differs from v28 only by its listed changes", () => {
    const registry = createDefaultPromptRegistry();
    // v30 (C3) succeeds it; v29 stays published, deprecated.
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(31);
    expect(registry.get("COMPANY_ANALYST", 29)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(registry.get("COMPANY_ANALYST", 28)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V29.output).toBe(COMPANY_ANALYST_V28.output);
    expect(COMPANY_ANALYST_V29.variables).toEqual(
      COMPANY_ANALYST_V28.variables,
    );
    const undone = [...V29_CHANGES]
      .reverse()
      .reduce(
        (text, [from, to]) => text.replace(to, from),
        COMPANY_ANALYST_V29.template,
      );
    expect(undone).toBe(COMPANY_ANALYST_V28.template);
    for (const [, to] of V29_CHANGES) {
      expect(COMPANY_ANALYST_V29.template).toContain(to);
    }
  });

  it("carries each live gap's instruction", () => {
    const t = COMPANY_ANALYST_V29.template;
    // CMP-061 #0, UNK-076 #1: the subject is named.
    expect(t).toContain(
      'Name what you answer about at its first mention in each reply, never a bare "Its"',
    );
    // ORD-016 #4: a fact is on record without an earlier answer saying it.
    expect(t).toContain("A fact is on record even if unsaid so far.");
    // NUM-106 #2: a worked figure's inputs, as the claim check grounds it.
    expect(t).toContain("$180k a month is $2.16M a year");
    // FUP-031 #3.
    expect(t).toContain('"Same question for X": their last one, about X.');
    // Contradictions coexist, in the answer itself.
    expect(t).toContain(
      "If two facts conflict, say both with their sources and list the conflict in contradictions; do not choose between them, average them, or prefer the larger, newer or more favourable one.",
    );
    // Untouched: unknown stays unknown.
    expect(COMPANY_ANALYST_V28.template).toContain(
      "Set insufficientEvidence to true only when the facts",
    );
    expect(t).toContain("Set insufficientEvidence to true only when the facts");
  });
});
