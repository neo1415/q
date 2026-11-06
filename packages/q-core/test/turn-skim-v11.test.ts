import { describe, expect, it } from "vitest";

import {
  TURN_SKIM_V10,
  TURN_SKIM_V11,
  TurnSkimV11ResultSchema,
  V10_DOCUMENT,
  V11_ON_WEB,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Owner's account, live 2026-11-06 (11180d8e6): "find me new companies
 * online that i would be interested in" was skimmed as FIT and answered
 * from the in-app ranking; "online" was never read.
 */
describe("TURN_SKIM v11: a turn asking for the public web waits for the full reading", () => {
  it("is active, v10 kept whole plus the onWeb rule, by meaning", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_SKIM");
    expect(active.definition.version).toBe(11);
    expect(
      TURN_SKIM_V11.template.replace(
        `${V10_DOCUMENT}${V11_ON_WEB}`,
        V10_DOCUMENT,
      ),
    ).toBe(TURN_SKIM_V10.template);
    expect(V11_ON_WEB).toMatch(/by what it means, in any language/u);
    expect(V11_ON_WEB).toMatch(/not on Capital Q/u);
  });

  it("reads onWeb leniently: absent or malformed is false", () => {
    const base = { kind: "FIT", confidence: "HIGH" };
    expect(TurnSkimV11ResultSchema.parse(base).onWeb).toBe(false);
    expect(TurnSkimV11ResultSchema.parse({ ...base, onWeb: "yes" }).onWeb).toBe(
      false,
    );
    expect(TurnSkimV11ResultSchema.parse({ ...base, onWeb: true }).onWeb).toBe(
      true,
    );
  });
});
