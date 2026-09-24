import {
  clearFailure,
  EMPTY_FAILURES,
  noteFailure,
  type FailureLedger,
  type FailureOperation,
} from "./failures.js";
import type {
  ConversationTurnReading,
  InferenceSuggestion,
  QuestionKind,
} from "./reading.js";
import type { ShownOption } from "./references.js";
import {
  recordRepair,
  type RepairHistory,
  type RepairStrategy,
} from "./repair.js";

/**
 * Explicit conversational state and the reducer over it (CQ-QX-005 §16).
 *
 * A conversation with Q is a person doing several things at once —
 * answering, asking, correcting, wandering off and coming back — while Q
 * quietly completes a job underneath. The job is the consumer's (a
 * mandate, a company profile, whatever the person is doing on Home); the
 * shape of the conversation around it is the same everywhere, and this
 * is that shape, written down so that nothing has to be inferred from a
 * transcript:
 *
 *   topic          the job item in hand
 *   asked          Q's unanswered question, with the choices it showed
 *   clarification  a targeted question Q is holding open
 *   answering      the person's question Q is in the middle of
 *   proposals      Q's own inferences, awaiting a yes, never written
 *   research       the task in flight, and where to resume after it
 *   resumeTopic    where an interruption returns to
 *   failures       what has failed and how often, per subsystem
 *   repair         which repair rungs have been used on the topic
 *
 * Pure: events in, state out. The consumer owns persistence and the
 * writes; this decides nothing about the domain and holds no values the
 * owning service holds.
 */

export type AskedQuestion = {
  readonly topic: string;
  readonly question: string;
  readonly options: readonly ShownOption[];
};

export type PendingClarification = {
  readonly topic: string;
  readonly because:
    "LOW_CONFIDENCE" | "UNRESOLVED_REFERENCE" | "SCALE" | "REFUSED" | "TENSION";
  readonly attempts: number;
};

export type PendingProposal = InferenceSuggestion & {
  /** The turn it was offered on, so a stale one can be let go. */
  readonly offeredAt: number;
};

export type ResearchTask = {
  readonly question: string;
  readonly resumeTopic: string | null;
  readonly startedAt: number;
};

export type ConversationState = {
  readonly turn: number;
  readonly topic: string | null;
  readonly asked: AskedQuestion | null;
  /** Recent selections by topic, so "same as before" has a referent. */
  readonly selections: Readonly<Record<string, readonly string[]>>;
  readonly clarification: PendingClarification | null;
  readonly answering: {
    readonly kind: QuestionKind;
    readonly text: string;
  } | null;
  readonly proposals: readonly PendingProposal[];
  readonly research: ResearchTask | null;
  readonly resumeTopic: string | null;
  readonly failures: FailureLedger;
  readonly repair: RepairHistory | null;
  /** Consecutive turns that produced no progress on the topic in hand. */
  readonly stalled: number;
};

export const INITIAL_CONVERSATION_STATE: ConversationState = {
  turn: 0,
  topic: null,
  asked: null,
  selections: {},
  clarification: null,
  answering: null,
  proposals: [],
  research: null,
  resumeTopic: null,
  failures: EMPTY_FAILURES,
  repair: null,
  stalled: 0,
};

const MAX_SELECTIONS = 12;
const MAX_PROPOSALS = 6;

export type ConversationEvent =
  | { readonly type: "TURN_STARTED" }
  | { readonly type: "TOPIC_CHANGED"; readonly topic: string | null }
  | { readonly type: "ASKED"; readonly asked: AskedQuestion }
  | { readonly type: "NOTHING_ASKED" }
  | {
      readonly type: "RECORDED";
      readonly topics: readonly string[];
      readonly selections?: Readonly<Record<string, readonly string[]>>;
    }
  | {
      readonly type: "CLARIFICATION_NEEDED";
      readonly topic: string;
      readonly because: PendingClarification["because"];
    }
  | { readonly type: "CLARIFICATION_SETTLED" }
  | {
      readonly type: "QUESTION_RECEIVED";
      readonly kind: QuestionKind;
      readonly text: string;
    }
  | { readonly type: "QUESTION_ANSWERED" }
  | {
      readonly type: "PROPOSED";
      readonly suggestions: readonly InferenceSuggestion[];
    }
  | { readonly type: "PROPOSAL_DECIDED"; readonly target: string }
  | {
      readonly type: "RESEARCH_STARTED";
      readonly question: string;
      readonly resumeTopic: string | null;
    }
  | { readonly type: "RESEARCH_FINISHED" }
  | { readonly type: "INTERRUPTED"; readonly resumeTopic: string | null }
  | { readonly type: "RESUMED" }
  | { readonly type: "FAILED"; readonly operation: FailureOperation }
  | { readonly type: "SUCCEEDED"; readonly operation: FailureOperation }
  | {
      readonly type: "REPAIRED";
      readonly topic: string;
      readonly strategy: RepairStrategy;
    }
  | { readonly type: "PROGRESSED" }
  | { readonly type: "STALLED" };

export function reduceConversation(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  switch (event.type) {
    case "TURN_STARTED":
      return { ...state, turn: state.turn + 1 };
    case "TOPIC_CHANGED":
      return event.topic === state.topic
        ? state
        : { ...state, topic: event.topic, stalled: 0 };
    case "ASKED":
      return {
        ...state,
        asked: event.asked,
        topic: event.asked.topic,
        // A repair history belongs to the topic it was earned on.
        repair:
          state.repair !== null && state.repair.topic === event.asked.topic
            ? state.repair
            : null,
      };
    case "NOTHING_ASKED":
      return { ...state, asked: null };
    case "RECORDED": {
      const settled = new Set(event.topics);
      const selections = { ...state.selections, ...(event.selections ?? {}) };
      const keys = Object.keys(selections);
      const bounded =
        keys.length > MAX_SELECTIONS
          ? Object.fromEntries(
              keys
                .slice(keys.length - MAX_SELECTIONS)
                .map((k) => [k, selections[k] ?? []]),
            )
          : selections;
      return {
        ...state,
        selections: bounded,
        asked:
          state.asked !== null && settled.has(state.asked.topic)
            ? null
            : state.asked,
        clarification:
          state.clarification !== null && settled.has(state.clarification.topic)
            ? null
            : state.clarification,
        proposals: state.proposals.filter((p) => !settled.has(p.target)),
        repair:
          state.repair !== null && settled.has(state.repair.topic)
            ? null
            : state.repair,
        failures: clearFailure(clearFailure(state.failures, "PARSE"), "WRITE"),
        stalled: 0,
      };
    }
    case "CLARIFICATION_NEEDED":
      return {
        ...state,
        clarification: {
          topic: event.topic,
          because: event.because,
          attempts:
            state.clarification !== null &&
            state.clarification.topic === event.topic
              ? state.clarification.attempts + 1
              : 1,
        },
      };
    case "CLARIFICATION_SETTLED":
      return { ...state, clarification: null };
    case "QUESTION_RECEIVED":
      return {
        ...state,
        answering: { kind: event.kind, text: event.text.slice(0, 1_000) },
        // Where to come back to: the question Q had open, else the topic.
        resumeTopic: state.asked?.topic ?? state.topic,
      };
    case "QUESTION_ANSWERED":
      return { ...state, answering: null };
    case "PROPOSED": {
      const fresh = event.suggestions.map((s) => ({
        ...s,
        offeredAt: state.turn,
      }));
      const targets = new Set(fresh.map((s) => s.target));
      return {
        ...state,
        proposals: [
          ...state.proposals.filter((p) => !targets.has(p.target)),
          ...fresh,
        ].slice(-MAX_PROPOSALS),
      };
    }
    case "PROPOSAL_DECIDED":
      return {
        ...state,
        proposals: state.proposals.filter((p) => p.target !== event.target),
      };
    case "RESEARCH_STARTED":
      return {
        ...state,
        research: {
          question: event.question.slice(0, 1_000),
          resumeTopic: event.resumeTopic,
          startedAt: state.turn,
        },
        resumeTopic: event.resumeTopic ?? state.resumeTopic,
      };
    case "RESEARCH_FINISHED":
      return { ...state, research: null };
    case "INTERRUPTED":
      return { ...state, resumeTopic: event.resumeTopic ?? state.resumeTopic };
    case "RESUMED":
      return { ...state, resumeTopic: null, answering: null };
    case "FAILED":
      return {
        ...state,
        failures: noteFailure(state.failures, event.operation),
      };
    case "SUCCEEDED":
      return {
        ...state,
        failures: clearFailure(state.failures, event.operation),
      };
    case "REPAIRED":
      return {
        ...state,
        repair: recordRepair(state.repair, event.topic, event.strategy),
      };
    case "PROGRESSED":
      return { ...state, stalled: 0 };
    case "STALLED":
      return { ...state, stalled: state.stalled + 1 };
  }
}

export function reduceAll(
  state: ConversationState,
  events: readonly ConversationEvent[],
): ConversationState {
  return events.reduce(reduceConversation, state);
}

/**
 * What a turn's reading is allowed to do, decided before anything is
 * done (CQ-QX-005 §2, §4).
 *
 * The one rule the live sessions broke most: the person spoke, so the
 * state advanced. Here the reading's kind and confidence decide, and the
 * decision is a value the consumer can log beside the trace.
 */
export type TurnDisposition = {
  /** ANSWER or CORRECTION at HIGH confidence: values may be written. */
  readonly write: boolean;
  /** MEDIUM confidence: values are read back and held for a yes. */
  readonly confirm: boolean;
  /** LOW confidence or an unclear transcript: ask, in a targeted way. */
  readonly clarify: boolean;
  /** The words were noise: a transcription matter, not a reasoning one. */
  readonly transcription: boolean;
  /** A question for Q to answer in this turn, before resuming. */
  readonly answer: boolean;
  /** The turn was about something other than the job; nothing moves. */
  readonly aside: boolean;
};

export function disposeTurn(reading: ConversationTurnReading): TurnDisposition {
  const transcription =
    reading.kind === "UNCLEAR_TRANSCRIPT" || reading.transcript === "FRAGMENT";
  const writing = reading.kind === "ANSWER" || reading.kind === "CORRECTION";
  return {
    write: writing && reading.confidence === "HIGH" && !transcription,
    confirm: writing && reading.confidence === "MEDIUM" && !transcription,
    clarify:
      (writing && reading.confidence === "LOW") ||
      reading.kind === "CLARIFICATION",
    transcription,
    // A writing turn may carry their question beside it ("yes — and what
    // would you look for?"): it is answered in the same turn (v9, E1).
    answer:
      reading.kind === "QUESTION_TO_Q" ||
      reading.kind === "RESEARCH_REQUEST" ||
      reading.question !== null,
    aside: reading.kind === "OFF_TOPIC" || reading.kind === "SMALL_TALK",
  };
}

/** The topic Q returns to once an interruption is over. */
export function resumeTarget(state: ConversationState): string | null {
  return (
    state.research?.resumeTopic ??
    state.resumeTopic ??
    state.asked?.topic ??
    state.topic
  );
}
