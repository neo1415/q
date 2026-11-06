import { describe, expect, it } from "vitest";

import { WEB_BESIDE_RECORDS_NOTE } from "../src/q/index.js";

/**
 * Production 2026-11-06: "In Capital Q, Adaeze previously…". The note
 * for an answer written from the public web beside Capital Q's records
 * told the model to give the records first as ("In Capital Q: …"), and
 * the model wrote that label to the person. The records still come
 * first, in plain words; the note gives no label to say.
 */
describe("the web-beside-records note", () => {
  it("puts the records first without a label to repeat", () => {
    const note = WEB_BESIDE_RECORDS_NOTE.content;
    expect(note).not.toMatch(/In Capital Q/u);
    expect(note).toContain("give what their records hold first");
    expect(note).toContain("in plain words, with no label before them");
    // Kept: public sources attributed by site and date, never verified.
    expect(note).toContain("naming the site and date for each public fact");
    expect(note).toContain("never present a public source as verified");
  });
});
