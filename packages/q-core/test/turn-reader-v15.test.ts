import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V14,
  TURN_READER_V15,
  TurnReaderV15ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v15 (founder live 2026-09-29): spoken words plainly meant
 * for someone else are read as such, so Q stays quiet for them. v14's
 * rules stay; a reading without the field is answered as before.
 */
describe("TURN_READER v15", () => {
  it("adds its line to v14 and loses nothing of it (v16 now leads)", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(32);
    expect(TURN_READER_V14.status).toBe("DEPRECATED");
    expect(TURN_READER_V15.status).toBe("DEPRECATED");
    expect(TURN_READER_V15.template).toContain(
      "ADDRESSED: addressedToQ is false only",
    );
    expect(TURN_READER_V15.template).toContain("Typed words are always true.");
    expect(TURN_READER_V15.template.replace(/ADDRESSED: [^\n]*\n/, "")).toBe(
      TURN_READER_V14.template,
    );
  });

  it("defaults to addressed when the field is absent, and keeps false when read", () => {
    const field = TurnReaderV15ResultSchema.shape.addressedToQ;
    expect(field.parse(undefined)).toBe(true);
    expect(field.parse(false)).toBe(false);
  });
});
