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
    expect(JSON.stringify(answer?.networkBlock)).toContain("Doha Ventures");
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
    expect(JSON.stringify(answer?.block)).not.toContain("Doha Tech Angels");
    expect(answer?.shown).toBe(2);
  });
});
