import { describe, expect, it, vi } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
} from "@capital-q/q-runtime";

import {
  investorProspectsText,
  pickProspects,
  prospectCardsBlock,
  runInvestorProspects,
} from "../src/q/investor-prospects-answer.js";

/**
 * Founder investor matching (owner 2026-10-23): "Which investors should I
 * talk to first, and why?" from founder.maji-loop got "no investor
 * mandates, prior interest or fit evidence is available". It is answered
 * by code from the investors already interested and the likely fits from
 * what investors publish, never from an investor's private mandate.
 */

const COMPANY = "0a000000-0000-4000-8000-000000000001";
const KESTREL = "1a000000-0000-4000-8000-000000000001";
const SAVANNA = "1b000000-0000-4000-8000-000000000002";
const RIFT = "1c000000-0000-4000-8000-000000000003";
const DELTA = "1d000000-0000-4000-8000-000000000004";

const prospects = [
  {
    investorOrganisationId: SAVANNA,
    name: "Savanna Seed Partners",
    investorType: "VC",
    hqCountry: "KE",
    publicDescription: "Seed cheques for East African fintech.",
    reasons: [
      { kind: "SAME_COUNTRY", detail: "Based in Kenya, where you operate" },
      { kind: "TYPICAL_STAGE", detail: "Invests at seed, your stage" },
      { kind: "DEPLOYING", detail: "Says it is actively investing" },
    ],
    label: "likely fit, not evidence of interest",
    gate: {
      title: "Savanna gate",
      acceptingApplications: true,
      criteria: [
        { label: "Seed", required: true, standing: "MET" },
        { label: "Fintech", required: true, standing: "MET" },
      ],
    },
  },
  {
    investorOrganisationId: KESTREL,
    name: "Kestrel Capital",
    investorType: "ANGEL_NETWORK",
    hqCountry: "NG",
    publicDescription: null,
    reasons: [{ kind: "TYPICAL_STAGE", detail: "Invests at seed, your stage" }],
    label: "likely fit, not evidence of interest",
    gate: null,
  },
  {
    investorOrganisationId: RIFT,
    name: "Rift Valley Ventures",
    investorType: "VC",
    hqCountry: "KE",
    publicDescription: null,
    reasons: [{ kind: "SAME_COUNTRY", detail: "Based in Kenya" }],
    label: "likely fit, not evidence of interest",
    gate: {
      title: "Rift gate",
      acceptingApplications: true,
      criteria: [
        { label: "Series A", required: true, standing: "NOT_MET" },
        { label: "Revenue", required: true, standing: "UNKNOWN" },
      ],
    },
  },
] as const;

const interests = [
  {
    investorOrganisationId: DELTA,
    investorName: "Delta Angels",
    investorType: "ANGEL",
    expressedAt: "2026-10-20T09:00:00.000Z",
    answer: "DECLINED" as const,
    answeredAt: "2026-10-21T09:00:00.000Z",
  },
  {
    investorOrganisationId: KESTREL,
    investorName: "Kestrel Capital",
    investorType: "ANGEL_NETWORK",
    expressedAt: "2026-10-19T09:00:00.000Z",
    answer: "PENDING" as const,
    answeredAt: null,
  },
];

function outcome(name: string, data: unknown): QToolCallOutcome {
  return {
    callId: name,
    toolName: name,
    status: "SUCCEEDED",
    result: { ok: true, data },
  } as unknown as QToolCallOutcome;
}

describe("which investors a founder should talk to first", () => {
  it("puts investors already interested first, then likely fits, each once; declined interest is left out", () => {
    const picks = pickProspects(interests, prospects, 3);
    expect(picks.map((p) => [p.name, p.kind])).toEqual([
      ["Kestrel Capital", "INTERESTED"],
      ["Savanna Seed Partners", "LIKELY_FIT"],
      ["Rift Valley Ventures", "LIKELY_FIT"],
    ]);
    expect(picks[0]?.why).toMatch(
      /expressed interest on 19 Oct and are waiting for your answer/u,
    );
    // A one-line why from what each publishes, and its published gate.
    expect(picks[1]?.why).toBe(
      "Based in Kenya, where you operate; Invests at seed, your stage; you meet every required criterion on their published gate",
    );
    expect(picks[2]?.why).toMatch(/you miss 1 of the 2 required criteria/u);
  });

  it("names them with a why each and says which are interest and which are likely fit", () => {
    const picks = pickProspects(interests, prospects, 3);
    const text = investorProspectsText(picks, 3);
    expect(text).toMatch(
      /^Talk to Kestrel Capital, Savanna Seed Partners and Rift Valley Ventures first\./u,
    );
    expect(text).toContain("Kestrel Capital: They expressed interest");
    expect(text).toContain(
      "The others are likely fits from what each publishes, not interest they have shown.",
    );
  });

  it("says so plainly when there is nobody to name", () => {
    expect(investorProspectsText([], 3)).toMatch(/I have nobody to name/u);
  });

  it("gives each a card bound to its investor organisation, so 'the top one' is a named investor", () => {
    const block = prospectCardsBlock(pickProspects(interests, prospects, 3));
    expect(block?.shape).toBe("RANKED");
    expect(block?.cards.map((card) => card.subject)).toEqual([
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: KESTREL },
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: SAVANNA },
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: RIFT },
    ]);
    expect(block?.cards.map((card) => card.view)).toEqual([
      "Has shown interest",
      "Likely fit",
      "Likely fit",
    ]);
    expect(block?.followUps).toEqual(["Why might Kestrel Capital pass on us?"]);
  });

  it("reads only the prospect list and their own incoming interest, for their own company", async () => {
    const execute = vi.fn((call: { name: string; arguments: unknown }) =>
      Promise.resolve(
        call.name === "find_prospective_investors"
          ? outcome(call.name, { prospects })
          : outcome(call.name, { interests, truthClass: "VERIFIED" }),
      ),
    );
    const found = await runInvestorProspects({
      ask: {
        text: "Which investors should I talk to first, and why?",
        count: null,
      },
      companyId: COMPANY,
      tools: { execute },
      context: {} as QToolExecutionContext,
      available: new Set([
        "find_prospective_investors",
        "list_incoming_interest",
        "get_investor_mandate",
      ]),
    });
    expect(
      execute.mock.calls.map(([call]) => [call.name, call.arguments]),
    ).toEqual([
      ["find_prospective_investors", { companyId: COMPANY, limit: 10 }],
      ["list_incoming_interest", { companyId: COMPANY }],
    ]);
    expect(found?.shown).toBe(3);
    expect(found?.calls).toHaveLength(2);
  });

  it("leaves the turn to the full path when the prospect list cannot be read", async () => {
    const found = await runInvestorProspects({
      ask: { text: "Who should I pitch?", count: 4 },
      companyId: COMPANY,
      tools: {
        execute: () => Promise.reject(new Error("down")),
      },
      context: {} as QToolExecutionContext,
      available: new Set(["find_prospective_investors"]),
    });
    expect(found).toBeNull();
  });
});
