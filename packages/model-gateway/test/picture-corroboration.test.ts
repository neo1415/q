import { describe, expect, it } from "vitest";

import {
  corroboratedPictures,
  looksLikeOwnSite,
  pageAboutThem,
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

  it("Duplo held by Capital Q in Lagos: LEGO's pages name Duplo but do not place it there, so LEGO's picture is not theirs", () => {
    const kept = corroboratedPictures(
      [
        picture("www.lego.com", "LEGO DUPLO Peppa Pig Bike Ride"),
        picture("techcabal.com", "Duplo raises seed round"),
      ],
      {
        name: "Duplo",
        held: { country: "NG", city: "Lagos" },
        sources: [
          { domain: "www.lego.com", subjectMatch: "MATCH", countries: ["DK"] },
          {
            domain: "techcabal.com",
            subjectMatch: "MATCH",
            countries: [],
            text: "Lagos-based Duplo, a B2B payments startup, raised a seed round.",
          },
        ],
      },
    );
    expect(kept.map((one) => one.domain)).toEqual(["techcabal.com"]);
  });

  it("no evidence, no picture -- a name alone is none, even when no search ran", () => {
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

/**
 * Live 2026-10-24 (investor.savanna-seed, "Who founded Duplo?"): the
 * answer's Sources held LEGO DUPLO on Wikipedia, a chocolate bar and
 * "Diplo Run Club" beside Duplo's own site and a page naming its founders.
 * Pages about them pass -- their own site, press that says what they do --
 * and namesakes do not, though they never say "Lagos".
 */
describe("which pages are about a company Capital Q holds", () => {
  const DUPLO = {
    country: "NG",
    city: "Lagos",
    about: "B2B payments and invoicing for African businesses.",
  };
  const page = (
    domain: string,
    title: string,
    text: string,
    subjectMatch: string | null = null,
  ) => ({ domain, title, text, subjectMatch, countries: [] });

  it.each([
    [
      "Duplo's own site",
      page(
        "tryduplo.com",
        "About us | Duplo",
        "Duplo helps businesses collect payments and send invoices.",
      ),
      true,
    ],
    [
      "press naming its founders",
      page(
        "startupintros.com",
        "Duplo - Founders",
        "Duplo, a fintech for B2B payments, was founded by Yele Oyekola and Tunde Akinnuwa.",
      ),
      true,
    ],
    [
      "LEGO DUPLO on Wikipedia",
      page(
        "en.wikipedia.org",
        "Lego Duplo - Wikipedia",
        "Lego Duplo is a product line of construction toys: large bricks for toddlers.",
        "MATCH",
      ),
      false,
    ],
    [
      "a chocolate bar",
      page(
        "www.eatbetter.app",
        "Duplo chocolate bar",
        "Duplo is a chocolate bar made by Ferrero, wafer and hazelnut.",
      ),
      false,
    ],
    [
      "a page that never names them",
      page(
        "wwd.com",
        "Diplo Run Club",
        "Diplo's run club and children's footwear.",
      ),
      false,
    ],
  ])("%s", (_case, source, about) => {
    expect(pageAboutThem(source, "Duplo", DUPLO)).toBe(about);
  });

  it("their own website on record is always theirs; a namesake's own site never", () => {
    const held = { ...DUPLO, website: "https://tryduplo.com" };
    expect(
      pageAboutThem(page("tryduplo.com", "Home", "Welcome."), "Duplo", held),
    ).toBe(true);
    expect(
      pageAboutThem(
        page("duplo-usa.com", "Duplo USA", "Duplo payments"),
        "Duplo",
        held,
      ),
    ).toBe(false);
  });
});
