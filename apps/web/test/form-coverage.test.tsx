// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding/definition";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding/definition";

import { viewOf } from "../../../packages/onboarding/test/support/coverage-view";
import { CoverageOverview } from "../src/features/onboarding-kit/components/coverage-overview";
import {
  coverageFor,
  phasesFor,
  summaryWords,
} from "../src/features/onboarding-kit/coverage";

/**
 * Owner directive 2026-10-16, "Form onboarding equally capable": the form
 * renders lane ob1's canonical coverage, so it shows what Q recorded, what
 * Q only proposed (never as saved), and what registration already said.
 */
afterEach(cleanup);

const NOW = new Date("2026-10-16T10:00:00.000Z");

function founderCoverage(
  answers: Parameters<typeof viewOf>[1],
  extra: Parameters<typeof viewOf>[2] = {},
  registeredOrganisation: string | null = null,
) {
  return coverageFor({
    journey: "founder",
    view: viewOf(FOUNDER_DEFINITION_CURRENT, answers, extra),
    registeredOrganisation,
    now: NOW,
  });
}

function field(coverage: ReturnType<typeof founderCoverage>, key: string) {
  const found = coverage.fields.find((f) => f.fieldKey === key);
  if (found === undefined) throw new Error(`no field ${key}`);
  return found;
}

describe("coverage the form shares with Q", () => {
  it("knows the company from registration and never treats it as missing", () => {
    const coverage = founderCoverage({}, {}, "Harbourline Cargo");
    const name = field(coverage, "F1.company_name");
    expect(name.state).toBe("KNOWN");
    expect(name.source).toBe("REGISTRATION");
    expect(name.display).toBe("Harbourline Cargo");
    expect(coverage.next.map((n) => n.fieldKey)).not.toContain(
      "F1.company_name",
    );
  });

  it("an answer given to Q in conversation is on the record in the form", () => {
    const view = viewOf(FOUNDER_DEFINITION_CURRENT, {
      "F1.stage": { type: "SINGLE_SELECT", optionKey: "seed" },
    });
    const spoken = {
      ...view,
      responses: view.responses.map((r) => ({
        ...r,
        sourceModality: "VOICE_TRANSCRIPT" as const,
      })),
    };
    const coverage = coverageFor({
      journey: "founder",
      view: spoken,
      registeredOrganisation: null,
      now: NOW,
    });
    expect(field(coverage, "F1.stage").state).toBe("CONFIRMED_SAVED");
    expect(field(coverage, "F1.stage").source).toBe("CONVERSATION");
  });

  it("investor coverage is the mandate, not founder fundraising questions", () => {
    const coverage = coverageFor({
      journey: "investor",
      view: viewOf(INVESTOR_DEFINITION_V1, {}),
      registeredOrganisation: "Savanna Seed",
      now: NOW,
    });
    expect(coverage.fields.some((f) => f.fieldKey.startsWith("F"))).toBe(false);
    expect(
      coverage.fields.find((f) => f.fieldKey === "I0.organisation_name")?.state,
    ).toBe("KNOWN");
  });
});

describe("the overview", () => {
  it("shows a quiet summary, then every field with its state in words", async () => {
    const coverage = founderCoverage(
      { "F1.stage": { type: "SINGLE_SELECT", optionKey: "seed" } },
      {
        suggestions: [
          {
            stepKey: "F1.description",
            value: { type: "TEXT", text: "Freight booking for West Africa" },
            sourceType: "EVIDENCE_DOCUMENT",
          },
        ],
      },
      "Harbourline Cargo",
    );
    const onResolve = vi.fn(() => Promise.resolve(true));
    const onOpen = vi.fn();
    render(
      <CoverageOverview
        coverage={coverage}
        phases={phasesFor("founder")}
        busy={false}
        onOpen={onOpen}
        onResolve={onResolve}
      />,
    );
    expect(screen.getByText(summaryWords(coverage))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "What Q has" }));

    const row = (key: string) => {
      const element = document.querySelector(`[data-coverage-field="${key}"]`);
      if (!(element instanceof HTMLElement)) throw new Error(`no row ${key}`);
      return within(element);
    };
    row("F1.company_name").getByText("From your sign-up");
    row("F1.stage").getByText("Saved");
    // Proposed from a document: waiting, never saved.
    row("F1.description").getByText("Waiting for you to confirm");
    expect(row("F1.description").queryByText("Saved")).toBeNull();
    row("F1.description").getByText(/from a document you shared/);
    expect(row("F1.company_name").getByText("Required")).toBeTruthy();

    await userEvent.click(
      row("F1.description").getByRole("button", { name: /Confirm/ }),
    );
    expect(onResolve).toHaveBeenCalledWith(expect.any(String), "ACCEPT");

    await userEvent.click(
      row("F1.country").getByRole("button", { name: /Answer/ }),
    );
    expect(onOpen).toHaveBeenCalledWith("F1.country");
  });

  it("says so when a confirmation could not be recorded", async () => {
    const coverage = founderCoverage(
      {},
      {
        suggestions: [
          {
            stepKey: "F1.website",
            value: { type: "TEXT", text: "https://harbourline.example" },
            sourceType: "PUBLIC_WEBSITE",
          },
        ],
      },
    );
    render(
      <CoverageOverview
        coverage={coverage}
        phases={phasesFor("founder")}
        busy={false}
        onOpen={undefined}
        onResolve={() => Promise.resolve(false)}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "What Q has" }));
    await userEvent.click(screen.getByRole("button", { name: /Not right/ }));
    expect(screen.getByRole("alert").textContent).toContain("wasn't recorded");
  });
});
