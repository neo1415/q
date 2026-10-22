import { describe, expect, it } from "vitest";

import { tourHoldsVoice } from "@/features/q-pitch/tour-presence";

describe("Q Pitch holds the voice (15 Oct cost bug: a paid line opened before Start)", () => {
  it("while a tour is asked for, running or set to resume, nothing opens a voice line on its own", () => {
    expect(
      tourHoldsVoice({
        running: false,
        search: "?qpitch=story",
        resumeStored: false,
      }),
    ).toBe(true);
    expect(
      tourHoldsVoice({ running: true, search: "", resumeStored: false }),
    ).toBe(true);
    expect(
      tourHoldsVoice({ running: false, search: "", resumeStored: true }),
    ).toBe(true);
  });

  it("without a tour, the arrival behaves as before", () => {
    expect(
      tourHoldsVoice({ running: false, search: "", resumeStored: false }),
    ).toBe(false);
    expect(
      tourHoldsVoice({ running: false, search: "?c=abc", resumeStored: false }),
    ).toBe(false);
  });
});
