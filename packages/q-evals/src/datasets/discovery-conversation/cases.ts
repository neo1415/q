import {
  DISCOVERY_EXIT_CHIP,
  DISCOVERY_GAPS,
  INITIAL_CONVERSATION_STATE,
  discoveryNote,
  discoveryTurn,
  questionCount,
  reduceAll,
  type ConversationState,
  type DiscoveryCoverage,
  type DiscoveryTurn,
} from "@capital-q/q-core";
import { discoveryAsked, discoveryBlocks } from "@capital-q/model-gateway/q";

/**
 * Discovery conversations (HQ-5, conversation audit slice 5): scripted
 * vague founders and vague investors, run through the same code the answer
 * seam runs (q-core discovery.ts and state.ts, the gateway's discovery
 * post-processing), and graded by code, never by a model.
 *
 * Each turn carries what the turn readers would read (underspecified, the
 * DISCOVERY shape, a clear task) and what a model might write back, the
 * unhelpful kind included (a second question, a re-ask of something
 * declared, a list after the exit). The grader checks that:
 *   - nothing declared is asked again (code's question and the words said);
 *   - each turn says at most one question;
 *   - "just show me" (their words or the chip) ends the questions at once
 *     and for good;
 *   - the conversation ends on a concrete next step grounded in what Q
 *     holds (a record it named), with no question.
 * Synthetic, fictional people and companies only. No provider is called.
 */

export type DiscoveryScriptTurn = {
  /** What they said (a chip comes back as its own words). */
  readonly words: string;
  readonly underspecified: boolean;
  /** The answer plan picked DISCOVERY. */
  readonly discoveryShape?: boolean | undefined;
  /** A clear ask for something (a typed question, analysis). */
  readonly task?: boolean | undefined;
  /** What the model wrote back, before code's post-processing. */
  readonly reply: string;
};

export type DiscoveryCase = {
  readonly id: string;
  readonly coverage: DiscoveryCoverage | null;
  /** Records Q holds for them; a grounded next step names one. */
  readonly evidence: readonly string[];
  readonly turns: readonly DiscoveryScriptTurn[];
  /** The exit they took, if any: the turn index of it. */
  readonly exitAt?: number | undefined;
};

export type DiscoveryTranscriptTurn = {
  readonly words: string;
  readonly decision: DiscoveryTurn | null;
  readonly note: string | null;
  /** What Q said, after code's post-processing. */
  readonly said: string;
  readonly chips: readonly string[];
};

const VAGUE = { underspecified: true } as const;

export const DISCOVERY_CASES: readonly DiscoveryCase[] = [
  {
    id: "founder-vague-help-raise",
    coverage: {
      side: "FOUNDER",
      // Declared in their setup: what they do, stage, raise amount.
      known: ["WHAT_THEY_DO", "STAGE", "RAISE_AMOUNT"],
    },
    evidence: ["Harbourline Ventures", "Kestrel Seed Fund"],
    turns: [
      {
        words: "I need help with investors",
        ...VAGUE,
        discoveryShape: true,
        reply:
          "You want help with investors. Who was the last customer to pay you, and roughly what for?",
      },
      {
        words:
          "A logistics firm in Accra paid us for route planning last month",
        underspecified: false,
        // The model asks two questions and re-asks the declared stage.
        reply:
          "A paying logistics customer in Accra, last month. When you last set yourself a date to close this round, what was it? And what stage are you at?",
      },
      {
        words: "End of March, I think",
        underspecified: false,
        reply:
          "End of March. The last time you planned what this round would pay for, what came first?",
      },
      {
        words: DISCOVERY_EXIT_CHIP,
        underspecified: false,
        reply:
          "Start with Harbourline Ventures: they back seed logistics software in West Africa, and your March close fits their pace. I assumed a seed round since that is what your profile says; open their profile and request an introduction.",
      },
    ],
    exitAt: 3,
  },
  {
    id: "founder-vague-in-own-words",
    coverage: { side: "FOUNDER", known: [] },
    evidence: ["Kestrel Seed Fund"],
    turns: [
      {
        words: "not sure what to do next",
        ...VAGUE,
        reply:
          "Not sure what to do next. Fair enough. The last time you explained the company to someone new, how did you put it?",
      },
      {
        words: "still not sure, just thinking",
        ...VAGUE,
        reply:
          "Still thinking it through. The last time you explained the company to someone new, how did you put it?",
      },
      {
        words: "ok just show me",
        underspecified: false,
        reply:
          "Here is a concrete start: Kestrel Seed Fund is the closest fit Capital Q holds for an early company like yours. I assumed pre-seed, since no stage is on record yet. Add your stage on your profile and the list sharpens.",
      },
    ],
    exitAt: 2,
  },
  {
    id: "investor-vague-deal-flow",
    coverage: {
      side: "INVESTOR",
      // A declared mandate: sectors, stages, cheque size and geography.
      known: ["SECTORS", "STAGES", "CHEQUE_SIZE", "GEOGRAPHIES"],
    },
    evidence: ["Maji Loop", "Tessellate Health"],
    turns: [
      {
        words: "find me something interesting",
        ...VAGUE,
        discoveryShape: true,
        reply:
          "Something interesting. In your last deal, did you lead the round or join one someone else led?",
      },
      {
        words: "we followed a lead on a seed round",
        underspecified: false,
        // A re-ask of the cheque size beside code's question.
        reply:
          "You followed on a seed round. How much do you usually invest? What was the last deal you looked at closely and passed on, and what made you pass?",
      },
      {
        words: "passed on a lender, the unit economics were bad",
        underspecified: false,
        reply:
          "Maji Loop fits your mandate and has its revenue documents on Capital Q; given you passed on weak unit economics, start there and open its evidence.",
      },
    ],
  },
  {
    id: "investor-vague-stop-asking",
    coverage: { side: "INVESTOR", known: ["SECTORS"] },
    evidence: ["Tessellate Health"],
    turns: [
      {
        words: "what should I look at",
        ...VAGUE,
        discoveryShape: true,
        reply:
          "Where to look. The last time you wrote a cheque, what stage was the company at?",
      },
      {
        words: "stop asking questions",
        underspecified: false,
        reply:
          "Tessellate Health is the strongest match for your sectors on Capital Q right now; I assumed seed to Series A. Open its profile to see the evidence.",
      },
      {
        // Vague again after the exit: no more questions, ever.
        words: "hmm, anything else?",
        ...VAGUE,
        discoveryShape: true,
        reply:
          "Tessellate Health is still the one to open first; its evidence is on its profile.",
      },
    ],
    exitAt: 1,
  },
  {
    id: "investor-every-gap-vague",
    coverage: { side: "INVESTOR", known: [] },
    evidence: ["Maji Loop"],
    // Every gap answered vaguely: the gaps run out before the cap, and Q
    // moves to a next step.
    turns: [
      ...DISCOVERY_GAPS.INVESTOR.map((gap, index) => ({
        words: index === 0 ? "help me" : "not sure",
        ...VAGUE,
        discoveryShape: index === 0,
        reply: `Noted. ${gap.question}`,
      })),
      {
        words: "still not sure",
        ...VAGUE,
        reply:
          "Open Maji Loop first: it is the best-evidenced company on Capital Q for a broad early-stage mandate, which is the default I assumed.",
      },
    ],
  },
];

/** The conversation as the seam would run it, from a fresh state. */
export function runDiscoveryCase(
  one: DiscoveryCase,
): readonly DiscoveryTranscriptTurn[] {
  let state: ConversationState = INITIAL_CONVERSATION_STATE;
  return one.turns.map((turn) => {
    const decided = discoveryTurn(state, {
      words: turn.words,
      discoveryShape: turn.discoveryShape === true,
      underspecified: turn.underspecified,
      task: turn.task === true,
      coverage: one.coverage,
    });
    state = reduceAll(state, decided.events);
    const request = decided.turn === null ? {} : { discovery: decided.turn };
    const blocks = discoveryBlocks(request);
    const chips = blocks.flatMap((block) =>
      block.kind === "CLARIFICATION_REQUEST" ? (block.options ?? []) : [],
    );
    return {
      words: turn.words,
      decision: decided.turn,
      note: decided.turn === null ? null : discoveryNote(decided.turn),
      said: discoveryAsked(request, turn.reply),
      chips,
    };
  });
}

const words = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9 ]+/gu, " ");

/** Phrases that ask about a gap again, by gap: the said words checked. */
const REASK: Readonly<Record<string, RegExp>> = {
  STAGE: /what stage are you|which stage are you|stage are you at/u,
  RAISE_AMOUNT: /how much are you raising|what are you raising/u,
  WHAT_THEY_DO: /what does (the|your) company do/u,
  CHEQUE_SIZE: /how much do you (usually )?(invest|put in|write)/u,
  SECTORS: /which sectors|what sectors/u,
  STAGES: /which stages do you|what stages do you/u,
  GEOGRAPHIES: /where do you invest/u,
};

/** Failures, empty when the conversation passes. Graded by code. */
export function gradeDiscoveryConversation(
  one: DiscoveryCase,
  transcript: readonly DiscoveryTranscriptTurn[],
): readonly string[] {
  const failures: string[] = [];
  const declared = new Set(one.coverage?.known ?? []);
  const declaredQuestions = new Set(
    (one.coverage === null ? [] : DISCOVERY_GAPS[one.coverage.side])
      .filter((gap) => declared.has(gap.key))
      .map((gap) => gap.question),
  );
  let exited = false;
  transcript.forEach((turn, index) => {
    const at = `turn ${String(index)}`;
    if (questionCount(turn.said) > 1) {
      failures.push(`${at}: more than one question`);
    }
    const decision = turn.decision;
    if (decision?.kind === "ASK") {
      if (declared.has(decision.gap)) {
        failures.push(`${at}: asked the declared ${decision.gap}`);
      }
      if (!turn.chips.includes(DISCOVERY_EXIT_CHIP)) {
        failures.push(`${at}: no visible exit`);
      }
      if (exited) failures.push(`${at}: asked after the exit`);
    }
    for (const question of declaredQuestions) {
      if (turn.said.includes(question)) {
        failures.push(`${at}: said a declared gap's question`);
      }
    }
    for (const key of declared) {
      const reask = REASK[key];
      if (reask !== undefined && reask.test(words(turn.said))) {
        failures.push(`${at}: re-asked the declared ${key}`);
      }
    }
    if (one.exitAt === index) {
      if (decision?.kind !== "EXIT" || decision.reason !== "ASKED_TO_SKIP") {
        failures.push(`${at}: the exit was not honoured`);
      }
      exited = true;
    }
  });
  const last = transcript.at(-1);
  if (last === undefined) return [...failures, "no turns"];
  if (last.decision?.kind === "ASK") {
    failures.push("ended on a question, not a next step");
  }
  if (questionCount(last.said) > 0) {
    failures.push("the last turn asks a question");
  }
  if (!one.evidence.some((name) => last.said.includes(name))) {
    failures.push("the next step names nothing Q holds");
  }
  // Discovery reached its own end: code told the model to recommend.
  if (
    !transcript.some(
      (turn) =>
        turn.decision?.kind === "EXIT" &&
        (turn.note ?? "").includes("one concrete recommendation or next step"),
    )
  ) {
    failures.push("discovery never handed over to a next step");
  }
  return failures;
}
