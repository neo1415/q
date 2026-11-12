import { describe, expect, it } from "vitest";

import { parseQResultBlocks } from "@capital-q/contracts";

import { publicRecordTimeline } from "../src/q/result-blocks.js";

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
          note: "Public web: hellopeter.com · not verified",
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
        page("a.com/1", "2026-01-01"),
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
      ["2026-01-01", "Page a.com/1"],
      // No title: the site's name, never an invented headline.
      ["2026-03-01", "f.com"],
    ]);
  });

  it("one dated page is not a record over time", () => {
    expect(
      publicRecordTimeline({
        name: "Paystack",
        now,
        sources: [page("a.com/1", "2026-01-01"), page("a.com/1", "2026-01-01")],
        matched: () => true,
      }),
    ).toBeNull();
  });
});
