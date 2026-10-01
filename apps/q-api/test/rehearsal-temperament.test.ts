import { describe, expect, it } from "vitest";

import {
  applyAppraisal,
  deliveryFor,
  initialTemperament,
  registerOf,
  temperamentNote,
  type RehearsalAppraisal,
} from "../src/composition/rehearsal-temperament.js";

/**
 * REHEARSE (founder ask 2026-10-01): the played person's emotion builds
 * from the conversation by fixed rules, and difficulty sets how fast.
 */

const run = (
  difficulty: "GENTLE" | "REALISTIC" | "TOUGH",
  appraisals: readonly RehearsalAppraisal[],
) => {
  let state = initialTemperament(difficulty, "NEUTRAL");
  const registers = [registerOf(state, difficulty)];
  for (const appraisal of appraisals) {
    state = applyAppraisal(state, appraisal, difficulty);
    registers.push(registerOf(state, difficulty));
  }
  return { state, registers };
};

describe("temperament", () => {
  it("stonewalling on Tough ends in fury; the same on Gentle does not", () => {
    const dodges: RehearsalAppraisal[] = [
      "EVASIVE",
      "REPEATED_DODGE",
      "RUDE",
      "REPEATED_DODGE",
    ];
    expect(run("TOUGH", dodges).registers.at(-1)).toBe("FURIOUS");
    expect(run("GENTLE", dodges).registers.at(-1)).not.toBe("FURIOUS");
    // It builds: exasperation comes before anger.
    expect(run("TOUGH", dodges).registers).toContain("EXASPERATED");
  });

  it("good answers and a joke warm them up to delight", () => {
    const { registers } = run("REALISTIC", [
      "STRONG_ANSWER",
      "FUNNY",
      "STRONG_ANSWER",
    ]);
    expect(registers).toContain("WARM");
    expect(registers.at(-1)).toBe("DELIGHTED");
  });

  it("a hard no to a founder they play brings tears; an apology cools anger", () => {
    expect(run("REALISTIC", ["HARD_NO_FOR_THEM"]).registers.at(-1)).toBe(
      "CRYING",
    );
    expect(run("REALISTIC", ["BAD_NEWS_FOR_THEM"]).registers.at(-1)).toBe(
      "SAD",
    );
    const angry = run("TOUGH", ["RUDE", "REPEATED_DODGE"]).state;
    const calmer = applyAppraisal(angry, "APOLOGY", "TOUGH");
    expect(calmer.frustration).toBeLessThan(angry.frustration);
  });

  it("builds a step at a time: one curt line never goes straight to shouting", () => {
    const { registers } = run("TOUGH", ["RUDE"]);
    expect(registers.at(-1)).not.toBe("FURIOUS");
  });

  it("polite lines cool a temper rather than feed it", () => {
    const hot = run("REALISTIC", ["EVASIVE", "REPEATED_DODGE"]).state;
    const after = applyAppraisal(hot, "NEUTRAL", "REALISTIC");
    expect(after.frustration).toBeLessThan(hot.frustration);
  });

  it("nothing said moves almost nothing", () => {
    const start = initialTemperament("REALISTIC", "NEUTRAL");
    expect(registerOf(applyAppraisal(start, "NEUTRAL", "REALISTIC"))).toBe(
      "EVEN",
    );
    expect(temperamentNote(start, "EVEN")).toContain("Register now: EVEN");
  });
});

describe("delivery from the register", () => {
  it("raises the voice only when furious", () => {
    expect(
      deliveryFor("FURIOUS", "ANGRY", {
        mood: "SKEPTICAL",
        intensity: "NORMAL",
        reaction: null,
      }),
    ).toEqual({ mood: "ANGRY", intensity: "RAISED", reaction: null });
    // No outburst without a cause in the state.
    expect(
      deliveryFor("EVEN", "EVEN", {
        mood: "ANGRY",
        intensity: "RAISED",
        reaction: "CRY",
      }),
    ).toEqual({ mood: "SKEPTICAL", intensity: "NORMAL", reaction: null });
  });

  it("sobs on entering grief, sighs on entering exasperation, laughs when delighted", () => {
    const plain = {
      mood: "NEUTRAL",
      intensity: "NORMAL",
      reaction: null,
    } as const;
    expect(deliveryFor("CRYING", "EVEN", plain)).toEqual({
      mood: "SAD",
      intensity: "SOFT",
      reaction: "CRY",
    });
    expect(deliveryFor("CRYING", "CRYING", plain).reaction).toBeNull();
    expect(deliveryFor("EXASPERATED", "EVEN", plain).reaction).toBe("SIGH");
    expect(deliveryFor("DELIGHTED", "WARM", plain)).toEqual({
      mood: "ENTHUSIASTIC",
      intensity: "NORMAL",
      reaction: "LAUGH",
    });
    // The model's own mood stands when it fits the register.
    expect(
      deliveryFor("WARM", "WARM", {
        mood: "HAPPY",
        intensity: "NORMAL",
        reaction: "CHUCKLE",
      }),
    ).toEqual({ mood: "HAPPY", intensity: "NORMAL", reaction: "CHUCKLE" });
  });
});
