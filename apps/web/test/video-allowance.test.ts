import { describe, expect, it } from "vitest";

import { videoAllowanceLine } from "@/features/video-room/video-allowance";

const week = { weeklySessions: 5, resetsAt: "2026-10-19T00:00:00.000Z" };

describe("the shared video allowance wording", () => {
  it("counts what is left this week", () => {
    expect(videoAllowanceLine({ ...week, remaining: 3 })).toBe(
      "3 of 5 video sessions left this week.",
    );
    expect(videoAllowanceLine({ ...week, remaining: 1 })).toBe(
      "1 of 5 video sessions left this week.",
    );
  });

  it("says plainly when it is used up and when it starts again", () => {
    expect(videoAllowanceLine({ ...week, remaining: 0 })).toBe(
      "You’ve used this week’s 5 video sessions. They start again on Monday 19 October.",
    );
  });

  it("says nothing when the server could not tell", () => {
    expect(videoAllowanceLine(null)).toBeNull();
    expect(videoAllowanceLine(undefined)).toBeNull();
  });
});
