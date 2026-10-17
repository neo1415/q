// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  UNICORN_PILLAR_IDS,
  UNICORN_POTENTIAL_CAVEAT,
  type UnicornPotentialDto,
} from "@capital-q/contracts";

import {
  UnicornPotential,
  unicornPotentialLine,
} from "../src/features/scores/unicorn-potential";
import {
  controlOf,
  resetControls,
  stateOf,
} from "../src/features/q/control/registry";
import { performOnControl } from "../src/features/q/control/perform";

const assessedAt = "2026-10-17T12:00:00.000Z";
const score: UnicornPotentialDto = {
  status: "SCORED",
  overallScore: 75,
  band: "STRONG_SIGNALS",
  confidence: "MODERATE",
  coverage: 1,
  stage: "SEED",
  methodVersion: "unicorn-potential.v1.0.0",
  inputRulesVersion: "unicorn-inputs.v1",
  assessedAt,
  up: [{ label: "Founder expertise", detail: "Relevant customer experience" }],
  down: [
    { label: "Distribution", detail: "Channel efficiency remains untested" },
  ],
  missing: ["Share dated retention cohorts"],
  momentum: null,
  benchmark: "Comparable benchmark unavailable",
  pillars: UNICORN_PILLAR_IDS.map((id) => ({
    id,
    label: `Pillar ${id}`,
    grade: 3,
    weight: 8,
    contribution: 6,
    coverage: 1,
    criteria: (["A", "B"] as const).map((criterionId) => ({
      id: criterionId,
      label: `Criterion ${id}${criterionId}`,
      state: "OBSERVED",
      grade: 3,
      anchor: `Bounded evidence anchor ${id}${criterionId}`,
      sources: [
        {
          id: `claim-${id}${criterionId}`,
          revision: "revision-2",
          label: `Founder statement ${id}${criterionId}`,
          at: assessedAt,
          kind: "CLAIM",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          visibilityScope: "network_visible",
          lifecycleStatus: "CURRENT",
        },
      ],
    })),
  })),
};

afterEach(() => {
  cleanup();
  resetControls();
});

describe("Unicorn Potential progressive assessment", () => {
  it("keeps the summary calm and all twelve pillar calculations available on expansion", () => {
    render(<UnicornPotential score={score} companyId="company-1" />);
    const root = document.querySelector<HTMLDetailsElement>(
      '[data-score="unicorn-potential"]',
    );
    expect(root?.open).toBe(false);
    const summary = root?.querySelector("summary");
    expect(summary?.textContent).toContain("75/100");
    expect(summary?.textContent).toContain("Moderate confidence");
    expect(summary?.textContent).toContain("100% coverage");
    expect(summary?.textContent).not.toContain("probability");
    expect(screen.getByText(UNICORN_POTENTIAL_CAVEAT).closest("details")).toBe(
      root,
    );
    expect(document.querySelectorAll("[data-unicorn-pillar]")).toHaveLength(12);
    for (const id of UNICORN_PILLAR_IDS) {
      const pillar = document.querySelector(
        `[data-unicorn-pillar="${id}"]`,
      ) as HTMLElement;
      expect(pillar.textContent).toContain("3/4 grade");
      expect(pillar.textContent).toContain("8% weight");
      expect(pillar.textContent).toContain("6 points");
      expect(within(pillar).getByText(`Criterion ${id}A`)).toBeTruthy();
      expect(within(pillar).getByText(`Criterion ${id}B`)).toBeTruthy();
    }
    fireEvent.click(summary as HTMLElement);
    expect(root?.open).toBe(true);
  });

  it("shows source lineage and support without pretending a founder claim is verified", () => {
    render(<UnicornPotential score={score} companyId="company-1" />);
    const source = screen
      .getByText("Founder statement P1A")
      .closest("li") as HTMLElement;
    expect(source.textContent).toContain(
      "user claim · self reported · current",
    );
    expect(source.textContent).toContain("Oct 17, 2026");
    expect(source.textContent).toContain("network visible");
    expect(source.textContent).toContain("claim-P1A · revision revision-2");
    expect(source.textContent).not.toContain("verified");
    expect(screen.getByText("Bounded evidence anchor P1A")).toBeTruthy();
    expect(screen.getByText("Share dated retention cohorts")).toBeTruthy();
  });

  it("preserves insufficient evidence as unscored, including unknown criteria", () => {
    const thin: UnicornPotentialDto = {
      ...score,
      status: "INSUFFICIENT_EVIDENCE",
      overallScore: null,
      band: null,
      coverage: 0,
      confidence: "LOW",
      pillars: score.pillars.map((p) => ({
        ...p,
        grade: null,
        contribution: null,
        coverage: 0,
        criteria: p.criteria.map((c) => ({
          ...c,
          state: "UNKNOWN",
          grade: null,
          sources: [],
        })),
      })),
    };
    render(<UnicornPotential score={thin} companyId="company-1" />);
    const summary = document.querySelector(
      '[data-score="unicorn-potential"] > summary',
    );
    expect(summary?.textContent).toContain("Insufficient evidence");
    expect(summary?.textContent).not.toContain("/100");
    expect(
      document.querySelector('[data-unicorn-pillar="P1"]')?.textContent,
    ).toContain("Unscored");
    expect(screen.getAllByText("No eligible source recorded")).toHaveLength(24);
    expect(unicornPotentialLine(thin)).toBe(
      "Unicorn Potential: insufficient evidence",
    );
  });

  it("shows no invented momentum or cohort percentile when history is absent", () => {
    render(<UnicornPotential score={score} companyId="company-1" />);
    expect(screen.getByText("Not enough history")).toBeTruthy();
    expect(screen.getByText("Comparable benchmark unavailable")).toBeTruthy();
    expect(document.querySelectorAll("svg, canvas")).toHaveLength(0);
  });

  it("shows the supplied comparable change, both dates and its real drivers", () => {
    render(
      <UnicornPotential
        score={{
          ...score,
          momentum: {
            delta: 5,
            previousScore: 70,
            previousAt: "2026-10-16T12:00:00.000Z",
            drivers: ["New retention evidence shared"],
          },
        }}
        companyId="company-1"
      />,
    );
    const momentum = screen.getByRole("region", { name: "Unicorn Momentum" });
    expect(momentum.textContent).toContain(
      "+5 points · 70/100 on Oct 16, 2026 → 75/100 on Oct 17, 2026",
    );
    expect(momentum.textContent).toContain("New retention evidence shared");
  });

  it("registers a real native Q disclosure and confirms actual opening and closing", async () => {
    render(<UnicornPotential score={score} companyId="company-1" />);
    const entry = controlOf("disclosure.unicorn-potential");
    expect(entry?.kind).toBe("DISCLOSURE");
    if (entry === undefined) throw new Error("Disclosure was not registered");
    const element = entry?.element();
    expect(element?.tagName).toBe("SUMMARY");
    expect(stateOf("DISCLOSURE", element as HTMLElement)).toBe("CLOSED");
    expect(
      await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_unicorn_test",
        act: "OPEN",
        target: "disclosure.unicorn-potential",
      }),
    ).toBe("DONE");
    expect(stateOf("DISCLOSURE", element as HTMLElement)).toBe("OPEN");
    expect((element?.parentElement as HTMLDetailsElement).open).toBe(true);
    expect(
      await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_unicorn_test",
        act: "CLOSE",
        target: "disclosure.unicorn-potential",
      }),
    ).toBe("DONE");
    expect((element?.parentElement as HTMLDetailsElement).open).toBe(false);
  });
});
