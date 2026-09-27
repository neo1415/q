import { describe, expect, it } from "vitest";

import {
  decideOnboardingNudge,
  EMPTY_NUDGE_STATE,
  minutesLeft,
  ONBOARDING_NUDGE_POLICY,
  recordNudgeChoice,
  recordNudgeShown,
  type OnboardingNudgeProgress,
  type OnboardingNudgeState,
  type OnboardingNudgeSurface,
} from "../src/domain/nudge-policy.js";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-09-01T09:00:00Z");
const at = (days: number, hours = 0) =>
  new Date(START + days * DAY + hours * 60 * 60 * 1000);

function progress(
  done: number,
  required = 9,
  lastActivityAt = at(-2),
): OnboardingNudgeProgress {
  return {
    status: "ACTIVE",
    requiredCount: required,
    requiredDoneCount: done,
    lastActivityAt,
  };
}

/** Every day at 10:00 for `days` days, the days a reminder was given. */
function simulate(
  p: OnboardingNudgeProgress,
  days: number,
  surface: OnboardingNudgeSurface = "BRIEFING",
  state: OnboardingNudgeState = EMPTY_NUDGE_STATE,
): number[] {
  const shown: number[] = [];
  let current = state;
  for (let day = 0; day < days; day += 1) {
    const now = at(day, 1);
    const decision = decideOnboardingNudge({
      progress: p,
      state: current,
      now,
      surface,
    });
    if (decision.due) {
      shown.push(day);
      current = recordNudgeShown({ state: current, progress: p, now, surface });
    }
  }
  return shown;
}

describe("onboarding nudge policy", () => {
  it("is versioned", () => {
    expect(ONBOARDING_NUDGE_POLICY.version).toMatch(/^onboarding-nudge\//);
  });

  it("is quiet for someone who has not started, or is done", () => {
    const base = {
      state: EMPTY_NUDGE_STATE,
      now: at(0),
      surface: "BRIEFING" as const,
    };
    expect(decideOnboardingNudge({ ...base, progress: null })).toEqual({
      due: false,
      reason: "NOT_STARTED",
    });
    expect(
      decideOnboardingNudge({
        ...base,
        progress: { ...progress(3), status: "COMPLETED" },
      }),
    ).toEqual({ due: false, reason: "COMPLETE" });
    expect(decideOnboardingNudge({ ...base, progress: progress(9) })).toEqual({
      due: false,
      reason: "COMPLETE",
    });
    expect(
      decideOnboardingNudge({ ...base, progress: progress(0, 0) }),
    ).toEqual({ due: false, reason: "NOTHING_REQUIRED" });
  });

  it("is eligible at any progress below 100%, strongest at or below half", () => {
    for (let done = 0; done < 9; done += 1) {
      const decision = decideOnboardingNudge({
        progress: progress(done),
        state: EMPTY_NUDGE_STATE,
        now: at(0),
        surface: "BRIEFING",
      });
      expect(decision.due).toBe(true);
      if (decision.due) {
        expect(decision.emphasis).toBe(done / 9 <= 0.5 ? "STRONG" : "LIGHT");
      }
    }
  });

  it("backs off: daily, then every 2, 4, then weekly at most (≤50%)", () => {
    expect(simulate(progress(2), 40)).toEqual([0, 1, 3, 7, 14, 21, 28, 35]);
  });

  it("starts lighter past halfway", () => {
    expect(simulate(progress(6), 30)).toEqual([0, 2, 6, 13, 20, 27]);
  });

  it("never twice in one calendar day, whichever surface", () => {
    const p = progress(2);
    const state = recordNudgeShown({
      state: EMPTY_NUDGE_STATE,
      progress: p,
      now: at(0, 1),
      surface: "BRIEFING",
    });
    for (const surface of ["BRIEFING", "Q_NOTE"] as const) {
      expect(
        decideOnboardingNudge({ progress: p, state, now: at(0, 10), surface }),
      ).toEqual({ due: false, reason: "ALREADY_TODAY" });
    }
  });

  it("mentions it at most once in one Q conversation, even days later", () => {
    const p = progress(2);
    const state = recordNudgeShown({
      state: EMPTY_NUDGE_STATE,
      progress: p,
      now: at(0, 1),
      surface: "Q_NOTE",
      conversationId: "c-1",
    });
    expect(
      decideOnboardingNudge({
        progress: p,
        state,
        now: at(9),
        surface: "Q_NOTE",
        conversationId: "c-1",
      }),
    ).toEqual({ due: false, reason: "ALREADY_IN_CONVERSATION" });
    expect(
      decideOnboardingNudge({
        progress: p,
        state,
        now: at(9),
        surface: "Q_NOTE",
        conversationId: "c-2",
      }).due,
    ).toBe(true);
  });

  it("is quiet for someone who worked on it in the last few hours", () => {
    expect(
      decideOnboardingNudge({
        progress: progress(2, 9, at(0)),
        state: EMPTY_NUDGE_STATE,
        now: at(0, 3),
        surface: "BRIEFING",
      }),
    ).toEqual({ due: false, reason: "RECENT_ACTIVITY" });
  });

  it("resets the back-off when they come back to it", () => {
    const first = progress(2);
    let state = EMPTY_NUDGE_STATE;
    for (const day of [0, 1, 3]) {
      state = recordNudgeShown({
        state,
        progress: first,
        now: at(day, 1),
        surface: "BRIEFING",
      });
    }
    expect(state.shownCount).toBe(3);
    // They worked on it on day 4; by day 5 the cadence is daily again.
    const back = progress(3, 9, at(4));
    expect(
      decideOnboardingNudge({
        progress: back,
        state,
        now: at(5, 1),
        surface: "BRIEFING",
      }).due,
    ).toBe(true);
    expect(
      recordNudgeShown({
        state,
        progress: back,
        now: at(5, 1),
        surface: "BRIEFING",
      }).shownCount,
    ).toBe(1);
  });

  it("'remind me later' holds for three days", () => {
    const p = progress(2);
    const state = recordNudgeChoice({
      state: EMPTY_NUDGE_STATE,
      choice: "LATER",
      now: at(0),
    });
    for (const day of [0, 1, 2]) {
      expect(
        decideOnboardingNudge({
          progress: p,
          state,
          now: at(day, 23),
          surface: "BRIEFING",
        }),
      ).toEqual({ due: false, reason: "SNOOZED" });
    }
    expect(
      decideOnboardingNudge({
        progress: p,
        state,
        now: at(3, 1),
        surface: "BRIEFING",
      }).due,
    ).toBe(true);
  });

  it("'stop reminding me' holds until they return to their setup", () => {
    const p = progress(2);
    const state = recordNudgeChoice({
      state: EMPTY_NUDGE_STATE,
      choice: "STOP",
      now: at(0),
    });
    expect(simulate(p, 60, "BRIEFING", state)).toEqual([]);
    expect(simulate(p, 60, "Q_NOTE", state)).toEqual([]);
    // They came back on day 10 and left again: reminders may resume.
    const back = progress(3, 9, at(10));
    expect(
      decideOnboardingNudge({
        progress: back,
        state,
        now: at(11, 1),
        surface: "BRIEFING",
      }).due,
    ).toBe(true);
  });

  it("stops the moment the setup is complete, whatever was shown before", () => {
    const state = recordNudgeShown({
      state: EMPTY_NUDGE_STATE,
      progress: progress(2),
      now: at(0),
      surface: "BRIEFING",
    });
    expect(simulate(progress(9), 30, "BRIEFING", state)).toEqual([]);
  });

  it("never shows more often than daily nor less than weekly, over a long run", () => {
    for (const done of [0, 4, 8]) {
      const shown = simulate(progress(done), 120);
      const gaps = shown.slice(1).map((day, i) => day - (shown[i] ?? 0));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(7);
    }
  });

  it("estimates the minutes left, at least one", () => {
    expect(minutesLeft(progress(4))).toBe(2);
    expect(minutesLeft(progress(8))).toBe(1);
    expect(minutesLeft(progress(0, 30))).toBe(10);
  });
});
