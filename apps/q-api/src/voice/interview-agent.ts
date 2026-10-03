import { randomUUID } from "node:crypto";

import {
  appendOnboardingInterviewTurns,
  listOnboardingInterviewTurns,
} from "@capital-q/api-client";
import {
  CorrelationIdSchema,
  QRunIdSchema,
  type ModelMessage,
  type OnboardingSessionView,
} from "@capital-q/contracts";
import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";
import {
  acceptStructuredOutput,
  type ModelGateway,
} from "@capital-q/model-gateway";
import {
  NO_TURN_AUTHORITY,
  toolResultMessage,
  type QDelegationReader,
  type QTurnAuthority,
} from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  type InterviewAgentV11Variables,
  INITIAL_CONVERSATION_STATE,
  isExhausted,
  reduceConversation,
  type ConversationState,
  InterviewAgentV16ResultSchema,
  gesturesForReply,
  renderPrompt,
  type InterviewAgentV16Result,
  type InterviewAgentVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import {
  compactThread,
  createLoopMemoryReader,
  createPreferenceNotebook,
  quoteOccursIn,
  type MemoryService,
} from "@capital-q/q-knowledge";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  createNotePreferenceTool,
  createOnboardingTools,
  createQToolExecutor,
  createQToolRegistry,
  HOME_Q_CAPABILITY_GROUPS,
  type QCapabilityGroup,
} from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import {
  definitionFor,
  optionsOf,
  toOpenStep,
  type InterviewTurnInput,
  type InterviewTurnOutcome,
} from "./interview-steps.js";
import { conductNote, decideConduct, INITIAL_CONDUCT } from "./conduct.js";
import {
  AccountPausedError,
  openingsOf,
  PERSONALITY_NOTES,
  type StandingStore,
} from "./standing.js";
import {
  createOnboardingPort,
  type RecommendationStore,
} from "./onboarding-port.js";
import { createReplySentenceStream } from "./reply-stream.js";
import type { InvestorResearch } from "./investor-research.js";
import { createResearchPublicLinksTool } from "./investor-research-tool.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";
import { textStatedIn } from "./value-support.js";

/**
 * The onboarding interview as a tool-calling Q run (ADR 0016).
 *
 * One turn: the Context Firewall plans the run for this person; the
 * onboarding tools are offered under that plan, bound to their own
 * session; the model reads the whole state and the whole conversation and
 * acts through the tools, a bounded number of rounds; its reply is written
 * after the results, so it can claim only what they say happened. Code
 * chooses no question and composes no line — only transport failure copy.
 */

const MAX_ROUNDS = 4;
const MAX_CALLS = 8;

/**
 * A person is waiting (ACC 2026-09-25: one luna attempt ran 5.5 minutes
 * and the person got an HTTP 503). The whole turn ends by this deadline,
 * inside the voice route's own 20 s (live 2026-09-30: at 25 s the
 * route cut Q off first, "that was taking too long", and the answer was
 * lost); every model call in it is cut off by it.
 */
const TURN_DEADLINE_MS = 18_000;
/** Tool rounds stop while this much is left, so the reply can be written. */
const REPLY_RESERVE_MS = 7_000;
/** Below this, no reply call is started; the turn degrades honestly. */
const MIN_REPLY_MS = 2_000;
/**
 * The first model's patience when another waits behind it. The loop's own
 * luna calls measured p95 5.1 s; hosted rounds run about 2 s (2026-09-30),
 * so 6 s leaves room above them and still leaves time for the next model
 * to take the round inside the turn's deadline.
 */
const FIRST_ATTEMPT_MS = 6_000;

const BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.2,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: 12_000,
} as const;

const THIS_TURN_MAX = 12_000;

/** A tool result's content, as data: parsed JSON where it is JSON. */
function resultOf(message: ModelMessage): unknown {
  const content = message.content;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content.slice(0, 2_000);
  }
}

/** Step, basis and outcome of each write this turn, for the trace. */
function decisionsOf(
  actions: readonly { tool: string; input: unknown; result: unknown }[],
): readonly string[] {
  const out: string[] = [];
  for (const action of actions) {
    const items =
      typeof action.input === "object" && action.input !== null
        ? Object.values(action.input).find(Array.isArray)
        : undefined;
    const data =
      typeof action.result === "object" &&
      action.result !== null &&
      "data" in action.result
        ? action.result.data
        : undefined;
    const results =
      typeof data === "object" &&
      data !== null &&
      "results" in data &&
      Array.isArray(data.results)
        ? (data.results as unknown[])
        : [];
    for (const [index, result] of results.entries()) {
      const item: unknown = Array.isArray(items) ? items[index] : undefined;
      const field = (from: unknown, key: string): string =>
        typeof from === "object" &&
        from !== null &&
        key in from &&
        typeof (from as Record<string, unknown>)[key] === "string"
          ? String((from as Record<string, unknown>)[key]).slice(0, 80)
          : "-";
      const reason = field(result, "reason");
      out.push(
        `${action.tool}:${field(result, "stepKey")}:${field(item, "basis")}:${field(result, "outcome")}${reason === "-" ? "" : `:${reason}`}`,
      );
    }
  }
  return out.slice(0, 40);
}

/**
 * Steps a write was refused for this turn, other than an answer held for
 * the person's confirmation (which is progress, not a refusal).
 */
export function refusedStepsOf(
  actions: readonly { tool: string; input: unknown; result: unknown }[],
): readonly string[] {
  const refused = new Set<string>();
  for (const decision of decisionsOf(actions)) {
    const [tool, stepKey, , outcome, reason] = decision.split(":");
    if (
      tool !== "record_answers" ||
      stepKey === undefined ||
      stepKey === "-" ||
      (outcome !== "REJECTED" && outcome !== "UNMATCHED") ||
      reason?.startsWith("Held for") === true
    ) {
      continue;
    }
    refused.add(stepKey);
  }
  return [...refused];
}

/**
 * A step refused on this many turns is no longer put to the loop as
 * "given earlier, record it now" (live 2026-10-01: the same refused write
 * was retried on eight turns, a model round each).
 */
export const REFUSALS_BEFORE_LETTING_GO = 2;

/**
 * What Q has done this turn, for the next round's prompt. Oldest actions
 * give way first when it is long: the newest results decide what is left.
 */
export function thisTurnText(
  actions: readonly { tool: string; input: unknown; result: unknown }[],
): string {
  if (actions.length === 0) return "";
  for (let from = 0; from < actions.length; from += 1) {
    const text = JSON.stringify(actions.slice(from));
    if (text.length <= THIS_TURN_MAX) return text;
  }
  return JSON.stringify(actions.slice(-1)).slice(0, THIS_TURN_MAX);
}

export type InterviewAgentTurnInput = InterviewTurnInput & {
  /** The person, as the route resolved them. Required for a Q run. */
  readonly actor?: ActorContext | undefined;
  /**
   * Each complete sentence of the final reply, once, in order, as the
   * model writes it (P0-3): what a voice speaks before the turn ends.
   * The returned outcome still carries the whole reply.
   */
  readonly onSentence?: ((sentence: string) => void) | undefined;
};

export type InterviewAgentDependencies = {
  readonly gateway: ModelGateway;
  readonly firewall: ContextFirewallPort;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: "REAL_CUSTOMER" | "SYNTHETIC_DEMO" | undefined;
  /**
   * The person's memory (ADR 0012, P0-5): recall and communication profile
   * in, stated preferences out through the Write Gate. Absent: the default
   * profile, nothing recalled, no note_preference tool.
   */
  readonly memory?: Pick<MemoryService, "recall" | "remember"> | undefined;
  /**
   * Where Q's recommendations are kept: the onboarding service's
   * suggestions (P0-2). Absent: recommend is refused honestly.
   */
  readonly recommendations?: RecommendationStore | undefined;
  /**
   * Which choices the person handed to Q this turn, read independently
   * of the acting model. Absent: nothing is ever handed over, and Q
   * recommends instead of recording on anyone's behalf.
   */
  readonly delegation?: QDelegationReader | undefined;
  /**
   * Which consistency checks have been put to the person, per onboarding
   * session, so each is raised once. Default: kept in this process.
   */
  readonly raisedChecks?: RaisedChecks | undefined;
  /**
   * Whether a question needing a look-up can be handed to Q's research
   * (the caller runs it and reports back through researchEnded). Default:
   * available.
   */
  readonly researchAvailable?: boolean | undefined;
  /**
   * Research first (BIZ-009): reads an investor's own public sources as
   * soon as the firm is known and holds what it finds as recommendations
   * with their source. Absent: an investor is simply asked.
   */
  readonly investorResearch?: InvestorResearch | undefined;
  /**
   * The founder's company read while Q interviews them (founder direction
   * 2026-09-30), through the same engine. Absent: founders are just asked.
   */
  readonly founderResearch?: InvestorResearch | undefined;
  /**
   * Q's standing with the person across visits (founder direction
   * 2026-09-30): their chosen personality and Q's patience with small
   * talk. Absent: Auto, and small talk is never counted.
   */
  readonly standing?: StandingStore | undefined;
  /** Told when Q pauses an account, to let Capital Q's operators know. */
  readonly onPaused?:
    ((actor: ActorContext, strikes: number) => Promise<void>) | undefined;
  /** Milliseconds now; injectable so a test can run out the clock. */
  readonly now?: (() => number) | undefined;
  /** The whole turn's deadline; tests shorten it. */
  readonly turnDeadlineMs?: number | undefined;
};

export type RaisedChecks = {
  readonly get: (onboardingSessionId: string) => ReadonlySet<string>;
  readonly add: (onboardingSessionId: string, ids: readonly string[]) => void;
};

/**
 * Raised checks kept in this process (bounded). A restart forgets them and
 * a check may be put once more; the settlement itself is durable, on the
 * record (confirm_as_stated's note).
 */
export function createInMemoryRaisedChecks(maxSessions = 2_000): RaisedChecks {
  const bySession = new Map<string, Set<string>>();
  return {
    get: (id) => bySession.get(id) ?? new Set(),
    add: (id, ids) => {
      const set = bySession.get(id) ?? new Set<string>();
      for (const check of ids) set.add(check);
      bySession.delete(id);
      bySession.set(id, set);
      while (bySession.size > maxSessions) {
        const oldest = bySession.keys().next().value;
        if (oldest === undefined) break;
        bySession.delete(oldest);
      }
    },
  };
}

export type InterviewAgent = {
  readonly turn: (
    input: InterviewAgentTurnInput,
  ) => Promise<InterviewTurnOutcome>;
  /**
   * How a look-up this loop handed over ended (the caller ran it as a Q
   * run): a route that keeps failing stops being offered, and the next
   * look-up may start (CQ-QX-005's failure ledger).
   */
  readonly researchEnded: (onboardingSessionId: string, ok: boolean) => void;
};

/**
 * What Q does on Home that the loop does not, in a person's terms, from
 * the capability registry (R20). Groups with nothing to ask for (screens,
 * records, the loop itself) are left out.
 */
const ELSEWHERE_WORDS: Readonly<Partial<Record<QCapabilityGroup, string>>> = {
  PROFILE: "change their profile",
  HANDLE: "make their Q Card",
  DOCUMENT: "prepare documents such as a pitch deck or a brief, with a PDF",
  VISIBILITY: "change who can see their company",
  RELATIONSHIP: "express or answer interest",
  RESEARCH: "research public sources",
};

export const ELSEWHERE_NOTE = `Outside onboarding, Q on their Home page can also ${HOME_Q_CAPABILITY_GROUPS.flatMap(
  (group) => {
    const words = ELSEWHERE_WORDS[group];
    return words === undefined ? [] : [words];
  },
).join(
  "; ",
)}. If they ask for one of these now, say Q will do it on Home once they finish or pause here; never say it is done, and never say Capital Q cannot do it.`;

/**
 * The trusted notes on what else a turn asks, from the independent
 * reading and the research ledger. Code composes the facts; the loop says
 * them in its own words.
 */
/** Marks an optional step Q has asked twice in the asked-steps memory. */
const ASKED_AGAIN = "#again";

/** The prompt's bound on the turn notes (INTERVIEW_AGENT variables). */
const TURN_NOTES_MAX = 1_500;

/** What the journey still holds open, for the turn notes. */
export type JourneyOpenings = {
  readonly signupName: string | null;
  readonly signupNameIs: string;
  readonly signupStepKey: string;
  /** The name on their record now, said exactly whenever it is named. */
  readonly recordedName?: string | null | undefined;
  readonly unsaidFindings: readonly {
    readonly stepKey: string;
    readonly value: string;
    readonly because: string | null;
  }[];
  readonly unasked: readonly {
    readonly stepKey: string;
    readonly question: string;
  }[];
  /** Optional steps asked twice and still unanswered: not asked again. */
  readonly passedOver?: readonly string[] | undefined;
  /**
   * A required question asked on each of the last two replies and still
   * unanswered while they talk about something else: rested this turn,
   * asked again later (HANDOVER §5.1: "full-time" asked six times running).
   */
  readonly resting?: string | null | undefined;
  /**
   * Answers their earlier words gave (as read when said) that are not on
   * the record yet, with those words: recorded from them, never asked
   * again (live 2026-09-30: "$5 million on a post-money SAFE" from an
   * opening monologue was asked for again as "How much are you raising?").
   */
  readonly givenEarlier?:
    readonly { readonly stepKey: string; readonly words: string }[] | undefined;
};

export function turnNotesFor(input: {
  readonly pausing: boolean;
  /** Research first (BIZ-009): what to say about it this turn, once. */
  readonly research?: "STARTED" | "NOTHING_FOUND" | null | undefined;
  readonly lookup:
    | { readonly kind: "RUN"; readonly question: string }
    | { readonly kind: "RUNNING" }
    | { readonly kind: "UNAVAILABLE" }
    | null;
  readonly pronounce: { readonly term: string; readonly sayAs: string } | null;
  /**
   * What the journey still holds open, composed by code from the record
   * (founder live test 2026-09-30: Q asked the company name typed at
   * sign-up, never said what research found, and went to the review with
   * the website, description and pitch deck never asked).
   */
  readonly open?: JourneyOpenings | undefined;
}): string {
  const notes: string[] = [];
  if (input.pausing) {
    notes.push(
      "They want to pause and come back later: acknowledge it in one short sentence, say their answers are kept, and ask nothing.",
    );
  }
  switch (input.lookup?.kind) {
    case "RUN":
      notes.push(
        `A look-up will run right after your reply for their question: "${input.lookup.question.slice(0, 300)}". Say in a few words you will look it up; don't answer it or ask anything now. If they were only chatting (no real question), set chatter PERSON, acknowledge it warmly and carry on: then nothing is looked up.`,
      );
      break;
    case "RUNNING":
      notes.push(
        "They asked something that needs looking up, and the last look-up is still running: say you will bring it back when it lands, then carry on.",
      );
      break;
    case "UNAVAILABLE":
      notes.push(
        "They asked something that needs looking up, and looking things up is not available right now: say so in one short sentence, then carry on.",
      );
      break;
    case undefined:
      break;
  }
  if (input.research === "STARTED") {
    notes.push(
      "Research is starting on them and their firm from public sources (their website, public filings, links they gave). Never narrate the look-up (R38): at most, once, in a few words, say you will bring back what you find for them to confirm, then carry on asking.",
    );
  } else if (input.research === "NOTHING_FOUND") {
    notes.push(
      "The public research found nothing useful about their firm: say so in a few words and carry on asking normally.",
    );
  }
  if (input.pronounce !== null) {
    notes.push(
      `They corrected how to say "${input.pronounce.term.slice(0, 80)}": say it as "${input.pronounce.sayAs.slice(0, 120)}" from now on, and acknowledge it in a few words.`,
    );
  }
  // What the journey still holds open comes after what this turn itself
  // asks, and the notes are fitted to the prompt's budget in that order.
  const open = input.open;
  if (open !== undefined) {
    if (open.signupName !== null) {
      notes.push(
        `Their ${open.signupNameIs}, "${open.signupName.slice(0, 80)}", comes from their sign-up and goes on their record (${open.signupStepKey}) as soon as it can: say it back once in passing so they can correct it; never ask for it. If they correct it, record their correction.`,
      );
    }
    if (open.givenEarlier !== undefined && open.givenEarlier.length > 0) {
      notes.push(
        `They already answered these earlier in this conversation and they are not on the record yet: record each now from those words (quote them); never ask them again: ${open.givenEarlier
          .map((g) => `${g.stepKey} ("${g.words.slice(0, 120)}")`)
          .join("; ")}`,
      );
    }
    if (open.unsaidFindings.length > 0) {
      notes.push(
        `Research found, not yet said to them; say it now in one short line with its source and ask if right: ${open.unsaidFindings
          .map(
            (f) =>
              `${f.stepKey} = ${f.value.slice(0, 120)}${f.because === null ? "" : ` (${f.because.slice(0, 60)})`}`,
          )
          .join("; ")}`,
      );
    }
  }
  notes.push(
    "Off-topic remark: acknowledge it in a few words, then go on; never repeat your last question word for word.",
  );
  if (open?.recordedName !== undefined && open.recordedName !== null) {
    notes.push(
      `Their ${open.signupNameIs} on record is "${open.recordedName.slice(0, 120)}": whenever you name it, say it exactly so, including anything in brackets.`,
    );
  }
  notes.push(
    'An optional question they have not answered after you asked it twice is passed over: move on, never press it. Something you could not record is mentioned once, never again in later replies. Record a number as the number they said, in any words; never ask them to repeat anything in particular words or another form. When their answer fits none of a step\'s choices (a country not listed, "Founder" for a role), record their own words for it with ownWords true; they are kept, never forced into a near choice. Ask only when their words are unclear.',
  );
  if (open?.passedOver !== undefined && open.passedOver.length > 0) {
    notes.push(
      `Passed over, never ask again in this conversation: ${open.passedOver.join(", ")}`,
    );
  }
  if (open?.resting !== undefined && open.resting !== null) {
    notes.push(
      `You asked ${open.resting} on each of your last two replies and they are talking about something else: this turn, answer what they are saying and do not ask ${open.resting}; ask another open question or none. It comes back on a later turn.`,
    );
  }
  if (open !== undefined && open.unasked.length > 0) {
    notes.push(
      `Still unasked, ask each once before the final review, one at a time; one they pass over is never asked again: ${open.unasked.map((u) => u.stepKey).join(", ")}`,
    );
  }
  // Every turn: the registry's view of what Q does beyond this loop.
  notes.push(ELSEWHERE_NOTE);
  // Fitted to the prompt's budget in order: a note that does not fit is
  // left out whole rather than cut mid-sentence, the first one excepted.
  let fitted = "";
  for (const note of notes) {
    const next = fitted.length === 0 ? note : `${fitted}\n${note}`;
    if (next.length <= TURN_NOTES_MAX) fitted = next;
    else if (fitted.length === 0) fitted = note.slice(0, TURN_NOTES_MAX);
  }
  return fitted;
}

/** The firm the investor named, or the one they typed at sign-up. */
/** A text answer on the record, or "" when there is none. */
export function textAnswerOf(
  view: OnboardingSessionView | null,
  stepKey: string,
): string {
  const value: unknown = view?.responses.find(
    (r) => r.stepKey === stepKey,
  )?.value;
  return typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
    ? value.text.trim().slice(0, 200)
    : "";
}

export function firmNameOf(
  view: OnboardingSessionView | null,
  signupOrganisation: string | null,
): string {
  const value: unknown = view?.responses.find(
    (r) => r.stepKey === INVESTOR_STEPS.organisationName,
  )?.value;
  const text =
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
      ? value.text.trim()
      : "";
  return (text || signupOrganisation?.trim() || "").slice(0, 160);
}

export function createInterviewAgent(
  dependencies: InterviewAgentDependencies,
): InterviewAgent {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, firewall, logger } = dependencies;
  const now = dependencies.now ?? Date.now;
  const deadlineMs = dependencies.turnDeadlineMs ?? TURN_DEADLINE_MS;
  const raisedChecks =
    dependencies.raisedChecks ?? createInMemoryRaisedChecks();
  // Optional questions already put to each person: asked once, never
  // pressed again (live 2026-09-30: the website was asked every turn).
  const askedOptional = createInMemoryRaisedChecks();
  // The step each session's last reply asked, for the independent reading
  // of the answer to it (DELEGATION_READER v4).
  const lastAsked = new Map<string, string>();
  // The steps each session's last replies asked, newest last ("" for a
  // reply that asked nothing), to rest a question pressed twice running.
  const recentAsks = new Map<string, string[]>();
  const rememberAsk = (sessionId: string, asking: string | null) => {
    const list = recentAsks.get(sessionId) ?? [];
    list.push(asking ?? "");
    recentAsks.delete(sessionId);
    recentAsks.set(sessionId, list.slice(-2));
    while (recentAsks.size > 2_000) {
      const oldest = recentAsks.keys().next().value;
      if (oldest === undefined) break;
      recentAsks.delete(oldest);
    }
  };
  // What each earlier utterance stated, as the independent reading found
  // it when it was said: a monologue's answers stay theirs on later turns
  // (live 2026-09-30). Bounded per session and across sessions.
  const statedBySession = new Map<
    string,
    { readonly text: string; readonly stated: readonly string[] }[]
  >();
  const rememberStated = (
    sessionId: string,
    text: string,
    stated: ReadonlySet<string>,
  ) => {
    if (text.length === 0 || stated.size === 0) return;
    const list = statedBySession.get(sessionId) ?? [];
    list.push({ text: text.slice(0, 4_000), stated: [...stated] });
    statedBySession.delete(sessionId);
    statedBySession.set(sessionId, list.slice(-30));
    while (statedBySession.size > 2_000) {
      const oldest = statedBySession.keys().next().value;
      if (oldest === undefined) break;
      statedBySession.delete(oldest);
    }
  };
  // Steps each session's writes were refused for, counted by turn.
  const refusedBySession = new Map<string, Map<string, number>>();
  const rememberRefused = (sessionId: string, stepKeys: readonly string[]) => {
    if (stepKeys.length === 0) return;
    const counts = refusedBySession.get(sessionId) ?? new Map<string, number>();
    for (const stepKey of stepKeys) {
      counts.set(stepKey, (counts.get(stepKey) ?? 0) + 1);
    }
    refusedBySession.delete(sessionId);
    refusedBySession.set(sessionId, counts);
    while (refusedBySession.size > 2_000) {
      const oldest = refusedBySession.keys().next().value;
      if (oldest === undefined) break;
      refusedBySession.delete(oldest);
    }
  };
  const researchAvailable = dependencies.researchAvailable ?? true;
  /** The conversation core's state per session: the research ledger. */
  const conversations = new Map<string, ConversationState>();
  const conversationOf = (id: string) =>
    conversations.get(id) ?? INITIAL_CONVERSATION_STATE;
  const remember = (id: string, state: ConversationState) => {
    conversations.delete(id);
    conversations.set(id, state);
    while (conversations.size > 2_000) {
      const oldest = conversations.keys().next().value;
      if (oldest === undefined) break;
      conversations.delete(oldest);
    }
  };

  const turn = async (
    input: InterviewAgentTurnInput,
  ): Promise<InterviewTurnOutcome> => {
    const actor = input.actor;
    if (actor === undefined) {
      throw new Error("an interview Q run needs the person's actor context");
    }
    // The person is waiting from the moment they spoke: the deadline
    // counts the reading, the state and the tools, not only the model.
    const startedAt = now();
    const utterance = input.utterance.trim();
    const opening = utterance.length === 0;
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.safeParse(
      input.attribution.correlationId,
    ).success
      ? CorrelationIdSchema.parse(input.attribution.correlationId)
      : CorrelationIdSchema.parse(`cor_${randomUUID()}`);

    // The whole conversation, from the kept thread; the browser's recent
    // turns only when the thread cannot be read.
    const kept = await listOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
    ).catch((error: unknown) => {
      logger.warn({ err: error }, "interview thread not read for the Q run");
      return null;
    });
    const thread =
      kept === null
        ? input.recentTurns.map((t) => ({
            role: t.role === "person" ? ("PERSON" as const) : ("Q" as const),
            text: t.text.slice(0, 2_000),
          }))
        : kept.items.map((t) => ({
            role: t.role === "PERSON" ? ("PERSON" as const) : ("Q" as const),
            text: t.text.slice(0, 2_000),
          }));
    const lastQTurn = thread.findLast((t) => t.role === "Q")?.text;
    const standing =
      dependencies.standing === undefined
        ? null
        : await dependencies.standing
            .read(actor.userId, actor.tenantId, new Date(now()))
            .catch((error: unknown) => {
              logger.warn({ err: error }, "Q's standing was not read");
              return null;
            });
    const personality = standing?.personality ?? "AUTO";
    const conductBefore = standing?.conduct ?? INITIAL_CONDUCT;
    // A paused account talks to nobody until a person at Capital Q has
    // looked at it: refused here, before any model is called.
    if (conductBefore.suspended) throw new AccountPausedError();
    // What Q is told before it reads the turn: what to do if this turn is
    // small talk. Code decides again from Q's reading afterwards.
    const ifChatter = decideConduct(conductBefore, "PERSON");
    const conductText =
      standing === null || opening
        ? ""
        : `If their latest words are small talk rather than the setup: ${
            conductNote(ifChatter) ||
            "that is fine; enjoy it briefly and warmly."
          } If they are not, carry on with the setup.${
            conductBefore.strikes >= 3
              ? " You are short on patience with this person today."
              : ""
          }`;
    const journeySteps = definitionFor(input.journeyType).steps;
    // Read once the plan authorises the run; nothing handed over until then.
    let delegationRead: Promise<QTurnAuthority | null> =
      Promise.resolve(NO_TURN_AUTHORITY);
    const port = createOnboardingPort({
      statedEarlier: (stepKey, quote) =>
        (statedBySession.get(input.onboardingSessionId) ?? []).some(
          (earlier) =>
            earlier.stated.includes(stepKey) &&
            quoteOccursIn(quote, earlier.text),
        ),
      session: input.session,
      onboardingSessionId: input.onboardingSessionId,
      journeyType: input.journeyType,
      ownerUserId: actor.userId,
      // Only the person's own words can carry a write (P0-2): what they
      // just said, then what they said earlier in this conversation.
      personTurns: [
        ...(utterance.length === 0 ? [] : [utterance]),
        ...thread
          .filter((t) => t.role === "PERSON")
          .map((t) => t.text)
          .reverse(),
      ],
      lastQTurn,
      authority:
        dependencies.delegation === undefined
          ? undefined
          : () => delegationRead,
      recommendations: dependencies.recommendations,
      raisedChecks: raisedChecks.get(input.onboardingSessionId),
      runId,
      // Found by research between turns and not said yet: not approvable.
      unheardSteps: (input.journeyType === "investor"
        ? dependencies.investorResearch
        : dependencies.founderResearch
      )?.unsaid(input.onboardingSessionId),
    });
    // The newest turns verbatim, the older ones as a bounded summary
    // (P0-5): the whole conversation, within a fixed budget.
    const compacted = compactThread(thread);
    const conversation: InterviewAgentVariables["conversation"] = [
      ...compacted.recent,
    ];

    const decision = await firewall.plan({
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      subjects: [],
    });
    if (decision.outcome !== "AUTHORISED") {
      throw new Error(
        "the Context Firewall did not authorise this interview run",
      );
    }
    const reader = dependencies.delegation;
    if (!opening && reader !== undefined) {
      const pending = await port.pendingRecommendations().catch(() => []);
      delegationRead = reader.read({
        utterance,
        lastQ: lastQTurn ?? "",
        askedStep: lastAsked.get(input.onboardingSessionId) ?? null,
        steps: journeySteps.map((step) => ({
          stepKey: step.stepKey,
          question: SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt,
          about: step.configuration.supportingText ?? "",
          required: step.required,
        })),
        pending: pending.map((item) => ({
          stepKey: item.stepKey,
          recommended: item.value,
        })),
        attribution: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          qRunId: runId,
          correlationId,
        },
        signal: input.signal,
      });
    }
    const memory = dependencies.memory;
    const loop =
      memory === undefined
        ? { memory: "", profile: DEFAULT_COMMUNICATION_PROFILE }
        : await createLoopMemoryReader({ memory }).read({
            actor,
            plan: decision.plan,
            sessionKey: input.onboardingSessionId,
          });
    // A stated preference is kept through the Write Gate, quote-checked
    // against the person's own words in this conversation.
    const noteTool =
      memory === undefined
        ? []
        : [
            createNotePreferenceTool(
              createPreferenceNotebook({
                memory,
                actor,
                sessionKey: input.onboardingSessionId,
                priorUserTurns: thread
                  .filter((t) => t.role === "PERSON")
                  .map((t) => t.text),
              }),
            ),
          ];
    // Research first (BIZ-009): as soon as the firm is known, Q reads its
    // public sources. Detached: nothing here waits for the web.
    const research =
      input.journeyType === "investor"
        ? dependencies.investorResearch
        : dependencies.founderResearch;
    const considerResearch = (
      view: OnboardingSessionView | null,
      links?: {
        readonly websiteUrl: string | null;
        readonly profileUrls: readonly string[];
      },
    ): boolean =>
      research?.consider({
        actor,
        session: input.session,
        onboardingSessionId: input.onboardingSessionId,
        identity: {
          firmName:
            input.journeyType === "investor"
              ? firmNameOf(view, input.signup?.organisationName ?? null)
              : // Research starts on the name typed at sign-up, so it is
                // back before the company is even discussed.
                textAnswerOf(view, FOUNDER_STEPS.companyName) ||
                (input.signup?.organisationName?.trim() ?? "").slice(0, 160),
          websiteUrl:
            links?.websiteUrl ??
            (input.journeyType === "investor"
              ? null
              : textAnswerOf(view, FOUNDER_STEPS.website) || null),
          profileUrls: links?.profileUrls ?? [],
          personName: input.signup?.displayName ?? null,
        },
      }) ?? false;
    const linksTool =
      research === undefined
        ? []
        : [
            createResearchPublicLinksTool({
              ownerUserId: actor.userId,
              personTurns: [
                ...(utterance.length === 0 ? [] : [utterance]),
                ...thread.filter((t) => t.role === "PERSON").map((t) => t.text),
              ],
              research: (links) => considerResearch(port.view(), links),
            }),
          ];
    const tools = createQToolExecutor({
      // Nothing said, nothing to write: an opening offers only reads, so
      // no answer can be recorded that the person did not give.
      registry: createQToolRegistry(
        [...createOnboardingTools(port), ...noteTool, ...linksTool].filter(
          (tool) => !opening || tool.classification === "READ_ONLY",
        ),
      ),
      logger,
    });
    const context = {
      actor,
      runId,
      correlationId,
      capability: "ANSWER" as const,
      plan: decision.plan,
      signal: input.signal,
      conversation: { latestUserText: utterance },
    };
    const offered = await tools.offer(context);
    // What they typed at sign-up is their own answer (founder direction
    // 2026-09-30: prefill, then confirm): the company or firm name goes on
    // the record at once, so nothing that depends on it waits, and Q says
    // it back for them to correct rather than asking it.
    const signupOrganisation = input.signup?.organisationName?.trim() ?? "";
    // Again after each tool round: an investor's firm can be recorded only
    // once their investor type is (bench 2026-09-30: Q asked a partner for
    // the firm they had typed at sign-up).
    const prefillFromSignup = async (): Promise<void> => {
      if (signupOrganisation.length === 0) return;
      await port
        .recordFromSignup(
          input.journeyType === "investor"
            ? INVESTOR_STEPS.organisationName
            : FOUNDER_STEPS.companyName,
          signupOrganisation.slice(0, 160),
        )
        .catch(() => false);
    };
    await prefillFromSignup();
    let state = await port.state();
    if (research !== undefined) {
      considerResearch(port.view());
      // What research found and can now be offered is held before the
      // model reads the state, so this very turn can say it.
      if ((await research.offerReady(input.onboardingSessionId, port)) > 0) {
        state = await port.state();
      }
    }
    const researchNote = research?.takeNote(input.onboardingSessionId) ?? null;
    // What this turn's reply will say for the first time.
    const unsaidShown =
      research?.unsaid(input.onboardingSessionId) ?? new Set<string>();
    // What the journey still holds open, from the record: what sign-up
    // gave, findings not yet put to them, questions never asked.
    const askedBefore = askedOptional.get(input.onboardingSessionId);
    const refusedCounts =
      refusedBySession.get(input.onboardingSessionId) ??
      new Map<string, number>();
    const uploadOnly = new Set(
      journeySteps
        .filter((step) => step.configuration.stepType === "document_upload")
        .map((step) => step.stepKey),
    );
    const journeyOpenings = async (): Promise<JourneyOpenings> => {
      const view = port.view();
      const answered = new Set(view?.responses.map((r) => r.stepKey) ?? []);
      const setAside = new Set(
        view?.progress.eligibleSteps
          .filter((e) => e.status === "SKIPPED")
          .map((e) => e.stepKey) ?? [],
      );
      const pending = await port.pendingRecommendations().catch(() => []);
      const pendingSteps = new Set(pending.map((p) => p.stepKey));
      const qSaid = thread
        .filter((t) => t.role === "Q")
        .map((t) => t.text)
        .join(" ");
      // Whether Q's own earlier words carried it: the value itself, or
      // most of its distinctive words when Q put it in its own.
      const saidByQ = (value: string): boolean => {
        if (textStatedIn(value, qSaid)) return true;
        const words = value
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length > 3);
        if (words.length === 0) return false;
        const heard = words.filter((w) => textStatedIn(w, qSaid)).length;
        return heard / words.length >= 0.5;
      };
      const signupStepKey =
        input.journeyType === "investor"
          ? INVESTOR_STEPS.organisationName
          : FOUNDER_STEPS.companyName;
      const signupName = input.signup?.organisationName?.trim() ?? "";
      return {
        // On the record from sign-up and not yet said back to them.
        signupName:
          signupName.length > 0 && !textStatedIn(signupName, qSaid)
            ? signupName
            : null,
        recordedName: (() => {
          const named = textAnswerOf(view, signupStepKey).trim();
          return named.length > 0 ? named : null;
        })(),
        signupNameIs:
          input.journeyType === "investor" ? "firm's name" : "company's name",
        signupStepKey,
        unsaidFindings: pending
          .filter((p) => p.rationale !== null && !saidByQ(p.value))
          .slice(0, 6)
          .map((p) => ({
            stepKey: p.stepKey,
            value: p.value.slice(0, 200),
            because: p.rationale === null ? null : p.rationale.slice(0, 120),
          })),
        givenEarlier: (() => {
          const seen = new Set<string>();
          const given: { stepKey: string; words: string }[] = [];
          for (const earlier of statedBySession.get(
            input.onboardingSessionId,
          ) ?? []) {
            if (earlier.text === utterance) continue;
            for (const stepKey of earlier.stated) {
              if (
                seen.has(stepKey) ||
                answered.has(stepKey) ||
                setAside.has(stepKey) ||
                // Words never fill an upload; what they have is noted.
                uploadOnly.has(stepKey) ||
                (refusedCounts.get(stepKey) ?? 0) >= REFUSALS_BEFORE_LETTING_GO
              ) {
                continue;
              }
              seen.add(stepKey);
              given.push({ stepKey, words: earlier.text.slice(0, 160) });
            }
          }
          return given.slice(0, 6);
        })(),
        resting: (() => {
          const [before, last] =
            recentAsks.get(input.onboardingSessionId) ?? [];
          if (last === undefined || last === "" || before !== last) {
            return null;
          }
          const step = journeySteps.find((s) => s.stepKey === last);
          return step !== undefined && step.required && !answered.has(last)
            ? last
            : null;
        })(),
        passedOver: journeySteps
          .filter(
            (step) =>
              !step.required &&
              !answered.has(step.stepKey) &&
              askedBefore.has(`${step.stepKey}${ASKED_AGAIN}`),
          )
          .map((step) => step.stepKey),
        unasked: journeySteps
          .filter(
            (step) =>
              !step.required &&
              step.configuration.stepType !== "confirmation" &&
              !answered.has(step.stepKey) &&
              !setAside.has(step.stepKey) &&
              !pendingSteps.has(step.stepKey) &&
              !askedBefore.has(step.stepKey) &&
              (view?.progress.eligibleSteps.some(
                (e) => e.stepKey === step.stepKey,
              ) ??
                false),
          )
          .slice(0, 12)
          .map((step) => ({
            stepKey: step.stepKey,
            question: (
              SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
            ).slice(0, 160),
          })),
      };
    };
    const open = await journeyOpenings();
    const ledger = conversationOf(input.onboardingSessionId);
    // Everything the turn takes from the independent reading of their
    // words, once that reading is in.
    const readingOf = (authority: QTurnAuthority) => {
      const listed = (keys: ReadonlySet<string>): string =>
        keys.size === 0
          ? "none"
          : JSON.stringify(
              journeySteps
                .filter((step) => keys.has(step.stepKey))
                .map((step) => ({
                  stepKey: step.stepKey,
                  question: (
                    SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
                  ).slice(0, 300),
                })),
            ).slice(0, 2_000);
      const delegated = listed(authority.handed);
      const approved = listed(authority.approved);
      const declined = listed(authority.declined);

      // What else the turn asks, from the independent reading. A look-up
      // question goes on in the person's own words, never a model's; the
      // research ledger decides whether it may run.
      const lookupWords =
        authority.lookup === null
          ? null
          : textStatedIn(authority.lookup, utterance)
            ? authority.lookup
            : utterance.slice(0, 400);
      const lookup =
        lookupWords === null || opening
          ? null
          : !researchAvailable || isExhausted(ledger.failures, "RESEARCH")
            ? ({ kind: "UNAVAILABLE" } as const)
            : ledger.research !== null
              ? ({ kind: "RUNNING" } as const)
              : ({ kind: "RUN", question: lookupWords } as const);
      // A corrected pronunciation must come from what they said; the term
      // may be one Q just said.
      const pronounce =
        authority.pronounce !== null &&
        textStatedIn(authority.pronounce.sayAs, utterance) &&
        (textStatedIn(authority.pronounce.term, utterance) ||
          textStatedIn(authority.pronounce.term, lastQTurn ?? ""))
          ? authority.pronounce
          : null;
      const pausing = authority.pausing && !opening;
      const turnNotes = turnNotesFor({
        pausing,
        lookup,
        pronounce,
        research: researchNote,
        open,
      });
      return {
        authority,
        delegated,
        approved,
        declined,
        lookup,
        pronounce,
        pausing,
        turnNotes,
      };
    };
    // The reading runs alongside Q's first round rather than before it
    // (live 2026-09-30: 1.5-5 s of every turn was spent waiting on it).
    // Until it is in, the round is told so; every write still waits for it
    // in the port, and a reply is held until it is known the reading asks
    // nothing different of the turn.
    let reading: ReturnType<typeof readingOf> | null = null;
    const readingDone = delegationRead.then((authority) => {
      reading = readingOf(authority ?? NO_TURN_AUTHORITY);
      rememberStated(
        input.onboardingSessionId,
        utterance,
        reading.authority.stated,
      );
      return reading;
    });
    const NOT_READ_YET =
      "not read yet this round: record only what they state; accept, delegate or finish nothing until it is listed";
    const provisional = {
      ...readingOf(NO_TURN_AUTHORITY),
      delegated: NOT_READ_YET,
      approved: NOT_READ_YET,
      declined: NOT_READ_YET,
    };
    const current = () => reading ?? provisional;
    // A reading already in (a fast reader, an opening) is used from the
    // first round: one tick lets its settlement land.
    await Promise.race([
      readingDone,
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      }),
    ]);

    // Every round is rendered afresh from the onboarding state and what Q
    // has already done this turn, never from a provider's native tool
    // history: a fallback model cannot continue another provider's
    // function-call history (Gemini refuses one it did not sign), and a
    // turn must survive its first model failing half way.
    const actions: { tool: string; input: unknown; result: unknown }[] = [];
    const render = () =>
      renderPrompt<InterviewAgentV11Variables>(registry, {
        task: "INTERVIEW_AGENT",
        charter: input.channel === "voice" ? "Q_SYSTEM_VOICE" : "Q_SYSTEM",
        operatingMode: "ASSESSMENT",
        communicationProfile: loop.profile,
        // Capital Q's authority statement for this loop (lead decision,
        // 2026-09-25): a reversible write to the person's own onboarding, at
        // their explicit delegation, is scoped delegation, not an action on
        // Q's own account. Trusted text in the charter's frame.
        environmentNotes:
          "You change the person's onboarding only through your tools; a tool result is what happened. Capital Q grants scoped delegation here: when the person explicitly hands you a choice about their own onboarding and asks you to go ahead, recording your choice is acting on their instruction, reversible and theirs to change, and is permitted without a further approval step.",
        variables: {
          journey: input.journeyType,
          channel: input.channel,
          opening,
          state: JSON.stringify(state).slice(0, 24_000),
          conversation,
          utterance,
          memory: loop.memory.slice(0, 4_000),
          earlier: (compacted.summary ?? "").slice(0, 2_200),
          thisTurn: thisTurnText(actions),
          delegated: current().delegated,
          approved: current().approved,
          declined: current().declined,
          turnNotes: current().turnNotes,
          personality: PERSONALITY_NOTES[personality],
          conduct: conductText.slice(0, 600),
          openings: openingsOf(thread).slice(0, 600),
        },
      });

    const base = {
      taskClass: "NORMAL_DIALOGUE" as const,
      sensitivity: decision.plan.maxSensitivity,
      budget: BUDGET,
      attribution: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        qRunId: runId,
        correlationId,
      },
      ...(dependencies.dataPosture === undefined
        ? {}
        : { dataPosture: dependencies.dataPosture }),
    };

    // A person is waiting: the whole turn has a deadline, and every model
    // call inside it is cut off by it. Only the person leaving (the
    // caller's own signal) is a cancellation; the deadline is a degraded
    // turn, answered honestly.
    const remaining = () => deadlineMs - (now() - startedAt);
    const deadline = new AbortController();
    const timer = setTimeout(
      () => {
        deadline.abort();
      },
      Math.max(0, remaining()),
    );
    const signal =
      input.signal === undefined
        ? deadline.signal
        : AbortSignal.any([input.signal, deadline.signal]);

    const stream =
      input.onSentence === undefined
        ? undefined
        : createReplySentenceStream(input.onSentence);
    let result: InterviewAgentV16Result | undefined;
    let rounds = 0;
    let calls = 0;
    let timedOut = false;
    /**
     * What the person approved, recorded by code (founder 2026-10-02:
     * "on any kind of confirmation, record the answers at once or one by
     * one, as the user tells Q"). The reading decides, by meaning, which
     * of the findings Q put to them they approved -- all of them for "yes,
     * all of that is right", exactly the first two for "the first two are
     * right, change the third". Code then accepts exactly those pending,
     * heard recommendations, through the same guarded port the model's
     * accept_recommendation uses, instead of hoping the model calls it.
     * Once per turn; whatever the model records besides stands.
     */
    let approvalsRecorded = false;
    const recordApproved = async (approved: ReadonlySet<string>) => {
      if (approvalsRecorded || approved.size === 0) return;
      approvalsRecorded = true;
      const pendingNow = new Set(
        (await port.pendingRecommendations().catch(() => [])).map(
          (item) => item.stepKey,
        ),
      );
      const stepKeys = [...approved].filter((key) => pendingNow.has(key));
      if (stepKeys.length === 0) return;
      const results = await port.accept(stepKeys).catch(() => []);
      actions.push({
        tool: "accept_recommendation",
        input: { stepKeys },
        result: { results },
      });
      logger.info(
        {
          approved: stepKeys,
          committed: results
            .filter((r) => r.outcome === "COMMITTED")
            .map((r) => r.stepKey),
        },
        "approved findings recorded by code",
      );
    };
    try {
      while (
        result === undefined &&
        rounds < MAX_ROUNDS &&
        calls < MAX_CALLS &&
        remaining() > REPLY_RESERVE_MS
      ) {
        rounds += 1;
        const unread = reading === null;
        if (reading !== null) {
          await recordApproved(
            (reading as ReturnType<typeof readingOf>).authority.approved,
          );
          state = await port.state();
        }
        const response = await gateway.execute(
          {
            ...base,
            messages: [...render().messages],
            output: { kind: "TEXT" },
            tools: offered.map((tool) => tool.definition),
          },
          {
            firstAttemptTimeoutMs: FIRST_ATTEMPT_MS,
            signal,
            // A reply written before the reading is in is held, not said.
            ...(stream === undefined || unread
              ? {}
              : { onTextDelta: stream.push }),
          },
        );
        if (response.output.kind === "TEXT") {
          const written = response.output.text;
          if (unread) {
            const settled = await readingDone;
            // The reading asks something of this turn the reply could not
            // know: write it again with the reading in hand.
            if (
              settled.pausing ||
              settled.lookup !== null ||
              settled.pronounce !== null ||
              settled.authority.handed.size > 0 ||
              settled.authority.approved.size > 0 ||
              settled.authority.finishing
            ) {
              continue;
            }
            stream?.push(written);
          }
          const accepted = acceptStructuredOutput(
            written,
            InterviewAgentV16ResultSchema,
          );
          if (accepted.ok) result = accepted.value;
          break;
        }
        if (response.output.kind !== "TOOL_CALLS") break;
        const proposals = response.output.calls.slice(0, MAX_CALLS - calls);
        for (const call of proposals) {
          calls += 1;
          const outcome = await tools.execute(
            { callId: call.callId, name: call.name, arguments: call.arguments },
            context,
          );
          actions.push({
            tool: call.name,
            input: call.arguments,
            result: resultOf(toolResultMessage(call, outcome)),
          });
        }
        await prefillFromSignup();
        state = await port.state();
      }
      if (result === undefined && remaining() > MIN_REPLY_MS) {
        // The reply, written after every result so far, with no tools left.
        const rendered = render();
        const response = await gateway.execute<InterviewAgentV16Result>(
          {
            ...base,
            messages: [...rendered.messages],
            output: rendered.output,
          },
          {
            schema: InterviewAgentV16ResultSchema,
            firstAttemptTimeoutMs: FIRST_ATTEMPT_MS,
            signal,
          },
        );
        if (response.output.kind === "STRUCTURED") {
          result = (
            response.output as { readonly value: InterviewAgentV16Result }
          ).value;
        }
      }
    } catch (error: unknown) {
      if (input.signal?.aborted === true) throw error;
      timedOut = deadline.signal.aborted;
      logger.warn(
        { err: error, rounds, calls, timedOut },
        "interview Q run failed",
      );
    } finally {
      clearTimeout(timer);
    }

    const { authority, lookup, pronounce, pausing } =
      reading ?? (await readingDone);
    // A reading that came in after the last round still records what they
    // approved: the approval is theirs whether or not a round saw it.
    await recordApproved(authority.approved);
    const view = port.view() ?? (await port.state(), port.view());
    if (view === null) {
      throw new Error("the onboarding session could not be read");
    }
    if (stream !== undefined && result !== undefined) {
      const { diverged } = stream.finish(result.reply);
      if (diverged) {
        logger.warn(
          { rounds },
          "the streamed reply and the settled reply differ; the rest was not streamed",
        );
      }
    }
    if (result !== undefined) {
      rememberAsk(input.onboardingSessionId, result.asking);
    }
    // A reply that asks nothing leaves no step for the next answer.
    if (result !== undefined && result.asking === null) {
      lastAsked.delete(input.onboardingSessionId);
    }
    if (result?.asking !== undefined && result.asking !== null) {
      lastAsked.delete(input.onboardingSessionId);
      lastAsked.set(input.onboardingSessionId, result.asking);
      while (lastAsked.size > 2_000) {
        const oldest = lastAsked.keys().next().value;
        if (oldest === undefined) break;
        lastAsked.delete(oldest);
      }
      // The second time it is asked is marked too: a third is pressing.
      askedOptional.add(
        input.onboardingSessionId,
        askedBefore.has(result.asking)
          ? [result.asking, `${result.asking}${ASKED_AGAIN}`]
          : [result.asking],
      );
    }
    if (result !== undefined && result.raised.length > 0) {
      const open = new Set(state.checks.map((check) => check.checkId));
      raisedChecks.add(
        input.onboardingSessionId,
        result.raised.filter((id) => open.has(id)),
      );
    }
    const recorded = port.recorded();
    const replyWritten =
      result?.reply ??
      (recorded.length > 0
        ? "That's on your record. I lost my train of thought for a second — say that last part again?"
        : "I couldn't reach my reasoning service just then, so I haven't taken that in. Say it again in a moment.");
    // Never the previous question word for word (QA 2026-10-03): what they
    // said is acknowledged first, and the question comes in other words.
    const reply = notVerbatim(replyWritten, lastQTurn ?? null, {
      asking: result?.asking ?? null,
      alternate: (stepKey) => {
        const step = journeySteps.find((s) => s.stepKey === stepKey);
        if (step === undefined) return null;
        const spoken = SPOKEN_QUESTIONS[stepKey] ?? null;
        const written = step.configuration.prompt;
        return (
          [spoken, written].find(
            (wording): wording is string =>
              wording !== null &&
              wording !== undefined &&
              !sameWords(wording, lastQTurn ?? ""),
          ) ?? null
        );
      },
    });
    if (reply !== replyWritten) {
      logger.info(
        { asking: result?.asking ?? null },
        "interview reply repeated the last question verbatim; reworded",
      );
    }

    // Q's patience, decided by code from Q's reading of the turn.
    const conduct =
      standing === null || result === undefined || opening
        ? decideConduct(conductBefore, "NONE")
        : decideConduct(conductBefore, result.chatter);
    if (standing !== null && dependencies.standing !== undefined) {
      await dependencies.standing
        .saveConduct(actor.userId, actor.tenantId, conduct.state)
        .catch((error: unknown) => {
          logger.warn({ err: error }, "Q's standing was not kept");
        });
      if (conduct.action === "SUSPEND" && !conductBefore.suspended) {
        const paused = await dependencies.standing
          .suspend(
            actor.userId,
            actor.tenantId,
            "Kept steering the onboarding interview to small talk after five warnings.",
          )
          .catch(() => false);
        if (paused) {
          await dependencies
            .onPaused?.(actor, conduct.state.strikes)
            .catch((error: unknown) => {
              logger.warn({ err: error }, "the pause was not reported");
            });
        }
      }
    }

    // Code checks the step the model says it asked is one still open.
    const steps = new Map(
      definitionFor(input.journeyType).steps.map(
        (s) => [s.stepKey, s] as const,
      ),
    );
    const askedStep =
      result?.asking === null || result?.asking === undefined
        ? undefined
        : steps.get(result.asking);
    // A step whose concept is settled is never offered as the question,
    // whatever the reply asked (one concept, one answer).
    const covered = new Set(
      (await port.state().catch(() => null))?.steps
        .filter((row) => row.coveredBy !== undefined)
        .map((row) => row.stepKey) ?? [],
    );
    // The loop's own reading decides between a question and a remark (QA
    // 2026-10-03, 345a7155: "I'm in Singapore this week ... time zones are
    // a mess" became an 82 s look-up, then the open question verbatim).
    const handingOver = lookup?.kind === "RUN" && result?.chatter !== "PERSON";
    if (lookup?.kind === "RUN" && !handingOver) {
      logger.info(
        {},
        "a look-up was read but the turn was small talk; not run",
      );
    }
    const askedOpen =
      askedStep === undefined ||
      covered.has(askedStep.stepKey) ||
      handingOver ||
      pausing
        ? null
        : toOpenStep(askedStep, view);
    // Where the conversation returns once the look-up is done: the open
    // question the journey would ask next, required first.
    const resumeStep = handingOver
      ? (view.progress.eligibleSteps
          .filter(
            (e) =>
              e.status !== "COMPLETED" &&
              e.status !== "SKIPPED" &&
              !covered.has(e.stepKey),
          )
          .sort((a, b) => Number(b.required) - Number(a.required))
          .map((e) => steps.get(e.stepKey))
          .find((step) => step !== undefined) ?? null)
      : null;
    if (handingOver) {
      remember(
        input.onboardingSessionId,
        reduceConversation(ledger, {
          type: "RESEARCH_STARTED",
          question: lookup.question,
          resumeTopic: resumeStep?.stepKey ?? null,
        }),
      );
    }
    const stillOpen =
      askedOpen !== null &&
      view.progress.eligibleSteps.some(
        (e) =>
          e.stepKey === askedOpen.stepKey &&
          e.status !== "COMPLETED" &&
          e.status !== "SKIPPED",
      );

    // Kept: one exchange per turn, under one reference.
    const turns = [
      ...(opening
        ? []
        : [
            {
              role: "PERSON" as const,
              text: utterance.slice(0, 4_000),
              channel:
                input.channel === "voice"
                  ? ("VOICE" as const)
                  : ("TEXT" as const),
            },
          ]),
      {
        role: "Q" as const,
        text: reply.slice(0, 4_000),
        channel:
          input.channel === "voice" ? ("VOICE" as const) : ("TEXT" as const),
        ...(stillOpen && askedOpen !== null
          ? { stepKey: askedOpen.stepKey }
          : {}),
      },
    ];
    void appendOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
      { turnRef: randomUUID(), turns },
    ).catch((error: unknown) => {
      logger.warn(
        { err: error },
        "the interview thread did not keep this exchange",
      );
    });

    rememberRefused(input.onboardingSessionId, refusedStepsOf(actions));
    logger.info(
      {
        rounds,
        calls,
        recorded,
        asking: stillOpen ? askedOpen?.stepKey : null,
        answered: result !== undefined,
        // What each write decided, by step and basis: never a value or a
        // quote, which are the person's words.
        decisions: decisionsOf(actions),
        stated: [...authority.stated],
        declined: [...authority.declined],
        handed: [...authority.handed],
        approved: [...authority.approved],
        finishing: authority.finishing,
        timedOut,
        ms: now() - startedAt,
      },
      "interview q run traced",
    );

    // The firm may have been named this turn: research starts now, while
    // the person reads the reply.
    considerResearch(view);
    if (result !== undefined) {
      research?.markSaid(input.onboardingSessionId, unsaidShown);
    }

    // PRESENCE: what Q's particles form for which sentence, as the model
    // asked, kept to the closed set and to this reply (spec §5).
    const gestures =
      result === undefined ? [] : gesturesForReply(reply, result.gestures);
    return {
      reply,
      intent: opening ? "OPENING" : "ANSWER",
      ...(gestures.length === 0 ? {} : { gestures }),
      asking:
        stillOpen && askedOpen !== null && askedStep !== undefined
          ? {
              stepKey: askedOpen.stepKey,
              kind: askedOpen.kind,
              options: [...(askedOpen.options ?? optionsOf(askedStep))],
              maxChoices: askedOpen.maxChoices,
            }
          : null,
      recorded,
      skipped: [],
      questionForQ: handingOver ? lookup.question : null,
      researching: handingOver ? lookup.question.slice(0, 200) : null,
      // A completed journey goes where the screen's own button goes: an
      // investor to the companies they set it up to see, a founder home.
      navigate:
        view.session.status === "COMPLETED"
          ? input.journeyType === "investor"
            ? "DISCOVER"
            : "PROFILE"
          : conduct.action === "ROUTE_AWAY"
            ? "DISCOVER"
            : null,
      handoff: null,
      pronounce,
      warnings: conduct.state.strikes,
      conduct: { action: conduct.action, mood: conduct.mood },
      view,
      degraded: result === undefined,
      reading: null,
      resume:
        resumeStep === null
          ? null
          : {
              stepKey: resumeStep.stepKey,
              question: (
                SPOKEN_QUESTIONS[resumeStep.stepKey] ??
                resumeStep.configuration.prompt
              ).slice(0, 400),
            },
      qualitative: [],
      trace: null,
      askingAbout: stillOpen && askedOpen !== null ? [askedOpen.stepKey] : [],
      pending: {
        recommendations: await port.pendingRecommendations().catch(() => []),
        held: [],
      },
    };
  };

  const researchEnded = (onboardingSessionId: string, ok: boolean): void => {
    const finished = reduceConversation(conversationOf(onboardingSessionId), {
      type: "RESEARCH_FINISHED",
    });
    remember(
      onboardingSessionId,
      reduceConversation(finished, {
        type: ok ? "SUCCEEDED" : "FAILED",
        operation: "RESEARCH",
      }),
    );
  };

  return { turn, researchEnded };
}

/** The same words, ignoring case, spacing and punctuation. */
export function sameWords(a: string, b: string): boolean {
  const words = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const left = words(a);
  return left.length > 0 && left === words(b);
}

/**
 * A reply that is the previous question again, word for word, is not
 * said as is: a short acknowledgement first, and the open step asked in
 * its other wording when there is one (QA 2026-10-03, 345a7155).
 */
export function notVerbatim(
  reply: string,
  previous: string | null,
  options: {
    readonly asking: string | null;
    readonly alternate: (stepKey: string) => string | null;
  },
): string {
  if (previous === null || !sameWords(reply, previous)) return reply;
  const other =
    options.asking === null ? null : options.alternate(options.asking);
  return other === null
    ? `Noted. Coming back to it: ${reply}`
    : `Noted. ${other}`;
}
