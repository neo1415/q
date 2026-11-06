import { describe, expect, it } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";

import {
  foundersStated,
  runWebDiscovery,
  yearsStated,
  type WebDiscoveryAsk,
} from "../src/q/web-discovery.js";
import type { WebDiscoveryReader } from "../src/q/web-discovery-reader.js";

/**
 * Live 2026-11-06 (11180d8e6, Savanna Seed): eight companies listed from
 * tracxn and weetracker pages, every one "founders not named in the
 * sources I read"; Jumo and M-Kopa, long established, listed for "new
 * companies"; three with "sector not stated · location unknown". The
 * founder round never started (the 30 s deep budget was spent), and
 * nothing read the pages' own words for founders, years or places.
 *
 * Scripted, shaped like production: two listing pages naming eight
 * companies and nothing else; founder-round pages (a database profile,
 * news, a company page) that state founders, founded years and places;
 * a page reader that names the companies on the listings and nothing on
 * the founder pages; a clock that spends 20 s before the founder round.
 */

const NOW = Date.parse("2026-11-06T13:06:00Z");

type Page = {
  readonly url: string;
  readonly title: string;
  readonly text: string;
};

const LISTINGS: readonly Page[] = [
  {
    url: "https://tracxn.example/fintech-kenya",
    title: "Top fintech startups in Kenya",
    text: "Top fintech startups in Kenya: M-Kopa, Jumo, Numida, Kopo Kopo and Apollo Agriculture.",
  },
  {
    url: "https://weetracker.example/agritech-fintech",
    title: "Startups to watch",
    text: "Startups to watch: Agridex, Udu Technologies and Fincart.",
  },
];

/** What the founder round finds for each company, by its name. */
const FOUNDER_PAGES: Readonly<Record<string, Page>> = {
  Numida: {
    url: "https://crunchbase.example/numida",
    title: "Numida - Company Profile",
    text: "Numida is a fintech company in Uganda founded in 2022 by Mina Shahid and Catherine Lahner.",
  },
  Agridex: {
    url: "https://news.example/agridex-seed",
    title: "Agridex raises seed round",
    text: "Agridex, a Kenya agritech marketplace, raised a seed round in 2026. Agridex co-founder Wanjiru Mwangi said the money will fund growth.",
  },
  "Udu Technologies": {
    url: "https://udutechnologies.example/about",
    title: "About Udu Technologies",
    text: "Udu Technologies was launched in 2024 in Nigeria. CEO Tolu Adeyemi leads the team.",
  },
  Fincart: {
    url: "https://press.example/fincart",
    title: "Fincart founders",
    text: "Fincart was founded by Ama Owusu and Kofi Mensah, its fintech app serves traders in Ghana.",
  },
  Jumo: {
    url: "https://press.example/jumo",
    title: "Jumo history",
    text: "Jumo was founded in 2014 by Andrew Watkins-Ball.",
  },
  "M-Kopa": {
    url: "https://press.example/mkopa",
    title: "M-KOPA story",
    text: "M-KOPA was founded in 2011 by Jesse Moore and Nick Hughes in Kenya.",
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

const sourceOf = (page: Page, index: number) => ({
  index,
  url: page.url,
  domain: new URL(page.url).hostname,
  title: page.title,
  publishedAt: null,
  retrievedAt: "2026-11-06T13:06:00Z",
  excerpt: page.text,
  extracted: true,
  instructionRiskSignals: 0,
});

function web() {
  const searched: { query: string[]; pageNames: string[] }[] = [];
  const port: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: (proposal) => {
      const args = proposal.arguments as Record<string, unknown>;
      if (proposal.name === "search_companies") {
        return Promise.resolve(ok(proposal, { items: [] }));
      }
      const queries = [
        String(args["query"]),
        ...((args["alsoSearch"] as string[] | undefined) ?? []),
      ];
      const pageNames = (args["pageNames"] as string[] | undefined) ?? [];
      searched.push({ query: queries, pageNames });
      const pages =
        pageNames.length === 0
          ? LISTINGS
          : pageNames.flatMap((name) => {
              const page = FOUNDER_PAGES[name];
              return page === undefined ? [] : [page];
            });
      return Promise.resolve(
        ok(proposal, {
          status: "OK",
          sources: pages.map((page, i) => sourceOf(page, i + 1)),
        }),
      );
    },
  };
  return { port, searched };
}

/** Names the listed companies; finds nothing on the founder pages. */
const reader: WebDiscoveryReader = (input) =>
  Promise.resolve(
    input.looking.startsWith("the founders of")
      ? null
      : [
          "M-Kopa",
          "Jumo",
          "Numida",
          "Kopo Kopo",
          "Apollo Agriculture",
          "Agridex",
          "Udu Technologies",
          "Fincart",
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

const ASK: WebDiscoveryAsk = {
  text: "hey, find me new companies online and their founders",
  sectors: [],
  countries: [],
  stages: [],
  count: null,
};

async function discover() {
  const scripted = web();
  // Round one and the page reads take 20 s, as live.
  let t = NOW;
  const answer = await runWebDiscovery({
    ask: ASK,
    mandate: {
      sectors: ["fintech", "agritech"],
      countries: ["KE", "NG", "GH"],
      regions: [],
      stageMin: "pre_seed",
      stageMax: "seed",
      stages: [],
    },
    tools: scripted.port,
    context: {} as QToolExecutionContext,
    available: new Set(["research_public_web", "search_companies"]),
    reader,
    attribution: { tenantId: "t", userId: "u", correlationId: "c" },
    now: () => {
      const at = t;
      t += 2_500;
      return at;
    },
  });
  return { answer, searched: scripted.searched };
}

describe("web discovery round 3: founders, new first, fit filled (live 2026-11-06)", () => {
  it("runs the founder round after a 20 s round one and names founders for at least half", async () => {
    const { answer, searched } = await discover();
    expect(answer).not.toBeNull();
    if (answer === null) return;
    expect(answer.founderQueries.length).toBeGreaterThanOrEqual(6);
    expect(answer.founderQueries[0]).toMatch(/ founder CEO$/u);
    // The founder round names the companies as the pages wrote them.
    expect(searched.some((call) => call.pageNames.length > 0)).toBe(true);
    const withFounders = answer.companies.filter(
      (company) => company.founders.length > 0,
    );
    expect(
      withFounders.length / answer.companies.length,
    ).toBeGreaterThanOrEqual(0.5);
    const founders = Object.fromEntries(
      answer.companies.map((company) => [company.name, company.founders]),
    );
    expect(founders["Numida"]).toEqual(["Mina Shahid", "Catherine Lahner"]);
    expect(founders["Agridex"]).toEqual(["Wanjiru Mwangi"]);
    expect(founders["Udu Technologies"]).toEqual(["Tolu Adeyemi"]);
    expect(founders["Fincart"]).toEqual(["Ama Owusu", "Kofi Mensah"]);
    // Nothing invented: a company with no page stating founders keeps none.
    expect(founders["Kopo Kopo"]).toEqual([]);
  });

  it("ranks new companies first, shows the year a page states, and invents none", async () => {
    const { answer } = await discover();
    if (answer === null) throw new Error("no answer");
    const order = answer.companies.map((company) => company.name);
    const at = (name: string) => order.indexOf(name);
    // Round 4 (live 2026-11-06): over 8 years old is not new -- left out.
    expect(at("Jumo")).toBe(-1);
    expect(at("M-Kopa")).toBe(-1);
    expect(answer.text).toMatch(
      /left out 2 that the sources say were founded more than 8 years ago/u,
    );
    for (const fresh of ["Numida", "Agridex", "Udu Technologies"]) {
      expect(at(fresh)).toBeLessThan(at("Kopo Kopo"));
    }
    expect(answer.text).toContain("**Udu Technologies** · founded 2024");
    expect(answer.text).toContain("**Numida** · founded 2022");
    expect(answer.text).toContain("**Agridex** · raised in 2026");
    // No page states a year for Kopo Kopo: none is shown.
    expect(answer.text).toMatch(/\*\*Kopo Kopo\*\* —/u);
  });

  it("fills sector and place from the founder round's pages, and only from them", async () => {
    const { answer } = await discover();
    if (answer === null) throw new Error("no answer");
    const line = (name: string) =>
      answer.text.split("\n").find((l) => l.includes(`**${name}**`)) ?? "";
    expect(line("Fincart")).toContain("Fit: fintech");
    expect(line("Fincart")).toContain("Ghana");
    expect(line("Agridex")).toContain("agritech");
    expect(line("Agridex")).toContain("Kenya");
    // One line per company, each with its source.
    for (const company of answer.companies) {
      expect(line(company.name)).toMatch(/Source: \[[^\]]+\]\(https:/u);
    }
  });
});

describe("what a sentence states", () => {
  it("reads founders only from a sentence that names the company", () => {
    expect(
      foundersStated("Fincart", [
        "Fincart was founded by Ama Owusu and Kofi Mensah.",
      ]),
    ).toEqual(["Ama Owusu", "Kofi Mensah"]);
    expect(
      foundersStated("Agridex", ["Agridex co-founder Wanjiru Mwangi said."]),
    ).toEqual(["Wanjiru Mwangi"]);
    expect(
      foundersStated("Agridex", ["Wanjiru Mwangi, its co-founder, said."]),
    ).toEqual([]);
    expect(
      foundersStated("Agridex", [
        "Agridex hired Wanjiru Mwangi, its co-founder said.",
      ]),
    ).toEqual(["Wanjiru Mwangi"]);
    // A round, a place or the company itself is never a founder.
    expect(
      foundersStated("Paylane Africa", [
        "Paylane Africa founder Series A round closed.",
        "Founded by Paylane Africa Group in Lagos.",
      ]),
    ).toEqual([]);
  });

  it("reads only the years a page states", () => {
    const now = new Date(NOW);
    expect(
      yearsStated(["Udu was launched in 2024 and raised seed in 2026."], now),
    ).toEqual({ founded: 2024, raised: 2026 });
    expect(yearsStated(["Udu builds payments."], now)).toEqual({
      founded: null,
      raised: null,
    });
    // A year after this one is not a year anything happened.
    expect(yearsStated(["Founded in 2031."], now).founded).toBeNull();
  });
});
