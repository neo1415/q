import { describe, expect, it } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";

import { runWebDiscovery } from "../src/q/web-discovery.js";
import type { WebDiscoveryReader } from "../src/q/web-discovery-reader.js";

/**
 * Live 2026-11-06 on f580935bb: "find me new companies online that i
 * would be interested in" listed one company (valU); round 3 listed 8.
 * Round 4's filters (listing names, over 8 years old) dropped most of what
 * round one found, and nothing topped the list back up.
 *
 * Scripted: round one's pages name a directory, three old companies and
 * one new one; a top-up search (an accelerator cohort, a country list)
 * names five more new ones.
 */

const NOW = Date.parse("2026-11-06T17:40:00Z");

type Page = {
  readonly url: string;
  readonly title: string;
  readonly text: string;
};

const ROUND_ONE: Page = {
  url: "https://african-startups.example/fintech",
  title: "African startups: fintech",
  text: "African startups covers fintech. M-Kopa was founded in 2011. Jumo was founded in 2014. Kopo Kopo was founded in 2012. valU was founded in 2023 by Walid Hassouna.",
};
const TOP_UP: Page = {
  url: "https://accelerator.example/cohort-2026",
  title: "Fintech accelerator cohort 2026",
  text: "The 2026 fintech cohort: Owo Rails was founded in 2025 by Bisi Adewale. Kobo Harbour was founded in 2024 by Emeka Obi. Pesaflow was founded in 2024 by Wanjiru Kamau. Ledgerline was founded in 2025 by Amara Osei. Tamu Pay was founded in 2023 by Halima Said.",
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
  let research = 0;
  const port: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: (proposal) => {
      if (proposal.name === "search_companies") {
        return Promise.resolve(ok(proposal, { items: [] }));
      }
      research += 1;
      const args = proposal.arguments as Record<string, unknown>;
      const asked = [
        String(args["query"]),
        ...((args["alsoSearch"] as string[] | undefined) ?? []),
      ];
      queries.push(...asked);
      const topUp = asked.some((q) => /\bcohort\b|^top\b/u.test(q));
      const page =
        ((args["pageNames"] as string[] | undefined)?.length ?? 0)
          ? null
          : topUp
            ? TOP_UP
            : ROUND_ONE;
      return Promise.resolve(
        ok(proposal, {
          status: "OK",
          sources:
            page === null
              ? []
              : [
                  {
                    index: 1,
                    url: page.url,
                    domain: new URL(page.url).hostname,
                    title: page.title,
                    publishedAt: null,
                    retrievedAt: "2026-11-06T17:40:00Z",
                    excerpt: page.text,
                    extracted: true,
                    instructionRiskSignals: 0,
                  },
                ],
        }),
      );
    },
  };
  return { port, queries, research: () => research };
}

/** Names every capitalised company the pages list, the directory too. */
const reader: WebDiscoveryReader = (input) => {
  const text = input.sources.map((s) => s.excerpt).join(" ");
  const names = [
    "African startups",
    "M-Kopa",
    "Jumo",
    "Kopo Kopo",
    "valU",
    "Owo Rails",
    "Kobo Harbour",
    "Pesaflow",
    "Ledgerline",
    "Tamu Pay",
  ].filter((name) => text.includes(name));
  return Promise.resolve(
    names.map((name) => ({
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
};

describe("round 6: a yield floor tops a thin list up", () => {
  it("runs one more round with other angles when fewer than 5 survive, and says what it left out", async () => {
    const scripted = web();
    const answer = await runWebDiscovery({
      ask: {
        text: "find me new companies online that i would be interested in",
        sectors: ["fintech"],
        countries: ["EG", "KE"],
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
    });
    if (answer === null) throw new Error("no answer");
    const names = answer.companies.map((company) => company.name);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(names).toEqual(
      expect.arrayContaining(["valU", "Owo Rails", "Kobo Harbour", "Pesaflow"]),
    );
    for (const left of ["African startups", "M-Kopa", "Jumo", "Kopo Kopo"]) {
      expect(names).not.toContain(left);
    }
    // The top-up searched other angles: a cohort and a country list.
    expect(scripted.queries.some((q) => /\bcohort\b/u.test(q))).toBe(true);
    expect(
      scripted.queries.some((q) =>
        /^top fintech startups (Egypt|Kenya)\b/u.test(q),
      ),
    ).toBe(true);
    // Never past the research service's discovery budget.
    expect(scripted.research()).toBeLessThanOrEqual(6);
    // Said as it is.
    expect(answer.text).toMatch(
      new RegExp(
        `found ${String(names.length)} companies \\(left out 3 that the sources say were founded more than 8 years ago, 1 that was a list or directory\\)`,
        "u",
      ),
    );
  });
});
