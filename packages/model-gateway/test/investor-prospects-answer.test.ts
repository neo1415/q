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
 *
 * Maji Loop sells water from solar kiosks: a fintech fund is not a fit,
 * whatever its country and stage, and is never said to be one.
 */

const COMPANY = "0a000000-0000-4000-8000-000000000001";
const KESTREL = "1a000000-0000-4000-8000-000000000001";
const SAVANNA = "1b000000-0000-4000-8000-000000000002";
const RIFT = "1c000000-0000-4000-8000-000000000003";
const DELTA = "1d000000-0000-4000-8000-000000000004";
const CLIMATE = "1e000000-0000-4000-8000-000000000005";

const required = (
  label: string,
  dimension: string,
  standing: "MET" | "NOT_MET" | "UNKNOWN",
) => ({ label, required: true, dimension, standing });

/** In the prospect tool's order: published sector match, unknown, mismatch. */
const prospects = [
  {
    investorOrganisationId: CLIMATE,
    name: "Pan-African Climate Development Fund",
    investorType: "DFI",
    hqCountry: "KE",
    publicDescription:
      "Climate finance for energy and water access in East Africa.",
    deploymentState: "ACTIVELY_INVESTING",
    reasons: [
      { kind: "SAME_COUNTRY", detail: "based in the same country (KE)" },
      { kind: "DEPLOYING", detail: "says it is actively investing" },
    ],
    label: "likely fit, not evidence of interest",
    gate: {
      title: "Climate gate",
      acceptingApplications: true,
      criteria: [
        required("Clean energy; energy access", "TAXONOMY", "MET"),
        required("Seed to Series A", "STAGE", "MET"),
      ],
    },
    sector: {
      fit: "MATCH",
      focus: "Clean energy; energy access",
      closeness: "EXACT",
      source: "GATE",
      yours: ["Clean Energy", "Energy Access"],
    },
  },
  {
    investorOrganisationId: RIFT,
    name: "Rift Valley Seed Fund",
    investorType: "VC",
    hqCountry: "KE",
    publicDescription: null,
    deploymentState: "SELECTIVE",
    reasons: [
      { kind: "SAME_COUNTRY", detail: "based in the same country (KE)" },
      {
        kind: "TYPICAL_STAGE",
        detail: "vc investors typically back seed companies",
      },
      { kind: "DEPLOYING", detail: "says it is investing selectively" },
    ],
    label: "likely fit, not evidence of interest",
    gate: null,
  },
  {
    investorOrganisationId: SAVANNA,
    name: "Savanna Seed Partners",
    investorType: "VC",
    hqCountry: "KE",
    publicDescription: null,
    deploymentState: "ACTIVELY_INVESTING",
    reasons: [
      { kind: "SAME_COUNTRY", detail: "based in the same country (KE)" },
      { kind: "DEPLOYING", detail: "says it is actively investing" },
    ],
    label: "likely fit, not evidence of interest",
    gate: {
      title: "Savanna gate",
      acceptingApplications: true,
      criteria: [
        required("Fintech", "TAXONOMY", "NOT_MET"),
        required("Seed", "STAGE", "MET"),
      ],
    },
    sector: {
      fit: "MISMATCH",
      focus: "Fintech",
      closeness: null,
      source: "GATE",
      yours: ["Clean Energy", "Energy Access"],
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
  it("puts interest first, then a sector match; a fintech fund is left out for a water company", () => {
    const picks = pickProspects(interests, prospects, 3);
    expect(picks.map((p) => [p.name, p.kind])).toEqual([
      ["Kestrel Capital", "INTERESTED"],
      ["Pan-African Climate Development Fund", "LIKELY_FIT"],
      ["Rift Valley Seed Fund", "LIKELY_FIT"],
    ]);
  });

  it("says why from the record: the interest event, or what they publish, never a generic inference", () => {
    const picks = pickProspects(interests, prospects, 3);
    expect(picks[0]?.why).toBe(
      "they approached you first, expressing interest on 19 Oct, and are still waiting for your answer, so reply to them before you pitch anyone cold",
    );
    expect(picks[1]?.why).toBe(
      "their published gate looks for Clean energy; energy access, which matches how your company is classified (Clean Energy, Energy Access); they describe their focus as “Climate finance for energy and water access in East Africa”; they are based in Kenya, as you are; they say they are actively investing; you meet the other required criteria on their published gate",
    );
    // Rift publishes no sector: nothing is claimed about it, and its
    // stage reason (a generic inference about VCs) is never said.
    expect(picks[2]?.why).toBe(
      "they are based in Kenya, as you are; they say they are investing selectively",
    );
    for (const pick of picks) {
      expect(pick.why).not.toMatch(/typically back/u);
    }
  });

  it("names a sector mismatch only when nothing better is left, and says it is a stretch", () => {
    const savanna = prospects[2];
    const picks = pickProspects([], [savanna], 3);
    expect(picks.map((p) => p.name)).toEqual(["Savanna Seed Partners"]);
    expect(picks[0]?.why).toMatch(
      /^their published gate looks for Fintech, which is not how your company is classified \(Clean Energy, Energy Access\), so this is a stretch/u,
    );
  });

  it("says a related sector is close, never the same, and reads a published card", () => {
    const close = {
      ...prospects[1],
      sector: {
        fit: "MATCH",
        focus: "Energy",
        closeness: "ADJACENT",
        source: "CARD",
        yours: ["Clean Energy", "Energy Access"],
      },
    } as const;
    const [pick] = pickProspects([], [close], 1);
    expect(pick?.why).toMatch(
      /^their Q Card lists Energy, which is close to how your company is classified \(Clean Energy, Energy Access\) but not the same/u,
    );
    for (const p of pickProspects(interests, [...prospects, close], 5)) {
      expect(p.why).not.toMatch(/your sector/u);
    }
  });

  it("names them with a why each and says which are interest and which are likely fit", () => {
    const picks = pickProspects(interests, prospects, 3);
    const text = investorProspectsText(picks, 3);
    expect(text).toMatch(
      /^Talk to Kestrel Capital, Pan-African Climate Development Fund and Rift Valley Seed Fund first\./u,
    );
    expect(text).toContain("Kestrel Capital: They approached you first");
    expect(text).toContain(
      "The others are likely fits from what each publishes, not interest they have shown.",
    );
    expect(text).not.toContain("Savanna");
  });

  it("says so plainly when there is nobody to name", () => {
    expect(investorProspectsText([], 3)).toMatch(/I have nobody to name/u);
  });

  it("gives each a card bound to its investor organisation, so 'the top one' is a named investor", () => {
    const block = prospectCardsBlock(pickProspects(interests, prospects, 3));
    expect(block?.shape).toBe("RANKED");
    expect(block?.cards.map((card) => card.subject)).toEqual([
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: KESTREL },
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: CLIMATE },
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
