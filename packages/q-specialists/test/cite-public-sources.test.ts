import { describe, expect, it } from "vitest";

import type { PublicWebSource } from "../src/company/ports.js";
import { citePublicSources } from "../src/company/specialist.js";

/**
 * Source labels are Capital Q's, not a person's (CQ-Q-RESEARCH-001 §30): a
 * synthesis that says "(source S1)" is rewritten into the title, domain,
 * date and public link the label stands for, and nothing else changes.
 */

const SOURCES: readonly PublicWebSource[] = [
  {
    index: 1,
    url: "https://en.wikipedia.org/wiki/Kobo360",
    domain: "en.wikipedia.org",
    title: "Kobo360 - Wikipedia",
    publishedAt: null,
    retrievedAt: "2026-09-14T13:21:52.968Z",
    temporal: "UNDATED",
    excerpt: "…",
    isSubjectWebsite: false,
    mentionedCountries: ["NG", "KE"],
    instructionRiskSignals: 0,
    recordedAsEvidence: true,
  },
  {
    index: 2,
    url: "https://techcrunch.com/2019/08/kobo360-raises",
    domain: "techcrunch.com",
    title: null,
    publishedAt: "2019-08-14T00:00:00.000Z",
    retrievedAt: "2026-09-14T13:21:52.968Z",
    temporal: "OLD",
    excerpt: "…",
    isSubjectWebsite: false,
    mentionedCountries: [],
    instructionRiskSignals: 0,
    recordedAsEvidence: true,
  },
];

describe("citePublicSources", () => {
  it("rewrites label references into title, domain, date and link", () => {
    const text =
      "Pitchbook (source S1) says $86m. Tracxn (S2) records $27m; S3 is silent. Source S1 again.";
    expect(citePublicSources(text, SOURCES)).toBe(
      "Pitchbook (Kobo360 - Wikipedia (en.wikipedia.org, retrieved 2026-09-14, https://en.wikipedia.org/wiki/Kobo360)) says $86m. Tracxn (techcrunch.com (techcrunch.com, published 2019-08-14, https://techcrunch.com/2019/08/kobo360-raises)) records $27m; S3 is silent. Kobo360 - Wikipedia (en.wikipedia.org, retrieved 2026-09-14, https://en.wikipedia.org/wiki/Kobo360) again.",
    );
  });

  it("leaves text alone when there are no sources, and leaves words that merely contain S-digits alone", () => {
    expect(citePublicSources("See source S1.", [])).toBe("See source S1.");
    expect(citePublicSources("The GS1 barcode and iOS1 build.", SOURCES)).toBe(
      "The GS1 barcode and iOS1 build.",
    );
  });
});
