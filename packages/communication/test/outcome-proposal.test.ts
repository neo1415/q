import { describe, expect, it } from "vitest";

import {
  howDidItGo,
  notesQuestions,
  proposeMeetingOutcome,
} from "../src/index.js";

/** "How did it go?" (2026-10-02): proposed from the notes, never recorded. */
describe("the proposed meeting outcome", () => {
  const notes = (agreements: string[], followUps: string[] = []) => ({
    agreements,
    followUps: followUps.map((text) => ({ text, owner: null })),
  });

  it("reads plain phrases the notes carry, strongest first", () => {
    expect(
      proposeMeetingOutcome(
        notes(
          ["Apex will start due diligence next week"],
          ["Set up a follow-up call"],
        ),
      ),
    ).toBe("DILIGENCE");
    expect(
      proposeMeetingOutcome(
        notes([], ["Schedule a second meeting with the partners"]),
      ),
    ).toBe("FOLLOW_UP_MEETING");
    expect(
      proposeMeetingOutcome(notes(["Founder to send the financial model"])),
    ).toBe("MATERIALS_REQUESTED");
    expect(proposeMeetingOutcome(notes(["Intro to two portfolio CTOs"]))).toBe(
      "INTRODUCTIONS",
    );
  });

  it("proposes nothing when nothing clearly matches, and never a pass", () => {
    expect(
      proposeMeetingOutcome(notes(["Good conversation about the market"])),
    ).toBeNull();
    expect(
      proposeMeetingOutcome(notes(["We are not going to invest, too early"])),
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
  it("is built only from what both sides read, never from the organiser's Q notes", () => {
    const questions = notesQuestions({
      agreements: ["Thanks all, good first conversation"],
      followUps: [{ text: "Start due diligence on Kora", owner: null }],
      inCallProposals: 2,
    });
    expect(questions.organiser).toContain("next steps are diligence");
    expect(questions.organiser).toContain("I noted 3 things to follow up");
    expect(questions.others).toBe(
      "How did it go? Tell me what was agreed and I'll record it.",
    );
    expect(questions.others).not.toMatch(/diligence|follow up/i);
  });

  it("proposes for the other side when the agreements themselves say so", () => {
    expect(
      notesQuestions({
        agreements: ["Apex will begin diligence"],
        followUps: [],
        inCallProposals: 0,
      }).others,
    ).toContain("next steps are diligence");
  });
});
