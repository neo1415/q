import { describe, expect, it } from "vitest";

import { turnNotesFor } from "../src/voice/interview-agent.js";

/**
 * The onboarding loop is told, every turn, what Q does on Home (R20), from
 * the capability registry: a mid-onboarding request for one of those is
 * neither denied nor claimed done.
 */
describe("the loop's notes carry the registry's view of Home Q", () => {
  it("names what Q does on Home on a turn with nothing else to note", () => {
    const notes = turnNotesFor({
      pausing: false,
      lookup: null,
      pronounce: null,
    });
    expect(notes).toContain("change their profile");
    expect(notes).toContain("make their Q Card");
    expect(notes).toContain("pitch deck");
    expect(notes).toContain("never say Capital Q cannot do it");
  });

  it("keeps the turn's own notes and stays within the prompt's bound", () => {
    const notes = turnNotesFor({
      pausing: true,
      lookup: { kind: "RUN", question: "x".repeat(300) },
      pronounce: { term: "y".repeat(80), sayAs: "z".repeat(120) },
    });
    expect(notes).toContain("pause");
    expect(notes).toContain("look-up will run");
    expect(notes.length).toBeLessThanOrEqual(1_500);
  });
});

describe("the loop is told what the journey still holds open (live 2026-09-30)", () => {
  it("names the sign-up name, unsaid findings and unasked steps, within the bound", () => {
    const notes = turnNotesFor({
      pausing: false,
      lookup: null,
      pronounce: null,
      open: {
        signupName: "Fictional Co",
        signupNameIs: "company's name",
        signupStepKey: "F1.company_name",
        unsaidFindings: [
          {
            stepKey: "F1.description",
            value: "Software for field teams",
            because: "found on a public page (example.test)",
          },
        ],
        unasked: [
          { stepKey: "F1.website", question: "What's your website?" },
          { stepKey: "F2.materials", question: "Do you have a deck?" },
        ],
      },
    });
    expect(notes).toContain("Fictional Co");
    expect(notes).toContain("F1.company_name");
    expect(notes).toContain("Software for field teams");
    expect(notes).toContain("F2.materials");
    expect(notes.length).toBeLessThanOrEqual(1_500);
  });
});
