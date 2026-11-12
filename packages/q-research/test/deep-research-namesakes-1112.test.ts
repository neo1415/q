import { describe, expect, it } from "vitest";

import { namesakePage } from "../src/application/deep-research.js";

/**
 * Live 12 Nov (job 0cc22b2f): an investment analysis of Ledgerline (a
 * Nigerian VAT-compliance company) cited "GitHub - Syed-99/ledgerline:
 * Subscription billing…" and "Ledgerline Software (McKinsey) | PrepLounge"
 * as its sources. Pages that are evidently another organisation of the
 * subject's name are not kept; the market's pages are untouched.
 */
const LEDGERLINE = { name: "Ledgerline", country: "NG" };
const page = (
  url: string,
  title: string,
  excerpt: string,
  mentionedCountries: string[] = [],
) => ({ url, title, excerpt, mentionedCountries });

describe("namesakes of a named company", () => {
  it("drops someone else's repository and a page that places the name elsewhere", () => {
    expect(
      namesakePage(
        page(
          "https://github.com/Syed-99/ledgerline",
          "GitHub - Syed-99/ledgerline: Subscription billing and payments engine",
          "ledgerline is a subscription billing engine",
        ),
        LEDGERLINE,
      ),
    ).toBe(true);
    expect(
      namesakePage(
        page(
          "https://www.preplounge.com/en/management-consulting-cases/ledgerline-software-mckinsey-445",
          "Ledgerline Software (McKinsey) | PrepLounge.com",
          "Ledgerline Software is a provider of accounting software for small businesses in the United States.",
          ["US"],
        ),
        LEDGERLINE,
      ),
    ).toBe(true);
  });

  it("keeps the market's pages, pages placing it at home, and its own repository", () => {
    expect(
      namesakePage(
        page(
          "https://www.xtransfer.com/blog/africa-b2b-payment-solutions",
          "What Is the Best B2B Cross-Border Payment Solution for Africa in 2026?",
          "B2B payments across Nigeria and Kenya…",
          ["NG", "KE"],
        ),
        LEDGERLINE,
      ),
    ).toBe(false);
    expect(
      namesakePage(
        page(
          "https://techcabal.com/2026/01/02/ledgerline-raise",
          "Ledgerline raises seed round",
          "Lagos-based Ledgerline, a VAT compliance startup in Nigeria…",
          ["NG"],
        ),
        LEDGERLINE,
      ),
    ).toBe(false);
    expect(
      namesakePage(
        page(
          "https://github.com/paystack/paystack-ios",
          "GitHub - paystack/paystack-ios",
          "Paystack iOS SDK",
        ),
        { name: "Paystack", country: "NG" },
      ),
    ).toBe(false);
    expect(
      namesakePage(
        page(
          "https://github.com/ledgerline/ledgerline",
          "GitHub - ledgerline/ledgerline",
          "Ledgerline's open SDK",
        ),
        LEDGERLINE,
      ),
    ).toBe(false);
  });

  it("a page in several countries including theirs stays; no country known stays", () => {
    expect(
      namesakePage(
        page(
          "https://a.com/x",
          "Ledgerline expands",
          "Ledgerline in Nigeria and Ghana",
          ["NG", "GH"],
        ),
        LEDGERLINE,
      ),
    ).toBe(false);
    expect(
      namesakePage(
        page("https://a.com/y", "Ledgerline", "Ledgerline launches", ["US"]),
        { name: "Ledgerline", country: null },
      ),
    ).toBe(false);
  });
});
