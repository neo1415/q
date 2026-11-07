import { describe, expect, it } from "vitest";

import { normaliseWebsite } from "../src/application/website.js";

/**
 * P1-9 (onboarding plan 2026-11-07; DECISIONS 77 "normalised so it can be
 * searched"): the form and the conversation store a website the same way.
 * The conversation turned "Savage Bridge dot com" into
 * https://savagebridge.com while the form stored "www.SavageBridge.com"
 * as https://www.SavageBridge.com and refused the spoken form outright.
 * One canonical form: lower-case host, no leading www, path kept.
 */
describe("one canonical website, whichever way it was given", () => {
  it.each([
    ["savage bridge dot com", "https://savagebridge.com"],
    ["www dot savagebridge dot com", "https://savagebridge.com"],
    ["www.SavageBridge.com", "https://savagebridge.com"],
    ["https://www.SavageBridge.com", "https://savagebridge.com"],
    ["SavageBridge .com", "https://savagebridge.com"],
    ["savagebridge.com.", "https://savagebridge.com"],
    ["http://Example.com/Team", "http://example.com/Team"],
    ["instagram.com/lumenhealth", "https://instagram.com/lumenhealth"],
  ])("%s → %s", (given, stored) => {
    expect(normaliseWebsite(given)).toBe(stored);
  });

  it("still refuses words that are not a public host", () => {
    for (const said of [
      "instagram",
      "no website yet",
      "we don't have one",
      "https://intranet",
    ]) {
      expect(() => normaliseWebsite(said), said).toThrow();
    }
  });
});
