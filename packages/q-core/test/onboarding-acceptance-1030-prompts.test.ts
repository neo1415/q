import { describe, expect, it } from "vitest";

import { createDefaultPromptRegistry } from "../src/index.js";

/**
 * Live acceptance 2026-10-30 (production 4bcfa584b): the reader's rules,
 * by concept. Code holds the line on skips; the prompt carries the meaning.
 */
const registry = createDefaultPromptRegistry();

describe("ONBOARDING_TRANSCRIPT_READER v8", () => {
  const active = registry.getActive("ONBOARDING_TRANSCRIPT_READER");
  const template = active.definition.template;

  it("is the active version and keeps v7's rules", () => {
    expect(active.definition.version).toBeGreaterThanOrEqual(8);
    expect(template).toMatch(/A step of kind LONG_TEXT is told at length/u);
    expect(template).toMatch(/no website yet, no revenue so far/u);
  });

  it("examples in Q's question are never a value they agreed to", () => {
    expect(template).toMatch(
      /Examples Q lists inside a question .* are not something read back or suggested/u,
    );
  });

  it("a step is answered only by words that answer it; a skip stays a skip", () => {
    expect(template).toMatch(
      /A step is answered only by words that answer what it asks/u,
    );
    expect(template).toMatch(
      /A step whose record says they chose to skip it stays skipped/u,
    );
  });

  it("not knowing declines an optional step; skipping the rest declines every remaining optional step, never a required one", () => {
    expect(template).toMatch(
      /they do not know the answer to an optional step/u,
    );
    expect(template).toMatch(
      /put every optional step that has nothing on record and was not skipped under declined/u,
    );
    expect(template).toMatch(/Never a required step\./u);
  });
});
