import { describe, expect, it } from "vitest";

import { createDefaultPromptRegistry } from "../src/index.js";

/**
 * Live onboarding sweep 2026-10-29: the readers' rules, by concept (never
 * a phrase list). D2 and D6 are the model's mapping, so the prompt carries
 * the rule and these tests pin that the active versions do.
 */
const registry = createDefaultPromptRegistry();

describe("ONBOARDING_TRANSCRIPT_READER v6 (keeps v4's and v5's rules)", () => {
  const active = registry.getActive("ONBOARDING_TRANSCRIPT_READER");
  const template = active.definition.template;

  it("is the active version, or a later one that keeps its rules (v7, live 2026-10-30)", () => {
    expect(active.definition.version).toBeGreaterThanOrEqual(6);
  });

  it("recheck 2026-10-30 (891425cbe): a step on record changes only on words about it; each answer says so", () => {
    expect(template).toMatch(
      /A step that already has something on record changes only when their words are about that step/u,
    );
    expect(template).toMatch(
      /Words that answer a different question .* are never a new answer to the step on record/u,
    );
    expect(template).toMatch(/"aboutStep": false/u);
    expect(active.definition.output.kind).toBe("STRUCTURED");
  });

  it("recheck 2026-10-30: a range of amounts is its two ends, whatever question it was said to", () => {
    expect(template).toMatch(
      /A range of amounts they give .* is its two ends: the lower figure answers the step for the smallest amount and the higher figure the step for the largest/u,
    );
    expect(template).toMatch(/whichever question it was said to/u);
  });

  it("D2/D5: the value is an option key; detail beside an answer still names the option holding it", () => {
    expect(template).toMatch(/never their sentence, never a label/u);
    expect(template).toMatch(
      /a city or a region inside a listed country is that country/u,
    );
    expect(template).toMatch(/read against today's date in the notes/u);
  });

  it("D6 (recheck 2026-10-30): options are opaque ids beside labels; never a key as a word", () => {
    expect(template).toMatch(/each option is listed as an id and its label/u);
    expect(template).toMatch(/The value is the id \(or ids\)/u);
    expect(template).not.toMatch(/its key is a word they used/u);
  });

  it('D6: what they will consider includes what they do only sometimes ("Series A mostly, sometimes seed")', () => {
    expect(template).toMatch(
      /When a step asks what they will consider .* everything they say they do, even sometimes, is one of their choices/u,
    );
    // v3's rule still holds for how they usually work.
    expect(template).toMatch(
      /how they usually work .* what they mainly do: an occasional exception they mention is not one of their choices/u,
    );
  });
});

describe("TAXONOMY_CHOICE v2", () => {
  const active = registry.getActive("TAXONOMY_CHOICE");
  it("reads a region the list lacks as its listed members only, and a city as its country", () => {
    expect(active.definition.version).toBe(2);
    expect(active.definition.template).toMatch(
      /choose each member that is listed, and only those/u,
    );
    expect(active.definition.template).toMatch(
      /a city in a listed country; a month or a quarter inside a listed span of time/u,
    );
  });
});
