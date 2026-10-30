import { describe, expect, it } from "vitest";

import {
  TURN_READER_V59,
  TURN_READER_V60,
  V59_ACT_ON_IS_NOT_OPEN,
  V60_ANSWERING_INTEREST,
  V60_ASKING_IS_NOT_OPEN,
  V60_SCREENS_ANY_LANGUAGE,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * QA 2026-10-23 (F-36, F-41, F-33), with the exact phrasings: a screen in
 * any language is NAVIGATE; asking about a shown record is a question; an
 * investor's interest is answered, never handed over.
 */
describe("TURN_READER v60", () => {
  it("v59 kept whole plus three readings (v63 is active)", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(73);
    expect(TURN_READER_V59.status).toBe("DEPRECATED");
    const added = `${V60_SCREENS_ANY_LANGUAGE}${V60_ASKING_IS_NOT_OPEN}${V60_ANSWERING_INTEREST}`;
    expect(TURN_READER_V60.template).toContain(
      `${V59_ACT_ON_IS_NOT_OPEN}${added}`,
    );
    expect(TURN_READER_V60.template.replace(added, "")).toBe(
      TURN_READER_V59.template,
    );
    expect(TURN_READER_V60.output).toBe(TURN_READER_V59.output);
  });

  it("names each finding's own words, read by meaning", () => {
    expect(V60_SCREENS_ANY_LANGUAGE).toContain(
      '"افتح صفحة الاكتشاف" is NAVIGATE DISCOVER',
    );
    expect(V60_SCREENS_ANY_LANGUAGE).toMatch(/named in any language/u);
    expect(V60_ASKING_IS_NOT_OPEN).toContain(
      "tell me more about the second one",
    );
    expect(V60_ASKING_IS_NOT_OPEN).toMatch(/open is null/u);
    expect(V60_ANSWERING_INTEREST).toContain(
      "reply to Rift Valley Seed Fund: accept their interest",
    );
    expect(V60_ANSWERING_INTEREST).toMatch(/handOver is null/u);
  });
});
