import { describe, expect, it } from "vitest";

import {
  applyAppraisal,
  categoryOf,
  deliveryFor,
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
  ] as const)("%s", (_label, input, register, warning, close) => {
    expect(step(input as Partial<TemperamentInput>)).toEqual({
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
