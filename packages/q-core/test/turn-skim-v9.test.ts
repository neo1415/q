import { describe, expect, it } from "vitest";

import {
  TURN_SKIM_V8,
  TURN_SKIM_V9,
  V9_ASKS_OF_IT,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Production 2026-10-25 (run 3d8c2636): "Who is the founder of Paystack?"
 * was read as a lookup of Paystack and answered from a weak name match. A
 * question of an organisation is not a request to identify it.
 */
describe("TURN_SKIM v9: a question of an organisation is not a lookup of it", () => {
  it("is active, v8 kept whole plus the rule, by meaning", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_SKIM");
    expect(active.definition.version).toBe(9);
    expect(TURN_SKIM_V9.output).toBe(TURN_SKIM_V8.output);
    expect(TURN_SKIM_V9.template).toContain(V9_ASKS_OF_IT);
    expect(
      TURN_SKIM_V9.template.replace(V9_ASKS_OF_IT, '"do you know QInvest").'),
    ).toBe(TURN_SKIM_V8.template);
    expect(V9_ASKS_OF_IT).toMatch(
      /by what it means in any words and any language/u,
    );
    expect(V9_ASKS_OF_IT).toMatch(/that is OTHER, never PERSON_SEARCH/u);
  });
});
