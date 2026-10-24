import { describe, expect, it } from "vitest";

import type { OnboardingResponseValue } from "@capital-q/contracts";
import {
  confirmationItemKey,
  deriveOnboardingCoverage,
  groupConfirmation,
  knownFactsFromRegistration,
  onboardingCopyFor,
  selectNextFields,
} from "@capital-q/onboarding";

import { viewOf } from "../../onboarding/test/support/coverage-view.js";

import {
  FOUNDER_COVERAGE_PROFILE,
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_STEPS,
} from "../src/definition/index.js";

const NOW = new Date("2026-10-16T10:00:00.000Z");

const coverageOf = (
  answers: Readonly<Record<string, OnboardingResponseValue>>,
  extra: Parameters<typeof viewOf>[2] = {},
  more: Partial<Parameters<typeof deriveOnboardingCoverage>[0]> = {},
) =>
  deriveOnboardingCoverage({
    profile: FOUNDER_COVERAGE_PROFILE,
    definition: FOUNDER_DEFINITION_CURRENT,
    view: viewOf(FOUNDER_DEFINITION_CURRENT, answers, extra),
    now: NOW,
    ...more,
  });

const field = (c: ReturnType<typeof coverageOf>, key: string) => {
  const found = c.fields.find((f) => f.fieldKey === key);
  if (found === undefined) throw new Error(`no field ${key}`);
  return found;
};

const seed = { type: "SINGLE_SELECT", optionKey: "seed" } as const;

describe("founder coverage profile", () => {
  it("annotates only real definition steps, never a checkpoint", () => {
    const keys = new Set(
      FOUNDER_DEFINITION_CURRENT.steps.map((s) => s.stepKey),
    );
    for (const key of Object.keys(FOUNDER_COVERAGE_PROFILE.fields)) {
      expect(keys.has(key), key).toBe(true);
    }
    for (const checkpoint of [
      FOUNDER_STEPS.review,
      FOUNDER_STEPS.snapshot,
      FOUNDER_STEPS.raiseConfirm,
      FOUNDER_STEPS.intent,
    ]) {
      expect(FOUNDER_COVERAGE_PROFILE.fields[checkpoint]).toBeUndefined();
    }
  });

  it("never marks a required step deferrable", () => {
    const c = coverageOf({});
    for (const f of c.fields)
      if (f.required) expect(f.deferrable, f.fieldKey).toBe(false);
  });
});

describe("deriveOnboardingCoverage (founder)", () => {
  it("a fresh session: essentials missing, conditional steps inapplicable, optional deferrable", () => {
    const c = coverageOf({});
    expect(field(c, FOUNDER_STEPS.companyName).state).toBe("MISSING");
    // F5.revenue_status applies only at Series A+; unknown stage -> off the path.
    expect(field(c, FOUNDER_STEPS.revenueStatus).state).toBe("INAPPLICABLE");
    expect(field(c, FOUNDER_STEPS.revenueStatus).dependsOn).toContain(
      FOUNDER_STEPS.stage,
    );
    expect(field(c, FOUNDER_STEPS.functions).state).toBe("DEFERRABLE");
    expect(c.summary.canComplete).toBe(false);
    expect(c.next[0]).toEqual({
      fieldKey: FOUNDER_STEPS.companyName,
      reason: "ESSENTIAL_MISSING",
    });
  });

  it("registration facts are KNOWN and never selected as a question", () => {
    const known = knownFactsFromRegistration(FOUNDER_COVERAGE_PROFILE, {
      organisationName: "Harbourline Cargo",
    });
    const c = coverageOf({}, {}, { known });
    const name = field(c, FOUNDER_STEPS.companyName);
    expect(name.state).toBe("KNOWN");
    expect(name.source).toBe("REGISTRATION");
    expect(name.display).toBe("Harbourline Cargo");
    expect(c.next.map((n) => n.fieldKey)).not.toContain(
      FOUNDER_STEPS.companyName,
    );
    expect(
      knownFactsFromRegistration(FOUNDER_COVERAGE_PROFILE, {
        organisationName: "  ",
      }),
    ).toEqual([]);
  });

  it("a stage answer turns on the stage-specific branch", () => {
    const c = coverageOf({ [FOUNDER_STEPS.stage]: seed });
    expect(field(c, FOUNDER_STEPS.stage).state).toBe("CONFIRMED_SAVED");
    expect(field(c, FOUNDER_STEPS.stage).source).toBe("CONVERSATION");
    expect(field(c, FOUNDER_STEPS.signal).state).toBe("MISSING");
    expect(field(c, FOUNDER_STEPS.revenueStatus).state).toBe("INAPPLICABLE");
  });

  it("offered values are SUPPLIED_UNCONFIRMED with provenance, and grouped into one confirmation", () => {
    const c = coverageOf(
      {},
      {
        suggestions: [
          {
            stepKey: FOUNDER_STEPS.country,
            value: { type: "SINGLE_SELECT", optionKey: "ng" },
            sourceType: "EVIDENCE_DOCUMENT",
          },
          {
            stepKey: FOUNDER_STEPS.description,
            value: { type: "TEXT", text: "Freight booking for West Africa." },
            sourceType: "EVIDENCE_DOCUMENT",
          },
          {
            stepKey: FOUNDER_STEPS.website,
            value: { type: "TEXT", text: "harbourline.example" },
            sourceType: "PUBLIC_WEBSITE",
          },
        ],
      },
    );
    const country = field(c, FOUNDER_STEPS.country);
    expect(country.state).toBe("SUPPLIED_UNCONFIRMED");
    expect(country.proposals[0]?.source).toBe("DOCUMENT");
    expect(country.display).toBeNull(); // never presented as saved
    expect(field(c, FOUNDER_STEPS.website).proposals[0]?.source).toBe(
      "PUBLIC_RESEARCH",
    );
    expect(c.summary.unconfirmed).toBe(3);

    const group = groupConfirmation(c, { sources: ["DOCUMENT"] });
    expect(group?.items.map((i) => i.fieldKey).sort()).toEqual(
      [FOUNDER_STEPS.country, FOUNDER_STEPS.description].sort(),
    );
    expect(group?.prompt).toMatch(/from your document/);
    // Same suggestions, same group, same idempotency keys: a retry writes nothing twice.
    const again = groupConfirmation(c, { sources: ["DOCUMENT"] });
    expect(again?.groupId).toBe(group?.groupId);
    const first = group?.items[0];
    if (group === null || group === undefined || first === undefined)
      throw new Error("no group");
    expect(confirmationItemKey(group.groupId, first.suggestionId)).toBe(
      confirmationItemKey(group.groupId, first.suggestionId),
    );
    expect(confirmationItemKey(group.groupId, first.suggestionId)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("a contradiction is CONTRADICTORY, first in line, and blocks completion", () => {
    const c = coverageOf(
      { [FOUNDER_STEPS.stage]: seed },
      {
        contradictions: [
          {
            stepKey: FOUNDER_STEPS.teamSize,
            readings: ["4 people", "12 people"],
          },
        ],
      },
    );
    const team = field(c, FOUNDER_STEPS.teamSize);
    expect(team.state).toBe("CONTRADICTORY");
    expect(team.readings).toEqual(["4 people", "12 people"]);
    expect(c.next[0]).toEqual({
      fieldKey: FOUNDER_STEPS.teamSize,
      reason: "CONTRADICTION",
    });
  });

  it("a set-aside optional field is never asked again", () => {
    const c = coverageOf(
      {},
      { skipped: [FOUNDER_STEPS.website, FOUNDER_STEPS.functions] },
    );
    expect(field(c, FOUNDER_STEPS.website).declined).toBe(true);
    expect(field(c, FOUNDER_STEPS.website).state).toBe("DEFERRABLE");
    const all = selectNextFields(c, 12).map((n) => n.fieldKey);
    expect(all).not.toContain(FOUNDER_STEPS.website);
    expect(all).not.toContain(FOUNDER_STEPS.functions);
  });

  it("a held save is not claimed, not re-asked, and blocks completion until it lands", () => {
    const c = coverageOf({}, {}, { pendingSaves: [FOUNDER_STEPS.companyName] });
    const name = field(c, FOUNDER_STEPS.companyName);
    expect(name.savePending).toBe(true);
    expect(name.state).toBe("MISSING");
    expect(c.next.map((n) => n.fieldKey)).not.toContain(
      FOUNDER_STEPS.companyName,
    );
    expect(c.summary.pendingSaves).toBe(1);
    expect(c.summary.canComplete).toBe(false);
  });

  it("a stated revenue figure without supporting documents is EVIDENCE_NEEDED; a held document settles it", () => {
    const answers = {
      [FOUNDER_STEPS.stage]: { type: "SINGLE_SELECT", optionKey: "series_a" },
      [FOUNDER_STEPS.revenueStatus]: {
        type: "SINGLE_SELECT",
        optionKey: "recurring",
      },
      [FOUNDER_STEPS.customers]: { type: "RANGE", value: "40" },
    } as const;
    const c = coverageOf(answers);
    expect(field(c, FOUNDER_STEPS.customers).state).toBe("EVIDENCE_NEEDED");
    expect(field(c, FOUNDER_STEPS.customers).evidenceWanted).toContain(
      "MANAGEMENT_ACCOUNTS",
    );
    const withDoc = coverageOf(
      answers,
      {},
      { documents: [{ documentType: "MANAGEMENT_ACCOUNTS" }] },
    );
    expect(field(withDoc, FOUNDER_STEPS.customers).state).toBe(
      "CONFIRMED_SAVED",
    );
  });

  it("copy falls back to English for an unknown language and keeps the lane-ml seam", () => {
    expect(onboardingCopyFor("fr-FR").saved(["Stage"])).toBe("Saved: Stage.");
    // Lane ml filled the seam: Arabic is a real catalog now.
    expect(onboardingCopyFor("ar-SA").saved(["Stage"])).toBe(
      "تم الحفظ: Stage.",
    );
    const custom = onboardingCopyFor("ar", {
      ar: { ...onboardingCopyFor("en"), saved: () => "تم الحفظ" },
    });
    expect(custom.saved(["x"])).toBe("تم الحفظ");
  });

  it("a registration fact, once saved, reads as saved, credited to where it was given", () => {
    const known = knownFactsFromRegistration(FOUNDER_COVERAGE_PROFILE, {
      organisationName: "Harbourline Cargo",
    });
    const view = viewOf(FOUNDER_DEFINITION_CURRENT, {
      [FOUNDER_STEPS.companyName]: { type: "TEXT", text: "Harbourline Cargo" },
    });
    const conversational = {
      ...view,
      responses: view.responses.map((r) => ({
        ...r,
        sourceModality: "TYPED_TEXT" as const,
        channel: "CONVERSATION" as const,
      })),
    };
    const c = deriveOnboardingCoverage({
      profile: FOUNDER_COVERAGE_PROFILE,
      definition: FOUNDER_DEFINITION_CURRENT,
      view: conversational,
      known,
      now: NOW,
    });
    const name = field(c, FOUNDER_STEPS.companyName);
    expect(name.state).toBe("CONFIRMED_SAVED");
    // Typed in the conversation is the conversation, never "the form".
    expect(name.source).toBe("CONVERSATION");
    const formView = {
      ...view,
      responses: view.responses.map((r) => ({
        ...r,
        sourceModality: "TYPED_TEXT" as const,
        channel: "FORM" as const,
      })),
    };
    expect(
      field(
        deriveOnboardingCoverage({
          profile: FOUNDER_COVERAGE_PROFILE,
          definition: FOUNDER_DEFINITION_CURRENT,
          view: formView,
          known,
          now: NOW,
        }),
        FOUNDER_STEPS.companyName,
      ).source,
    ).toBe("FORM");
  });

  it("an uploaded deck settles the materials field (live 2026-10-16)", () => {
    const c = coverageOf(
      {},
      {},
      { documents: [{ documentType: "PITCH_DECK" }] },
    );
    expect(field(c, FOUNDER_STEPS.materials)).toMatchObject({
      state: "CONFIRMED_SAVED",
      source: "DOCUMENT",
    });
  });
});

describe("QA QO-31: the sector is essential", () => {
  it("is asked before essentials are complete, since matching and Discover need it", () => {
    expect(FOUNDER_COVERAGE_PROFILE.fields["F1.categories"]?.priority).toBe(
      "ESSENTIAL",
    );
  });
});
