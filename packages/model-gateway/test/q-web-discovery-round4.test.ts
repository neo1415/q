import { describe, expect, it } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";

import * as discovery from "../src/q/web-discovery.js";
import type { WebDiscoveryReader } from "../src/q/web-discovery-reader.js";

/**
 * Live 2026-11-06 on 309143f51 (fictional investor), round 4:
 * 1. "African startups · raised in 2026" was listed: a directory site.
 * 2. "can you find more online? that maybe not exist in capital Q yet"
 *    re-listed Aella, M Kopa, Numida, Kopo Kopo and Zedvance.
 * 3. Founders on 1 of 8 on the repeat (6 of 8 the first time).
 * 4. M-Kopa (2011) and Kopo Kopo (2012) listed for "new"; 7 of 8 "stage
 *    unknown" though the pages said "seed" or "Series A".
 * 5. (natural-conversation-eval.test.ts) the follow-up repeated the top-3
 *    cards, the top-3 line and a tie line.
 */

const { runWebDiscovery } = discovery;
const NOW = Date.parse("2026-11-06T14:40:00Z");

type Page = {
  readonly url: string;
  readonly title: string;
  readonly text: string;
};

const DIRECTORY: Page = {
  url: "https://african-startups.example/fintech-2026",
  title: "African startups: fintech to watch in 2026",
  text: "African startups lists fintech to watch in 2026: Aella, a lending app founded in 2016; Owo Rails, a pre-seed payments API founded in 2025 by Bisi Adewale; Kobo Harbour, which raised a seed round in 2026; and M-Kopa, founded in 2011.",
};
const TOP10: Page = {
  url: "https://news.example/top-10-fintech",
  title: "Top 10 fintech startups in Kenya",
  text: "Top 10 fintech startups in Kenya: Numida raised a Series A in 2025. Pesaflow was founded in 2024 by Wanjiru Kamau and raised a seed round.",
};
const FOUNDER_PAGES: Readonly<Record<string, Page>> = {
  "Kobo Harbour": {
    url: "https://koboharbour.example/about",
    title: "About Kobo Harbour",
    text: "Kobo Harbour was founded in 2024 by Emeka Obi and Sade Lawal in Ibadan.",
  },
  Numida: {
    url: "https://press.example/numida",
    title: "Numida",
    text: "Numida was founded in 2022 by Mina Shahid and Catherine Lahner.",
  },
};

const ok = (proposal: QToolProposal, data: unknown): QToolCallOutcome => ({
  callId: proposal.callId,
  toolName: "public_web.search",
  toolVersion: 1,
  classification: "READ_ONLY",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "PUBLIC",
  result: { ok: true, data },
  latencyMs: 1,
});

function web() {
  const queries: string[] = [];
  const port: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: (proposal) => {
      if (proposal.name === "search_companies") {
        return Promise.resolve(ok(proposal, { items: [] }));
      }
      const args = proposal.arguments as Record<string, unknown>;
      queries.push(
        String(args["query"]),
        ...((args["alsoSearch"] as string[] | undefined) ?? []),
      );
      const names = (args["pageNames"] as string[] | undefined) ?? [];
      const pages =
        names.length === 0
          ? [DIRECTORY, TOP10]
          : names.flatMap((name) => {
              const page = FOUNDER_PAGES[name];
              return page === undefined ? [] : [page];
            });
      return Promise.resolve(
        ok(proposal, {
          status: "OK",
          sources: pages.map((page, i) => ({
            index: i + 1,
            url: page.url,
            domain: new URL(page.url).hostname,
            title: page.title,
            publishedAt: null,
            retrievedAt: "2026-11-06T14:40:00Z",
            excerpt: page.text,
            extracted: true,
            instructionRiskSignals: 0,
          })),
        }),
      );
    },
  };
  return { port, queries };
}

/** The reader names everything a page names, the directory included. */
const reader: WebDiscoveryReader = (input) =>
  Promise.resolve(
    input.looking.startsWith("the founders of")
      ? null
      : [
          "African startups",
          "Top 10 fintech startups",
          "Aella",
          "Owo Rails",
          "Kobo Harbour",
          "M-Kopa",
          "Numida",
          "Pesaflow",
        ].map((name) => ({
          name,
          founders: [],
          does: null,
          sector: null,
          stage: null,
          place: null,
          sourceRefs: [0],
          quote: name,
        })),
  );

async function discover(
  alreadyListed: readonly { name: string; founders: readonly string[] }[] = [],
) {
  const scripted = web();
  const answer = await runWebDiscovery({
    ask: {
      text: "find me new companies online",
      sectors: ["fintech"],
      countries: ["KE"],
      stages: [],
      count: null,
    },
    mandate: null,
    tools: scripted.port,
    context: {} as QToolExecutionContext,
    available: new Set(["research_public_web", "search_companies"]),
    reader,
    attribution: { tenantId: "t", userId: "u", correlationId: "c" },
    now: () => NOW,
    alreadyListed,
  });
  if (answer === null) throw new Error("no answer");
  return { answer, queries: scripted.queries };
}

const names = (answer: { companies: readonly { name: string }[] }) =>
  answer.companies.map((company) => company.name);

describe("round 4 · 1: a directory, a list or a media site is never a company", () => {
  it("leaves out a name that is a listing site's own name or a generic plural", async () => {
    const { answer } = await discover();
    expect(names(answer)).not.toContain("African startups");
    expect(names(answer)).not.toContain("Top 10 fintech startups");
    expect(answer.text).not.toContain("African startups**");
    // A company on its own site is still a company.
    expect(names(answer)).toContain("Kobo Harbour");
  });
});

describe("round 4 · 2-3: 'more' is new companies only, founders kept", () => {
  it("leaves out every company already listed in the conversation and says how many are new", async () => {
    const { answer, queries } = await discover([
      { name: "Aella", founders: [] },
      { name: "M Kopa", founders: [] },
      { name: "Numida", founders: ["Mina Shahid", "Catherine Lahner"] },
    ]);
    expect(names(answer)).not.toContain("Aella");
    expect(names(answer)).not.toContain("M-Kopa");
    expect(names(answer)).not.toContain("Numida");
    expect(names(answer)).toEqual(
      expect.arrayContaining(["Owo Rails", "Kobo Harbour", "Pesaflow"]),
    );
    expect(answer.text).toMatch(/\b3 new companies\b/u);
    expect(answer.text).toMatch(/leaving out the 3 I listed earlier/u);
    // It searched further: queries a first search did not send.
    const first = await discover();
    expect(queries.some((query) => !first.queries.includes(query))).toBe(true);
    // Founders on at least half of what is new.
    const withFounders = answer.companies.filter((c) => c.founders.length > 0);
    expect(
      withFounders.length / answer.companies.length,
    ).toBeGreaterThanOrEqual(0.5);
  });

  it("says honestly when nothing new was found", async () => {
    const { answer } = await discover(
      [
        "Aella",
        "Owo Rails",
        "Kobo Harbour",
        "M-Kopa",
        "Numida",
        "Pesaflow",
      ].map((name) => ({ name, founders: [] })),
    );
    expect(answer.companies).toEqual([]);
    expect(answer.text).toMatch(/only named companies I've already listed/u);
  });

  it("reads the companies and founders Q listed earlier from its own replies", () => {
    expect(
      discovery.priorListings([
        "I searched the public web and found 2 companies.\n\n1. **Numida** · founded 2022 — Founders: Mina Shahid and Catherine Lahner. Fit: fintech. Source: [a](https://a.example).\n2. **Kopo Kopo** — founders not named in the sources I read. Source: [b](https://b.example).",
        "Your mandate is fintech.",
      ]),
    ).toEqual([
      { name: "Numida", founders: ["Mina Shahid", "Catherine Lahner"] },
      { name: "Kopo Kopo", founders: [] },
    ]);
  });
});

describe("round 4 · 4: new means new; stage from the page", () => {
  it("leaves out companies a source says are over 8 years old, and says so", async () => {
    const { answer } = await discover();
    expect(names(answer)).not.toContain("M-Kopa");
    expect(names(answer)).not.toContain("Aella");
    expect(answer.text).toMatch(
      /left out 2 that the sources say were founded more than 8 years ago/u,
    );
  });

  it("fills the stage a sentence naming the company states", async () => {
    const { answer } = await discover();
    const stage = (name: string) =>
      answer.companies.find((company) => company.name === name)?.stage ?? null;
    expect(stage("Kobo Harbour")).toBe("seed");
    expect(stage("Owo Rails")).toBe("pre-seed");
    expect(stage("Numida")).toBe("Series A");
  });
});
