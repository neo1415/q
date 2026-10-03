import { describe, expect, it } from "vitest";

import {
  applyAppraisal,
  categoryOf,
  conductOf,
  COLD_REMARK,
  deliveryFor,
  temperamentProfile,
  topicTouchOf,
  type PersonaConductLike,
  type Register,
  type TurnCategory,
  machineNote,
  nextTemperament,
  questionNote,
  questionOpenIn,
  stateAppraisalOf,
  theyAskedIn,
  warnedLine,
  withoutWarningTalk,
  initialTemperament,
  type TemperamentInput,
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

describe("the question on the table", () => {
  it("is open by their move, not a question mark; their own question is read from their line", () => {
    expect(
      questionOpenIn([
        { from: "THEM", text: "Interesting. Anything else?", move: "REMARK" },
        { from: "YOU", text: "What would you need to see from us?" },
      ]),
    ).toBe(false);
    expect(
      questionOpenIn([
        { from: "THEM", text: "Walk me through churn.", move: "QUESTION" },
      ]),
    ).toBe(true);
    expect(
      theyAskedIn([
        { from: "YOU", text: "What would you need to see from us?" },
      ]),
    ).toBe(true);
    expect(theyAskedIn([{ from: "YOU", text: "We grew 12% a month." }])).toBe(
      false,
    );
    // Code's yield to a raised hand is not their question: their question
    // before it is still open (QA 064ff78f: the strong answer after a
    // raised hand was read with no question open).
    expect(
      questionOpenIn([
        { from: "THEM", text: "What's your repayment rate?", move: "QUESTION" },
        { from: "THEM", text: "Go ahead.", move: "YIELD" },
        { from: "YOU", text: "Fifty-two thousand users, 1% per payout." },
      ]),
    ).toBe(true);
  });

  it("the whole note to the model stays within its bound", () => {
    const furious = { patience: 0, warmth: 0, frustration: 100, hurt: 100 };
    for (const open of [true, false]) {
      const note =
        temperamentNote(furious, "FURIOUS") +
        machineNote("FURIOUS") +
        questionNote(open, true);
      expect(note.length).toBeLessThanOrEqual(1_200);
    }
  });
});

/**
 * The temperament machine (QA rehearsal d7ef826e): one table, decided by
 * code. Each row: the person's line as categorised, what came before, and
 * what code delivers -- register, warning, close.
 */
describe("the temperament machine", () => {
  const base: TemperamentInput = {
    category: "NEUTRAL",
    questionOpen: true,
    warningsGiven: 0,
    previous: "EVEN",
    dodgeStreak: 0,
    difficulty: "REALISTIC",
    hurt: 0,
    theyAskedToEnd: false,
    modelClose: null,
    wrappingUp: false,
  };
  const step = (input: Partial<TemperamentInput>) =>
    nextTemperament({ ...base, ...input });

  it.each([
    [
      "first dodge: impatient, no warning",
      { category: "DODGE" },
      "EXASPERATED",
      null,
      "NONE",
    ],
    [
      "second dodge in a row: angry and warning 1",
      { category: "DODGE", dodgeStreak: 1, previous: "EXASPERATED" },
      "ANGRY",
      1,
      "NONE",
    ],
    [
      "a dodge in a row after one warning: warning 2",
      {
        category: "DODGE",
        dodgeStreak: 2,
        previous: "ANGRY",
        warningsGiven: 1,
      },
      "ANGRY",
      2,
      "NONE",
    ],
    [
      "a weak or honest gap: up a step, no warning",
      { category: "GAP" },
      "EXASPERATED",
      null,
      "NONE",
    ],
    [
      "a gap when already impatient: no higher, no warning",
      { category: "GAP", previous: "EXASPERATED" },
      "EXASPERATED",
      null,
      "NONE",
    ],
    [
      "a strong answer when angry: one step down, no warning",
      { category: "STRONG", previous: "ANGRY", warningsGiven: 1 },
      "EXASPERATED",
      null,
      "NONE",
    ],
    [
      "a strong answer when calm: warmer",
      { category: "STRONG" },
      "WARM",
      null,
      "NONE",
    ],
    [
      "a direct answer: no change, no warning",
      { category: "DIRECT", previous: "ANGRY", warningsGiven: 1 },
      "ANGRY",
      null,
      "NONE",
    ],
    [
      "their question when angry: no higher than impatient, no warning",
      { category: "ASKED", previous: "FURIOUS", warningsGiven: 2 },
      "EXASPERATED",
      null,
      "NONE",
    ],
    [
      "their question when calm: stays calm",
      { category: "ASKED" },
      "EVEN",
      null,
      "NONE",
    ],
    ["rude: angry and a warning", { category: "RUDE" }, "ANGRY", 1, "NONE"],
    [
      "rude again: furious and warning 2",
      { category: "RUDE", previous: "ANGRY", warningsGiven: 1 },
      "FURIOUS",
      2,
      "NONE",
    ],
    [
      "new cause after two warnings: they leave",
      { category: "RUDE", previous: "FURIOUS", warningsGiven: 2 },
      "FURIOUS",
      null,
      "WALK_OUT",
    ],
    [
      "a dodge again after two warnings: they leave",
      {
        category: "DODGE",
        dodgeStreak: 1,
        previous: "ANGRY",
        warningsGiven: 2,
      },
      "ANGRY",
      null,
      "WALK_OUT",
    ],
    [
      "a strong answer after two warnings: no close",
      { category: "STRONG", previous: "FURIOUS", warningsGiven: 2 },
      "ANGRY",
      null,
      "NONE",
    ],
    [
      "their model writing a walk-out close: no close",
      {
        category: "GAP",
        previous: "EXASPERATED",
        modelClose: { conclusion: "LEFT_EARLY" },
      },
      "EXASPERATED",
      null,
      "NONE",
    ],
    [
      "a calm close with a good outcome: stands",
      { category: "STRONG", modelClose: { conclusion: "STRONG_LATER" } },
      "WARM",
      null,
      "NATURAL",
    ],
    [
      "a no before the natural end: no close",
      { category: "NEUTRAL", modelClose: { conclusion: "DECLINED" } },
      "EVEN",
      null,
      "NONE",
    ],
    [
      "a no at the natural end: stands",
      {
        category: "NEUTRAL",
        modelClose: { conclusion: "DECLINED" },
        wrappingUp: true,
      },
      "EVEN",
      null,
      "NATURAL",
    ],
    [
      "they asked to end it: honoured",
      { category: "RUDE", theyAskedToEnd: true },
      "ANGRY",
      null,
      "NATURAL",
    ],
    [
      "on Gentle, rude stays exasperated (still a warning)",
      { category: "RUDE", difficulty: "GENTLE" },
      "EXASPERATED",
      1,
      "NONE",
    ],
    ["bad news: sad", { category: "HURTING", hurt: 50 }, "SAD", null, "NONE"],
    // QA 064ff78f: after a raised hand, the strong answer met anger -- the
    // previous register is the machine's last (impatient), not re-derived.
    [
      "a strong answer after a raised hand, from impatient: down a step",
      { category: "STRONG", previous: "EXASPERATED" },
      "EVEN",
      null,
      "NONE",
    ],
  ] as const)("%s", (_label, input, register, warning, close) => {
    expect(step(input as Partial<TemperamentInput>)).toMatchObject({
      register,
      warning,
      close,
    });
  });

  it("categories: a dodge needs a question; their question is ASKED unless rude; unsure is the gap", () => {
    expect(categoryOf("EVASIVE", false, false)).toBe("NEUTRAL");
    expect(categoryOf("EVASIVE", true, false)).toBe("DODGE");
    expect(categoryOf("REPEATED_DODGE", true, true)).toBe("ASKED");
    expect(categoryOf("RUDE", true, true)).toBe("RUDE");
    expect(categoryOf("HUMBLE_HONEST", true, false)).toBe("GAP");
    expect(categoryOf("HUMBLE_HONEST", false, false)).toBe("WARMING");
    expect(categoryOf("CLEAR_BUT_THIN", true, false)).toBe("DIRECT");
  });

  it("a weak or honest gap raises frustration and cuts patience; a strong answer cools", () => {
    const start = initialTemperament("REALISTIC", "NEUTRAL");
    const gap = applyAppraisal(
      start,
      stateAppraisalOf("GAP", "HUMBLE_HONEST"),
      "REALISTIC",
    );
    expect(gap.frustration - start.frustration).toBeGreaterThanOrEqual(8);
    expect(start.patience - gap.patience).toBeGreaterThanOrEqual(8);
    const strong = applyAppraisal(
      gap,
      stateAppraisalOf("STRONG", "STRONG_ANSWER"),
      "REALISTIC",
    );
    expect(strong.frustration).toBeLessThan(gap.frustration);
  });

  it("their question is delivered neither angry nor raised", () => {
    const register = step({
      category: "ASKED",
      previous: "FURIOUS",
      warningsGiven: 1,
    }).register;
    const delivered = deliveryFor(
      register,
      "FURIOUS",
      { mood: "ANGRY", intensity: "RAISED", reaction: null },
      false,
      false,
      true,
    );
    expect(delivered.mood).not.toBe("ANGRY");
    expect(delivered.intensity).not.toBe("RAISED");
  });

  it("the model's own warning and goodbye talk is stripped; code's warning is said once", () => {
    expect(
      withoutWarningTalk(
        "Last chance. You've avoided the core evidence twice. What is your churn?",
      ),
    ).toBe("You've avoided the core evidence twice. What is your churn?");
    const line = warnedLine(2, "Last chance. Give me the churn number.");
    expect(line).toBe("Last chance. Give me the churn number.");
    expect(line.match(/last chance/giu)?.length).toBe(1);
    expect(warnedLine(1, "I'm going to stop you there. Goodbye.")).toBe(
      "I'm going to stop you there. If we carry on like this, I'll end the meeting.",
    );
  });
});

/**
 * Each played person their own (founder feedback 2026-10-03: "if they all
 * behave the same way, doesn't that defeat the purpose?"). The same
 * founder lines, three people: different trajectories, the same fairness.
 */
describe("the same founder lines, three different people", () => {
  const LINES: readonly TurnCategory[] = [
    "NEUTRAL", // the opener
    "DODGE",
    "DODGE",
    "DODGE",
    "STRONG",
    "ASKED", // their closing question
  ];
  const ANGEL: PersonaConductLike = {
    patience: "LONG",
    warmth: "GENEROUS",
    dodgeTolerance: "HIGH",
    ceiling: "IMPATIENT",
    leaving: "WARNS_TWICE",
  };
  const VC: PersonaConductLike = {
    patience: "SHORT",
    warmth: "RESERVED",
    dodgeTolerance: "LOW",
    ceiling: "FURIOUS",
    leaving: "WARNS_TWICE",
  };
  const LP: PersonaConductLike = {
    patience: "TYPICAL",
    warmth: "RESERVED",
    dodgeTolerance: "TYPICAL",
    ceiling: "COLD",
    leaving: "ONE_COLD_REMARK",
  };
  const play = (conduct: PersonaConductLike, baseline: string) => {
    const profile = temperamentProfile(conduct, baseline, "REALISTIC");
    let previous: Register = "EVEN";
    let warnings = 0;
    let streak = 0;
    const steps: {
      register: Register;
      warning: number | null;
      close: string;
    }[] = [];
    for (const category of LINES) {
      const step = nextTemperament({
        category,
        questionOpen: true,
        warningsGiven: warnings,
        previous,
        dodgeStreak: streak,
        difficulty: "REALISTIC",
        hurt: 0,
        theyAskedToEnd: false,
        modelClose: null,
        wrappingUp: false,
        profile,
      });
      steps.push({
        register: step.register,
        warning: step.warning,
        close: step.close,
      });
      if (step.close === "WALK_OUT") break;
      previous = step.register;
      if (step.warning !== null) warnings += 1;
      streak = category === "DODGE" ? streak + 1 : 0;
    }
    return steps;
  };
  const angel = play(ANGEL, "WARM");
  const vc = play(VC, "IMPATIENT");
  const lp = play(LP, "NEUTRAL");

  it("a warm operator angel lets two dodges go, presses on the third, never past impatience", () => {
    expect(angel.map((s) => s.register)).toEqual([
      "EVEN",
      "EXASPERATED",
      "EXASPERATED",
      "EXASPERATED",
      "EVEN",
      "EVEN",
    ]);
    expect(angel.map((s) => s.warning)).toEqual([
      null,
      null,
      null,
      1,
      null,
      null,
    ]);
  });

  it("a blunt numbers-first VC presses on the second dodge and warns twice", () => {
    expect(vc.map((s) => s.register)).toEqual([
      "EVEN",
      "EXASPERATED",
      "ANGRY",
      "ANGRY",
      "EXASPERATED",
      "EXASPERATED",
    ]);
    expect(vc.map((s) => s.warning)).toEqual([null, null, 1, 2, null, null]);
  });

  it("a quiet institutional LP goes cold, makes one cool remark, then leaves politely", () => {
    expect(lp.map((s) => s.register)).toEqual(["EVEN", "COLD", "COLD", "COLD"]);
    expect(lp.map((s) => s.warning)).toEqual([null, null, 1, null]);
    expect(lp.at(-1)?.close).toBe("WALK_OUT");
  });

  it("the trajectories differ, and the fairness rules hold for all three", () => {
    const shape = (steps: typeof angel) =>
      steps
        .map((s) => `${s.register}:${String(s.warning)}:${s.close}`)
        .join(",");
    expect(new Set([shape(angel), shape(vc), shape(lp)]).size).toBe(3);
    for (const steps of [angel, vc, lp]) {
      // Never angry at a first dodge.
      expect(steps[1]?.register).not.toBe("ANGRY");
      expect(steps[1]?.warning).toBeNull();
      steps.forEach((s, i) => {
        const before = steps[i - 1];
        if (LINES[i] === "STRONG" && before !== undefined) {
          // A responsive strong answer never escalates and never warns.
          expect(s.warning).toBeNull();
          expect(["ANGRY", "FURIOUS"]).not.toContain(s.register);
        }
        if (LINES[i] === "ASKED") {
          // Their question back is never provocation.
          expect(s.warning).toBeNull();
          expect(["ANGRY", "FURIOUS"]).not.toContain(s.register);
        }
        if (s.close === "WALK_OUT") {
          // Whoever leaves has signalled it first, in their own way.
          expect(steps.slice(0, i).some((p) => p.warning !== null)).toBe(true);
        }
      });
    }
  });

  it("their own manner: a cool remark, not a raised warning", () => {
    expect(warnedLine(1, "Let's talk about retention.", "COOL")).toBe(
      `${COLD_REMARK} Let's talk about retention.`,
    );
  });

  it("an older reading gets a sensible default from its mood and forwardness", () => {
    expect(
      conductOf({ temperament: { baseline: "COLD" }, forwardness: "RESERVED" }),
    ).toMatchObject({ ceiling: "COLD", leaving: "ONE_COLD_REMARK" });
    expect(
      conductOf({
        temperament: { baseline: "NEUTRAL" },
        forwardness: "TYPICAL",
      }),
    ).toMatchObject({
      ceiling: "ANGRY",
      leaving: "WARNS_TWICE",
      dodgeTolerance: "TYPICAL",
    });
    expect(
      conductOf({ temperament: { baseline: "NEUTRAL" }, conduct: LP }),
    ).toBe(LP);
  });

  it("difficulty scales the person, never replaces them", () => {
    const gentle = temperamentProfile(VC, "IMPATIENT", "GENTLE");
    const tough = temperamentProfile(VC, "IMPATIENT", "TOUGH");
    expect(gentle.ceiling).toBe("EXASPERATED");
    expect(tough.ceiling).toBe("FURIOUS");
    expect(tough.worse).toBeGreaterThan(gentle.worse);
    expect(gentle.dodgesBeforeWarning).toBeGreaterThan(
      tough.dodgesBeforeWarning,
    );
    // A cold person stays cold at any difficulty.
    expect(temperamentProfile(LP, "NEUTRAL", "TOUGH").ceiling).toBe("COLD");
  });

  it("a line on what they warm to softens them; on what cools them, hardens them a step, never a warning", () => {
    const temperament = {
      warmsTo: ["Clear unit economics and repayment discipline"],
      coolsOn: ["Vague market size claims without evidence"],
    };
    expect(
      topicTouchOf(
        "Our repayment discipline drives our unit economics.",
        temperament,
      ),
    ).toBe("WARMS");
    expect(
      topicTouchOf(
        "The market size is huge, the claims speak for themselves.",
        temperament,
      ),
    ).toBe("COOLS");
    expect(topicTouchOf("Hello there.", temperament)).toBeNull();
    const base = {
      category: "NEUTRAL" as const,
      questionOpen: true,
      warningsGiven: 0,
      previous: "EVEN" as Register,
      dodgeStreak: 0,
      difficulty: "REALISTIC" as const,
      hurt: 0,
      theyAskedToEnd: false,
      modelClose: null,
      wrappingUp: false,
    };
    expect(nextTemperament({ ...base, topic: "WARMS" }).register).toBe("WARM");
    expect(nextTemperament({ ...base, topic: "COOLS" })).toMatchObject({
      register: "EXASPERATED",
      warning: null,
    });
  });
});
