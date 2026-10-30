import { describe, expect, it } from "vitest";

import { createDefaultPromptRegistry } from "../src/index.js";

/**
 * Live onboarding sweep 2026-10-29: the readers' rules, by concept (never
 * a phrase list). D2 and D6 are the model's mapping, so the prompt carries
 * the rule and these tests pin that the active versions do.
 */
const registry = createDefaultPromptRegistry();

describe("ONBOARDING_TRANSCRIPT_READER v4", () => {
  const active = registry.getActive("ONBOARDING_TRANSCRIPT_READER");
  const template = active.definition.template;

  it("is the active version", () => {
    expect(active.definition.version).toBe(4);
  });

  it("D2/D5: the value is an option key; detail beside an answer still names the option holding it", () => {
    expect(template).toMatch(/never their sentence, never a label/u);
    expect(template).toMatch(
      /a city or a region inside a listed country is that country/u,
    );
    expect(template).toMatch(/read against today's date in the notes/u);
  });

  it("D6: chosen by the label's meaning, never a key's word (\"follow a lead\" is co-invest)", () => {
    expect(template).toMatch(
      /never choose an option because its key is a word they used/u,
    );
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
      /a city in a listed country\) name that category/u,
    );
  });
});
