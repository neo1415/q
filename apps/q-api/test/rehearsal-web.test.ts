import { describe, expect, it } from "vitest";

import type { PublicWebResearchProvider } from "@capital-q/q-research";

import {
  REHEARSAL_WEB_TEXT_MAX,
  rehearsalWeb,
} from "../src/composition/rehearsal-web.js";

/**
 * R1 (owner 2026-10-23): what is written about the counterpart, from three
 * searches and the most telling pages read in full. Fake provider: no
 * network, no provider spend.
 */
function provider(options: {
  readonly hits: Readonly<
    Record<string, readonly { url: string; title: string; snippet: string }[]>
  >;
  readonly extractFails?: boolean;
}) {
  const queries: string[] = [];
  const read: string[][] = [];
  const fake: PublicWebResearchProvider = {
    code: "tavily",
    search: (request) => {
      queries.push(request.query);
      const key =
        Object.keys(options.hits).find((part) =>
          request.query.includes(part),
        ) ?? "";
      return Promise.resolve({
        hits: (options.hits[key] ?? []).map((hit) => ({
          ...hit,
          publishedAt: null,
          score: null,
        })),
        latencyMs: 1,
      } as never);
    },
    extract: (request) => {
      read.push([...request.urls]);
      if (options.extractFails === true) return Promise.reject(new Error("x"));
      return Promise.resolve({
        pages: request.urls.map((url) => ({
          url,
          title: null,
          text: `Full page of ${url}. ${"We back founders who know their market. ".repeat(80)}`,
        })),
        failedUrls: [],
        latencyMs: 1,
      });
    },
  };
  return { fake, queries, read };
}

const HITS = {
  '" investor': [
    { url: "https://a.example/profile", title: "Profile", snippet: "Partner." },
    {
      url: "https://b.example/news",
      title: "Raises fund",
      snippet: "New fund.",
    },
  ],
  "interview OR podcast": [
    {
      url: "https://c.example/podcast-42",
      title: "Podcast: patient capital",
      snippet: "On patience.",
    },
    { url: "https://a.example/profile", title: "Profile", snippet: "Partner." },
  ],
  "thesis OR blog": [
    {
      url: "https://d.example/blog/why-we-invest",
      title: "Why we invest",
      snippet: "Our thesis.",
    },
    { url: "http://insecure.example/x", title: "Old", snippet: "No TLS." },
  ],
};

describe("what is written about the counterpart (R1)", () => {
  it("searches three ways, merges, and reads the telling pages first", async () => {
    const { fake, queries, read } = provider({ hits: HITS });
    const web = await rehearsalWeb(
      fake,
      "Al Nakheel Capital",
      "INVESTOR_ORGANISATION",
    );
    expect(queries).toHaveLength(3);
    expect(queries.every((q) => q.startsWith('"Al Nakheel Capital"'))).toBe(
      true,
    );
    // One entry per URL, https only.
    expect(web.sources.map((s) => s.url)).toEqual([
      "https://a.example/profile",
      "https://b.example/news",
      "https://c.example/podcast-42",
      "https://d.example/blog/why-we-invest",
    ]);
    // The podcast and the blog are read before the plain profile.
    expect(read[0]?.slice(0, 2)).toEqual([
      "https://c.example/podcast-42",
      "https://d.example/blog/why-we-invest",
    ]);
    // Pages read in full lead the text; the rest keep their snippets.
    expect(web.text.startsWith("Podcast: patient capital (read in full,")).toBe(
      true,
    );
    expect(web.text).toContain("Raises fund: New fund.");
    expect(web.text.length).toBeLessThanOrEqual(REHEARSAL_WEB_TEXT_MAX);
  });

  it("keeps the snippets when the pages cannot be read", async () => {
    const { fake } = provider({ hits: HITS, extractFails: true });
    const web = await rehearsalWeb(
      fake,
      "Al Nakheel Capital",
      "INVESTOR_ORGANISATION",
    );
    expect(web.text).toContain("Podcast: patient capital: On patience.");
    expect(web.text).not.toContain("read in full");
  });

  it("is empty without a provider or without results: unknown stays unknown", async () => {
    expect(await rehearsalWeb(undefined, "X", "COMPANY")).toEqual({
      text: "",
      sources: [],
    });
    const { fake } = provider({ hits: {} });
    expect(await rehearsalWeb(fake, "Nobody Known", "COMPANY")).toEqual({
      text: "",
      sources: [],
    });
  });
});
