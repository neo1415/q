import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { UserId } from "@capital-q/security";

import {
  createOnboardingNudges,
  nudgeJourney,
  type OnboardingNudgeStateRepository,
} from "../src/application/nudges.js";
import type { OwnOnboardingSummary } from "../src/application/own-summary.js";
import type { OnboardingNudgeState } from "../src/domain/nudge-policy.js";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-09-01T10:00:00Z");
const USER = "00000000-0000-4000-8000-000000000001" as UserId;
const CONVERSATION = "00000000-0000-4000-8000-0000000000c1";

function summary(
  journeyType: "founder" | "investor",
  overrides: Partial<OwnOnboardingSummary> = {},
): OwnOnboardingSummary {
  return {
    journeyType,
    status: "ACTIVE",
    completedBy: null,
    role: null,
    answeredCount: 4,
    eligibleCount: 12,
    currentStep: null,
    answered: [],
    open: [],
    requiredCount: 9,
    requiredDoneCount: 4,
    remainingTopics: ["Your raise", "Traction", "Team", "Market", "Extra"],
    lastActivityAt: new Date(START - 3 * DAY).toISOString(),
    ...overrides,
  };
}

function harness(summaries: readonly OwnOnboardingSummary[]) {
  const rows = new Map<string, OnboardingNudgeState>();
  const states: OnboardingNudgeStateRepository = {
    find: (_executor, userId) => Promise.resolve(rows.get(userId) ?? null),
    save: (_executor, userId, state) => {
      rows.set(userId, state);
      return Promise.resolve();
    },
  };
  let clock = START;
  const nudges = createOnboardingNudges({
    sql: {} as DatabaseExecutor,
    states,
    summaries: { read: () => Promise.resolve(summaries) },
    now: () => new Date(clock),
  });
  return {
    nudges,
    rows,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("onboarding nudges", () => {
  for (const journey of ["founder", "investor"] as const) {
    describe(journey, () => {
      it("gives the briefing card at most once a day, stably within the day", async () => {
        const { nudges, advance } = harness([summary(journey)]);
        const first = await nudges.claimBriefing(USER);
        expect(first).toMatchObject({
          journeyType: journey,
          emphasis: "STRONG",
          requiredCount: 9,
          doneCount: 4,
          minutesLeft: 2,
          remainingTopics: ["Your raise", "Traction", "Team", "Market"],
          day: "2026-09-01",
        });
        // A re-render the same day: the same card, not a new one.
        advance(2 * 60 * 60 * 1000);
        expect(await nudges.claimBriefing(USER)).toEqual(first);
        // Q does not mention it the day the card was given.
        expect(
          await nudges.peek(USER, {
            surface: "Q_NOTE",
            conversationId: CONVERSATION,
          }),
        ).toBeNull();
        // Next day: a new day's card.
        advance(DAY);
        expect((await nudges.claimBriefing(USER))?.day).toBe("2026-09-02");
      });

      it("mentions it in a Q conversation at most once", async () => {
        const { nudges, advance } = harness([summary(journey)]);
        const request = {
          surface: "Q_NOTE" as const,
          conversationId: CONVERSATION,
        };
        expect(await nudges.peek(USER, request)).not.toBeNull();
        await nudges.markShown(USER, request);
        expect(await nudges.peek(USER, request)).toBeNull();
        advance(10 * DAY);
        expect(await nudges.peek(USER, request)).toBeNull();
        expect(
          await nudges.peek(USER, {
            surface: "Q_NOTE",
            conversationId: "00000000-0000-4000-8000-0000000000c2",
          }),
        ).not.toBeNull();
      });

      it("honours 'later' and 'stop'", async () => {
        const { nudges, advance } = harness([summary(journey)]);
        await nudges.choose(USER, "LATER");
        expect(await nudges.claimBriefing(USER)).toBeNull();
        advance(3 * DAY);
        expect(await nudges.claimBriefing(USER)).not.toBeNull();
        await nudges.choose(USER, "STOP");
        advance(30 * DAY);
        expect(await nudges.claimBriefing(USER)).toBeNull();
        expect(await nudges.peek(USER, { surface: "Q_NOTE" })).toBeNull();
      });

      it("says nothing once the setup is complete", async () => {
        const { nudges } = harness([
          summary(journey, { requiredDoneCount: 9 }),
        ]);
        expect(await nudges.claimBriefing(USER)).toBeNull();
        expect(await nudges.continueTarget(USER)).toBe(journey);
      });
    });
  }

  it("does not chase a stray setup once either side is complete", () => {
    expect(
      nudgeJourney([
        summary("investor"),
        summary("founder", { status: "COMPLETED", completedBy: "SESSION" }),
      ]),
    ).toBeNull();
    expect(
      nudgeJourney([summary("investor"), summary("founder")])?.journeyType,
    ).toBe("founder");
  });

  it("does not remember a conversation id that is not one", async () => {
    const { nudges, rows } = harness([summary("founder")]);
    await nudges.markShown(USER, { surface: "Q_NOTE", conversationId: "x" });
    expect(rows.get(USER)?.lastConversationId).toBeNull();
  });
});
