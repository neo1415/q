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
  // A person whose ceiling is COLD: as displeased as exasperated, never
  // louder -- cold, quiet and formal (founder feedback 2026-10-03).
  "COLD",
  "CRYING",
  "SAD",
  "DELIGHTED",
  "WARM",
  "EVEN",
] as const;
export type Register = (typeof REGISTERS)[number];

type Delta = Partial<Record<keyof Temperament, number>>;

/**
 * The reading the numbers move by: the model's, or code's own for a gap
 * (HONEST_GAP: unsure, unknown or not tracked, however candid, costs) and
 * a direct answer (DIRECT_ANSWER: no cost). See categoryOf.
 */
export type AppliedAppraisal =
  RehearsalAppraisal | "HONEST_GAP" | "DIRECT_ANSWER";

/**
 * Whether the played person's last line put a question to them: by the
 * move it was stored with (QUESTION or FOLLOW_UP), never by a question
 * mark -- "Anything else?" closing a remark, or a warning's rhetorical
 * "Are we done here?", is not a question waiting on them (QA df5af97b:
 * the founder's closing question was called "not the question I
 * asked"). Lines stored before moves were kept fall back to the mark.
 */
export function questionOpenIn(
  turns: readonly {
    readonly from: string;
    readonly text: string;
    readonly move?: string | undefined;
  }[],
): boolean {
  // Code's own yield to a raised hand is not their question: look past it
  // to the line before (QA rehearsal 064ff78f).
  const lastTheirs = [...turns]
    .reverse()
    .find((turn) => turn.from === "THEM" && turn.move !== "YIELD");
  if (lastTheirs === undefined) return false;
  if (lastTheirs.move !== undefined) {
    return lastTheirs.move === "QUESTION" || lastTheirs.move === "FOLLOW_UP";
  }
  return lastTheirs.text.includes("?");
}

/**
 * What the model is told about the question on the table, in the same
 * categories code applies: an unsure or no-data answer is HUMBLE_HONEST
 * (code scores it HONEST_GAP, a cost) or EVASIVE; CLEAR_BUT_THIN is only a
 * real answer with little behind it (code scores it DIRECT_ANSWER).
 */
export function questionNote(questionOpen: boolean, theyAsked = false): string {
  const asked = theyAsked
    ? " Their line asks you something: answer it; a question back or about next steps is never a dodge or a provocation."
    : "";
  return (
    (questionOpen
      ? " Your question is open: an answer that is unsure, unknown or not tracked is a gap, however candid -- read it HUMBLE_HONEST if candid or EVASIVE if it avoids it, never CLEAR_BUT_THIN; CLEAR_BUT_THIN is only a real answer with little behind it."
      : " No question of yours is waiting on them: their line cannot dodge one, so never say it didn't answer your question.") +
    asked
  );
}

/** Whether their latest line asks something: it ends on a question. */
export function theyAskedIn(
  turns: readonly { readonly from: string; readonly text: string }[],
): boolean {
  const last = turns.at(-1);
  return last !== undefined && last.from === "YOU" && /\?\s*$/u.test(last.text);
}

/** Readings that give the played person new cause for frustration. */
const PROVOKING: ReadonlySet<AppliedAppraisal> = new Set([
  "EVASIVE",
  "REPEATED_DODGE",
  "RUDE",
  "OVERCLAIM",
  "CLEAR_BUT_THIN",
  "HONEST_GAP",
]);

/** What each reading of their latest line does to the played person. */
const EFFECTS: Readonly<Record<AppliedAppraisal, Delta>> = {
  // Candid, but the question is still unanswered.
  HONEST_GAP: { frustration: 10, patience: -10 },
  // Answered, if briefly: no new cause.
  DIRECT_ANSWER: { patience: -2 },
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
  appraisal: AppliedAppraisal,
  difficulty: Difficulty,
  profile?: TemperamentProfile,
  /** Their line touched what this person warms to, or what cools them. */
  topic: TopicTouch = null,
): Temperament {
  const { worse, better } = profile ?? PROFILE[difficulty];
  const base: Delta = EFFECTS[appraisal] ?? {};
  const delta: Delta =
    topic === null
      ? base
      : {
          ...base,
          warmth: (base.warmth ?? 0) + (topic === "WARMS" ? 8 : -6),
          frustration: (base.frustration ?? 0) + (topic === "WARMS" ? -4 : 8),
        };
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
  // Founder live 2026-10-02: insulted on Realistic, the played person only
  // got exasperated and firm. Anger now comes sooner when provoked.
  const furyAt = difficulty === "TOUGH" ? 78 : 85;
  const angerAt = difficulty === "TOUGH" ? 55 : 62;
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
    COLD: "you have gone cold: quiet, formal and brief; you never raise your voice",
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
  COLD: ["COLD", "SKEPTICAL", "INDIFFERENT", "DISAPPOINTED"],
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
  COLD: "COLD",
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
  provoked = false,
  answered = false,
): Delivery {
  // Answered: whatever is left of their temper, this line is not heated
  // and not raised (QA df5af97b: a numbers-backed answer was met louder).
  if (answered && !closing) {
    const heated = HEATED.has(model.mood) || model.mood === "IMPATIENT";
    return {
      mood: heated ? "SKEPTICAL" : model.mood,
      intensity: model.intensity === "RAISED" ? "NORMAL" : model.intensity,
      reaction: model.reaction === "CRY" ? null : model.reaction,
    };
  }
  // Provoked in anger (an insult, a dodge again), it is heard: angry and
  // raised, never a cold, level line (founder live 2026-10-02).
  if (provoked && (register === "ANGRY" || register === "FURIOUS")) {
    return { mood: "ANGRY", intensity: "RAISED", reaction: null };
  }
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
    case "COLD":
      // Quiet displeasure: never raised, no sigh for show.
      return {
        mood,
        intensity: model.intensity === "SOFT" ? "SOFT" : "NORMAL",
        reaction: null,
      };
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

/** How a ONE_COLD_REMARK person signals, then leaves: politely, quietly. */
export const COLD_REMARK = "I'm not sure this is going anywhere.";
export const POLITE_EXIT_LINE =
  "I don't think this is for us. Thank you for your time.";

// ---------------------------------------------------------------------------
// Each played person's own temperament (founder feedback 2026-10-03: "if
// they all behave the same way, doesn't that defeat the purpose?"). The
// machine stays the frame; the persona's conduct sets its parameters, and
// difficulty scales them.
// ---------------------------------------------------------------------------

export type PersonaConductLike = {
  readonly patience: "SHORT" | "TYPICAL" | "LONG";
  readonly warmth: "RESERVED" | "TYPICAL" | "GENEROUS";
  readonly dodgeTolerance: "LOW" | "TYPICAL" | "HIGH";
  readonly ceiling: "COLD" | "IMPATIENT" | "ANGRY" | "FURIOUS";
  readonly leaving: "WARNS_TWICE" | "ONE_COLD_REMARK";
};

export type TemperamentProfile = {
  readonly start: Temperament;
  /** How hard bad moments land (patience drains, frustration rises). */
  readonly worse: number;
  /** How much a good answer buys. */
  readonly better: number;
  /** Dodges in a row they let pass before pressing (never fewer than 1). */
  readonly dodgesBeforeWarning: number;
  /** The loudest register they reach. */
  readonly ceiling: Register;
  /** Signals they give before they leave: two warnings, or one cold remark. */
  readonly signalsBeforeLeaving: 1 | 2;
};

/**
 * Their conduct as read by the persona (v6), or for an older reading a
 * default from what it does say: their baseline mood and forwardness.
 */
export function conductOf(persona: {
  readonly temperament: { readonly baseline: string };
  readonly forwardness?: "RESERVED" | "TYPICAL" | "FORWARD" | undefined;
  readonly conduct?: PersonaConductLike | undefined;
}): PersonaConductLike {
  if (persona.conduct !== undefined) return persona.conduct;
  const baseline = persona.temperament.baseline;
  const forward = persona.forwardness === "FORWARD";
  const reserved = persona.forwardness === "RESERVED";
  return {
    patience:
      baseline === "IMPATIENT" || forward
        ? "SHORT"
        : baseline === "WARM" || baseline === "ENTHUSIASTIC"
          ? "LONG"
          : "TYPICAL",
    warmth:
      baseline === "WARM" || baseline === "ENTHUSIASTIC"
        ? "GENEROUS"
        : baseline === "COLD" || reserved
          ? "RESERVED"
          : "TYPICAL",
    dodgeTolerance: forward ? "LOW" : reserved ? "HIGH" : "TYPICAL",
    ceiling:
      baseline === "COLD" || reserved ? "COLD" : forward ? "FURIOUS" : "ANGRY",
    leaving:
      baseline === "COLD" || reserved ? "ONE_COLD_REMARK" : "WARNS_TWICE",
  };
}

const CEILING_REGISTER: Readonly<
  Record<PersonaConductLike["ceiling"], Register>
> = {
  COLD: "COLD",
  IMPATIENT: "EXASPERATED",
  ANGRY: "ANGRY",
  FURIOUS: "FURIOUS",
};

/** The persona's conduct, scaled by difficulty: the frame's parameters. */
export function temperamentProfile(
  conduct: PersonaConductLike,
  baseline: string,
  difficulty: Difficulty,
): TemperamentProfile {
  const level = PROFILE[difficulty];
  const start = initialTemperament(difficulty, baseline);
  const patience =
    conduct.patience === "SHORT" ? -15 : conduct.patience === "LONG" ? 15 : 0;
  const tolerance =
    (conduct.dodgeTolerance === "HIGH" ? 2 : 1) +
    (difficulty === "GENTLE" ? 1 : 0);
  const ceiling = CEILING_REGISTER[conduct.ceiling];
  return {
    start: { ...start, patience: clamp(start.patience + patience) },
    worse:
      level.worse *
      (conduct.patience === "SHORT"
        ? 1.4
        : conduct.patience === "LONG"
          ? 0.7
          : 1),
    better:
      level.better *
      (conduct.warmth === "GENEROUS"
        ? 1.5
        : conduct.warmth === "RESERVED"
          ? 0.6
          : 1),
    // Never a warning for a first dodge, whoever they are.
    dodgesBeforeWarning: Math.max(1, tolerance),
    // Gentle never goes past exasperation; a cold person stays cold.
    ceiling:
      difficulty === "GENTLE" &&
      ceiling !== "COLD" &&
      rung(ceiling) > rung("EXASPERATED")
        ? "EXASPERATED"
        : ceiling,
    signalsBeforeLeaving: conduct.leaving === "ONE_COLD_REMARK" ? 1 : 2,
  };
}

/** Whether their line touched what this person warms to or cools on. */
export type TopicTouch = "WARMS" | "COOLS" | null;

const STOP = new Set([
  "about",
  "their",
  "there",
  "these",
  "those",
  "which",
  "would",
  "could",
  "should",
  "where",
  "being",
  "other",
  "every",
  "under",
  "after",
  "before",
  "really",
  "things",
  "people",
  "company",
  "founders",
  "founder",
  "investor",
  "investors",
  "business",
  "something",
]);
const contentWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 5 && !STOP.has(word))
      .map((word) => word.replace(/(?:ies|es|s)$/u, "")),
  );

/**
 * Their line against the persona's warmsTo and coolsOn, by shared content
 * words (two or more with one item): a deterministic modifier on the
 * numbers and one step of register, never a warning by itself.
 */
export function topicTouchOf(
  line: string,
  temperament: {
    readonly warmsTo: readonly string[];
    readonly coolsOn: readonly string[];
  },
): TopicTouch {
  const said = contentWords(line);
  const touches = (items: readonly string[]) =>
    items.some(
      (item) =>
        [...contentWords(item)].filter((word) => said.has(word)).length >= 2,
    );
  if (touches(temperament.coolsOn)) return "COOLS";
  if (touches(temperament.warmsTo)) return "WARMS";
  return null;
}

// ---------------------------------------------------------------------------
// The temperament machine (QA rehearsal d7ef826e: a first dodge went
// straight to anger and a warning, a strong answer drew "Last chance", and
// the closing ask was delivered angry and raised). One deterministic table,
// decided by code: the model's reading of their line is only an input, and
// the model's words are only words -- it never decides the register, a
// warning or a close.
// ---------------------------------------------------------------------------

/** What their latest line was, as code applies it. */
export const TURN_CATEGORIES = [
  "STRONG",
  "DIRECT",
  "GAP",
  "DODGE",
  "RUDE",
  "ASKED",
  "WARMING",
  "HURTING",
  "NEUTRAL",
] as const;
export type TurnCategory = (typeof TURN_CATEGORIES)[number];

/**
 * The model's reading, read against the table's inputs: a dodge needs a
 * question to dodge; an unsure answer to their question is the gap; their
 * own question (next steps, or back at them) is ASKED, whatever else the
 * reading says -- unless it was rude.
 */
export function categoryOf(
  appraisal: RehearsalAppraisal,
  questionOpen: boolean,
  theyAsked: boolean,
): TurnCategory {
  if (appraisal === "RUDE") return "RUDE";
  if (theyAsked) return "ASKED";
  switch (appraisal) {
    case "STRONG_ANSWER":
      return "STRONG";
    case "CLEAR_BUT_THIN":
      return questionOpen ? "DIRECT" : "NEUTRAL";
    case "HUMBLE_HONEST":
      return questionOpen ? "GAP" : "WARMING";
    case "OVERCLAIM":
      return "GAP";
    case "EVASIVE":
    case "REPEATED_DODGE":
      return questionOpen ? "DODGE" : "NEUTRAL";
    case "FUNNY":
    case "APOLOGY":
    case "GOOD_NEWS_FOR_THEM":
      return "WARMING";
    case "BAD_NEWS_FOR_THEM":
    case "HARD_NO_FOR_THEM":
      return "HURTING";
    case "NEUTRAL":
      return "NEUTRAL";
  }
}

/** The appraisal the numbers move by, for each category. */
export function stateAppraisalOf(
  category: TurnCategory,
  appraisal: RehearsalAppraisal,
): AppliedAppraisal {
  switch (category) {
    case "STRONG":
      return "STRONG_ANSWER";
    case "DIRECT":
      return "DIRECT_ANSWER";
    case "GAP":
      return appraisal === "OVERCLAIM" ? "OVERCLAIM" : "HONEST_GAP";
    case "DODGE":
      return appraisal === "REPEATED_DODGE" ? "REPEATED_DODGE" : "EVASIVE";
    case "RUDE":
      return "RUDE";
    case "ASKED":
    case "NEUTRAL":
      return "NEUTRAL";
    case "WARMING":
    case "HURTING":
      return appraisal;
  }
}

/** Calm to furious: the ladder anger climbs and answers come down. */
const LADDER: readonly Register[] = [
  "DELIGHTED",
  "WARM",
  "EVEN",
  "EXASPERATED",
  "ANGRY",
  "FURIOUS",
];
const rung = (register: Register): number => {
  // Cold is as displeased as exasperated, only quieter.
  if (register === "COLD") return LADDER.indexOf("EXASPERATED");
  const at = LADDER.indexOf(register);
  // Grief sits beside the ladder: its level for anger is composed.
  return at === -1 ? LADDER.indexOf("EVEN") : at;
};
const at = (index: number): Register =>
  LADDER[Math.max(0, Math.min(LADDER.length - 1, index))] ?? "EVEN";
const EXASPERATED_RUNG = rung("EXASPERATED");
const ANGRY_RUNG = rung("ANGRY");

/** Conclusions that end a meeting by walking out, not by its natural end. */
const WALK_OUT_CONCLUSIONS: ReadonlySet<string> = new Set([
  "LEFT_EARLY",
  "DECLINED",
]);

export type TemperamentInput = {
  readonly category: TurnCategory;
  readonly questionOpen: boolean;
  readonly warningsGiven: number;
  readonly previous: Register;
  /** Their dodges in a row just before this line (0: none). */
  readonly dodgeStreak: number;
  readonly difficulty: Difficulty;
  /** Hurt after this line, for grief (BAD_NEWS, HARD_NO). */
  readonly hurt: number;
  /** They asked to end the meeting themselves: honoured at once. */
  readonly theyAskedToEnd: boolean;
  /** The model wrote a close, and how it would end. */
  readonly modelClose: { readonly conclusion: string | null } | null;
  /** The meeting is at its natural end (code's wrap-up). */
  readonly wrappingUp: boolean;
  /** This person's own parameters; absent: the shared default. */
  readonly profile?: TemperamentProfile | undefined;
  /** Their line touched what this person warms to or cools on. */
  readonly topic?: TopicTouch | undefined;
};

export type TemperamentStep = {
  /** The register this line is delivered in. */
  readonly register: Register;
  /** This line is warning 1 or 2; null: no warning. */
  readonly warning: 1 | 2 | null;
  /**
   * WALK_OUT: they leave (code's goodbye, DECLINED). NATURAL: the model's
   * close stands (they asked to end it, or a calm close at the natural
   * end or with a good outcome). NONE: the meeting goes on.
   */
  readonly close: "NONE" | "NATURAL" | "WALK_OUT";
  /** How this person signals and leaves: in anger, or coolly and politely. */
  readonly manner: "HEATED" | "COOL";
};

/**
 * The table, by category:
 *  STRONG   one step down the ladder; never a warning.
 *  DIRECT   stays; never a warning.
 *  GAP      one step up, no higher than exasperated; never a warning.
 *  DODGE    the first in a row: exasperated (impatient), no warning; the
 *           second in a row: angry and a warning; with two given: they leave.
 *  RUDE     angry (furious if already angry) and a warning; with two
 *           given: they leave.
 *  ASKED    no higher than exasperated; never angry, never a warning.
 *  WARMING  one step down.  HURTING  sad, or crying when hurt runs deep.
 *  NEUTRAL  stays.
 * Gentle never goes past exasperated. A close: walking out only after two
 * warnings and new cause (a dodge or rudeness); the model's own close only
 * when they asked to end it, or calmly with an outcome that is not a
 * walk-out (and a no only at the natural end). Anything else is not a close.
 */
export function nextTemperament(input: TemperamentInput): TemperamentStep {
  const profile = input.profile;
  const tolerance = Math.max(1, profile?.dodgesBeforeWarning ?? 1);
  const leaveAfter = profile?.signalsBeforeLeaving ?? 2;
  const cool = profile?.ceiling === "COLD" || leaveAfter === 1;
  const manner: TemperamentStep["manner"] = cool ? "COOL" : "HEATED";
  const from = rung(input.previous);
  const ceilingRung =
    profile === undefined
      ? input.difficulty === "GENTLE"
        ? EXASPERATED_RUNG
        : LADDER.length - 1
      : rung(profile.ceiling);
  const cap = (index: number) => Math.min(index, ceilingRung);
  const provoking =
    input.category === "RUDE" ||
    (input.category === "DODGE" && input.dodgeStreak >= tolerance);
  const topic = input.topic ?? null;
  let index: number;
  switch (input.category) {
    case "STRONG":
    case "WARMING":
      index = from - 1 - (topic === "WARMS" ? 1 : 0);
      break;
    case "DIRECT":
    case "NEUTRAL":
      // What they warm to softens them a step; what cools them hardens
      // them a step, never past impatience by itself.
      index =
        topic === "WARMS"
          ? from - 1
          : topic === "COOLS"
            ? Math.max(from, Math.min(from + 1, EXASPERATED_RUNG))
            : from;
      break;
    case "GAP":
      index = Math.max(from, Math.min(from + 1, EXASPERATED_RUNG));
      break;
    case "DODGE":
      index =
        input.dodgeStreak >= tolerance
          ? Math.max(ANGRY_RUNG, from)
          : Math.max(from, EXASPERATED_RUNG);
      break;
    case "RUDE":
      index = from >= ANGRY_RUNG ? ANGRY_RUNG + 1 : ANGRY_RUNG;
      break;
    case "ASKED":
      index = Math.min(from, EXASPERATED_RUNG);
      break;
    case "HURTING":
      index = -1;
      break;
  }
  let register: Register =
    input.category === "HURTING"
      ? input.hurt >= 70
        ? "CRYING"
        : "SAD"
      : at(cap(index));
  // A cold person is never louder than cold: displeasure goes quiet.
  if (
    profile?.ceiling === "COLD" &&
    LADDER.includes(register) &&
    rung(register) >= EXASPERATED_RUNG
  ) {
    register = "COLD";
  }
  if (input.theyAskedToEnd) {
    return { register, warning: null, close: "NATURAL", manner };
  }
  if (provoking) {
    // They leave only once they have signalled it, in their own way.
    if (input.warningsGiven >= leaveAfter) {
      return { register, warning: null, close: "WALK_OUT", manner };
    }
    return {
      register,
      warning: input.warningsGiven === 0 ? 1 : 2,
      close: "NONE",
      manner,
    };
  }
  const conclusion = input.modelClose?.conclusion ?? null;
  const calm = rung(register) <= EXASPERATED_RUNG;
  const naturalClose =
    input.modelClose !== null &&
    calm &&
    (conclusion === null ||
      !WALK_OUT_CONCLUSIONS.has(conclusion) ||
      (conclusion === "DECLINED" &&
        // A quiet "this isn't for us" stands once they have signalled it.
        (input.wrappingUp || (cool && input.warningsGiven >= leaveAfter))));
  return {
    register,
    warning: null,
    close: naturalClose ? "NATURAL" : "NONE",
    manner,
  };
}

/**
 * Warning, threat and goodbye talk the model wrote itself: code decides
 * those, so its own are taken out, and a warning code gives is said once
 * ("Last chance" twice in one line, live d7ef826e).
 */
const WARNING_TALK =
  /(?:^|(?<=[.!?]\s))[^.!?]*\b(?:last chance|final warning|(?:i'?m|i am) going to stop you(?: right)? there|(?:i'?ll|i will|i'?m going to) (?:end|stop|walk out of|leave) (?:this|the) (?:meeting|conversation)|this meeting is over|(?:i'?m|i am) (?:ending|done with) this(?: meeting)?|we'?re done here|goodbye)\b[^.!?]*[.!?]?\s*/giu;
export function withoutWarningTalk(line: string): string {
  return line
    .replace(WARNING_TALK, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/** The line as code's warning: its opener once, then the model's words. */
export function warnedLine(
  stage: 1 | 2,
  line: string,
  manner: "HEATED" | "COOL" = "HEATED",
): string {
  const words = withoutWarningTalk(line);
  // A cool person signals with one cold remark, not a raised warning.
  if (manner === "COOL") {
    return words.length === 0 ? COLD_REMARK : `${COLD_REMARK} ${words}`;
  }
  const opener = WARNING_OPENERS[stage];
  const follow =
    stage === 1
      ? "If we carry on like this, I'll end the meeting."
      : "Do that again and this meeting is over.";
  return words.length === 0 ? `${opener} ${follow}` : `${opener} ${words}`;
}

/** What the model is told before writing: words only, in this register. */
export function machineNote(previous: Register): string {
  return ` You are in the ${previous} register: write your words in it. Never warn them, threaten to leave or say goodbye yourself -- Capital Q decides warnings and when the meeting ends, and adds those words itself.`;
}
