import { describe, expect, it } from "vitest";

import { parseQResultBlocks } from "@capital-q/contracts";

import { dateInAddress, publicRecordTimeline } from "../src/q/result-blocks.js";

/**
 * Slice 2 (12 Nov): a company investigation lays out the dated public pages
 * it read as a timeline. Live: the Paystack answer named Hellopeter (7 Sep
 * 2026) and TechCabal (14 Nov 2025) by date in prose only.
 */
const now = new Date("2026-11-12T12:00:00Z");
const page = (
  url: string,
  publishedAt: string | null,
  title: string | null = `Page ${url}`,
) => ({
  url: `https://${url}`,
  domain: url.split("/")[0] ?? url,
  title,
  publishedAt,
});

describe("public record timeline", () => {
  it("orders matched, dated pages oldest first, each unverified", () => {
    const block = publicRecordTimeline({
      name: "Paystack",
      now,
      sources: [
        page(
          "hellopeter.com/paystack",
          "2026-09-07T08:30:00Z",
          "Paystack reviews",
        ),
        page(
          "techcabal.com/2025/11/14/x",
          "2025-11-14",
          "Paystack suspends co-founder",
        ),
      ],
      matched: () => true,
    });
    expect(block).toEqual({
      kind: "TIMELINE",
      title: "Public record: Paystack",
      events: [
        {
          at: "2025-11-14",
          label: "Paystack suspends co-founder",
          note: "Public web: techcabal.com · not verified",
          subject: null,
          url: "https://techcabal.com/2025/11/14/x",
        },
        {
          at: "2026-09-07",
          label: "Paystack reviews",
          note: "Date as the search listed it · Public web: hellopeter.com · not verified",
          subject: null,
          url: "https://hellopeter.com/paystack",
        },
      ],
    });
    // The contract accepts it as built.
    expect(parseQResultBlocks([block]).blocks).toHaveLength(1);
  });

  it("never places a namesake's page, an undated page or a future date", () => {
    const block = publicRecordTimeline({
      name: "Paystack",
      now,
      sources: [
        page("a.com/2026/01/1", "2026-01-01"),
        page("b.com/namesake", "2026-02-01"),
        page("c.com/undated", null),
        page("d.com/garbled", "sometime last year"),
        page("e.com/future", "2027-05-01"),
        page("f.com/2", "2026-03-01", null),
      ],
      matched: (url) => !url.includes("namesake"),
    });
    expect(block?.kind).toBe("TIMELINE");
    if (block?.kind !== "TIMELINE") return;
    expect(block.events.map((event) => [event.at, event.label])).toEqual([
      ["2026-01-01", "Page a.com/2026/01/1"],
      // No title: the site's name, never an invented headline.
      ["2026-03-01", "f.com"],
    ]);
  });

  it("one dated page is not a record over time", () => {
    expect(
      publicRecordTimeline({
        name: "Paystack",
        now,
        sources: [
          page("a.com/2026/01/1", "2026-01-01"),
          page("a.com/2026/01/1", "2026-01-01"),
        ],
        matched: () => true,
      }),
    ).toBeNull();
  });
});

/**
 * Owner, 12 Nov: a search provider's date states no meaning (not
 * publication, not last update). Only a date the page's own address
 * carries stands as the page's; any other is shown as the search listed it.
 */
describe("a page's date stands only where its address carries it", () => {
  it("reads the live Paystack pages as they are", () => {
    expect(
      dateInAddress(
        "https://techcabal.com/2025/11/14/paystack-suspends-ezra-olubi/",
        "2025-11-14",
      ),
    ).toBe(true);
    expect(
      dateInAddress("https://www.hellopeter.com/paystack", "2026-09-07"),
    ).toBe(false);
    expect(
      dateInAddress("https://www.linkedin.com/company/paystack", "2026-11-05"),
    ).toBe(false);
    expect(
      dateInAddress(
        "https://www.trustpilot.com/review/paystack.com",
        "2026-11-09",
      ),
    ).toBe(false);
  });

  it("the address must agree with the listed date", () => {
    expect(dateInAddress("https://a.com/2025/11/x", "2025-11-20")).toBe(true);
    expect(dateInAddress("https://a.com/2025-11-02-news", "2025-11-02")).toBe(
      true,
    );
    expect(dateInAddress("https://a.com/2025/11/14/x", "2025-11-15")).toBe(
      false,
    );
    expect(dateInAddress("https://a.com/2024/03/x", "2025-11-14")).toBe(false);
    expect(dateInAddress("https://a.com/item/2025", "2025-11-14")).toBe(false);
    expect(dateInAddress("not a url", "2025-11-14")).toBe(false);
  });

  it("says where a date came from, and shows no record of listed dates alone", () => {
    const listed = [
      page("www.linkedin.com/company/paystack", "2026-11-05", "LinkedIn"),
      page("www.trustpilot.com/review/paystack.com", "2026-11-09", "Reviews"),
    ];
    expect(
      publicRecordTimeline({
        name: "Paystack",
        now,
        sources: listed,
        matched: () => true,
      }),
    ).toBeNull();
    const block = publicRecordTimeline({
      name: "Paystack",
      now,
      sources: [
        page("techcabal.com/2025/11/14/x", "2025-11-14", "Suspension"),
        ...listed,
      ],
      matched: () => true,
    });
    if (block?.kind !== "TIMELINE") throw new Error("expected a timeline");
    expect(block.events.map((event) => event.note)).toEqual([
      "Public web: techcabal.com · not verified",
      "Date as the search listed it · Public web: www.linkedin.com · not verified",
      "Date as the search listed it · Public web: www.trustpilot.com · not verified",
    ]);
  });
});
