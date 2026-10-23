import { describe, expect, it } from "vitest";

import { matchCounterpart, namesOwnScreen } from "../src/index.js";

/**
 * QA F-36 (live 2026-10-23): "افتح صفحة الاكتشاف" ("open Discover") became
 * open_page COMPANY "Discover", and the misheard-name match took it for
 * Umoja Cover ("cover" in "discover"). A screen of Capital Q's own is
 * never a record's name.
 */
describe("open_page never takes a screen's name for a record", () => {
  it("knows the platform's own screens by name, however written", () => {
    for (const name of [
      "Discover",
      "discover page",
      "the Discover page",
      "Saved",
      "Your companies",
      "Explore",
    ]) {
      expect(namesOwnScreen(name), name).toBe(true);
    }
    for (const name of ["Umoja Cover", "Silo Credit", "Basketari"]) {
      expect(namesOwnScreen(name), name).toBe(false);
    }
  });

  it("is why the guard exists: the fuzzy match alone takes Discover for Umoja Cover", () => {
    const records = [
      { id: "1", name: "Umoja Cover" },
      { id: "2", name: "Silo Credit" },
    ];
    expect(matchCounterpart("Discover", records)).toBe("1");
    expect(matchCounterpart("Umoja", records)).toBe("1");
  });
});
