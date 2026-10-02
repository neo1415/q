import { describe, expect, it } from "vitest";

import { discoverabilityNotes } from "../src/features/company/discoverability";

/**
 * Live 2026-10-02 (Nixo: ready, no sector). The founder is told, in
 * general terms, what keeps investors' declared rules from placing the
 * company; never any investor or any mandate.
 */
describe("discoverabilityNotes", () => {
  it("a missing sector is said, with where to add it", () => {
    const notes = discoverabilityNotes({
      sectorDeclared: false,
      stageDeclared: true,
      countryDeclared: true,
    });
    expect(notes).toEqual([
      {
        fact: "SECTOR",
        text: "Investors who look for particular sectors can't place you until you add your sector, so you reach fewer of them.",
        href: "/profile",
      },
    ]);
  });

  it("nothing missing, or an older API: nothing said", () => {
    expect(
      discoverabilityNotes({
        sectorDeclared: true,
        stageDeclared: true,
        countryDeclared: true,
      }),
    ).toEqual([]);
    expect(discoverabilityNotes(undefined)).toEqual([]);
  });

  it("never names an investor or a mandate", () => {
    const text = discoverabilityNotes({
      sectorDeclared: false,
      stageDeclared: false,
      countryDeclared: false,
    })
      .map((note) => note.text)
      .join(" ");
    expect(text).not.toMatch(/mandate|pre[_-]?seed|adult|red flag/i);
  });
});
