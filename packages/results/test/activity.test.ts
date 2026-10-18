import { describe, expect, it } from "vitest";

import { ResultsActivitySchema } from "@capital-q/contracts";

import { activitySeries, resultsWindow } from "../src/index.js";

/** Results dashboard: the bars behind the activity chart, by code. */

const NOW = new Date("2026-10-05T12:00:00Z");

describe("activitySeries", () => {
  it("a week is a bar a day, every day present, quiet days zero", () => {
    const window = resultsWindow({ range: "7d" }, NOW);
    expect(window).toMatchObject({ from: "2026-09-29", label: "Last 7 days" });
    const out = activitySeries(
      [
        { day: "2026-09-30", kind: "interest", count: 2 },
        { day: "2026-10-05", kind: "meeting", count: 1 },
        { day: "2026-10-05", kind: "connection", count: 3 },
        { day: "2026-09-01", kind: "interest", count: 9 },
      ],
      window,
    );
    expect(out.bucket).toBe("DAY");
    expect(out.points).toHaveLength(7);
    expect(out.points[1]).toEqual({
      start: "2026-09-30",
      interests: 2,
      connections: 0,
      meetings: 0,
    });
    expect(out.points[6]).toEqual({
      start: "2026-10-05",
      interests: 0,
      connections: 3,
      meetings: 1,
    });
    expect(ResultsActivitySchema.safeParse(out).success).toBe(true);
  });

  it("longer windows are a bar a week from Monday", () => {
    const out = activitySeries(
      [
        { day: "2026-09-07", kind: "interest", count: 1 },
        { day: "2026-09-13", kind: "interest", count: 1 },
      ],
      resultsWindow({ range: "90d" }, NOW),
    );
    expect(out.bucket).toBe("WEEK");
    const week = out.points.find((p) => p.start === "2026-09-07");
    expect(week?.interests).toBe(2);
    expect(out.points.every((p) => new Date(p.start).getUTCDay() === 1)).toBe(
      true,
    );
  });

  it("all time starts at the first event, at most 52 bars; nothing recorded, no bars", () => {
    const all = resultsWindow({ range: "all" }, NOW);
    expect(activitySeries([], all).points).toEqual([]);
    const out = activitySeries(
      [{ day: "2024-01-03", kind: "meeting", count: 1 }],
      all,
    );
    expect(out.points.length).toBe(52);
    expect(ResultsActivitySchema.safeParse(out).success).toBe(true);
  });
});
