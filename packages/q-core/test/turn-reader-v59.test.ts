import { describe, expect, it } from "vitest";

import {
  TURN_READER_V40_REFERENCES,
  TURN_READER_V58,
  TURN_READER_V59,
  V59_ACT_ON_IS_NOT_OPEN,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Coordinator live test 2026-10-23 (run 1102eab6): "draft a note to the
 * founders of the second company" opened the company instead of drafting.
 * Asking Q to act for a record's people is never a request to open it.
 */
describe("TURN_READER v59: acting on a record is not opening it", () => {
  it("v58 kept whole plus one REFERENCE rule (v63 is active)", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(72);
    expect(TURN_READER_V58.status).toBe("DEPRECATED");
    expect(TURN_READER_V59.template).toContain(
      `${TURN_READER_V40_REFERENCES}${V59_ACT_ON_IS_NOT_OPEN}`,
    );
    expect(TURN_READER_V59.template.replace(V59_ACT_ON_IS_NOT_OPEN, "")).toBe(
      TURN_READER_V58.template,
    );
    expect(TURN_READER_V59.output).toBe(TURN_READER_V58.output);
  });

  it("reads by meaning in any language and keeps which record it is", () => {
    expect(V59_ACT_ON_IS_NOT_OPEN).toMatch(/open is null/u);
    expect(V59_ACT_ON_IS_NOT_OPEN).toMatch(
      /by what it means, in any language/u,
    );
    expect(V59_ACT_ON_IS_NOT_OPEN).toMatch(
      /name and shown still say which record/u,
    );
    expect(V59_ACT_ON_IS_NOT_OPEN).toContain(
      "draft a note to the founders of the second company",
    );
  });
});
