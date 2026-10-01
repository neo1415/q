import { describe, expect, it } from "vitest";

import {
  applyAppraisal,
  deliveryFor,
  initialTemperament,
  registerOf,
  stanceOf,
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

describe("who holds the leverage (founder live test 2026-10-01)", () => {
  it("a founder pitching is the weaker party: answers first, asks fair questions later", () => {
    const stance = stanceOf("FOUNDER", "TYPICAL", null);
    expect(stance.leads).toBe("YOU");
    expect(stance.note).toContain("they hold the leverage");
    expect(stance.note).toContain("come later, once you have answered theirs");
    expect(stance.note).not.toContain("forward");
  });

  it("only a founder known to be forward pushes back sooner, and still needs the money", () => {
    const stance = stanceOf(
      "FOUNDER",
      "FORWARD",
      "Challenged two funds on terms in public",
    );
    expect(stance.leads).toBe("YOU");
    expect(stance.note).toContain("known to be forward (Challenged two funds");
    expect(stance.note).toContain("you still need their money");
  });

  it("an investor hearing a pitch leads", () => {
    const stance = stanceOf("INVESTOR", "TYPICAL", null);
    expect(stance.leads).toBe("THEM");
    expect(stance.note).toContain("you hold the leverage");
  });
});

describe("leaving in anger (founder live test 2026-10-01)", () => {
  const model = {
    mood: "NEUTRAL",
    intensity: "NORMAL",
    reaction: null,
  } as const;

  it("an angry goodbye is raised, a cold one stays cold, a calm close is untouched", () => {
    expect(deliveryFor("ANGRY", "ANGRY", model, true)).toEqual({
      mood: "ANGRY",
      intensity: "RAISED",
      reaction: null,
    });
    expect(
      deliveryFor("FURIOUS", "ANGRY", { ...model, mood: "COLD" }, true),
    ).toEqual({ mood: "COLD", intensity: "NORMAL", reaction: null });
    expect(deliveryFor("EVEN", "EVEN", model, true).intensity).toBe("NORMAL");
    // Mid-meeting anger without fury stays at a normal volume.
    expect(deliveryFor("ANGRY", "ANGRY", model).intensity).toBe("NORMAL");
  });
});
