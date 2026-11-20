import { questionCount } from "../communication/natural-register.js";
import {
  reduceDiscovery,
  type ConversationEvent,
  type ConversationState,
  type DiscoveryExitReason,
} from "./state.js";

/**
 * Discovery mode (HQ-5; docs/research/2026-11-20-q-conversation-audit.md
 * slice 5): when what a person wants is not yet clear, Q opens it up the
 * way a good analyst would, rather than guessing or firing a form at them.
 *
 * Deterministic, and decided by code:
 *   - entered when the answer plan picks DISCOVERY, or when an ask is read
 *     as underspecified twice in a row (state.ts, PLANNED);
 *   - a gap model over their onboarding answers, their mandate and their
 *     company record: what Q already holds against what it needs to help.
 *     What is declared is never asked again (the HQ-2 rule);
 *   - one question a turn, about something they did ("the last time
 *     you..."), never a hypothetical; the model reflects first;
 *   - at most DISCOVERY_QUESTION_CAP questions, then Q works with what it
 *     has;
 *   - "just show me" always ends it, in their own words or through the
 *     chip shown with every question. A skipped gap stays unknown: Q says
 *     the default it assumed, it never records one.
 *
 * Pure: the consumer reads the coverage, applies the events, and passes
 * the turn to the answer's notes.
 */

export const DISCOVERY_QUESTION_CAP = 12;

/** The chip that always ends discovery (sent back as their own words). */
export const DISCOVERY_EXIT_CHIP = "Just show me";
/** The chip for a question they cannot answer yet: the gap stays unknown. */
export const DISCOVERY_UNSURE_CHIP = "Not sure yet";

export const DISCOVERY_SIDES = ["FOUNDER", "INVESTOR"] as const;
export type DiscoverySide = (typeof DISCOVERY_SIDES)[number];

export type DiscoveryGapDefinition = {
  readonly key: string;
  /** How the gap is named when Q says it already holds it. */
  readonly label: string;
  /** About something they did, never a hypothetical. */
  readonly question: string;
  /** Onboarding steps whose answer covers the gap (founder-v1, investor-v1). */
  readonly steps: readonly string[];
};

/** In the order they matter most for helping this person. */
export const DISCOVERY_GAPS: Readonly<
  Record<DiscoverySide, readonly DiscoveryGapDefinition[]>
> = {
  FOUNDER: [
    {
      key: "WHAT_THEY_DO",
      label: "what the company does",
      question:
        "The last time you explained the company to someone new, how did you put it?",
      steps: ["F1.description", "F1.categories"],
    },
    {
      key: "STAGE",
      label: "the company's stage",
      question:
        "When you last told someone where the company is at, what stage did you say?",
      steps: ["F1.stage"],
    },
    {
      key: "TRACTION",
      label: "traction and revenue",
      question: "Who was the last customer to pay you, and roughly what for?",
      steps: ["F5.revenue_status", "F5.customers", "F5.signal"],
    },
    {
      key: "RAISE_AMOUNT",
      label: "the amount you are raising",
      question:
        "The last time an investor asked how much you're raising, what figure did you give?",
      steps: ["F6.target_amount"],
    },
    {
      key: "TIMELINE",
      label: "when you want to close",
      question:
        "When you last set yourself a date to close this round, what was it?",
      steps: ["F6.timeframe"],
    },
    {
      key: "USE_OF_FUNDS",
      label: "what the money is for",
      question:
        "The last time you planned what this round would pay for, what came first?",
      steps: ["F6.use_of_funds"],
    },
    {
      key: "INVESTOR_TYPE",
      label: "the investors you want",
      question:
        "Think of the last investor conversation that went well: who were they, and what made it work?",
      steps: [],
    },
  ],
  INVESTOR: [
    {
      key: "SECTORS",
      label: "your sectors",
      question: "What did the last company you backed actually do?",
      steps: ["I3.sectors"],
    },
    {
      key: "STAGES",
      label: "the stages you invest at",
      question:
        "The last time you wrote a cheque, what stage was the company at?",
      steps: ["I2.stages"],
    },
    {
      key: "CHEQUE_SIZE",
      label: "your cheque size",
      question: "How much did you put into the last company you backed?",
      steps: ["I2.cheque_typical", "I2.cheque_min", "I2.cheque_max"],
    },
    {
      key: "GEOGRAPHIES",
      label: "where you invest",
      question: "Where was the last company you backed based?",
      steps: ["I3.geography"],
    },
    {
      key: "LEAD_OR_FOLLOW",
      label: "whether you lead or follow",
      question:
        "In your last deal, did you lead the round or join one someone else led?",
      steps: ["I2.investment_role"],
    },
    {
      key: "RECENT_DEALS",
      label: "your recent deals",
      question:
        "What was the last deal you looked at closely and passed on, and what made you pass?",
      steps: ["I8.portfolio"],
    },
  ],
};

export type DiscoveryCoverage = {
  readonly side: DiscoverySide;
  /** Gap keys Q already holds as declared; never asked. */
  readonly known: readonly string[];
};

/** Gap keys their answered onboarding steps cover. */
export function coverageFromOnboarding(
  side: DiscoverySide,
  answeredSteps: readonly string[],
): readonly string[] {
  const answered = new Set(answeredSteps);
  return DISCOVERY_GAPS[side]
    .filter((gap) => gap.steps.some((step) => answered.has(step)))
    .map((gap) => gap.key);
}

/** The parts of a declared mandate the gap model reads (get_investor_mandate). */
export type DiscoveryMandate = {
  readonly cheque: {
    readonly typical?: string | undefined;
    readonly min?: string | undefined;
    readonly max?: string | undefined;
  } | null;
  readonly stage: {
    readonly minStageCode: string | null;
    readonly maxStageCode: string | null;
  };
  readonly constraints: readonly { readonly dimension: string }[];
  readonly taxonomyPreferences: readonly { readonly vocabularyCode: string }[];
};

/** Gap keys a declared mandate covers. A dimension stated anywhere counts. */
export function coverageFromMandate(
  mandate: DiscoveryMandate,
): readonly string[] {
  const dimensions = new Set(mandate.constraints.map((c) => c.dimension));
  const vocabularies = new Set(
    mandate.taxonomyPreferences.map((p) => p.vocabularyCode),
  );
  const known: string[] = [];
  if (
    dimensions.has("sector") ||
    vocabularies.has("industry") ||
    vocabularies.has("product_category")
  ) {
    known.push("SECTORS");
  }
  if (
    dimensions.has("stage") ||
    mandate.stage.minStageCode !== null ||
    mandate.stage.maxStageCode !== null
  ) {
    known.push("STAGES");
  }
  const cheque = mandate.cheque;
  if (
    dimensions.has("cheque.typical") ||
    (cheque !== null &&
      (cheque.typical !== undefined ||
        cheque.min !== undefined ||
        cheque.max !== undefined))
  ) {
    known.push("CHEQUE_SIZE");
  }
  if (dimensions.has("geography.country") || vocabularies.has("geography")) {
    known.push("GEOGRAPHIES");
  }
  if (dimensions.has("investment_role")) known.push("LEAD_OR_FOLLOW");
  return known;
}

/** Gap keys their own company record covers. */
export function coverageFromCompany(company: {
  readonly stageCode?: string | null | undefined;
  readonly shortDescription?: string | null | undefined;
}): readonly string[] {
  return [
    ...((company.shortDescription ?? "").trim().length > 0
      ? ["WHAT_THEY_DO"]
      : []),
    ...((company.stageCode ?? "").trim().length > 0 ? ["STAGE"] : []),
  ];
}

/** The next gap to ask about: not known, not asked; null when none is left. */
export function nextDiscoveryGap(input: {
  readonly side: DiscoverySide;
  readonly known: readonly string[];
  readonly asked: readonly string[];
}): DiscoveryGapDefinition | null {
  const skip = new Set([...input.known, ...input.asked]);
  return DISCOVERY_GAPS[input.side].find((gap) => !skip.has(gap.key)) ?? null;
}

const SKIP_DISCOVERY =
  /^(?:(?:ok(?:ay)?|look|please|just|no|nah|honestly|enough)[,.!]?\s+)*(?:just\s+)?(?:show\s+me(?:\s+(?:something|what\s+you(?:'ve|\s+have)?\s*got|the\s+(?:list|results|options|companies|investors)))?|skip(?:\s+(?:this|it|the\s+questions))?|stop\s+asking(?:\s+(?:me\s+)?questions)?|enough\s+questions|no\s+more\s+questions|(?:just\s+)?get\s+on\s+with\s+it|(?:just\s+)?give\s+me\s+(?:something|a\s+recommendation|your\s+best\s+guess)|you\s+decide|whatever\s+you\s+think)(?:\s+(?:please|now|already))?[.!]*$/iu;

/**
 * Their words ask to leave discovery ("just show me", "skip", "stop asking
 * questions"). The whole turn must be the ask, so "show me how you got
 * that" is not one; the chip sends DISCOVERY_EXIT_CHIP, which matches.
 */
export function asksToSkipDiscovery(words: string): boolean {
  return SKIP_DISCOVERY.test(words.trim());
}

export type DiscoveryTurn =
  | {
      readonly kind: "ASK";
      readonly gap: string;
      readonly question: string;
      /** Labels of what Q already holds: said back, never asked. */
      readonly known: readonly string[];
      /** Questions asked including this one. */
      readonly asked: number;
      readonly chips: readonly string[];
    }
  | {
      readonly kind: "EXIT";
      readonly reason: DiscoveryExitReason;
      readonly known: readonly string[];
    };

/**
 * The discovery decision for this turn, with the events that record it.
 * Applies the PLANNED event itself, so the caller passes the state as the
 * last turn left it. Null: the conversation is not in discovery, and the
 * turn is answered as any other.
 */
export function discoveryTurn(
  state: ConversationState,
  input: {
    readonly words: string;
    /** The answer plan picked DISCOVERY for this turn. */
    readonly discoveryShape: boolean;
    readonly underspecified: boolean;
    /** A clear ask for something, answered as itself. */
    readonly task: boolean;
    readonly coverage: DiscoveryCoverage | null;
  },
): {
  readonly events: readonly ConversationEvent[];
  readonly turn: DiscoveryTurn | null;
} {
  const planned: ConversationEvent = {
    type: "PLANNED",
    discoveryShape: input.discoveryShape,
    underspecified: input.underspecified,
    task: input.task,
  };
  const was = state.discovery;
  const after = reduceDiscovery(was, planned);
  // A clear ask while discovering: done with discovery, the ask answered.
  if (was.active && !after.active) {
    return { events: [planned], turn: null };
  }
  if (!after.active) return { events: [planned], turn: null };
  const side = input.coverage?.side ?? null;
  const knownKeys = input.coverage?.known ?? [];
  const labels =
    side === null
      ? []
      : DISCOVERY_GAPS[side]
          .filter((gap) => knownKeys.includes(gap.key))
          .map((gap) => gap.label);
  const exit = (reason: DiscoveryExitReason) => ({
    events: [planned, { type: "DISCOVERY_EXITED", reason } as const],
    turn: { kind: "EXIT", reason, known: labels } as const,
  });
  // Only a turn after Q has asked can be an exit: the opening ask itself
  // is never read as "just show me".
  if (was.active && asksToSkipDiscovery(input.words)) {
    return exit("ASKED_TO_SKIP");
  }
  if (after.asked.length >= DISCOVERY_QUESTION_CAP) return exit("CAP");
  // Without a side there is no gap model: nothing to ask that is not a guess.
  if (side === null) return exit("NO_GAP_MODEL");
  const gap = nextDiscoveryGap({ side, known: knownKeys, asked: after.asked });
  if (gap === null) return exit("COVERED");
  return {
    events: [planned, { type: "DISCOVERY_ASKED", gap: gap.key }],
    turn: {
      kind: "ASK",
      gap: gap.key,
      question: gap.question,
      known: labels,
      asked: after.asked.length + 1,
      chips: [DISCOVERY_EXIT_CHIP, DISCOVERY_UNSURE_CHIP],
    },
  };
}

const EXIT_WORDS: ReadonlyMap<string, string> = new Map<
  DiscoveryExitReason,
  string
>([
  ["ASKED_TO_SKIP", "they asked to skip the questions"],
  ["CAP", "enough questions have been asked"],
  ["COVERED", "Q now has what it needs"],
  ["NO_GAP_MODEL", "there is nothing more Q should ask"],
  ["TASK", "they asked for something specific"],
]);

/**
 * The turn note for a discovery turn. ASK: reflect, then exactly the
 * question code chose. EXIT: no question; a concrete next step grounded
 * in what Q holds, the defaults it assumed said in a few words.
 */
export function discoveryNote(
  turn:
    | DiscoveryTurn
    | {
        readonly kind: "EXIT";
        readonly reason: string;
        readonly known: readonly string[];
      },
): string {
  const known =
    turn.known.length === 0
      ? ""
      : ` Already on record, so never ask about it: ${turn.known.join("; ")}.`;
  if (turn.kind === "ASK") {
    return `DISCOVERY (question ${String(turn.asked)} of at most ${String(DISCOVERY_QUESTION_CAP)}): what they want is not yet clear. Reflect back in one short line what they just told you, in their words. Then ask exactly this one question, and no other: "${turn.question}"${known} No list, no recommendation and no offer yet. At most about 50 words.`;
  }
  return `DISCOVERY IS OVER (${EXIT_WORDS.get(turn.reason) ?? "Q works with what it has"}). Ask no question. Give one concrete recommendation or next step now, grounded only in what Capital Q holds for them and what they have said here. Where something is still unknown, say in a few words the default you assumed; never record one.${known}`;
}

/**
 * HQ-5: a discovery question turn says one question. A reply that still
 * asks more keeps one and drops the others (the reflection before it
 * stays): code's own question when the reply says it, else the first.
 */
export function atMostOneQuestion(text: string, prefer?: string): string {
  if (questionCount(text) <= 1) return text;
  const sentences = text.match(/[^.!?]*[.!?]+["”’)]*\s*|[^.!?]+$/gu) ?? [text];
  const isQuestion = (sentence: string) => questionCount(sentence) > 0;
  const preferred = normalised(prefer ?? "");
  const keep =
    preferred.length === 0
      ? -1
      : sentences.findIndex(
          (sentence) =>
            isQuestion(sentence) && normalised(sentence).includes(preferred),
        );
  const chosen = keep >= 0 ? keep : sentences.findIndex(isQuestion);
  return sentences
    .filter((sentence, index) => !isQuestion(sentence) || index === chosen)
    .join("")
    .trim();
}

function normalised(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .replace(/[^a-z0-9' ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
