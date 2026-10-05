import { describe, expect, it } from "vitest";

import { scoreChanges } from "@/features/rehearsal/rehearsals-home";
import {
  activityTotals,
  commitmentLines,
  orderedStages,
  rangeOf,
  stageHref,
  stateWord,
  waitWords,
} from "@/features/results/results-words";

/** Results dashboard and Rehearsals page: the words and sums, by code. */

describe("results words", () => {
  it("reads a known period, else 30 days", () => {
    expect(rangeOf("7d")).toBe("7d");
    expect(rangeOf("12m")).toBe("12m");
    expect(rangeOf("bogus")).toBe("30d");
    expect(rangeOf(undefined)).toBe("30d");
  });

  it("orders the pipeline forward, drops empty stages, names the side", () => {
    expect(
      orderedStages([
        { state: "DECLINED", count: 2 },
        { state: "CONNECTED", count: 6 },
        { state: "CLOSED", count: 0 },
        { state: "INTEREST_EXPRESSED", count: 1 },
      ]).map((s) => s.state),
    ).toEqual(["INTEREST_EXPRESSED", "CONNECTED", "DECLINED"]);
    expect(stateWord("INTEREST_EXPRESSED", "INVESTOR")).toBe("Interest sent");
    expect(stateWord("INTEREST_EXPRESSED", "FOUNDER")).toBe(
      "Interested in you",
    );
  });

  it("keeps a review page's own query in drill-down links", () => {
    expect(stageHref("/results", "7d", "CONNECTED")).toBe(
      "/results?range=7d&stage=CONNECTED#pipeline",
    );
    expect(stageHref("/dev/results?side=founder", "all", null)).toBe(
      "/dev/results?side=founder&range=all#pipeline",
    );
  });

  it("says waits in hours, then days", () => {
    expect(waitWords(0.4)).toBe("Under 1 h");
    expect(waitWords(14.2)).toBe("14 h");
    expect(waitWords(72)).toBe("3 days");
  });

  it("sums activity, and an absent series is unknown, not zero", () => {
    expect(activityTotals(undefined)).toBeNull();
    expect(
      activityTotals({
        bucket: "DAY",
        points: [
          { start: "2026-10-01", interests: 1, connections: 0, meetings: 2 },
          { start: "2026-10-02", interests: 3, connections: 1, meetings: 0 },
        ],
      }),
    ).toEqual({ interests: 4, connections: 1, meetings: 2 });
  });

  it("never adds commitments across currencies", () => {
    const lines = commitmentLines([
      { status: "CONFIRMED", currencyCode: "USD", count: 1, amount: "250000" },
      {
        status: "CONFIRMED",
        currencyCode: "NGN",
        count: 2,
        amount: "1000000.5",
      },
    ]);
    expect(lines[0]).toEqual({
      status: "CONFIRMED",
      label: "Confirmed",
      count: 3,
      amounts: ["USD 250,000", "NGN 1,000,000.50"],
    });
    expect(lines[2]?.count).toBe(0);
  });
});

describe("rehearsal score changes", () => {
  it("compares each score with the one before with the same person", () => {
    const row = (
      id: string,
      who: string,
      at: string,
      score: number | null,
    ) => ({
      id,
      counterpart: {
        kind: "INVESTOR_ORGANISATION" as const,
        id: who,
        name: who,
      },
      status: "FINISHED" as const,
      outcome: null,
      score,
      exchanges: 1,
      createdAt: at,
    });
    const changes = scoreChanges([
      row("c", "a", "2026-10-03T00:00:00Z", 58),
      row("x", "b", "2026-10-02T12:00:00Z", 90),
      row("b", "a", "2026-10-02T00:00:00Z", null),
      row("a", "a", "2026-10-01T00:00:00Z", 46),
    ]);
    expect(changes.get("c")).toBe(12);
    expect(changes.has("a")).toBe(false);
    expect(changes.has("x")).toBe(false);
  });
});
