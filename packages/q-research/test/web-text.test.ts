import { describe, expect, it } from "vitest";

import { htmlToText } from "../src/providers/scrapingbee.js";
import { createSerperResearchProvider } from "../src/providers/serper.js";
import { webText } from "../src/providers/web-text.js";

/** Live 2026-10-30: report sources read "CBN&#39;s", "Nigeria&#8217;s". */
describe("web text: HTML character references decoded once where they enter", () => {
  it("decodes named, decimal and hex references", () => {
    expect(
      webText(
        "CBN&#39;s New Payments Circular: What Banks &amp; Fintechs Must Do",
      ),
    ).toBe("CBN's New Payments Circular: What Banks & Fintechs Must Do");
    expect(webText("The Central Bank of Nigeria&#8217;s new system")).toBe(
      "The Central Bank of Nigeria’s new system",
    );
    expect(webText("Paystack&#x27;s &quot;Terminal&quot; &mdash; 2026")).toBe(
      'Paystack\'s "Terminal" — 2026',
    );
    expect(webText("Banks &#039;and&#039; fintechs")).toBe(
      "Banks 'and' fintechs",
    );
  });

  it("decodes once: an escaped reference stays a reference", () => {
    expect(webText("&amp;#39; and &amp;amp;")).toBe("&#39; and &amp;");
  });

  it("leaves what is not a valid reference as written", () => {
    expect(webText("AT&T & co; &unknownname; &#0; &#xD800; &#1114112;")).toBe(
      "AT&T & co; &unknownname; &#0; &#xD800; &#1114112;",
    );
    expect(webText("no references")).toBe("no references");
  });

  it("serper's titles and snippets reach Capital Q decoded", async () => {
    const provider = createSerperResearchProvider({
      apiKey: "k".repeat(40),
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              organic: [
                {
                  link: "https://example.com/cbn-circular",
                  title: "CBN&#39;s New Payments Circular &amp; You",
                  snippet: "Nigeria&#8217;s banks &amp; fintechs",
                  position: 1,
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    });
    const result = await provider.search(
      {
        query: "cbn payments circular",
        maxResults: 3,
        freshness: "ANY",
        includeDomains: [],
      },
      {},
    );
    expect(result.hits[0]?.title).toBe("CBN's New Payments Circular & You");
    expect(result.hits[0]?.snippet).toBe("Nigeria’s banks & fintechs");
  });

  it("a read page's title and text are decoded too", () => {
    const page = htmlToText(
      "<title>Banks &amp; Fintechs</title><p>Nigeria&#8217;s &lt;rules&gt;</p>",
    );
    expect(page.title).toBe("Banks & Fintechs");
    expect(page.text).toContain("Nigeria’s <rules>");
  });
});
