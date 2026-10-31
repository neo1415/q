import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TaxonomyChoiceV3ResultSchema,
  type TaxonomyChoiceV3Variables,
} from "../src/index.js";

/**
 * Live check 2026-10-31 on production 656719a90 (fictional "Skerry Lantern
 * Ventures" and "Vesiveski Parcel Docks"). Meaning is the model's: the
 * prompt carries the rule, and these tests pin that the active version
 * does, and that what else they said reaches it as their words.
 */
const registry = createDefaultPromptRegistry();
const active = registry.getActive("TAXONOMY_CHOICE");
const template = active.definition.template;

describe("TAXONOMY_CHOICE v3", () => {
  it("is active and keeps v2's rules", () => {
    expect(active.definition.version).toBeGreaterThanOrEqual(3);
    expect(template).toMatch(/choose each member that is listed/u);
    expect(template).toMatch(
      /Never choose a category only because it shares a word/u,
    );
  });

  it('"industrial automation": a narrower kind of a listed broader category names it', () => {
    expect(template).toMatch(
      /narrower kind of activity, product or business inside one listed broader category, where nothing listed is closer to them, name that broader category/u,
    );
  });

  it('"recurring revenue" from a B2B investor: a category what else they said contradicts is never chosen', () => {
    expect(template).toMatch(/Never choose a category it contradicts/u);
    expect(template).toMatch(
      /customers are businesses, never a category for consumers/u,
    );
    expect(template).toMatch(
      /choose none: their words are kept as they said them/u,
    );
  });

  it('"40 lockers live in 12 towns": what the chosen ones do not hold comes back in their words', () => {
    expect(template).toMatch(
      /"beyond" is the part of THE SENTENCE about this field that the chosen ones do not hold/u,
    );
    expect(
      TaxonomyChoiceV3ResultSchema.parse({
        chosen: ["c5"],
        beyond: "40 lockers live in 12 towns",
      }).beyond,
    ).toBe("40 lockers live in 12 towns");
    // An older-shaped reading (no beyond) still parses, as nothing beyond.
    expect(
      TaxonomyChoiceV3ResultSchema.parse({ chosen: [] }).beyond,
    ).toBeNull();
  });

  it("what else they said is rendered as untrusted words, never as instructions", () => {
    const rendered = renderPrompt<TaxonomyChoiceV3Variables>(registry, {
      task: "TAXONOMY_CHOICE",
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "You are reading words, not answering anyone.",
      variables: {
        field: "What business models do you back?",
        candidates:
          "c1 | B2B SaaS | business_model\nc2 | Consumer Subscription | business_model",
        phrase: "recurring revenue",
        sentence: "Mostly B2B with recurring revenue.",
        context: "Customer types: B2B",
      },
    });
    const text = rendered.messages.map((m) => m.content).join("\n");
    const at = text.indexOf("Customer types: B2B");
    expect(at).toBeGreaterThan(0);
    const open = text.lastIndexOf("<<<UNTRUSTED_CONTENT", at);
    const close = text.lastIndexOf("<<<END_UNTRUSTED_CONTENT>>>", at);
    expect(open).toBeGreaterThan(close);
  });
});
