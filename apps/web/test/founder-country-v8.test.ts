import { describe, expect, it } from "vitest";

import {
  FOUNDER_STEPS,
  founderCountryAnswer,
} from "@capital-q/founder-onboarding/definition";
import { countryOfIso } from "@capital-q/taxonomy/countries";

import { FOUNDER_VOCABULARY } from "../src/features/founder-onboarding/conversation-adapter";
import {
  countryChoices,
  groupById,
  planSubmissions,
} from "../src/features/founder-onboarding/models/journey";

/**
 * Owner 2026-10-30: the founder's country comes from the one canonical
 * country list ("Copenhagen, Denmark" was saved as "other" when the step
 * offered twenty countries). v8 takes a geography node; a session pinned
 * to v1-v7 keeps its option list.
 */
const basics = groupById("company_basics");
const viewAt = (definitionVersion: number) => ({
  session: { definitionVersion },
  progress: { eligibleSteps: [] },
});

describe("the founder's country on the setup screen (v8)", () => {
  it("offers every country to a v8 session, and an older session its own list", () => {
    const v8 = countryChoices(8).map((c) => c.value);
    expect(v8).toContain("DK");
    expect(v8.length).toBe(249);
    const v7 = countryChoices(7).map((c) => c.value);
    expect(v7).toContain("QA");
    expect(v7).not.toContain("DK");
  });

  it("saves a v8 country as its geography node, and a v7 one as its option", () => {
    if (basics === undefined) throw new Error("no company basics screen");
    const response = {
      kind: "company_basics",
      name: "Nordlys",
      countryCode: "DK",
    } as const;
    const country = (definitionVersion: number) =>
      planSubmissions(basics, response, viewAt(definitionVersion)).find(
        (s) => s.stepKey === FOUNDER_STEPS.country,
      );
    expect(country(8)).toEqual({
      stepKey: FOUNDER_STEPS.country,
      action: "submit",
      value: founderCountryAnswer("DK"),
    });
    expect(country(7)).toEqual({
      stepKey: FOUNDER_STEPS.country,
      action: "submit",
      value: { type: "SINGLE_SELECT", optionKey: "dk" },
    });
  });

  it("searches the country among countries only, in the conversation", () => {
    const found = FOUNDER_VOCABULARY.searchFor?.(FOUNDER_STEPS.country, "den");
    expect(found?.[0]).toMatchObject({
      nodeId: countryOfIso("DK")?.nodeId,
      label: "Denmark",
    });
    expect(
      FOUNDER_VOCABULARY.searchFor?.(FOUNDER_STEPS.country, "africa")?.every(
        (c) => c.label.endsWith("Africa") || c.label.includes("African"),
      ),
    ).toBe(true);
    expect(
      FOUNDER_VOCABULARY.searchFor?.(FOUNDER_STEPS.categories, "den"),
    ).toBeUndefined();
    expect(
      FOUNDER_VOCABULARY.describe(
        FOUNDER_STEPS.country,
        founderCountryAnswer("DK"),
      ),
    ).toBe("Denmark");
  });
});
