import { describe, expect, it } from "vitest";

import {
  howDidItGo,
  notesQuestions,
  proposeMeetingOutcome,
  type MeetingOutcomeReader,
} from "../src/index.js";

/**
 * "How did it go?" (2026-10-02): proposed from the notes, never recorded.
 * What the lines led to is a model's reading (J7), faked here by the lines
 * it is given; code only turns it into a question.
 */
const READS: Readonly<
  Record<string, Awaited<ReturnType<MeetingOutcomeReader>>>
> = {
  "Apex will start due diligence next week": "DILIGENCE",
  "Schedule a second meeting with the partners": "FOLLOW_UP_MEETING",
  "Founder to send the financial model": "MATERIALS_REQUESTED",
  "Intro to two portfolio CTOs": "INTRODUCTIONS",
  "Start due diligence on Kora": "DILIGENCE",
  "Apex will begin diligence": "DILIGENCE",
};
const seen: (readonly string[])[] = [];
const reader: MeetingOutcomeReader = (lines) => {
  seen.push(lines);
  const first = lines
    .map((line) => READS[line])
    .find((one) => one !== undefined);
  return Promise.resolve(first ?? "NONE");
};

describe("the proposed meeting outcome", () => {
  const notes = (agreements: string[], followUps: string[] = []) => ({
    agreements,
    followUps: followUps.map((text) => ({ text, owner: null })),
  });

  it("is what the reading of the lines says", async () => {
    expect(
      await proposeMeetingOutcome(
        notes(["Apex will start due diligence next week"]),
        reader,
      ),
    ).toBe("DILIGENCE");
    expect(
      await proposeMeetingOutcome(
        notes([], ["Schedule a second meeting with the partners"]),
        reader,
      ),
    ).toBe("FOLLOW_UP_MEETING");
    expect(
      await proposeMeetingOutcome(
        notes(["Founder to send the financial model"]),
        reader,
      ),
    ).toBe("MATERIALS_REQUESTED");
    expect(
      await proposeMeetingOutcome(
        notes(["Intro to two portfolio CTOs"]),
        reader,
      ),
    ).toBe("INTRODUCTIONS");
  });

  it("proposes nothing when the reading finds none, and never a pass", async () => {
    expect(
      await proposeMeetingOutcome(
        notes(["We are not going to invest, too early"]),
        reader,
      ),
    ).toBeNull();
  });

  it("proposes nothing when the lines cannot be read (the safe fallback)", async () => {
    expect(
      await proposeMeetingOutcome(
        notes(["Apex will start due diligence next week"]),
        undefined,
      ),
    ).toBeNull();
    expect(
      await proposeMeetingOutcome(
        notes(["Apex will start due diligence next week"]),
        () => Promise.reject(new Error("no provider")),
      ),
    ).toBeNull();
  });

  it("asks one plain question, and offers follow-ups for approval", () => {
    expect(
      howDidItGo({ proposal: "DILIGENCE", followUps: 2, inCallProposals: 1 }),
    ).toBe(
      "How did it go? It sounded like next steps are diligence — record that? I noted 3 things to follow up; I can set reminders or draft the messages for you to approve.",
    );
    expect(
      howDidItGo({ proposal: null, followUps: 0, inCallProposals: 0 }),
    ).toBe("How did it go? Tell me what was agreed and I'll record it.");
  });
});

describe("the other side's debrief question (Context Firewall)", () => {
  it("is built only from what both sides read, never from the organiser's Q notes", async () => {
    seen.length = 0;
    const questions = await notesQuestions(
      {
        agreements: ["Thanks all, good first conversation"],
        followUps: [{ text: "Start due diligence on Kora", owner: null }],
        inCallProposals: 2,
      },
      reader,
    );
    expect(questions.organiser).toContain("next steps are diligence");
    expect(questions.organiser).toContain("I noted 3 things to follow up");
    expect(questions.others).toBe(
      "How did it go? Tell me what was agreed and I'll record it.",
    );
    // The other side's reading never saw the organiser's follow-ups.
    expect(seen).toContainEqual(["Thanks all, good first conversation"]);
  });

  it("proposes for the other side when the agreements themselves say so", async () => {
    const questions = await notesQuestions(
      {
        agreements: ["Apex will begin diligence"],
        followUps: [],
        inCallProposals: 0,
      },
      reader,
    );
    expect(questions.others).toContain("next steps are diligence");
  });
});
