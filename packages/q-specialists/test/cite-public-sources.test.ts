import { describe, expect, it } from "vitest";

import { citePublicSources as fromCore } from "@capital-q/q-core";

import { citePublicSources } from "../src/company/specialist.js";

/** The specialist cites through q-core's one presentation (CQ-Q-VOICE-001 R3). */
describe("citePublicSources (specialist)", () => {
  it("is q-core's formatter, not a copy", () => {
    expect(citePublicSources).toBe(fromCore);
  });
});
