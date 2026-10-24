// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompanyScoresDtoSchema,
  notAssessedInvestability,
  type CompanyScoresDto,
  type FitCompanyDto,
  type UnicornPotentialDto,
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
  it("adds an entitled third assessment without changing either existing score", () => {
    const unicornPotential: UnicornPotentialDto = {
      status: "NOT_ASSESSED",
      overallScore: null,
      band: null,
      confidence: "LOW",
      coverage: 0,
      stage: null,
      methodVersion: "unicorn-potential.v1.0.0",
      inputRulesVersion: "unicorn-inputs.v1",
      assessedAt: null,
      pillars: [],
      up: [],
      down: [],
      missing: [],
      momentum: null,
      benchmark: "Comparable benchmark unavailable",
    };
    const premium = { ...scored, unicornPotential };
    const { rerender } = render(<CompanyScores scores={premium} />);
    expect(
      document.querySelector('[data-score="investability"]')?.textContent,
    ).toContain("58");
    expect(
      document.querySelector('[data-score="suitability"]')?.textContent,
    ).toContain("80");
    expect(
      document.querySelector('[data-score="unicorn-potential"] > summary')
        ?.textContent,
    ).toContain("Not assessed yet");
    expect(companyScoresLabel(premium)).toContain(
      "Unicorn Potential: not assessed yet",
    );
    rerender(<CompanyScores scores={premium} unicornDetails={false} />);
    const overviewLink = screen.getByRole("link", {
      name: "Unicorn Potential: not assessed yet · View assessment",
    });
    expect(overviewLink.getAttribute("href")).toBe(
      `/company/${COMPANY}?tab=overview#unicorn-potential-${COMPANY}`,
    );
    expect(
      document.querySelector('[data-score="unicorn-potential"] > summary'),
    ).toBeNull();
    rerender(<CompanyScores scores={premium} variant="compact" />);
    expect(
      document.querySelector('[data-score="unicorn-potential"]')?.textContent,
    ).toBe("Unicorn Potential: not assessed yet");
    expect(document.querySelector("details")).toBeNull();
    rerender(<CompanyScores scores={scored} variant="full" />);
    expect(
      document.querySelector('[data-score="unicorn-potential"]'),
    ).toBeNull();
    expect(companyScoresLabel(scored)).not.toContain("Unicorn");
  });

  it("shows both scores separately, with coverage, confidence and why", () => {
    render(<CompanyScores scores={scored} variant="full" />);
    const inv = document.querySelector('[data-score="investability"]');
    const suit = document.querySelector('[data-score="suitability"]');
    expect(inv?.textContent).toContain("58");
    expect(inv?.textContent).toContain(
      "Based on 15 of 46 factors · 5 of 8 areas",
    );
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
      "Investability: not enough shared evidence yet · based on 15 of 46 factors",
    );
    expect(line?.textContent).toContain("Suitability 80 · 6 of 7 known");
    expect(line?.getAttribute("aria-label")).toBe(companyScoresLabel(thin));
  });

  it("the minimal tile variant keeps the full sentence as its name", () => {
    render(<CompanyScores scores={scored} variant="minimal" />);
    const tile = document.querySelector('[data-company-scores="minimal"]');
    expect(tile?.getAttribute("aria-label")).toContain(
      "Investability 58 · based on 15 of 46 factors",
    );
    // One clean signal on the tile: the fit with this viewer.
    expect(tile?.textContent).toBe("Suitability 80");
  });

  it("a tile drops an unscored Unicorn Potential from its visible line, never from its name", () => {
    // Owner QA 23 Oct: "Inv. 58 · Suit. 80 · Un" was cut off on a phone.
    const unscored = {
      ...scored,
      unicornPotential: {
        status: "INSUFFICIENT_EVIDENCE",
        overallScore: null,
        band: null,
        confidence: "LOW",
        coverage: 0,
        stage: null,
        methodVersion: "unicorn-potential.v1.0.0",
        inputRulesVersion: "unicorn-inputs.v1",
        assessedAt: null,
        pillars: [],
        up: [],
        down: [],
        missing: [],
        momentum: null,
        benchmark: "Comparable benchmark unavailable",
      } satisfies UnicornPotentialDto,
    };
    render(<CompanyScores scores={unscored} variant="minimal" />);
    const tile = document.querySelector('[data-company-scores="minimal"]');
    expect(tile?.textContent).not.toContain("Unicorn");
    expect(tile?.getAttribute("aria-label")).toBe(companyScoresLabel(unscored));
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

describe("score read authorization lifetime", () => {
  it("reauthorizes a company after remount instead of reusing a prior reader's result", async () => {
    const port = vi.fn((ids: readonly string[]) =>
      Promise.resolve(
        ids.map((companyId) => ({
          companyId,
          name: "Co",
          line: null,
          profile: {} as never,
          scores: { ...scored, companyId },
        })),
      ),
    );
    function Card() {
      const scores = useCompanyScores([COMPANY], { port });
      return <CompanyScoresFor scores={scores} companyId={COMPANY} />;
    }
    const first = render(<Card />);
    await waitFor(() => expect(port).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        document.querySelector('[data-company-scores="compact"]'),
      ).not.toBeNull(),
    );
    first.unmount();
    render(<Card />);
    await waitFor(() => expect(port).toHaveBeenCalledTimes(2));
  });
  it("does not combine two authorized readers queued in the same tick", async () => {
    const entitled = vi.fn((ids: readonly string[]) =>
      Promise.resolve(
        ids.map((companyId) => ({
          companyId,
          name: "Co",
          line: null,
          profile: {} as never,
          scores: { ...scored, companyId },
        })),
      ),
    );
    const denied = vi.fn(() => Promise.resolve([]));
    function Card({
      port,
      label,
    }: {
      readonly port: (
        ids: readonly string[],
      ) => Promise<readonly FitCompanyDto[]>;
      readonly label: string;
    }) {
      const scores = useCompanyScores([COMPANY], { port });
      return (
        <div data-testid={label}>
          {scores.has(COMPANY) ? "authorized score" : "no score"}
        </div>
      );
    }
    render(
      <>
        <Card port={entitled} label="entitled" />
        <Card port={denied} label="denied" />
      </>,
    );
    await waitFor(() => expect(entitled).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("entitled").textContent).toBe(
        "authorized score",
      ),
    );
    expect(screen.getByTestId("denied").textContent).toBe("no score");
  });
  it("does not attach a new reader to an earlier in-flight request", async () => {
    let finish: ((value: readonly FitCompanyDto[]) => void) | undefined;
    const earlier = vi.fn(
      () =>
        new Promise<readonly FitCompanyDto[]>((resolve) => {
          finish = resolve;
        }),
    );
    const later = vi.fn(() => Promise.resolve([]));
    function Card({
      port,
    }: {
      port: (ids: readonly string[]) => Promise<readonly FitCompanyDto[]>;
    }) {
      useCompanyScores([COMPANY], { port });
      return null;
    }
    const first = render(<Card port={earlier} />);
    await waitFor(() => expect(earlier).toHaveBeenCalledTimes(1));
    first.unmount();
    render(<Card port={later} />);
    await waitFor(() => expect(later).toHaveBeenCalledTimes(1));
    finish?.([]);
  });
});
