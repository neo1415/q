// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompanyScoresDtoSchema,
  notAssessedInvestability,
  type CompanyScoresDto,
  type FitCompanyDto,
} from "@capital-q/contracts";

/**
 * Investability and Suitability on screen (owner 2026-10-16; ADR 0074): two
 * separate scores, each with its coverage and confidence in words; "not
 * enough evidence" is words, never a number; the why opens what raised,
 * lowered and would raise confidence; cards share one batched read.
 */

vi.mock("../src/features/fit/fit-actions", () => ({
  fitProfilesAction: () => Promise.resolve(null),
}));

const {
  CompanyScores,
  companyScoresLabel,
  useCompanyScores,
  CompanyScoresFor,
  resetCompanyScoresCache,
} = await import("../src/features/scores");

afterEach(() => {
  cleanup();
  resetCompanyScoresCache();
});

const COMPANY = "c0000000-0000-4000-8000-000000000001";

const scored: CompanyScoresDto = CompanyScoresDtoSchema.parse({
  companyId: COMPANY,
  investability: {
    ...notAssessedInvestability("investiq/v1+investability-inputs.v1"),
    status: "SCORED",
    score: 58,
    band: "DEVELOPING",
    confidence: "LOW",
    cappedByConfidence: true,
    coverage: {
      areasScored: 5,
      areasTotal: 8,
      criteriaScored: 15,
      criteriaApplicable: 46,
    },
    stage: "Seed",
    up: [{ label: "Traction", detail: "Dated traction · self-reported" }],
    down: [],
    missing: ["Governance: board and reporting arrangements"],
    assessedAt: "2026-10-16T12:00:00.000Z",
  },
  suitability: {
    status: "SCORED",
    score: 80,
    band: "GOOD_FIT",
    confidence: "MEDIUM",
    coverage: { known: 6, applicable: 7 },
    up: [{ label: "Stage", detail: "Their stage is one you invest at." }],
    down: [],
    missing: ["Traction: not known yet"],
    configVersion: "ranking-config.v4",
  },
});

describe("CompanyScores", () => {
  it("shows both scores separately, with coverage, confidence and why", () => {
    render(<CompanyScores scores={scored} variant="full" />);
    const inv = document.querySelector('[data-score="investability"]');
    const suit = document.querySelector('[data-score="suitability"]');
    expect(inv?.textContent).toContain("58");
    expect(inv?.textContent).toContain("Based on 5 of 8 areas");
    expect(inv?.textContent).toContain("Developing · Low confidence");
    expect(suit?.textContent).toContain("80");
    expect(suit?.textContent).toContain("6 of 7 of your criteria known");
    expect(screen.getAllByText("Why")).toHaveLength(2);
    expect(screen.getByText("Traction")).toBeTruthy();
    expect(
      screen.getByText("Governance: board and reporting arrangements"),
    ).toBeTruthy();
    // Never one blended number.
    expect(document.body.textContent).not.toContain("69");
  });

  it("says too little evidence in words, never as a number", () => {
    const thin: CompanyScoresDto = {
      ...scored,
      investability: {
        ...scored.investability,
        status: "INSUFFICIENT_EVIDENCE",
        score: null,
        band: null,
        confidence: null,
      },
    };
    render(<CompanyScores scores={thin} variant="compact" />);
    const line = document.querySelector('[data-company-scores="compact"]');
    expect(line?.textContent).toContain(
      "Investability: not enough shared evidence yet · based on 5 of 8 areas",
    );
    expect(line?.textContent).toContain("Suitability 80 · 6 of 7 known");
    expect(line?.getAttribute("aria-label")).toBe(companyScoresLabel(thin));
  });

  it("the minimal tile variant keeps the full sentence as its name", () => {
    render(<CompanyScores scores={scored} variant="minimal" />);
    const tile = document.querySelector('[data-company-scores="minimal"]');
    expect(tile?.getAttribute("aria-label")).toContain(
      "Investability 58 · based on 5 of 8 areas",
    );
    expect(tile?.textContent).toContain("58");
    expect(tile?.textContent).toContain("80");
  });

  it("cards on one page share one batched read", async () => {
    const calls: string[][] = [];
    const port = (ids: readonly string[]) => {
      calls.push([...ids]);
      return Promise.resolve(
        ids.map((id): FitCompanyDto => ({
          companyId: id,
          name: "Co",
          line: null,
          profile: {} as never,
          scores: { ...scored, companyId: id },
        })),
      );
    };
    const OTHER = "c0000000-0000-4000-8000-000000000002";
    function Card({ id }: { readonly id: string }) {
      const scores = useCompanyScores([id], { port });
      return <CompanyScoresFor scores={scores} companyId={id} />;
    }
    render(
      <>
        <Card id={COMPANY} />
        <Card id={OTHER} />
      </>,
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-company-scores="compact"]'),
      ).toHaveLength(2),
    );
    expect(calls).toHaveLength(1);
    expect([...(calls[0] ?? [])].sort()).toEqual([COMPANY, OTHER].sort());
  });
});
