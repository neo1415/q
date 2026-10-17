import { describe, expect, it } from "vitest";

import {
  PILOT_ACTOR,
  PILOT_SCRIPT,
  TourControlGate,
  parseStepCommand,
  resolveStepCommand,
  startTour,
  transition,
} from "../src/index.js";

/** Q Pitch v6: step commands, said or typed, obeyed exactly. */
describe("parseStepCommand", () => {
  it.each([
    ["next", { kind: "NEXT" }],
    ["Skip this", { kind: "NEXT" }],
    ["Q, next please", { kind: "NEXT" }],
    ["go back", { kind: "BACK", count: 1 }],
    ["back two steps", { kind: "BACK", count: 2 }],
    ["go back 3", { kind: "BACK", count: 3 }],
    ["forward three steps", { kind: "FORWARD", count: 3 }],
    ["skip ahead 2 steps", { kind: "FORWARD", count: 2 }],
    ["go to step 7", { kind: "GOTO", step: 7 }],
    ["step seven", { kind: "GOTO", step: 7 }],
    ["go to 12", { kind: "GOTO", step: 12 }],
    ["the third step", { kind: "GOTO", step: 3 }],
    ["last step", { kind: "GOTO", step: -1 }],
    ["7", { kind: "GOTO", step: 7 }],
    ["-2", { kind: "BACK", count: 2 }],
    ["+3", { kind: "FORWARD", count: 3 }],
    ["pause", { kind: "PAUSE" }],
    ["resume", { kind: "RESUME" }],
    // French, Spanish, Portuguese, German, Italian, Swahili
    ["Suivant", { kind: "NEXT" }],
    ["Va à l'étape 5", { kind: "GOTO", step: 5 }],
    ["recule de deux étapes", { kind: "BACK", count: 2 }],
    ["siguiente", { kind: "NEXT" }],
    ["ir al paso 4", { kind: "GOTO", step: 4 }],
    ["vai para o passo 6", { kind: "GOTO", step: 6 }],
    ["gehe zu Schritt 8", { kind: "GOTO", step: 8 }],
    ["zurück zwei Schritte", { kind: "BACK", count: 2 }],
    ["vai al passo 9", { kind: "GOTO", step: 9 }],
    ["endelea", { kind: "RESUME" }],
    ["rudi nyuma hatua mbili", { kind: "BACK", count: 2 }],
  ])("%s", (said, expected) => {
    expect(parseStepCommand(said)).toEqual(expected);
  });

  it.each([
    "What happens next with this company?",
    "Can you go back to what you said about fees?",
    "tell me about step one of onboarding in detail please",
    "0",
    "go to step 0",
    "",
  ])("is not a command: %s", (said) => {
    expect(parseStepCommand(said)).toBeNull();
  });
});

describe("resolveStepCommand", () => {
  it("names the step it lands on, from the current one", () => {
    expect(resolveStepCommand({ kind: "NEXT" }, 2, 10)).toEqual({
      kind: "STEP",
      step: 4,
    });
    expect(resolveStepCommand({ kind: "BACK", count: 2 }, 5, 10)).toEqual({
      kind: "STEP",
      step: 4,
    });
    expect(resolveStepCommand({ kind: "FORWARD", count: 3 }, 1, 10)).toEqual({
      kind: "STEP",
      step: 5,
    });
    expect(resolveStepCommand({ kind: "GOTO", step: -1 }, 0, 10)).toEqual({
      kind: "STEP",
      step: 10,
    });
  });

  it("finishes the tour on next at the last step, and refuses a step it does not have", () => {
    expect(resolveStepCommand({ kind: "NEXT" }, 9, 10)).toEqual({
      kind: "SKIP",
    });
    expect(resolveStepCommand({ kind: "BACK", count: 4 }, 2, 10)).toEqual({
      kind: "OUT_OF_RANGE",
    });
    expect(resolveStepCommand({ kind: "GOTO", step: 11 }, 2, 10)).toEqual({
      kind: "OUT_OF_RANGE",
    });
  });
});

describe("a STEP intent moves the director to exactly that step", () => {
  const begin = () =>
    startTour({
      scenes: PILOT_SCRIPT.scenes,
      chapters: PILOT_SCRIPT.chapters,
      actor: PILOT_ACTOR,
    });

  it("admits a typed STEP and goes there", () => {
    const decision = new TourControlGate().admit(
      {
        intentId: "qp-step-1",
        source: "AUDIENCE_MIC",
        modality: "KEYBOARD",
        kind: "STEP",
        step: 3,
      },
      {
        narratorPlaying: false,
        counterpartPlaying: false,
        echoCancellation: true,
      },
    );
    expect(decision.admitted).toBe(true);
    if (!decision.admitted || decision.event === null) return;
    expect(decision.event).toEqual({ type: "GO_TO_STEP", index: 2 });
    const moved = transition(begin().state, decision.event);
    expect(moved.state.sceneIndex).toBe(2);
    expect(moved.state.phase).toBe("PREPARE_SCENE");
  });

  it("refuses a step outside the tour, and a STEP without a number", () => {
    const t = begin();
    expect(
      transition(t.state, { type: "GO_TO_STEP", index: 99 }).effects,
    ).toEqual([
      { type: "REJECTED", event: "GO_TO_STEP", reason: "STEP_OUT_OF_RANGE" },
    ]);
    expect(
      new TourControlGate().admit(
        {
          intentId: "qp-step-2",
          source: "AUDIENCE_MIC",
          modality: "KEYBOARD",
          kind: "STEP",
        },
        {
          narratorPlaying: false,
          counterpartPlaying: false,
          echoCancellation: true,
        },
      ).admitted,
    ).toBe(false);
  });
});
