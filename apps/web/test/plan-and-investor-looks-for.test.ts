import { describe, expect, it, vi } from "vitest";

import {
  DiscoveredInvestorProfileDtoSchema,
  InvestorGateFitDtoSchema,
  type DiscoveredInvestorProfileDto,
  type InvestorGateFitDto,
  type ReadinessBlueprintDto,
} from "@capital-q/contracts";

vi.mock("server-only", () => ({}));
vi.mock("../src/features/q/context", () => ({
  qApiSession: vi.fn(() => Promise.resolve(null)),
  apiSession: vi.fn(() => Promise.resolve(null)),
  resolveOwnContext: vi.fn(),
}));

import {
  blueprintPhases,
  horizonFrom,
  stepMeta,
} from "../src/features/capital/readiness-blueprint";
import {
  criterionWords,
  draftHref,
  gateRows,
  profileRows,
  standingTally,
} from "../src/features/investors/looks-for";
import {
  blueprintCard,
  blueprintNotOnPlanCard,
  looksForCard,
} from "../src/features/q/room/plan-investor-cards";

/**
 * Q.04 "Your 3/6/12-month plan" and Q.05 "What this investor looks for",
 * as words: unknown is never a "no", the plan is code-built steps in
 * order, and nothing here can carry an investor's private mandate.
 */

const INVESTOR = "a5000000-0000-4000-8000-000000000005";
const COMPANY = "11111111-1111-4111-8111-111111111111";

const gate: InvestorGateFitDto = {
  investorOrganisationId: INVESTOR,
  publicId: "harbour-seed",
  title: "Harbour Seed gate",
  acceptingApplications: true,
  criteria: [
    {
      label: "Stage: pre-seed or seed",
      requiredness: "REQUIRED",
      dimension: "STAGE",
      standing: "MET",
    },
    {
      label: "Raising up to $1.5m",
      requiredness: "PREFERRED",
      dimension: "RAISE_SIZE",
      standing: "UNKNOWN",
    },
    {
      label: "Not crypto",
      requiredness: "REQUIRED",
      dimension: "EXCLUDED_TAXONOMY",
      standing: "NOT_MET",
    },
  ],
};

const investor: DiscoveredInvestorProfileDto = {
  investorOrganisationId: INVESTOR,
  displayName: "Harbour Seed Partners",
  investorType: "VC",
  websiteUrl: null,
  hqCountry: "NG",
  publicDescription: null,
  deploymentState: "DEPLOYING",
};

const blueprint: ReadinessBlueprintDto = {
  id: "b1000000-0000-4000-8000-000000000001",
  companyId: COMPANY,
  version: 1,
  horizonMonths: 6,
  basis: {
    diagnosisVersion: "readiness-rules/v1",
    evidenceAsOf: "2026-10-07T09:00:00.000Z",
    mandateVersions: [],
  },
  roadmap: [
    {
      id: "upload-accounts",
      title: "Upload 3 months of management accounts",
      why: "Closes: revenue is self-reported only.",
      closesGapId: "revenue-evidence",
      pillar: "COMMERCIAL_VALIDATION",
      priority: "NOW",
      effort: "DAYS",
      executor: "FOUNDER",
      dependsOn: [],
      doneWhen: "Three monthly accounts are in your data room.",
      evidence: [],
      truthClass: "UNKNOWN",
      evidenceStatus: "NO_EVIDENCE",
      confidence: "LOW",
    },
    {
      id: "verify",
      title: "Verify your company",
      why: "Closes: organisation not verified.",
      closesGapId: "verification",
      pillar: "GOVERNANCE_AND_TRUST",
      priority: "NEXT",
      effort: "DAYS",
      executor: "WITH_Q",
      dependsOn: ["upload-accounts"],
      doneWhen: "Your company shows as verified.",
      evidence: [],
      truthClass: "UNKNOWN",
      evidenceStatus: "NO_EVIDENCE",
      confidence: "LOW",
    },
  ],
  sequencing: [
    { label: "Now", startsWeek: 0, endsWeek: 4, stepIds: ["upload-accounts"] },
    { label: "Next", startsWeek: 4, endsWeek: 12, stepIds: ["verify", "gone"] },
  ],
  investorPlans: [],
  uncertainty: ["Unit economics: no cost figures shared yet."],
  generatedAt: "2026-10-07T09:00:00.000Z",
};

describe("Your 3/6/12-month plan (Q.04)", () => {
  it("reads only 3, 6 or 12 from the address; anything else is 6", () => {
    expect(horizonFrom("3")).toBe(3);
    expect(horizonFrom("12")).toBe(12);
    expect(horizonFrom("24")).toBe(6);
    expect(horizonFrom(undefined)).toBe(6);
  });

  it("lays the code-built steps out in their phases, dropping unknown ids", () => {
    const phases = blueprintPhases(blueprint);
    expect(
      phases.map((p) => [p.label, p.weeks, p.steps.map((s) => s.id)]),
    ).toEqual([
      ["Now", "weeks 0–4", ["upload-accounts"]],
      ["Next", "weeks 4–12", ["verify"]],
    ]);
    const [first] = blueprint.roadmap;
    if (first === undefined) throw new Error("fixture");
    expect(stepMeta(first)).toBe("Traction · You · days");
  });

  it("the room card shows the plan's own steps and opens Capital", () => {
    const card = blueprintCard(blueprint, "/capital#readiness-blueprint");
    expect(card.heading).toBe("Your 6-month plan");
    expect(card.items.map((i) => i.title)).toEqual([
      "Now · Upload 3 months of management accounts",
      "Next · Verify your company",
    ]);
    expect(card.href).toBe("/capital#readiness-blueprint");
    // Not on the plan: an honest line, never a sample plan.
    expect(blueprintNotOnPlanCard("/capital").items).toEqual([]);
  });
});

describe("What this investor looks for (Q.05)", () => {
  it("puts the founder's fit in words; unknown is never a no", () => {
    const rows = gateRows(gate);
    expect(rows.map((r) => [r.standing, r.words])).toEqual([
      ["MET", "Your stage is within what they publish."],
      [
        "UNKNOWN",
        "Your raise isn't on your profile yet. Save your raise on Capital.",
      ],
      ["NOT_MET", "Your sector is one they exclude."],
    ]);
    expect(criterionWords("GEOGRAPHY", "UNKNOWN")).not.toMatch(/not met|no\b/i);
    expect(standingTally(rows)).toBe("You meet 1 of 3; 1 not known yet");
  });

  it("drafts only through the gate's own form, and only while it accepts applications", () => {
    expect(draftHref(gate)).toBe("/g/harbour-seed");
    expect(draftHref({ ...gate, acceptingApplications: false })).toBeNull();
    expect(draftHref(null)).toBeNull();
  });

  it("public-profile reasons read as matches", () => {
    expect(
      profileRows([
        { kind: "SECTOR_MATCH", detail: "Fintech" },
        { kind: "PROFILE_COMPLETE", detail: "ignored" },
      ]),
    ).toEqual([
      { label: "Sector", standing: "MET", words: "Fintech", required: false },
    ]);
  });

  it("the room card offers the draft for review, never sends", () => {
    const card = looksForCard(
      investor,
      gate,
      `/investors/${INVESTOR}#looks-for`,
    );
    expect(card.heading).toBe("What Harbour Seed Partners looks for");
    expect(card.href).toBe("/g/harbour-seed");
    expect(card.open).toBe("Review my draft application");
    const none = looksForCard(
      investor,
      null,
      `/investors/${INVESTOR}#looks-for`,
    );
    expect(none.items).toEqual([]);
    expect(none.href).toBe(`/investors/${INVESTOR}#looks-for`);
  });

  it("no private mandate can reach a founder: the contracts refuse the field", () => {
    expect(
      DiscoveredInvestorProfileDtoSchema.safeParse({
        ...investor,
        mandate: { minCheque: "250000" },
      }).success,
    ).toBe(false);
    expect(
      InvestorGateFitDtoSchema.safeParse({
        ...gate,
        criteria: [{ ...gate.criteria[0], threshold: "250000" }],
      }).success,
    ).toBe(false);
  });
});
