import { describe, expect, it } from "vitest";

import type {
  CapitalObjectiveDto,
  OnboardingResponseValue,
  OnboardingSessionView,
} from "@capital-q/contracts";

import {
  answerGroups,
  raiseFromObjective,
  taxonomyIdsIn,
} from "../src/features/profile/profile-answers";

/**
 * R25: the profile shows everything answered in onboarding, grouped for a
 * profile. Unknown is "Not added" (null), never zero; money keeps its
 * currency and is never parsed to a float; steps the profile already
 * edits as declared fields are not repeated.
 */

const SECTOR = "55555555-5555-4555-8555-555555555555";

function view(
  journeyType: "founder" | "investor",
  eligible: readonly string[],
  answers: Readonly<Record<string, OnboardingResponseValue>>,
): OnboardingSessionView {
  return {
    session: { journeyType },
    currentStep: null,
    progress: {
      eligibleSteps: eligible.map((stepKey) => ({
        stepKey,
        required: false,
        status: "COMPLETED",
      })),
    },
    pendingSuggestions: [],
    responses: Object.entries(answers).map(([stepKey, value], index) => ({
      id: `00000000-0000-4000-8000-00000000000${String(index)}`,
      stepKey,
      responseType: value.type,
      value,
      sourceModality: "TEXT",
      note: null,
      createdAt: "2026-09-20T10:00:00.000Z",
    })),
  } as unknown as OnboardingSessionView;
}

const INVESTOR_ELIGIBLE = [
  "I0.investor_type",
  "I0.business_title",
  "I2.stages",
  "I2.currency",
  "I2.cheque_min",
  "I2.cheque_typical",
  "I2.cheque_max",
  "I3.geography",
  "I3.sectors",
  "I7.hard_exclusions",
  "I11.additional_context",
];

describe("answerGroups (investor)", () => {
  const groups = answerGroups(
    "investor",
    view("investor", INVESTOR_ELIGIBLE, {
      "I0.investor_type": { type: "SINGLE_SELECT", optionKey: "VC" },
      "I0.business_title": { type: "TEXT", text: "Partner" },
      "I2.stages": { type: "MULTI_SELECT", optionKeys: ["pre_seed", "seed"] },
      "I2.currency": { type: "SINGLE_SELECT", optionKey: "usd" },
      "I2.cheque_min": { type: "RANGE", value: "250000" },
      "I2.cheque_max": { type: "RANGE", value: "1500000.50" },
      "I3.sectors": {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: [SECTOR],
      },
      "I11.additional_context": {
        type: "TEXT",
        text: "Payments infrastructure for African SMEs.",
      },
    }),
    { [SECTOR]: "Fintech" },
  );
  const line = (stepKey: string) =>
    groups.flatMap((group) => group.lines).find((l) => l.stepKey === stepKey);

  it("shows the mandate: stages, cheque with currency, sectors, thesis, role", () => {
    expect(groups.map((group) => group.id)).toEqual([
      "role",
      "cheque",
      "stages",
      "geography",
      "sectors",
      "thesis",
      "exclusions",
    ]);
    expect(line("I0.business_title")?.value).toBe("Partner");
    expect(line("I2.cheque_min")?.value).toBe("USD 250,000");
    expect(line("I2.cheque_max")?.value).toBe("USD 1,500,000.50");
    expect(line("I3.sectors")?.value).toBe("Fintech");
    expect(line("I11.additional_context")?.value).toBe(
      "Payments infrastructure for African SMEs.",
    );
    expect(line("I2.stages")?.value).toMatch(/Seed/);
  });

  it("keeps an unanswered step on the path as unknown, never zero", () => {
    expect(line("I2.cheque_typical")?.value).toBeNull();
    expect(line("I3.geography")?.value).toBeNull();
    expect(line("I7.hard_exclusions")?.value).toBeNull();
  });

  it("does not repeat fields the profile edits as declared fields", () => {
    expect(line("I0.investor_type")).toBeUndefined();
    expect(line("I2.currency")).toBeUndefined();
  });

  it("lists only taxonomy ids for labelling", () => {
    expect(
      taxonomyIdsIn(
        view("investor", INVESTOR_ELIGIBLE, {
          "I3.sectors": {
            type: "RESOURCE_REFERENCE",
            resourceType: "TAXONOMY_NODE",
            resourceIds: [SECTOR],
          },
          "I1.mandate_context": {
            type: "RESOURCE_REFERENCE",
            resourceType: "INVESTOR_MANDATE",
            resourceIds: ["66666666-6666-4666-8666-666666666666"],
          },
        }),
      ),
    ).toEqual([SECTOR]);
  });
});

describe("answerGroups: one statement, shown once (R30 #30)", () => {
  it("keeps a thesis recorded under two steps where it first appears", () => {
    const thesis =
      "We back operators building credit rails for informal traders, not decks.";
    const groups = answerGroups(
      "investor",
      view("investor", [...INVESTOR_ELIGIBLE, "I6.custom_criteria"], {
        "I6.custom_criteria": { type: "TEXT", text: thesis },
        "I11.additional_context": { type: "TEXT", text: thesis },
      }),
    );
    const shown = groups
      .flatMap((group) => group.lines)
      .filter((l) => l.value === thesis);
    expect(shown).toHaveLength(1);
  });
});

describe("answerGroups (founder)", () => {
  const groups = answerGroups(
    "founder",
    view(
      "founder",
      [
        "F1.company_name",
        "F1.categories",
        "F4.team_size",
        "F5.revenue_status",
        "F5.customers",
        "F6.currency",
        "F6.target_amount",
        "F7.follow_up",
      ],
      {
        "F1.company_name": { type: "TEXT", text: "Kivu Freight" },
        "F4.team_size": { type: "RANGE", value: "12" },
        "F6.currency": { type: "SINGLE_SELECT", optionKey: "usd" },
        "F6.target_amount": { type: "RANGE", value: "750000" },
        "F7.follow_up": { type: "TEXT", text: "private working note" },
      },
    ),
  );
  const lines = groups.flatMap((group) => group.lines);

  it("shows sector, team, traction and raise, with unknowns as null", () => {
    expect(groups.map((group) => group.id)).toEqual([
      "sector",
      "team",
      "traction",
      "raise",
    ]);
    expect(lines.find((l) => l.stepKey === "F4.team_size")?.value).toBe("12");
    expect(lines.find((l) => l.stepKey === "F5.customers")?.value).toBeNull();
    expect(lines.find((l) => l.stepKey === "F6.target_amount")?.value).toBe(
      "USD 750,000",
    );
  });

  it("never repeats the company's declared fields or the private follow-up note", () => {
    expect(lines.some((l) => l.stepKey === "F1.company_name")).toBe(false);
    expect(lines.some((l) => l.stepKey === "F7.follow_up")).toBe(false);
  });

  it("reads the raise from the capital objective once one exists", () => {
    const raise = raiseFromObjective({
      target: { amount: "2000000", currency: "EUR" },
      instrumentCode: null,
      targetStage: "seed",
      useOfFundsSummary: null,
    } as unknown as CapitalObjectiveDto);
    expect(raise.lines.map((l) => [l.title, l.value])).toEqual([
      ["Target", "EUR 2,000,000"],
      ["Instrument", null],
      ["Round stage", "Seed"],
      ["Use of funds", null],
    ]);
  });
});
