import { describe, expect, it } from "vitest";

import type { QAnswerCardsBlock } from "@capital-q/contracts";
import type {
  QConversationMessage,
  QToolCallOutcome,
  QToolPort,
} from "@capital-q/q-runtime";

import {
  runCompanyDiscovery,
  type DiscoverAsk,
} from "../src/q/discover-companies.js";
import { previousCardCompanyIds } from "../src/q/fit-integrity.js";
import { fitSweepAsk, fitSweepAskOfReading } from "../src/q/fit-sweep.js";
import { fitFixture } from "./fit-fixture.js";

/**
 * K1 (founder brief 2026-10-09; live 15:57 UTC "three fintech companies"
 * was answered with mandate prose and no cards). The reader's
 * DISCOVER_COMPANIES structure is answered from the catalog by code:
 * exactly N distinct cards or fewer with the reason, the ordering basis
 * said, fit only when asked for, and no model at all (this path has no
 * model to call). Fixtures only; no provider is called.
 */

const ID = (n: number) =>
  `7c1d0e55-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = {
  readonly n: number;
  readonly name: string;
  readonly sector: "fintech" | "digital_health" | "agritech";
  readonly country: string;
  /** Fit band strength for the investor's mandate. */
  readonly strong: number;
};

const CATALOG: readonly Row[] = [
  { n: 1, name: "Ajopot", sector: "fintech", country: "NG", strong: 2 },
  { n: 2, name: "Baridi", sector: "agritech", country: "KE", strong: 4 },
  { n: 3, name: "Clearwater", sector: "fintech", country: "KE", strong: 5 },
  {
    n: 4,
    name: "Drishti Health",
    sector: "digital_health",
    country: "IN",
    strong: 3,
  },
  { n: 5, name: "Kora", sector: "fintech", country: "NG", strong: 4 },
  { n: 6, name: "Ledgerfold", sector: "fintech", country: "ZA", strong: 1 },
  {
    n: 7,
    name: "Maji Health",
    sector: "digital_health",
    country: "KE",
    strong: 2,
  },
  { n: 8, name: "Paystream", sector: "fintech", country: "NG", strong: 3 },
];

const SECTOR_NAMES: Readonly<Record<string, string>> = {
  fintech: "Fintech",
  digital_health: "Digital Health",
  agritech: "Agritech",
};

const OUTCOMES = [
  "STAGE",
  "SECTOR",
  "GEOGRAPHY",
  "BUSINESS_MODEL",
  "TRACTION",
] as const;

function outcome(
  proposal: { callId: string },
  toolName: string,
  data: unknown,
): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "NETWORK_VISIBLE",
    result: { ok: true, data },
    latencyMs: 1,
  };
}

/** The catalog and fit tools as the tool port answers them. */
function tools(options: { mandate?: boolean; rows?: readonly Row[] } = {}) {
  const rows = options.rows ?? CATALOG;
  const asked: { name: string; args: Record<string, unknown> }[] = [];
  const port: Pick<QToolPort, "execute"> = {
    execute: (proposal) => {
      const args = proposal.arguments as Record<string, unknown>;
      asked.push({ name: proposal.name, args });
      if (proposal.name === "discover_companies") {
        const sectors = (args["sectors"] as string[] | undefined) ?? [];
        const countries = (args["countries"] as string[] | undefined) ?? [];
        const known = sectors.filter((s) => SECTOR_NAMES[s] !== undefined);
        const matched = rows
          .filter(
            (row) =>
              (sectors.length === 0 || sectors.includes(row.sector)) &&
              (countries.length === 0 || countries.includes(row.country)),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, Number(args["limit"] ?? 10));
        return Promise.resolve(
          outcome(proposal, "discovery.companies", {
            companies:
              sectors.length > 0 && known.length === 0
                ? []
                : matched.map((row) => ({
                    companyId: ID(row.n),
                    name: row.name,
                    stageCode: "seed",
                    headquartersCountry: row.country,
                    shortDescription: `${row.name} does useful things.`,
                    sectors: [SECTOR_NAMES[row.sector] ?? row.sector],
                  })),
            order: "NAME",
            sectors: known.map((code) => ({
              code,
              name: SECTOR_NAMES[code] ?? code,
            })),
            unknownSectors: sectors.filter(
              (s) => SECTOR_NAMES[s] === undefined,
            ),
            truthClass: "USER_CLAIM",
          }),
        );
      }
      if (proposal.name === "fit_profile") {
        if (options.mandate === false) {
          return Promise.resolve(
            outcome(proposal, "fit.profile", { status: "NO_MANDATE" }),
          );
        }
        const id = String(args["companyId"]);
        const row = rows.find((r) => ID(r.n) === id);
        if (row === undefined) {
          return Promise.resolve(
            outcome(proposal, "fit.profile", { status: "NOT_FOUND" }),
          );
        }
        const fixture = fitFixture(
          id,
          row.name,
          Object.fromEntries(
            OUTCOMES.map((key, index) => [
              key,
              index < row.strong ? "STRONG" : "PARTIAL",
            ]),
          ),
          row.strong >= 4 ? "STRONG_FIT" : "GOOD_FIT",
        );
        return Promise.resolve(
          outcome(proposal, "fit.profile", fixture.result.data),
        );
      }
      return Promise.reject(new Error(`not offered: ${proposal.name}`));
    },
  };
  return { port, asked };
}

const AVAILABLE = new Set(["discover_companies", "fit_profile"]);
const CONTEXT = {} as Parameters<typeof runCompanyDiscovery>[0]["context"];

const ask = (overrides: Partial<DiscoverAsk>): DiscoverAsk => ({
  text: "show me three fintech companies",
  sectors: ["fintech"],
  countries: [],
  stages: [],
  count: 3,
  ranking: "NONE",
  mandateRelevant: false,
  previous: false,
  ...overrides,
});

async function discover(
  request: DiscoverAsk,
  options: {
    mandate?: boolean;
    investor?: boolean;
    rows?: readonly Row[];
  } = {},
) {
  const port = tools(options);
  const started = Date.now();
  const answer = await runCompanyDiscovery({
    ask: request,
    tools: port.port,
    context: CONTEXT,
    available: AVAILABLE,
    investor: options.investor ?? true,
  });
  if (answer === null) throw new Error("no fast-path answer");
  return { answer, asked: port.asked, ms: Date.now() - started };
}

const names = (block: QAnswerCardsBlock | null) =>
  (block?.cards ?? []).map((card) => card.name);
const fitCalls = (asked: readonly { name: string }[]) =>
  asked.filter((call) => call.name === "fit_profile").length;

describe("DISCOVER_COMPANIES fast path (K1)", () => {
  it("'Show me three fintech companies': exactly three distinct cards, by name, said so, no fit", async () => {
    const { answer, asked, ms } = await discover(ask({}));
    expect(names(answer.block)).toEqual(["Ajopot", "Clearwater", "Kora"]);
    expect(
      new Set(
        answer.block?.cards.map((c) =>
          c.subject?.kind === "COMPANY" ? c.subject.companyId : "",
        ),
      ).size,
    ).toBe(3);
    expect(answer.block?.cards.every((card) => card.fit === null)).toBe(true);
    expect(answer.text).toBe(
      "Here are three fintech companies on Capital Q: Ajopot, Clearwater and Kora. They're listed by name, not ranked. They're on screen.",
    );
    expect(answer.basis).toBe("NAME");
    expect(fitCalls(asked)).toBe(0);
    expect(asked).toHaveLength(1);
    expect(ms).toBeLessThan(500);
  });

  it("'Give me three companies in the fintech space': the same reading, the same answer", async () => {
    const { answer } = await discover(
      ask({ text: "Give me three companies in the fintech space" }),
    );
    expect(names(answer.block)).toEqual(["Ajopot", "Clearwater", "Kora"]);
  });

  it("'top three fintech' with a mandate: ranked by fit, the basis said", async () => {
    const { answer, asked } = await discover(
      ask({ text: "top three fintech", ranking: "TOP" }),
    );
    expect(answer.basis).toBe("FIT");
    expect(names(answer.block)).toEqual(["Clearwater", "Kora", "Paystream"]);
    expect(answer.text).toMatch(
      /^Ranked by fit with your mandate, the strongest fintech companies: Clearwater at [\d.]+, Kora at [\d.]+ and Paystream at [\d.]+\. They're on screen\.$/u,
    );
    expect(fitCalls(asked)).toBe(5);
  });

  it("'top three fintech' without a mandate: by name, and says what 'top' cannot mean", async () => {
    const { answer } = await discover(
      ask({ text: "top three fintech", ranking: "TOP" }),
      { mandate: false },
    );
    expect(answer.basis).toBe("NAME_UNSCORED");
    expect(names(answer.block)).toEqual(["Ajopot", "Clearwater", "Kora"]);
    expect(answer.text).toMatch(
      /You don't have a mandate to rank against yet, so these are by name/u,
    );
  });

  it("'Find five healthtech startups' with two in the catalog: two cards and the reason", async () => {
    const { answer } = await discover(
      ask({
        text: "Find five healthtech startups",
        sectors: ["digital_health"],
        count: 5,
      }),
    );
    expect(names(answer.block)).toEqual(["Drishti Health", "Maji Health"]);
    expect(answer.text).toBe(
      "Capital Q has only two digital health companies you can see: Drishti Health and Maji Health. They're listed by name, not ranked. They're on screen.",
    );
  });

  it("'Which fintech companies suit my mandate': fit, three by default", async () => {
    const { answer } = await discover(
      ask({
        text: "Which fintech companies suit my mandate",
        count: null,
        ranking: "FIT",
        mandateRelevant: true,
      }),
    );
    expect(answer.basis).toBe("FIT");
    expect(answer.block?.cards).toHaveLength(3);
    expect(answer.block?.cards.every((card) => card.fit !== null)).toBe(true);
  });

  it("'three fintech companies in Nigeria': the country goes to the catalog, said in words", async () => {
    const { answer, asked } = await discover(
      ask({ text: "three fintech companies in Nigeria", countries: ["NG"] }),
    );
    expect(asked[0]?.args["countries"]).toEqual(["NG"]);
    expect(names(answer.block)).toEqual(["Ajopot", "Kora", "Paystream"]);
    expect(answer.text).toMatch(
      /^Here are three fintech companies in Nigeria on Capital Q:/u,
    );
  });

  it("0, 1 and 2 eligible: no cards with the reason, then one, then two", async () => {
    const none = await discover(ask({ countries: ["GH"] }));
    expect(none.answer.block).toBeNull();
    expect(none.answer.text).toBe(
      "I can't find any fintech companies in Ghana on Capital Q that you can see right now.",
    );
    const one = await discover(ask({ countries: ["ZA"] }));
    expect(names(one.answer.block)).toEqual(["Ledgerfold"]);
    expect(one.answer.text).toMatch(
      /^Capital Q has only one fintech company in South Africa you can see: Ledgerfold\./u,
    );
    const two = await discover(
      ask({ countries: ["KE"], sectors: ["fintech", "agritech"] }),
    );
    expect(names(two.answer.block)).toEqual(["Baridi", "Clearwater"]);
    expect(two.answer.text).toMatch(/^Capital Q has only two /u);
  });

  it("a sector Capital Q does not have is said as such, never guessed", async () => {
    const { answer } = await discover(ask({ sectors: ["space_mining"] }));
    expect(answer.block).toBeNull();
    expect(answer.text).toMatch(
      /^Capital Q doesn't have "space mining" as a sector/u,
    );
  });

  it("a founder asking for the best fit gets the catalog, never an investor's fit", async () => {
    const { answer, asked } = await discover(ask({ ranking: "FIT" }), {
      investor: false,
    });
    expect(fitCalls(asked)).toBe(0);
    expect(answer.block?.cards.every((card) => card.fit === null)).toBe(true);
  });

  it("without the catalog tool in this run, the full path answers instead", async () => {
    const answer = await runCompanyDiscovery({
      ask: ask({}),
      tools: tools().port,
      context: CONTEXT,
      available: new Set(["fit_profile"]),
      investor: true,
    });
    expect(answer).toBeNull();
  });
});

describe("follow-ups on the cards just shown (K1)", () => {
  async function shown(): Promise<readonly QConversationMessage[]> {
    const { answer } = await discover(ask({}));
    if (answer.block === null) throw new Error("no cards");
    return [
      { id: "u1", role: "PERSON", content: "Show me three fintech companies" },
      { id: "q1", role: "Q", content: answer.text, blocks: [answer.block] },
    ] as unknown as readonly QConversationMessage[];
  }

  it("'compare those three' scores exactly the three shown", async () => {
    const previous = previousCardCompanyIds(await shown());
    expect(previous).toEqual([ID(1), ID(3), ID(5)]);
    const sweep = fitSweepAsk("compare those three", previous);
    expect(sweep?.scope).toBe("PREVIOUS");
    expect(sweep?.within).toEqual(previous);
  });

  it("'which has the strongest fit', read as about the cards shown, scores exactly those", async () => {
    const previous = previousCardCompanyIds(await shown());
    // The words alone name no set; the reading's `previous` does.
    expect(fitSweepAsk("which has the strongest fit", previous)).toBeNull();
    const sweep = fitSweepAskOfReading(
      { text: "which has the strongest fit", count: null, previous: true },
      previous,
    );
    expect(sweep.scope).toBe("PREVIOUS");
    expect(sweep.within).toEqual(previous);
    expect(sweep.count).toBe(3);
  });

  it("'open the second' points at the second card's company", async () => {
    const { answer } = await discover(ask({}));
    const second = answer.block?.cards[1];
    expect(second?.name).toBe("Clearwater");
    expect(second?.subject).toEqual({ kind: "COMPANY", companyId: ID(3) });
  });
});
