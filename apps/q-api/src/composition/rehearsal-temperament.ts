/**
 * The played person's temperament across a rehearsal (REHEARSE, founder
 * ask 2026-10-01: "genuinely get angry, raise its voice, laugh, cry and
 * smile").
 *
 * Why moods stayed flat: each turn the model saw only the transcript and a
 * list of moods, with "raised only when truly heated". Nothing carried the
 * build-up from one exchange to the next, so every line was judged on its
 * own and came out sceptical or neutral. Now a small state -- patience,
 * warmth, frustration, hurt, 0 to 100 -- rises and falls with what the
 * person says, read by the model as a typed appraisal of their latest line
 * (never by matching words) and applied here by fixed rules. Difficulty
 * sets where it starts and how hard each appraisal pushes. The state
 * decides the register the line is delivered in; the model writes the
 * words in that register.
 */

export const REHEARSAL_APPRAISALS = [
  "STRONG_ANSWER",
  "CLEAR_BUT_THIN",
  "EVASIVE",
  "REPEATED_DODGE",
  "RUDE",
  "OVERCLAIM",
  "HUMBLE_HONEST",
  "FUNNY",
  "APOLOGY",
  "GOOD_NEWS_FOR_THEM",
  "BAD_NEWS_FOR_THEM",
  "HARD_NO_FOR_THEM",
  "NEUTRAL",
] as const;
export type RehearsalAppraisal = (typeof REHEARSAL_APPRAISALS)[number];

export type Temperament = {
  readonly patience: number;
  readonly warmth: number;
  readonly frustration: number;
  readonly hurt: number;
};

export type Difficulty = "GENTLE" | "REALISTIC" | "TOUGH";

export const REGISTERS = [
  "FURIOUS",
  "ANGRY",
  "EXASPERATED",
  "CRYING",
  "SAD",
  "DELIGHTED",
  "WARM",
  "EVEN",
] as const;
export type Register = (typeof REGISTERS)[number];

type Delta = Partial<Record<keyof Temperament, number>>;

/** Readings that give the played person new cause for frustration. */
const PROVOKING: ReadonlySet<RehearsalAppraisal> = new Set([
  "EVASIVE",
  "REPEATED_DODGE",
  "RUDE",
  "OVERCLAIM",
  "CLEAR_BUT_THIN",
]);

/** What each reading of their latest line does to the played person. */
const EFFECTS: Readonly<Record<RehearsalAppraisal, Delta>> = {
  STRONG_ANSWER: { warmth: 12, frustration: -12, patience: 6 },
  CLEAR_BUT_THIN: { frustration: 6, patience: -6 },
  EVASIVE: { frustration: 20, patience: -16, warmth: -6 },
  REPEATED_DODGE: { frustration: 30, patience: -25, warmth: -10 },
  RUDE: { frustration: 34, patience: -22, warmth: -22 },
  OVERCLAIM: { frustration: 14, warmth: -8, patience: -6 },
  HUMBLE_HONEST: { warmth: 10, frustration: -10, patience: 4 },
  FUNNY: { warmth: 16, frustration: -10 },
  APOLOGY: { frustration: -18, warmth: 6, patience: 6 },
  GOOD_NEWS_FOR_THEM: { warmth: 20, hurt: -20, frustration: -8 },
  BAD_NEWS_FOR_THEM: { hurt: 48, warmth: -6 },
  // A flat, final no to what they came for (a founder told "we're out").
  HARD_NO_FOR_THEM: { hurt: 75, warmth: -10, patience: -10 },
  NEUTRAL: { patience: -2 },
};

/** Where difficulty starts them, and how hard bad and good moments land. */
const PROFILE: Readonly<
  Record<
    Difficulty,
    {
      readonly start: Temperament;
      readonly worse: number;
      readonly better: number;
    }
  >
> = {
  GENTLE: {
    start: { patience: 85, warmth: 60, frustration: 5, hurt: 0 },
    worse: 0.6,
    better: 1.3,
  },
  REALISTIC: {
    start: { patience: 65, warmth: 45, frustration: 15, hurt: 0 },
    worse: 1,
    better: 1,
  },
  TOUGH: {
    start: { patience: 45, warmth: 30, frustration: 30, hurt: 0 },
    worse: 1.5,
    better: 0.7,
  },
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function initialTemperament(
  difficulty: Difficulty,
  baseline: string,
): Temperament {
  const start = PROFILE[difficulty].start;
  const warmer = baseline === "WARM" || baseline === "ENTHUSIASTIC" ? 10 : 0;
  const cooler = baseline === "COLD" || baseline === "IMPATIENT" ? 10 : 0;
  return {
    ...start,
    warmth: clamp(start.warmth + warmer - cooler),
    frustration: clamp(start.frustration + cooler),
  };
}

/** The state after their latest line, by fixed rules. */
export function applyAppraisal(
  state: Temperament,
  appraisal: RehearsalAppraisal,
  difficulty: Difficulty,
): Temperament {
  const { worse, better } = PROFILE[difficulty];
  const delta: Delta = EFFECTS[appraisal] ?? {};
  const scale = (key: keyof Temperament, value: number) => {
    // Rising frustration or hurt, or falling warmth or patience, is "worse".
    const bad = key === "frustration" || key === "hurt" ? value > 0 : value < 0;
    return value * (bad ? worse : better);
  };
  const next = { ...state };
  for (const key of Object.keys(delta) as (keyof Temperament)[]) {
    // Emotion builds: one line moves frustration and patience at most a
    // step (live 2026-10-01: one curt opener on Tough went straight to
    // shouting). A flat, final no may land all at once.
    const step = scale(key, delta[key] ?? 0);
    const bound = key === "hurt" ? 80 : 25;
    next[key] = clamp(state[key] + Math.max(-bound, Math.min(bound, step)));
  }
  // Tempers cool when a line gives no new cause (live: on Gentle, polite
  // lines kept the investor climbing to anger).
  if (!PROVOKING.has(appraisal)) {
    next.frustration = clamp(next.frustration - 6);
  }
  // Patience wears down with frustration, and comes back slowly.
  next.patience = clamp(Math.min(next.patience, 100 - next.frustration / 2));
  return next;
}

/**
 * The register the state puts them in: anger first, then grief, then
 * warmth. Difficulty sets the thresholds: on Gentle they never go past
 * exasperation, on Realistic fury needs more, on Tough it comes soonest.
 */
export function registerOf(
  state: Temperament,
  difficulty: Difficulty = "REALISTIC",
): Register {
  const furyAt = difficulty === "TOUGH" ? 85 : 92;
  const angerAt = difficulty === "TOUGH" ? 62 : 70;
  if (difficulty !== "GENTLE") {
    if (
      state.frustration >= furyAt ||
      (state.frustration >= angerAt + 8 && state.patience <= 10)
    ) {
      return "FURIOUS";
    }
    if (state.frustration >= angerAt) return "ANGRY";
  }
  if (state.hurt >= 70) return "CRYING";
  if (state.frustration >= 45) return "EXASPERATED";
  if (state.hurt >= 45) return "SAD";
  if (state.warmth >= 75) return "DELIGHTED";
  if (state.warmth >= 60) return "WARM";
  return "EVEN";
}

/** What the model is told about itself before it writes the line. */
export function temperamentNote(
  state: Temperament,
  register: Register,
): string {
  const how: Readonly<Record<Register, string>> = {
    FURIOUS:
      "you have lost your patience: speak angrily with a raised voice, short and sharp; you may threaten to end the meeting",
    ANGRY: "you are angry: cutting, blunt, no warmth",
    EXASPERATED:
      "you are exasperated: impatient, frustrated, you may sigh or be sarcastic",
    CRYING:
      "you are deeply upset: your voice breaks, you may cry, you struggle to keep composure",
    SAD: "you are disappointed and sad: quieter, heavier",
    DELIGHTED: "you are delighted: excited, warm, you may laugh",
    WARM: "you are warming to them: friendly, you smile as you speak, you may chuckle",
    EVEN: "you are composed: as the persona usually is",
  };
  return `Patience ${String(state.patience)}/100, warmth ${String(state.warmth)}/100, frustration ${String(state.frustration)}/100, hurt ${String(state.hurt)}/100. Register now: ${register} -- ${how[register]}. If their latest line pushes you further, go one step further; otherwise stay in this register.`;
}

export type Delivery = {
  readonly mood: string;
  readonly intensity: "SOFT" | "NORMAL" | "RAISED";
  readonly reaction: "LAUGH" | "CHUCKLE" | "SIGH" | "CRY" | null;
};

const IN_REGISTER: Readonly<Record<Register, readonly string[]>> = {
  FURIOUS: ["ANGRY"],
  ANGRY: ["ANGRY", "ANNOYED", "COLD"],
  EXASPERATED: ["IMPATIENT", "ANNOYED", "SARCASTIC", "COLD"],
  CRYING: ["SAD"],
  SAD: ["SAD", "DISAPPOINTED", "MEEK"],
  DELIGHTED: ["ENTHUSIASTIC", "HAPPY", "AMUSED"],
  WARM: ["WARM", "HAPPY", "AMUSED"],
  EVEN: [],
};
const REGISTER_MOOD: Readonly<Record<Register, string>> = {
  FURIOUS: "ANGRY",
  ANGRY: "ANGRY",
  EXASPERATED: "IMPATIENT",
  CRYING: "SAD",
  SAD: "DISAPPOINTED",
  DELIGHTED: "ENTHUSIASTIC",
  WARM: "WARM",
  EVEN: "NEUTRAL",
};
/** Moods that need a cause the state does not show yet. */
const HEATED = new Set(["ANGRY", "ANNOYED"]);

/**
 * How the line is delivered: the model's mood when it fits the register,
 * the register's own mood otherwise. A raised voice only when furious, a
 * sob only on entering grief, a laugh only when warm, a sigh on entering
 * exasperation. No outburst without a cause in the state.
 *
 * Leaving in anger is said in anger (founder live test 2026-10-01: the
 * angry ending was a flat stop): an angry or furious goodbye is raised,
 * a cold one stays cold.
 */
export function deliveryFor(
  register: Register,
  previous: Register | null,
  model: Delivery,
  closing = false,
): Delivery {
  if (closing && (register === "ANGRY" || register === "FURIOUS")) {
    return {
      mood: model.mood === "COLD" ? "COLD" : "ANGRY",
      intensity: model.mood === "COLD" ? "NORMAL" : "RAISED",
      reaction: null,
    };
  }
  const entering = previous !== register;
  if (register === "EVEN") {
    const calm = HEATED.has(model.mood) ? "SKEPTICAL" : model.mood;
    return {
      mood: calm,
      intensity: model.intensity === "RAISED" ? "NORMAL" : model.intensity,
      reaction:
        model.reaction === "CRY" || model.reaction === "LAUGH"
          ? null
          : model.reaction,
    };
  }
  const mood = IN_REGISTER[register].includes(model.mood)
    ? model.mood
    : REGISTER_MOOD[register];
  switch (register) {
    case "FURIOUS":
      return { mood, intensity: "RAISED", reaction: null };
    case "ANGRY":
      return { mood, intensity: "NORMAL", reaction: null };
    case "EXASPERATED":
      return {
        mood,
        intensity: "NORMAL",
        reaction: entering ? "SIGH" : model.reaction === "SIGH" ? "SIGH" : null,
      };
    case "CRYING":
      return { mood, intensity: "SOFT", reaction: entering ? "CRY" : null };
    case "SAD":
      return {
        mood,
        intensity: "SOFT",
        reaction: model.reaction === "SIGH" ? "SIGH" : null,
      };
    case "DELIGHTED":
      return {
        mood,
        intensity: "NORMAL",
        reaction:
          model.reaction === "LAUGH" || model.reaction === "CHUCKLE"
            ? model.reaction
            : entering
              ? "LAUGH"
              : null,
      };
    case "WARM":
      return {
        mood,
        intensity: "NORMAL",
        reaction:
          model.reaction === "CHUCKLE" || model.reaction === "LAUGH"
            ? model.reaction
            : null,
      };
  }
}

export type Forwardness = "RESERVED" | "TYPICAL" | "FORWARD";

/**
 * Who holds the leverage in this meeting (founder live test 2026-10-01:
 * played as a founder, the persona asked the investor "why are you
 * interested?" as if it held it). By the roles: an investor hearing a
 * pitch leads; a founder pitching is the weaker party -- answers,
 * persuades, asks fair questions later. Only how forward this person is
 * known to be (the persona's reading, from their own words or record)
 * shifts that, never the model's mood in the moment.
 */
export function stanceOf(
  played: "INVESTOR" | "FOUNDER",
  forwardness: Forwardness,
  why: string | null,
): {
  /** Who leads, seen from the person rehearsing. */
  readonly leads: "THEM" | "YOU";
  readonly note: string;
} {
  const because = why === null || why === "" ? "" : ` (${why})`;
  if (played === "FOUNDER") {
    const base =
      "You are the founder pitching to this investor: they hold the leverage. Answer their questions, persuade, stay courteous under pressure. Your own questions about the fund, process and terms are fair and come later, once you have answered theirs.";
    const shift =
      forwardness === "FORWARD"
        ? ` This founder is known to be forward${because}: you may push back sooner and ask pointed questions earlier, but you still need their money.`
        : forwardness === "RESERVED"
          ? ` This founder is known to be reserved${because}: answer more than you ask.`
          : "";
    return { leads: "YOU", note: base + shift };
  }
  const base =
    "You are the investor hearing this founder's pitch: you hold the leverage. You lead with questions and set the pace; you are fair, never contemptuous.";
  const shift =
    forwardness === "FORWARD"
      ? ` This investor is known to be forward${because}: interrupt, challenge numbers directly.`
      : forwardness === "RESERVED"
        ? ` This investor is known to be reserved${because}: fewer words, let silences sit.`
        : "";
  return { leads: "THEM", note: base + shift };
}

/**
 * Walking out, with warning (founder live 2026-10-02: the played person
 * walked out on the first angry line). In anger they warn twice, over two
 * turns, before they leave: "I'm going to stop you there…", then "Last
 * chance…", then the goodbye -- unless the person asks to end the meeting
 * themselves, which is honoured at once.
 */
export const WARNING_OPENERS = {
  1: "I'm going to stop you there.",
  2: "Last chance.",
} as const;

export const WALK_OUT_LINE =
  "That's it. I'm ending this meeting here. Goodbye!";

/** They asked to end it themselves (their own words, not a model's reading). */
export function asksToEnd(text: string): boolean {
  return /\b(end (?:the|this) (?:call|meeting)|let'?s (?:stop|end)|get lost|good ?bye|bye|i'?m done|we'?re done|get out|hang up|leave (?:the|this) (?:call|meeting)|not (?:going to|gonna) (?:\w+ )*(?:moving|move) forward)\b/i.test(
    text,
  );
}

export type WalkOut = {
  /** This line is warning 1 or 2, or null. */
  readonly warning: 1 | 2 | null;
  /** Rewrite the line into a warning, keep it, or end the meeting. */
  readonly action: "KEEP" | "WARN" | "WALK_OUT";
};

/**
 * What an angry line does, by fixed rules: below two warnings it warns
 * (a close is turned back into a warning); with two given, a provoking
 * line ends it. Not angry, or they asked to end: the model's line stands.
 */
export function walkOutPlan(input: {
  readonly register: Register;
  readonly warningsGiven: number;
  readonly theyAskedToEnd: boolean;
  readonly closing: boolean;
  readonly provoked: boolean;
}): WalkOut {
  const angry = input.register === "ANGRY" || input.register === "FURIOUS";
  if (!angry || input.theyAskedToEnd) return { warning: null, action: "KEEP" };
  if (input.warningsGiven < 2) {
    return {
      warning: input.warningsGiven === 0 ? 1 : 2,
      action: "WARN",
    };
  }
  if (input.closing || input.provoked)
    return { warning: null, action: "WALK_OUT" };
  return { warning: null, action: "KEEP" };
}

/** What the model is told before writing, so its words fit the stage. */
export function walkOutNote(warningsGiven: number, register: Register): string {
  const angry = register === "ANGRY" || register === "FURIOUS";
  if (!angry) return "";
  if (warningsGiven === 0) {
    return ' Do not end the meeting yet: this is your first warning -- tell them to stop ("I\'m going to stop you there…").';
  }
  if (warningsGiven === 1) {
    return ' Do not end the meeting yet: this is your last warning ("Last chance…").';
  }
  return " You have warned them twice: if they provoke you again, end the meeting with your goodbye.";
}
