import { describe, expect, it } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolProposal,
} from "@capital-q/q-runtime";

import { IdentityCardSchema } from "@capital-q/contracts/q";

import { runInvestorDiscovery } from "../src/q/investor-discovery-answer.js";

/**
 * Owner's own conversation (2026-10-24): "just find me three Qatari
 * investors". Capital Q's own investors based there are read beside the
 * public search and named first, as likely fits, never interest.
 */

const ok = (
  proposal: QToolProposal,
  toolName: string,
  data: unknown,
): QToolCallOutcome => ({
  callId: proposal.callId,
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "PUBLIC",
  result: { ok: true, data },
  latencyMs: 1,
});

const prospect = (
  id: string,
  name: string,
  hqCountry: string,
  investorType: string,
) => ({
  investorOrganisationId: id,
  name,
  investorType,
  hqCountry,
  publicDescription: `${name} backs early-stage startups.`,
  websiteUrl: null,
  deploymentState: null,
  reasons: [],
  label: "likely fit, not evidence of interest",
});

const publicFind = (name: string) => ({
  card: IdentityCardSchema.parse({
    entityKind: "ORGANIZATION",
    subject: {
      externalPersonId: "5f0c3b8e-1d2a-4c6b-9e7f-0a1b2c3d4e5f",
      entityKind: "ORGANIZATION",
      displayName: name,
      nameVariants: [],
      profileUrl: null,
      role: null,
      organization: null,
      location: "Qatar",
      evidenceBundleId: null,
      briefVersion: 0,
      confidence: "PLAUSIBLE",
    },
    sources: [
      {
        url: "https://example.org/firm",
        domain: "example.org",
        title: name,
        publishedAt: null,
        retrievedAt: "2026-10-24T10:00:00.000Z",
        provider: "fake",
      },
    ],
    uncertainty: [],
    enriching: false,
    actions: ["RESEARCH_FURTHER"],
  }),
  role: "INVESTOR",
  fit: ["Based in Qatar."],
  source: "WEB",
});

function tools(
  network: readonly ReturnType<typeof prospect>[],
  candidates: readonly ReturnType<typeof publicFind>[] = [],
) {
  const asked: string[] = [];
  return {
    asked,
    port: {
      execute: (proposal: QToolProposal) => {
        asked.push(proposal.name);
        if (proposal.name === "find_prospective_investors") {
          return Promise.resolve(
            ok(proposal, "investor.prospects", {
              prospects: network,
              fitVersion: 1,
            }),
          );
        }
        return Promise.resolve(
          ok(proposal, "people.discover", {
            outcome: candidates.length === 0 ? "NONE" : "FOUND",
            candidates,
            countries: ["QA"],
            regionWords: ["Qatari"],
            webSearched: true,
            aboutMyCompany: false,
            truthClass: "UNKNOWN",
            guidance: "",
          }),
        );
      },
    },
  };
}

const context = {} as QToolExecutionContext;

describe("a discovery of investors reads Capital Q's own beside the public search", () => {
  it("names the Capital Q investors based where they asked, and only those", async () => {
    const t = tools([
      prospect(
        "a1111111-0000-4000-8000-000000000001",
        "Doha Ventures",
        "QA",
        "VC",
      ),
      prospect(
        "a1111111-0000-4000-8000-000000000002",
        "Nairobi Angels",
        "KE",
        "ANGEL_NETWORK",
      ),
    ]);
    const answer = await runInvestorDiscovery({
      ask: {
        regions: ["Qatari"],
        sector: null,
        stage: null,
        count: 3,
        aboutMyCompany: false,
      },
      tools: t.port,
      context,
      available: new Set(["discover_investors", "find_prospective_investors"]),
    });
    expect(t.asked.sort()).toEqual([
      "discover_investors",
      "find_prospective_investors",
    ]);
    expect(answer?.text).toContain("On Capital Q, Doha Ventures");
    expect(answer?.text).not.toContain("Nairobi Angels");
    expect(answer?.text).toContain("not interest shown");
    // One list: the network firm first, tagged where it came from.
    expect(answer?.block?.cards[0]?.name).toBe("Doha Ventures");
    expect(answer?.block?.cards[0]?.view).toMatch(/^On Capital Q · /u);
    expect(answer?.outcome).toBe("FOUND");
  });

  it("keeps only the kind asked for", async () => {
    const t = tools([
      prospect(
        "a1111111-0000-4000-8000-000000000003",
        "Doha Ventures",
        "QA",
        "VC",
      ),
      prospect(
        "a1111111-0000-4000-8000-000000000004",
        "Al Thani Family Office",
        "QA",
        "FAMILY_OFFICE",
      ),
    ]);
    const answer = await runInvestorDiscovery({
      ask: {
        regions: ["Qatari"],
        sector: null,
        stage: null,
        count: 3,
        aboutMyCompany: false,
        kinds: ["family offices"],
      },
      tools: t.port,
      context,
      available: new Set(["discover_investors", "find_prospective_investors"]),
    });
    expect(answer?.text).toContain("Al Thani Family Office");
    expect(answer?.text).not.toContain("Doha Ventures");
  });

  // Coordinator 2026-10-24, live: Doha Tech Angels was named both "On
  // Capital Q" and "Outside Capital Q", and a short list never said so.
  it("names a firm on Capital Q once, there, and says how many of the asked were found", async () => {
    const t = tools(
      [
        prospect(
          "a1111111-0000-4000-8000-000000000005",
          "Doha Tech Angels",
          "QA",
          "ANGEL_NETWORK",
        ),
      ],
      [publicFind("Doha Tech Angels LLC"), publicFind("DVC")],
    );
    const answer = await runInvestorDiscovery({
      ask: {
        regions: ["Qatari"],
        sector: null,
        stage: null,
        count: 3,
        aboutMyCompany: false,
      },
      tools: t.port,
      context,
      available: new Set(["discover_investors", "find_prospective_investors"]),
    });
    const text = answer?.text ?? "";
    expect(text.split("Doha Tech Angels")).toHaveLength(2);
    expect(text).toContain("Outside Capital Q: From a public web search");
    expect(text).toContain("DVC");
    expect(text).toContain("That's two of the three you asked for.");
    // One list, network first, each card tagged where it came from
    // (coordinator 2026-10-24); Doha Tech Angels once, as Capital Q's.
    const cards = answer?.block?.cards ?? [];
    expect(cards.map((card) => card.name)).toEqual(["Doha Tech Angels", "DVC"]);
    expect(cards[0]?.view).toMatch(/^On Capital Q · /u);
    expect(cards[1]?.view).toBe("Public, unconfirmed");
    expect(answer?.shown).toBe(2);
  });
});

// F-133 (QA, a Ghana logistics seed founder): "which investors fit me"
// named no place, kind or sector, and the prepared Gulf and US set came
// back in name order. Their own company's place and stage are the match.
describe("an ask about their own company matches on where it is (F-133)", () => {
  const COMPANY = "c1111111-0000-4000-8000-000000000001";
  function withCompany() {
    const calls: QToolProposal[] = [];
    return {
      calls,
      port: {
        execute: (proposal: QToolProposal) => {
          calls.push(proposal);
          if (proposal.name === "get_company") {
            return Promise.resolve(
              ok(proposal, "company.get", {
                headquartersCountry: "GH",
                currentStageCode: "seed",
              }),
            );
          }
          if (proposal.name === "find_prospective_investors") {
            return Promise.resolve(
              ok(proposal, "investor.prospects", { prospects: [] }),
            );
          }
          return Promise.resolve(
            ok(proposal, "people.discover", {
              outcome: "NONE",
              candidates: [],
              countries: ["GH"],
              regionWords: ["Ghana"],
              webSearched: true,
              aboutMyCompany: true,
              truthClass: "UNKNOWN",
              guidance: "",
            }),
          );
        },
      },
    };
  }
  const available = new Set([
    "discover_investors",
    "find_prospective_investors",
    "get_company",
  ]);

  it("asks for investors where the company is, at its stage", async () => {
    const t = withCompany();
    await runInvestorDiscovery({
      ask: {
        regions: [],
        sector: null,
        stage: null,
        count: 3,
        aboutMyCompany: true,
      },
      tools: t.port,
      context,
      available,
      companyId: COMPANY,
    });
    const discover = t.calls.find((call) => call.name === "discover_investors");
    expect(discover?.arguments).toMatchObject({
      regions: ["Ghana"],
      stage: "seed",
      aboutMyCompany: true,
    });
  });

  it("keeps the place they named, and reads nothing extra", async () => {
    const t = withCompany();
    await runInvestorDiscovery({
      ask: {
        regions: ["Gulf"],
        sector: null,
        stage: null,
        count: 3,
        aboutMyCompany: true,
      },
      tools: t.port,
      context,
      available,
      companyId: COMPANY,
    });
    expect(t.calls.map((call) => call.name)).not.toContain("get_company");
    expect(
      t.calls.find((call) => call.name === "discover_investors")?.arguments,
    ).toMatchObject({ regions: ["Gulf"] });
  });
});
