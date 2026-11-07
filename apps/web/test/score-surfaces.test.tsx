// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompanyScoresDtoSchema,
  notAssessedInvestability,
  UNICORN_PILLAR_IDS,
  UNICORN_POTENTIAL_SHORT_CAVEAT,
  type CompanyScoresDto,
  type UnicornPotentialDto,
} from "@capital-q/contracts";

/**
 * Metrics audit P0-6 (ADR 0076, PADL #046): wherever a Unicorn Potential
 * number is shown, its confidence, its coverage and "an indicator, not a
 * probability" are shown with it. Unknown is words, never 0.
 */

const q = vi.hoisted(() => ({ askAbout: vi.fn(), askNow: vi.fn() }));
vi.mock("@/components/app-shell/global-q", () => ({ useGlobalQ: () => q }));
vi.mock("../src/features/fit/fit-actions", () => ({
  fitProfilesAction: () => Promise.resolve(null),
}));

const { UnicornFigure, ScoreFigure } =
  await import("../src/features/relationships/pipeline-score-figure");
const { QRead } = await import("../src/features/discover/q-read");
const { UnicornPotential, unicornPotentialLine } =
  await import("../src/features/scores/unicorn-potential");
const { CompanyScores } = await import("../src/features/scores");
const { pipelineScoresOf } =
  await import("../src/features/relationships/pipeline-scores");

afterEach(cleanup);

const COMPANY = "c0000000-0000-4000-8000-000000000001";

const unicorn: UnicornPotentialDto = {
  status: "SCORED",
  overallScore: 62,
  band: "STRONG_SIGNALS",
  confidence: "LOW",
  coverage: 1,
  stage: "SEED",
  methodVersion: "unicorn-potential.v1.0.0",
  inputRulesVersion: "unicorn-inputs.v4",
  assessedAt: "2026-11-01T12:00:00.000Z",
  up: [],
  down: [],
  missing: [],
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
      state: "OBSERVED" as const,
      grade: 3,
      anchor: `Anchor ${id}${criterionId}`,
      sources: [
        {
          id: `claim-${id}${criterionId}`,
          revision: "revision-1",
          label: `Founder statement ${id}${criterionId}`,
          at: "2026-11-01T12:00:00.000Z",
          kind: "CLAIM" as const,
          truthClass: "USER_CLAIM" as const,
          evidenceStatus: "SELF_REPORTED" as const,
          visibilityScope: "network_visible" as const,
          lifecycleStatus: "CURRENT" as const,
        },
      ],
    })),
  })),
};

const scores: CompanyScoresDto = CompanyScoresDtoSchema.parse({
  companyId: COMPANY,
  investability: {
    ...notAssessedInvestability("investiq/v2+investability-inputs.v5"),
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
    assessedAt: "2026-10-16T12:00:00.000Z",
  },
  suitability: null,
  unicornPotential: unicorn,
});

const CAVEAT = new RegExp(UNICORN_POTENTIAL_SHORT_CAVEAT, "iu");

describe("Unicorn Potential: caveat, confidence and coverage on every surface", () => {
  it("the pipeline figure (UnicornFigure)", () => {
    const cell = pipelineScoresOf(scores).unicorn;
    if (cell === undefined || cell === null) throw new Error("no cell");
    render(<UnicornFigure cell={cell} companyId={COMPANY} variant="inline" />);
    const figure = document.querySelector('[data-pipeline-score="unicorn"]');
    expect(figure?.textContent).toMatch(/62/u);
    expect(figure?.textContent).toMatch(/Low confidence/u);
    expect(figure?.textContent).toMatch(/100% coverage/u);
    expect(screen.getByRole("link").getAttribute("aria-label")).toMatch(CAVEAT);
  });

  it("Q's read row in Discover", () => {
    render(<QRead scores={scores} companyName="Acme" />);
    const row = document.querySelector(
      '.cq-q-read [data-score="unicorn-potential"]',
    );
    expect(row?.textContent).toMatch(/Low confidence/u);
    expect(row?.textContent).toMatch(/100% coverage/u);
    expect(row?.textContent).toMatch(CAVEAT);
  });

  it("the collapsed assessment summary", () => {
    render(<UnicornPotential score={unicorn} companyId={COMPANY} />);
    const summary = document.querySelector("summary");
    expect(summary?.textContent).toMatch(CAVEAT);
    expect(summary?.textContent).toMatch(/Low confidence/u);
  });

  it("the compact score line, and its spoken label", () => {
    render(<CompanyScores scores={scores} variant="compact" />);
    const line = document.querySelector('[data-score="unicorn-potential"]');
    expect(line?.textContent).toMatch(/Low confidence/u);
    expect(line?.textContent).toMatch(CAVEAT);
    expect(unicornPotentialLine(unicorn)).toMatch(CAVEAT);
  });
});

describe("ScoreFigure: unknown is words, never 0", () => {
  it("reads an unknown score aloud as not known", () => {
    render(<ScoreFigure label="Investability" value={null} variant="cell" />);
    expect(screen.getByText("Not known yet")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b0\b/u);
  });

  it("shows a known score as its number", () => {
    render(<ScoreFigure label="Suitability" value={70} variant="column" />);
    expect(document.body.textContent).toMatch(/Suitability 70/u);
  });
});
