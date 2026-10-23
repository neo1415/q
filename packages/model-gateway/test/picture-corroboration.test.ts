import { describe, expect, it } from "vitest";

import {
  corroboratedPictures,
  looksLikeOwnSite,
  registrableDomain,
} from "../src/q/picture-corroboration.js";

/**
 * QA QO-09 (owner's QA, 2026-10-23 ~21:55 UTC): a Duplo answer showed a
 * LEGO DUPLO Peppa Pig listing (ebay.com) and a Spheros answer a bus
 * air-conditioning maker's "Direct Drives" (spheros-transfrig.com), while
 * the answer said those pages were about someone else. A picture is shown
 * only where evidence ties its site to them.
 */

const picture = (domain: string, title: string, path = "/p") => ({
  imageUrl: `https://${domain}/img.jpg`,
  pageUrl: `https://${domain}${path}`,
  domain,
  title,
});

describe("pictures only where evidence ties the site to them", () => {
  it("Duplo: a LEGO DUPLO listing on eBay is not theirs; their own site is", () => {
    const kept = corroboratedPictures(
      [
        picture("www.ebay.com", "LEGO DUPLO Peppa Pig Bike Ride 10964"),
        picture("duplo.africa", "Duplo team"),
      ],
      {
        name: "Duplo",
        website: "https://duplo.africa",
        // The search matched pages that name "Duplo" -- LEGO's among them.
        sources: [
          { domain: "www.lego.com", subjectMatch: "MATCH" },
          { domain: "techcabal.com", subjectMatch: "MATCH" },
        ],
      },
    );
    expect(kept.map((one) => one.domain)).toEqual(["duplo.africa"]);
  });

  it("Duplo with no website on record: eBay, never matched by the search, is still not shown", () => {
    const kept = corroboratedPictures(
      [picture("www.ebay.com", "LEGO DUPLO Peppa Pig Bike Ride 10964")],
      {
        name: "Duplo",
        sources: [{ domain: "techcabal.com", subjectMatch: "MATCH" }],
      },
    );
    expect(kept).toEqual([]);
  });

  it("Spheros: a namesake's own site is never theirs, even when the search matched its pages by name", () => {
    const kept = corroboratedPictures(
      [
        picture("www.spheros-transfrig.com", "Direct Drives"),
        picture("techcabal.com", "Spheros raises seed"),
      ],
      {
        name: "Spheros",
        website: "spheros.io",
        sources: [
          { domain: "www.spheros-transfrig.com", subjectMatch: "MATCH" },
          { domain: "techcabal.com", subjectMatch: "MATCH" },
        ],
      },
    );
    expect(kept.map((one) => one.domain)).toEqual(["techcabal.com"]);
  });

  it("no evidence, no picture", () => {
    expect(
      corroboratedPictures([picture("www.reddit.com", "Duplo thread")], {
        name: "Duplo",
        sources: [],
      }),
    ).toEqual([]);
  });

  it("pages that only may be them: shown, said to be uncertain", () => {
    const kept = corroboratedPictures(
      [picture("news.example.com", "Zino Aviation opens in Accra")],
      {
        name: "Zino Aviation",
        sources: [{ domain: "news.example.com", subjectMatch: "POSSIBLE" }],
      },
    );
    expect(kept[0]?.title).toBe(
      "Not sure this is them · Zino Aviation opens in Accra",
    );
  });

  it("a person's pictures from the own site of the organisation they were placed at", () => {
    const kept = corroboratedPictures(
      [picture("jet.zinoaviation.com", "Zino Aviation cabin crew")],
      {
        name: "Zino Mario",
        sources: [],
        organisations: ["Zino Aviation"],
      },
    );
    expect(kept).toHaveLength(1);
  });

  it("a person's picture from a page naming the organisation they were placed at beside them", () => {
    const kept = corroboratedPictures(
      [
        picture(
          "nairametrics.com",
          "Interview: Captain Zino Mario on Zino Aviation",
        ),
        picture("www.artstation.com", "Captain Zino Mario fan art"),
      ],
      { name: "Zino Mario", sources: [], organisations: ["Zino Aviation"] },
    );
    expect(kept.map((one) => one.domain)).toEqual(["nairametrics.com"]);
  });

  it("one site across its subdomains; a name in a domain", () => {
    expect(registrableDomain("academy.zinoaviation.com")).toBe(
      "zinoaviation.com",
    );
    expect(registrableDomain("www.thisdaylive.co.uk")).toBe(
      "thisdaylive.co.uk",
    );
    expect(looksLikeOwnSite("www.spheros-transfrig.com", "Spheros")).toBe(true);
    expect(looksLikeOwnSite("techcabal.com", "Spheros")).toBe(false);
  });
});
