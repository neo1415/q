import { describe, expect, it } from "vitest";

import {
  citePublicSources,
  publicSourceBlockFields,
  withoutPublicSourceLabels,
  describePublicSource,
  presentPublicSource,
  type PublicSourceLike,
} from "../src/index.js";

/**
 * The one human-safe presentation of a public source (CQ-Q-VOICE-001 R3):
 * title, domain, a defensible date, the public link, a provenance phrase and
 * a spoken form — never a label, an id, a locator or a payload.
 */

const WIKI: PublicSourceLike = {
  index: 1,
  url: "https://en.wikipedia.org/wiki/Kobo360",
  domain: "en.wikipedia.org",
  title: "Kobo360 - Wikipedia",
  publishedAt: null,
  retrievedAt: "2026-09-14T13:21:52.968Z",
};
const UNTITLED: PublicSourceLike = {
  index: 2,
  url: "https://techcrunch.com/2019/08/kobo360-raises",
  domain: "techcrunch.com",
  title: null,
  publishedAt: "2019-08-14T00:00:00.000Z",
  retrievedAt: "2026-09-14T13:21:52.968Z",
};
const SOURCES: readonly PublicSourceLike[] = [WIKI, UNTITLED];

describe("presentPublicSource", () => {
  it("projects title, domain, a defensible date, the link, provenance and a spoken form", () => {
    expect(presentPublicSource(WIKI)).toEqual({
      index: 1,
      title: "Kobo360 - Wikipedia",
      domain: "en.wikipedia.org",
      publishedOn: null,
      retrievedOn: "2026-09-14",
      url: "https://en.wikipedia.org/wiki/Kobo360",
      dateLabel: "retrieved 2026-09-14",
      provenance: "Public web source · en.wikipedia.org · retrieved 2026-09-14",
      spoken: "Kobo360 - Wikipedia",
    });
    const untitled = presentPublicSource(UNTITLED);
    expect(untitled.title).toBe("techcrunch.com");
    expect(untitled.dateLabel).toBe("published 2019-08-14");
    expect(untitled.spoken).toBe("a page on techcrunch.com");
  });

  it("bounds a long title and never carries anything but public fields", () => {
    const long = presentPublicSource({
      ...WIKI,
      title: "x".repeat(400),
      publishedAt: "not a date",
    });
    expect(long.title.length).toBeLessThanOrEqual(121);
    expect(long.publishedOn).toBeNull();
    expect(Object.keys(long).sort()).toEqual(
      [
        "dateLabel",
        "domain",
        "index",
        "provenance",
        "publishedOn",
        "retrievedOn",
        "spoken",
        "title",
        "url",
      ].sort(),
    );
  });
});

describe("citePublicSources", () => {
  it("rewrites label references into title, domain, date and link", () => {
    const text =
      "Pitchbook (source S1) says $86m. Tracxn (S2) records $27m; S3 is silent. Source S1 again.";
    expect(citePublicSources(text, SOURCES)).toBe(
      `Pitchbook (${describePublicSource(WIKI)}) says $86m. Tracxn (${describePublicSource(UNTITLED)}) records $27m; S3 is silent. ${describePublicSource(WIKI)} again.`,
    );
  });

  it("leaves text alone when there are no sources, and leaves words that merely contain S-digits alone", () => {
    expect(citePublicSources("See source S1.", [])).toBe("See source S1.");
    expect(citePublicSources("The GS1 barcode and iOS1 build.", SOURCES)).toBe(
      "The GS1 barcode and iOS1 build.",
    );
  });
});

describe("withoutPublicSourceLabels (R23, R38)", () => {
  it("removes labels of sources this run read and leaves everything else", () => {
    expect(
      withoutPublicSourceLabels(
        "Pitchbook (source S1) says $86m. Tracxn S2, records $27m; S3 is silent.",
        SOURCES,
      ),
    ).toBe("Pitchbook says $86m. Tracxn, records $27m; S3 is silent.");
    expect(withoutPublicSourceLabels("See source S1.", [])).toBe(
      "See source S1.",
    );
    expect(
      withoutPublicSourceLabels("The GS1 barcode and iOS1 build.", SOURCES),
    ).toBe("The GS1 barcode and iOS1 build.");
  });

  it("projects a source into the block's public fields", () => {
    const fields = publicSourceBlockFields(UNTITLED);
    const p = presentPublicSource(UNTITLED);
    expect(fields).toEqual({
      url: p.url,
      domain: p.domain,
      title: p.title,
      publishedOn: p.publishedOn,
      retrievedOn: p.retrievedOn,
    });
  });
});

describe("provider dates that are not ISO (live 2026-10-10)", () => {
  const BLOCK_DAY = /^\d{4}-\d{2}-\d{2}$/;
  for (const publishedAt of [
    "Oct 3, 2026",
    "3 Oct 2026",
    "2 days ago",
    "yesterday",
    "2026-10-03T08:00:00+03:00",
    "",
  ]) {
    it(`"${publishedAt}" gives a contract-valid day or none`, () => {
      const fields = publicSourceBlockFields({ ...WIKI, publishedAt });
      if (fields.publishedOn !== null) {
        expect(fields.publishedOn).toMatch(BLOCK_DAY);
      }
      expect(fields.retrievedOn).toMatch(BLOCK_DAY);
    });
  }

  it("keeps a real date", () => {
    expect(
      publicSourceBlockFields({ ...WIKI, publishedAt: "Oct 3, 2026" })
        .publishedOn,
    ).toMatch(/^2026-10-0[23]$/);
  });
});
