import { describe, expect, it } from "vitest";

import {
  INTERVIEW_AGENT_V12,
  INTERVIEW_AGENT_V13,
  DELEGATION_READER_V4,
  DELEGATION_READER_V5,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * v13 only reorders v12 for the provider's prompt cache: the same lines,
 * with the onboarding state after every unchanging rule.
 */
describe("INTERVIEW_AGENT v13", () => {
  it("has exactly v12's lines", () => {
    const lines = (template: string) =>
      template
        .split("\n")
        .filter((line) => line.length > 0)
        .sort();
    expect(lines(INTERVIEW_AGENT_V13.template)).toEqual(
      lines(INTERVIEW_AGENT_V12.template),
    );
  });

  it("puts the state after the rules and every other per-turn section, before this turn's actions", () => {
    const at = (text: string) => INTERVIEW_AGENT_V13.template.indexOf(text);
    const state = at("{{state}}");
    for (const earlier of [
      "When you are done, write only the JSON object",
      "{{personality}}",
      "{{turnNotes}}",
      "{{conversation}}",
      "{{utterance}}",
    ]) {
      expect(at(earlier)).toBeGreaterThan(-1);
      expect(at(earlier)).toBeLessThan(state);
    }
    expect(state).toBeLessThan(at("{{thisTurn}}"));
  });
});

describe("DELEGATION_READER v5", () => {
  it("is active and adds the short-answer rule to every v4 rule", () => {
    expect(
      createDefaultPromptRegistry().getActive("DELEGATION_READER").definition
        .version,
    ).toBe(5);
    for (const line of DELEGATION_READER_V4.template
      .split("\n")
      .filter((l) => l.startsWith("- "))) {
      expect(DELEGATION_READER_V5.template).toContain(line);
    }
    expect(DELEGATION_READER_V5.template).toContain(
      "A short answer states only what it names or plainly means.",
    );
  });
});
