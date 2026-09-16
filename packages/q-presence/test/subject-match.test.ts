import { describe, expect, it } from "vitest";

import {
  distinctiveTerms,
  domainLabel,
  pageNamesSubject,
} from "../src/domain/subject-match.js";

/**
 * The case this exists for, from a real read: searching "The Vaultlyne"
 * returned an apartment building called The Vault in Lynn, Massachusetts,
 * and a model asked what the pages said reported, accurately, what a
 * stranger's pages said. None of those pages contains "vaultlyne", so none
 * of them should ever have reached the model.
 */

const VAULTLYNE = {
  name: "The Vaultlyne",
  websiteUrl: "https://thevaultlyne.com",
};

function page(url: string, title: string | null, excerpt: string) {
  return { url, title, excerpt };
}

describe("what makes a subject findable", () => {
  it("keeps the words that are theirs and drops the words that are everybody's", () => {
    expect([...distinctiveTerms(VAULTLYNE)].sort()).toEqual([
      "thevaultlyne",
      "vaultlyne",
    ]);
    expect(
      distinctiveTerms({ name: "Apex Ventures", websiteUrl: null }),
    ).toEqual(["apex"]);
    expect(
      distinctiveTerms({
        name: "Northstar Technologies Limited",
        websiteUrl: null,
      }),
    ).toEqual(["northstar"]);
    // Nothing distinctive at all: a read on this cannot be trusted.
    expect(
      distinctiveTerms({ name: "The Company Group", websiteUrl: null }),
    ).toEqual([]);
  });

  it("reads the label out of a website, however it was written", () => {
    expect(domainLabel("https://www.thevaultlyne.com/about")).toBe(
      "thevaultlyne",
    );
    expect(domainLabel("paystack.com")).toBe("paystack");
    expect(domainLabel("https://a.co")).toBeNull();
    expect(domainLabel(null)).toBeNull();
    expect(domainLabel("not a url at all")).toBeNull();
  });
});

describe("whether a page is about the subject", () => {
  const terms = distinctiveTerms(VAULTLYNE);

  it("rejects every page a real search returned about a namesake", () => {
    const strangers = [
      page(
        "https://www.zillow.com/apartments/lynn-ma/the-vault/CkBcgq",
        "The Vault Apartments",
        "Compelling rental values for Boston commuters: studios, one and two bedrooms.",
      ),
      page(
        "https://en.wiktionary.org/wiki/the",
        "the - Wiktionary",
        "Definite article. Used before a noun phrase.",
      ),
      page(
        "https://creativecollectivema.com/venue/the-neal-rantoul-vault-theatre",
        "The Neal Rantoul Vault Theatre",
        "An event space at 25 Exchange Street, Lynn.",
      ),
    ];
    for (const stranger of strangers) {
      expect(pageNamesSubject(terms, stranger), stranger.url).toBe(false);
    }
  });

  it("accepts a page that names them in the url, the title or the text", () => {
    expect(
      pageNamesSubject(terms, page("https://thevaultlyne.com/", null, "")),
    ).toBe(true);
    expect(
      pageNamesSubject(
        terms,
        page("https://news.example/story", "Vaultlyne raises a seed round", ""),
      ),
    ).toBe(true);
    expect(
      pageNamesSubject(
        terms,
        page(
          "https://news.example/story",
          "A Lagos insurtech",
          "The company, Vaultlyne, connects legacy systems.",
        ),
      ),
    ).toBe(true);
  });

  it("is not fooled by a shorter word inside a longer one, or by spacing", () => {
    // "vault" alone is not one of the terms, so The Vault stays out.
    expect(
      pageNamesSubject(terms, page("https://x.example/vault", "The Vault", "")),
    ).toBe(false);
    // A name split across markup still matches: the haystack is squeezed.
    expect(
      pageNamesSubject(
        terms,
        page("https://x.example/a", "Vault lyne", "the vault lyne story"),
      ),
    ).toBe(true);
  });

  it("keeps nothing when there is nothing distinctive to recognise", () => {
    expect(
      pageNamesSubject([], page("https://x.example/a", "Anything", "Anything")),
    ).toBe(false);
  });

  it("recognises a well-known subject in every page a real search returned", () => {
    const paystack = distinctiveTerms({
      name: "Paystack",
      websiteUrl: "https://paystack.com",
    });
    for (const url of [
      "https://en.wikipedia.org/wiki/Paystack",
      "https://paystack.com/",
      "https://www.linkedin.com/company/paystack",
      "https://play.google.com/store/apps/details?id=com.paystack.go",
    ]) {
      expect(pageNamesSubject(paystack, page(url, null, "")), url).toBe(true);
    }
  });
});
