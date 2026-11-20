/**
 * The answer plan (HQ-1; docs/research/2026-11-20-q-conversation-audit.md
 * §2.2): the shape an answer takes, decided by code from what the turn
 * readers already read. No model call, and no new reading of the words.
 *
 * The readers say what work the turn is (answerKind, its parts, the
 * question kind, small talk) and, since TURN_SKIM v12 and TURN_READER v95,
 * whether the ask is underspecified and whether a wrong guess would be
 * costly. This pure function picks one shape; its template is rendered
 * into the answer's turn notes, which sit after the cached prompt prefix,
 * so the provider's cache is untouched.
 *
 * Form only, never substance: the plan never changes what may be read, the
 * tools offered, the reasoning level (keyed by answerKind) or any check on
 * what is said. A length is a ceiling, never a floor, and unknowns are
 * still said plainly.
 */

export const ANSWER_SHAPES = [
  "SOCIAL",
  "QUICK",
  "CLARIFY",
  "ASSUME_AND_DO",
  "ANALYSIS",
  "COMPARISON",
  "ADVICE",
  "DISCOVERY",
] as const;
export type AnswerShape = (typeof ANSWER_SHAPES)[number];

/** The kinds of work the turn reader reads (TURN_ANSWER_KINDS). */
type AnswerKind =
  "CHAT" | "LOOKUP" | "FOLLOW_UP" | "ANALYSIS" | "COMPARISON" | "DOCUMENT";

/** Question kinds whose answers are analysis (answerTaskClass agrees). */
export const ANALYTICAL_QUESTION_KINDS: ReadonlySet<string> = new Set([
  "ADVICE",
  "OPTIONS",
  "PROGRESS",
  "FIT",
]);

export type AnswerPlanInput = {
  /** Every kind read for the turn (answerKind and its parts). */
  readonly answerKinds: readonly AnswerKind[];
  readonly questionKind?: string | null | undefined;
  readonly turnKind?: string | null | undefined;
  /** The goal or the subject is unclear (TURN_SKIM v12, TURN_READER v95). */
  readonly underspecified?: boolean | undefined;
  /** A wrong guess would waste real work or mislead. */
  readonly costlyIfWrong?: boolean | undefined;
};

export type AnswerPlan = {
  readonly shape: AnswerShape;
  /** ASSUME_AND_DO: the shape the work then takes once the assumption is said. */
  readonly then: Exclude<AnswerShape, "ASSUME_AND_DO"> | null;
};

/** Heaviest work first: a compound ask is shaped by its heaviest part. */
const WEIGHT: Readonly<Record<AnswerKind, number>> = {
  DOCUMENT: 5,
  COMPARISON: 4,
  ANALYSIS: 3,
  FOLLOW_UP: 2,
  LOOKUP: 1,
  CHAT: 0,
};

function heaviest(kinds: readonly AnswerKind[]): AnswerKind | null {
  let best: AnswerKind | null = null;
  for (const kind of kinds) {
    if (best === null || WEIGHT[kind] > WEIGHT[best]) best = kind;
  }
  return best;
}

/** The shape of the work itself, before any question of clarity. */
function workShape(
  kind: AnswerKind | null,
  questionKind: string | null,
): Exclude<AnswerShape, "ASSUME_AND_DO" | "CLARIFY" | "DISCOVERY"> | null {
  if (kind === "COMPARISON") return "COMPARISON";
  if (questionKind === "ADVICE") return "ADVICE";
  if (kind === "ANALYSIS") return "ANALYSIS";
  if (questionKind !== null && ANALYTICAL_QUESTION_KINDS.has(questionKind)) {
    return "ANALYSIS";
  }
  if (kind === "LOOKUP" || kind === "FOLLOW_UP") return "QUICK";
  if (kind === "CHAT") return "SOCIAL";
  return null;
}

/**
 * The shape, or null when the turn is a document (the artifact path keeps
 * its own form) or was not read at all (the answer keeps its neutral
 * default: nothing is guessed from the words).
 */
export function answerPlanOf(input: AnswerPlanInput): AnswerPlan | null {
  const kind = heaviest(input.answerKinds);
  if (kind === "DOCUMENT") return null;
  if (input.turnKind === "SMALL_TALK") return { shape: "SOCIAL", then: null };
  const questionKind = input.questionKind ?? null;
  const work = workShape(kind, questionKind);
  if (input.underspecified === true && work !== "SOCIAL") {
    if (input.costlyIfWrong === true) return { shape: "CLARIFY", then: null };
    // The goal itself is unclear (no work read): open it up, one question.
    if (work === null) return { shape: "DISCOVERY", then: null };
    return { shape: "ASSUME_AND_DO", then: work };
  }
  return work === null ? null : { shape: work, then: null };
}

/**
 * HQ-2 slice 3 (conversation audit §2.6): whether a closing offer of more
 * ("Want me to…?") may end this answer. Only at a natural break: an
 * analysis, a comparison or advice was just delivered. A quick answer,
 * small talk, a clarifying or discovery question ends where it ends.
 * Null plan (unread, a document): unchanged, not judged here. Code's own
 * deterministic offers (a plan offer beside code's priorities, a material
 * uncertainty) are not the model's, and are not affected.
 */
export function offerAllowedFor(plan: AnswerPlan | null): boolean | null {
  if (plan === null) return null;
  const shape = plan.shape === "ASSUME_AND_DO" ? plan.then : plan.shape;
  return shape === "ANALYSIS" || shape === "COMPARISON" || shape === "ADVICE";
}

export type AnswerShapeTemplate = {
  /** What the answer's model is told, in one block. */
  readonly template: string;
  /** A ceiling, never a floor. */
  readonly maxWords: number | null;
};

/**
 * The templates, versioned config (ANSWER_SHAPES_V1). A change is a new
 * version beside this one, never an edit: the notes are part of what the
 * answer was told, and runs record it.
 */
export const ANSWER_SHAPES_VERSION = 1;
export const ANSWER_SHAPES_V1: Readonly<
  Record<AnswerShape, AnswerShapeTemplate>
> = {
  SOCIAL: {
    template:
      "Warm and specific to what they said, one or two sentences, as a person would reply. No offer and no question unless they asked one.",
    maxWords: 40,
  },
  QUICK: {
    template:
      "The answer itself in the first sentence. Then at most one reason or source clause, saying the evidence class when it is not verified (their own figure, no document yet). No headings, no list, no offer.",
    maxWords: 80,
  },
  CLARIFY: {
    template:
      "The ask could mean different things and a wrong guess would cost them. Ask exactly one specific question that splits the options, in their words, and offer the sensible default you would take if they just say go ahead. Optionally one line reflecting what they asked first. Nothing else: no answer yet, no list.",
    maxWords: 35,
  },
  ASSUME_AND_DO: {
    template:
      "The ask leaves something open, and a reasonable reading is cheap to correct. Say the assumption you are taking in one short clause first (for example: taking that as last quarter), then answer in the shape below. They can redirect you.",
    maxWords: null,
  },
  ANALYSIS: {
    template:
      'Open with one short human line tied to their ask only when it fits (never "great question" and never praise). Then the bottom line in one or two sentences. Then two to four short sub-sections with ## headings, drawn from their ask\'s parts or the evidence you hold (for example: what the record shows; what is claimed, not shown; risks; what would change the view), each point naming its company and its evidence class. Then the conclusion. End with one follow-up question, or one call to action only when there is an action they can take now, not both.',
    maxWords: 350,
  },
  COMPARISON: {
    template:
      "Code's comparison table and verdict lead when there is one; never write the table again in prose. In words, give what actually separates them, each point grounded in the evidence on hand, and say where something is not known. One follow-up question at most.",
    maxWords: 150,
  },
  ADVICE: {
    template:
      'Open with one short acknowledging line only when it fits. The recommendation first. Then two or three reasons, each saying whether it rests on evidence or on your inference; the biggest risk; numbered steps when it is a how-to; then one next step. End with one follow-up question, or one call to action only when there is an action they can take now, not both. Never "great question" and never praise.',
    maxWords: 250,
  },
  DISCOVERY: {
    template:
      "What they want is not yet clear. Reflect back in one line what you heard, then ask one open question about something specific from their past or their situation. No list and no recommendation yet.",
    maxWords: 50,
  },
};

/**
 * The plan as the note the answer's model reads, in its turn notes. Pure:
 * the same plan always renders the same text.
 */
export function answerPlanNote(plan: AnswerPlan): string {
  const own = ANSWER_SHAPES_V1[plan.shape];
  const then = plan.then === null ? null : ANSWER_SHAPES_V1[plan.then];
  const words = (template: AnswerShapeTemplate) =>
    template.maxWords === null
      ? ""
      : ` At most about ${String(template.maxWords)} words.`;
  return [
    `SHAPE OF THIS ANSWER (${plan.shape}${plan.then === null ? "" : ` then ${plan.then}`}, v${String(ANSWER_SHAPES_VERSION)}): ${own.template}${words(own)}`,
    ...(then === null ? [] : [`${then.template}${words(then)}`]),
    "The shape is form only: every rule on evidence, unknowns and what you may say still holds, and a length is a ceiling, never a floor.",
  ].join(" ");
}
