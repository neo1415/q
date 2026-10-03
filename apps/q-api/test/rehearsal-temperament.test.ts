import { describe, expect, it } from "vitest";

import {
  applyAppraisal,
  appliedAppraisal,
  deliveryFor,
  questionNote,
  questionOpenIn,
  walkOutNote,
  walkOutPlan,
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
    // It builds over the lines: even on Tough, one dodge is not fury.
    expect(run("TOUGH", dodges).registers.slice(0, 2)).not.toContain("FURIOUS");
  });

  it("insulted on Realistic, the played person gets angry and raises their voice (live 2026-10-02)", () => {
    // The founder's e5eb53ee: a run of insults on Realistic.
    const { registers } = run("REALISTIC", ["EVASIVE", "RUDE", "RUDE", "RUDE"]);
    expect(registers.some((r) => r === "ANGRY" || r === "FURIOUS")).toBe(true);
    expect(
      deliveryFor(
        "ANGRY",
        "ANGRY",
        { mood: "COLD", intensity: "NORMAL", reaction: null },
        false,
        true,
      ),
    ).toEqual({ mood: "ANGRY", intensity: "RAISED", reaction: null });
    // Unprovoked anger stays at a normal volume.
    expect(
      deliveryFor(
        "ANGRY",
        "ANGRY",
        { mood: "ANGRY", intensity: "NORMAL", reaction: null },
        false,
        false,
      ).intensity,
    ).toBe("NORMAL");
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

describe("the question on the table (QA rehearsal e22ea609)", () => {
  const asked = [
    { from: "YOU", text: "We help small businesses get paid faster." },
    { from: "THEM", text: "What's your monthly revenue?" },
    { from: "YOU", text: "Honestly, I'm not sure about the numbers." },
  ];
  const opened = [{ from: "YOU", text: "Thanks for making the time." }];

  it("knows whether their last line asked something", () => {
    expect(questionOpenIn(asked)).toBe(true);
    expect(questionOpenIn(opened)).toBe(false);
    expect(
      questionOpenIn([...asked, { from: "THEM", text: "Go ahead." }]),
    ).toBe(false);
  });

  it("an honest gap in answering their question costs patience and raises frustration", () => {
    const start = initialTemperament("REALISTIC", "NEUTRAL");
    const after = applyAppraisal(
      start,
      appliedAppraisal("HUMBLE_HONEST", true),
      "REALISTIC",
    );
    expect(after.patience).toBeLessThan(start.patience);
    expect(after.frustration).toBeGreaterThan(start.frustration);
    expect(after.warmth).toBeLessThanOrEqual(start.warmth);
    // Candour with no question pending still warms them.
    const unprompted = applyAppraisal(
      start,
      appliedAppraisal("HUMBLE_HONEST", false),
      "REALISTIC",
    );
    expect(unprompted.warmth).toBeGreaterThan(start.warmth);
  });

  it("a dodge needs a question to dodge", () => {
    expect(appliedAppraisal("EVASIVE", false)).toBe("NEUTRAL");
    expect(appliedAppraisal("REPEATED_DODGE", false)).toBe("NEUTRAL");
    expect(appliedAppraisal("EVASIVE", true)).toBe("EVASIVE");
    expect(questionNote(false)).toContain("never say it didn't answer");
  });

  it("the whole note to the model stays within its bound", () => {
    const furious = { patience: 0, warmth: 0, frustration: 100, hurt: 100 };
    for (const open of [true, false]) {
      const note =
        temperamentNote(furious, registerOf(furious, "TOUGH")) +
        walkOutNote(1, "FURIOUS") +
        questionNote(open);
      expect(note.length).toBeLessThanOrEqual(1_200);
    }
  });
});

describe("two warnings before leaving, in any register (QA rehearsal e22ea609)", () => {
  const plan = (
    warningsGiven: number,
    conclusion: string,
    wrappingUp = false,
  ) =>
    walkOutPlan({
      register: "EXASPERATED",
      warningsGiven,
      theyAskedToEnd: false,
      closing: true,
      provoked: false,
      conclusion,
      wrappingUp,
    });

  it("a close that leaves early becomes the next warning until two are given", () => {
    expect(plan(0, "LEFT_EARLY")).toEqual({ warning: 1, action: "WARN" });
    expect(plan(1, "LEFT_EARLY")).toEqual({ warning: 2, action: "WARN" });
    expect(plan(1, "DECLINED")).toEqual({ warning: 2, action: "WARN" });
    expect(plan(2, "LEFT_EARLY")).toEqual({ warning: null, action: "KEEP" });
  });

  it("a no at the natural end, or a good close, is not a walk-out", () => {
    expect(plan(0, "DECLINED", true)).toEqual({
      warning: null,
      action: "KEEP",
    });
    expect(plan(0, "ADJOURNED")).toEqual({ warning: null, action: "KEEP" });
    expect(plan(1, "STRONG_LATER")).toEqual({ warning: null, action: "KEEP" });
  });
});
