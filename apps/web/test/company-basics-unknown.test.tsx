// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FounderOnboardingActions } from "../src/features/founder-onboarding/controller/use-founder-onboarding";
import {
  GROUPS,
  planSubmissions,
} from "../src/features/founder-onboarding/models/journey";
import type { CompanyBasicsField } from "../src/features/founder-onboarding/models/presentation";
import { CompanyBasicsStep } from "../src/features/founder-onboarding/steps/company-basics-step";
import type { StepProps } from "../src/features/founder-onboarding/steps/step-props";

/**
 * Live founder re-check 2026-11-15 (64637e8c9), D9: on the form, a blank
 * Country and City were stored as the text "I don't know". A blank field
 * they did not touch stores nothing; their explicit "I don't know" is
 * recorded as unknown (DECISIONS 78), never as a city or a country.
 */

afterEach(cleanup);

const basics = GROUPS.find((g) => g.id === "company_basics");
const v10 = (required: readonly string[]) =>
  ({
    session: { definitionVersion: 10 },
    progress: {
      eligibleSteps: [
        "F1.company_name",
        "F1.website",
        "F1.country",
        "F1.city",
        "F1.founded_year",
      ].map((stepKey) => ({ stepKey, required: required.includes(stepKey) })),
    },
  }) as unknown as Parameters<typeof planSubmissions>[2];
const NEEDED = ["F1.company_name", "F1.country", "F1.city", "F1.founded_year"];

describe("D9: what a blank field stores", () => {
  if (basics === undefined) throw new Error("no company screen");

  it("a needed field left blank stores nothing (the run: Country and City)", () => {
    const plan = planSubmissions(
      basics,
      {
        kind: "company_basics",
        name: "Saltpan Freight (fictional)",
        website: "https://saltpanfreight.example",
        foundedYear: "2023",
      },
      v10(NEEDED),
    );
    expect(plan.find((s) => s.stepKey === "F1.country")).toEqual({
      stepKey: "F1.country",
      action: "leave",
    });
    expect(plan.find((s) => s.stepKey === "F1.city")).toEqual({
      stepKey: "F1.city",
      action: "leave",
    });
    // Nothing in the plan is the words "I don't know".
    expect(JSON.stringify(plan)).not.toMatch(/I don't know/u);
  });

  it("their explicit 'I don't know' is recorded as unknown (set aside), never as text", () => {
    const plan = planSubmissions(
      basics,
      {
        kind: "company_basics",
        name: "Saltpan Freight (fictional)",
        unknown: ["countryCode", "city"],
        foundedYear: "2023",
      },
      v10(NEEDED),
    );
    expect(plan.find((s) => s.stepKey === "F1.country")).toEqual({
      stepKey: "F1.country",
      action: "skip",
    });
    expect(plan.find((s) => s.stepKey === "F1.city")).toEqual({
      stepKey: "F1.city",
      action: "skip",
    });
  });

  it("an optional field left blank is set aside, as before", () => {
    const plan = planSubmissions(
      basics,
      { kind: "company_basics", name: "Saltpan Freight (fictional)" },
      v10(["F1.company_name"]),
    );
    expect(plan.find((s) => s.stepKey === "F1.city")?.action).toBe("skip");
    expect(plan.find((s) => s.stepKey === "F1.country")?.action).toBe("skip");
  });
});

function props(needsAnswer: readonly CompanyBasicsField[]) {
  const submit = vi.fn((_response: unknown) => Promise.resolve());
  const reached: Partial<FounderOnboardingActions> = { submit };
  const step: StepProps<"company_basics"> = {
    step: {
      id: "company_basics",
      kind: "company_basics",
      section: "company",
      title: "Your company",
      prompt: "What is it called?",
      optional: false,
      skipped: false,
      countries: [{ value: "NG", label: "Nigeria" }],
      asksCityAndYear: true,
      needsAnswer,
      response: { kind: "company_basics", name: "Saltpan Freight (fictional)" },
    },
    formId: "company-form",
    busy: false,
    actions: new Proxy(reached, {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : vi.fn(),
    }) as FounderOnboardingActions,
  };
  return { step, submit };
}

const continueForm = () => {
  const form = document.getElementById("company-form");
  if (form === null) throw new Error("no form");
  fireEvent.submit(form);
};

describe("D9: the form asks rather than guessing", () => {
  it("a needed field left blank is asked for, and nothing is sent", () => {
    const { step, submit } = props(["countryCode", "city", "foundedYear"]);
    render(<CompanyBasicsStep {...step} />);
    fireEvent.change(screen.getByLabelText("Year founded"), {
      target: { value: "2023" },
    });
    continueForm();
    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("Fill this in, or choose I don't know."),
    ).toHaveLength(2);
  });

  it("their 'I don't know' is sent as unknown, with the answers they gave", () => {
    const { step, submit } = props(["countryCode", "city", "foundedYear"]);
    render(<CompanyBasicsStep {...step} />);
    fireEvent.change(screen.getByLabelText("Year founded"), {
      target: { value: "2023" },
    });
    const notKnown = (field: string) => {
      const chip = document.querySelector(`[data-not-known="${field}"] button`);
      if (chip === null) throw new Error(`no I don't know for ${field}`);
      fireEvent.click(chip);
    };
    notKnown("countryCode");
    notKnown("city");
    continueForm();
    expect(submit).toHaveBeenCalledWith({
      kind: "company_basics",
      name: "Saltpan Freight (fictional)",
      foundedYear: "2023",
      unknown: ["countryCode", "city"],
    });
  });

  it("a field this journey does not need offers no 'I don't know' and may stay blank", () => {
    const { step, submit } = props([]);
    render(<CompanyBasicsStep {...step} />);
    expect(document.querySelector("[data-not-known]")).toBeNull();
    continueForm();
    expect(submit).toHaveBeenCalledWith({
      kind: "company_basics",
      name: "Saltpan Freight (fictional)",
    });
  });
});
