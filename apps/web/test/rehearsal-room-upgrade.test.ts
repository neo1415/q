import { describe, expect, it } from "vitest";

import type { QRehearsalTurnDto } from "@capital-q/contracts";

import {
  captionName,
  sameLine,
  stanceTag,
  waitingForAnswer,
} from "../src/features/rehearsal/meet";
import {
  atLabel,
  boardNotes,
  endMoments,
} from "../src/features/rehearsal/review-moments";

/** Owner 2026-10-24: the rehearsal room upgrade. */
describe("captions name the speaker by first name", () => {
  it("a person by their first name; an organisation keeps its name", () => {
    expect(captionName("Amina Okafor", "PERSON", "EXTERNAL_PERSON")).toBe(
      "Amina",
    );
    expect(captionName("Amina Okafor", undefined, "EXTERNAL_PERSON")).toBe(
      "Amina",
    );
    expect(
      captionName("Savanna Seed Partners", undefined, "INVESTOR_ORGANISATION"),
    ).toBe("Savanna Seed Partners");
    expect(captionName("Halyard", "ORGANIZATION", "EXTERNAL_PERSON")).toBe(
      "Halyard",
    );
  });
});

describe("the stance tag comes from the line's own stance", () => {
  it("names the three stances and nothing else", () => {
    expect(stanceTag("ASKS")).toBe("Asks");
    expect(stanceTag("DISAGREES")).toBe("Disagrees");
    expect(stanceTag("DECIDES")).toBe("Decides");
    expect(stanceTag(null)).toBeNull();
    expect(stanceTag(undefined)).toBeNull();
  });

  it("only the line being spoken carries it, never the one before", () => {
    expect(
      sameLine(
        "What's your monthly churn, and how do you know?",
        "What's your monthly churn",
      ),
    ).toBe(true);
    expect(sameLine("Thanks for coming in.", "What's your monthly churn")).toBe(
      false,
    );
  });
});

describe("they're waiting for your answer", () => {
  const base = {
    lastFrom: "THEM" as const,
    lastStance: "ASKS",
    busy: false,
    ended: false,
  };
  it("after their question, while nobody speaks", () => {
    expect(waitingForAnswer(base)).toBe(true);
  });
  it.each([
    ["they are still speaking", { busy: true }],
    ["you already answered", { lastFrom: "YOU" as const }],
    ["their line asked nothing", { lastStance: "DISAGREES" }],
    ["the meeting ended", { ended: true }],
  ])("not when %s", (_case, change) => {
    expect(waitingForAnswer({ ...base, ...change })).toBe(false);
  });
});

describe("the end card", () => {
  const start = "2026-10-24T10:00:00.000Z";
  const turn = (
    from: "THEM" | "YOU",
    text: string,
    at: string,
  ): QRehearsalTurnDto => ({ from, text, at, mood: null, sawScreen: false });
  const turns = [
    turn("THEM", "What's your churn?", "2026-10-24T10:00:05.000Z"),
    turn(
      "YOU",
      "Monthly churn is two percent, measured on paying accounts since March.",
      "2026-10-24T10:01:12.000Z",
    ),
    turn(
      "YOU",
      "We think the market is huge, maybe billions.",
      "2026-10-24T10:04:07.000Z",
    ),
  ];

  it("ties each moment to its line and time; three each at most", () => {
    const { strongest, weakest } = endMoments(
      {
        wentRight: [
          {
            moment: "You gave monthly churn measured on paying accounts",
            why: "A sourced number.",
          },
        ],
        wentWrong: [
          {
            moment: "The market is huge, maybe billions",
            why: "No source.",
          },
          { moment: "Overall pacing", why: "" },
          { moment: "x", why: "" },
          { moment: "y", why: "" },
        ],
      },
      turns,
      start,
    );
    expect(strongest[0]).toMatchObject({ line: 1, at: "1:12" });
    expect(weakest).toHaveLength(3);
    expect(weakest[0]).toMatchObject({ line: 2, at: "4:07" });
    expect(weakest[1]).toMatchObject({ line: null, at: null });
  });

  it("the board note keeps both lists with their times", () => {
    const notes = boardNotes({
      name: "Savanna Seed Partners",
      duration: "6 min",
      strongest: [{ moment: "Churn", why: "Sourced.", line: 1, at: "1:12" }],
      weakest: [],
    });
    expect(notes).toContain("Rehearsal with Savanna Seed Partners, 6 min.");
    expect(notes).toContain("- 1:12 Churn: Sourced.");
    expect(notes).toContain("To work on\n- None noted");
  });

  it("times read as minutes and seconds", () => {
    expect(atLabel(start, "2026-10-24T10:00:09.000Z")).toBe("0:09");
    expect(atLabel(start, "2026-10-24T09:59:00.000Z")).toBeNull();
  });
});
