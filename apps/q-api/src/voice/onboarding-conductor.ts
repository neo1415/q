import { randomUUID } from "node:crypto";

import {
  appendOnboardingInterviewTurns,
  getOnboardingSession,
  listOnboardingInterviewTurns,
  type ApiSession,
} from "@capital-q/api-client";
import type { OnboardingSessionView } from "@capital-q/contracts";
import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  textAnswerOf,
  type InterviewAgent,
  type InterviewAgentTurnInput,
} from "./interview-agent.js";
import {
  definitionFor,
  optionsOf,
  toOpenStep,
  type InterviewTurnOutcome,
} from "./interview-steps.js";
import type { FoundRecommendation } from "./onboarding-port.js";
import type { PresenceFound, PresenceTrigger } from "./presence-trigger.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";
import {
  answersKnownFromJourney,
  settleKnownAnswers,
  type KnownAnswerPort,
} from "./known-answers.js";

export {
  answersKnownFromJourney,
  settleKnownAnswers,
  type KnownAnswer,
  type KnownAnswerPort,
} from "./known-answers.js";

/**
 * The onboarding conductor: the one owner of a first-run onboarding
 * conversation (founder report 2026-10-05, Mai Soli).
 *
 * Live, one spoken sentence started an interview run AND a general Q
 * ANSWER run; one cancelled the other and Q interrupted itself. The
 * session sat on F0.intent for good because a model judged that "the
 * latest words do not state this", although the person had already chosen
 * the founder journey. Research ran and found them, and nobody ever said
 * so. Everything here is deterministic: the model still writes Q's words,
 * but which brain owns a turn, which step is answered by data the platform
 * already holds, what Q asks next and when findings are put to the person
 * are decided by code.
 *
 * - One brain: `dispatchTurn` is the single decision of who answers a
 *   turn, and the conductor never hands a turn to the general ANSWER
 *   pipeline (`questionForQ` is always answered inside the flow).
 * - No stuck steps: `answersKnownFromJourney` names the steps whose answer
 *   is canonical data; they are recorded before any model reads the turn,
 *   on every turn and every (re)opening, which also repairs a session
 *   already stuck on one.
 * - Q leads: after every turn the reply ends on the next unanswered step,
 *   and a re-opened conversation resumes on it without greeting again.
 * - Research feeds the flow: presence findings become confirmation
 *   questions, queued to the next natural turn, never interrupting one.
 * - Race-safe: turns for one onboarding session are serialised, and a
 *   duplicate of the utterance in flight shares its outcome.
 */

// ---------------------------------------------------------------------------
// One brain
// ---------------------------------------------------------------------------

export type TurnOwner = "WELCOME" | "INTERVIEW" | "Q";

/**
 * Who answers a turn. The only place this is decided: a line bound to an
 * active onboarding session is the interview's, whatever was said, and
 * the general pipeline never also runs for it.
 */
export function dispatchTurn(thread: {
  readonly welcome?: boolean | undefined;
  readonly onboarding?: unknown;
}): TurnOwner {
  if (thread.welcome === true) return "WELCOME";
  if (thread.onboarding !== undefined && thread.onboarding !== null) {
    return "INTERVIEW";
  }
  return "Q";
}

// ---------------------------------------------------------------------------
// No stuck steps
// ---------------------------------------------------------------------------

export type NextStep = {
  readonly stepKey: string;
  readonly question: string;
};

/**
 * The next unanswered step on the active path, computed on read: a step
 * known from canonical data is treated as answered even before it is
 * written, so a stuck session never asks it again.
 */
export function nextUnansweredStep(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
): NextStep | null {
  if (view.session.status === "COMPLETED") return null;
  const steps = new Map(
    definitionFor(journeyType).steps.map((s) => [s.stepKey, s] as const),
  );
  const known = new Set(
    answersKnownFromJourney(journeyType).map((k) => k.stepKey),
  );
  const answered = new Set(view.responses.map((r) => r.stepKey));
  const open = view.progress.eligibleSteps.filter(
    (e) =>
      e.status !== "COMPLETED" &&
      e.status !== "SKIPPED" &&
      !answered.has(e.stepKey) &&
      !known.has(e.stepKey) &&
      steps.has(e.stepKey),
  );
  // Required before optional, otherwise the journey's own order.
  const chosen = open.find((e) => e.required) ?? open[0];
  if (chosen === undefined) return null;
  const step = steps.get(chosen.stepKey);
  if (step === undefined) return null;
  return {
    stepKey: step.stepKey,
    question: (
      SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
    ).slice(0, 400),
  };
}

// ---------------------------------------------------------------------------
// Q leads
// ---------------------------------------------------------------------------

/** What Q says when a conversation already under way is opened again. */
export function resumeLine(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
): string {
  if (view.session.status === "COMPLETED") {
    return "Your setup is complete. What would you like to look at next?";
  }
  const next = nextUnansweredStep(view, journeyType);
  return next === null
    ? "Picking up where we left off: I have what I need. Shall I finish your setup?"
    : `Picking up where we left off. ${next.question}`;
}

function asksSomething(reply: string): boolean {
  return reply.includes("?");
}

/**
 * Whether the conductor should put the next question after this reply.
 * Not when the reply already asks something, the setup is done, the
 * person is pausing or being sent elsewhere, or Q is mid-look-up.
 */
export function shouldLead(outcome: InterviewTurnOutcome): boolean {
  if (outcome.view.session.status === "COMPLETED") return false;
  if (outcome.pausing === true) return false;
  if (outcome.navigate !== null || outcome.handoff !== null) return false;
  const action = outcome.conduct?.action;
  if (action === "ROUTE_AWAY" || action === "SUSPEND") return false;
  return !asksSomething(outcome.reply);
}

// ---------------------------------------------------------------------------
// Research feeds the flow
// ---------------------------------------------------------------------------

export type FoundConfirmation = {
  /** Stable, so the same finding is never asked twice. */
  readonly key: string;
  readonly kind: "PERSON" | "WEBSITE";
  readonly line: string;
  /** Held for the person's yes, so "yes" accepts it like any recommendation. */
  readonly recommendation: FoundRecommendation | null;
};

const MAX_STATEMENT = 140;

function clip(text: string, max: number): string {
  let flat = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[;,:]+$/u, "");
  // A closing full stop goes; an abbreviation's own ("Ed.M.") stays.
  const last = flat.split(" ").at(-1) ?? "";
  if (flat.endsWith(".") && (last.match(/\./gu) ?? []).length < 2) {
    flat = flat.replace(/\.+$/u, "");
  }
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function hostOf(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, "")
    .replace(/^www\./u, "")
    .replace(/\/.*$/u, "");
}

/** Hosts that are someone else's platform, never a company's own site. */
const NOT_OWN_SITE =
  /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|crunchbase|github|medium|wikipedia|tiktok|google|bloomberg|forbes|techcrunch|substack)\.[a-z.]+$/u;

/**
 * Confirmation questions from a presence build's findings. Code composes
 * them from what the Write Gate accepted (HELD as inference): nothing here
 * is a fact until the person says yes.
 */
export function confirmationsFromPresence(
  found: PresenceFound,
  view: OnboardingSessionView | null,
): readonly FoundConfirmation[] {
  const out: FoundConfirmation[] = [];
  const name = clip(found.name, 80);
  if (name.length < 2) return out;
  if (found.subjectType === "COMPANY") {
    const websiteAnswered =
      view?.responses.some((r) => r.stepKey === FOUNDER_STEPS.website) ?? false;
    const own = found.domains.map(hostOf).find((d) => !NOT_OWN_SITE.test(d));
    if (own !== undefined && own.length > 3 && !websiteAnswered) {
      out.push({
        key: `website:${own}`,
        kind: "WEBSITE",
        line: `I found ${own} — is that your website?`,
        recommendation: {
          stepKey: FOUNDER_STEPS.website,
          value: `https://${own}`,
          because: `found when searching for ${name} by name`,
          sources: [{ sourceType: "PUBLIC_WEB", url: `https://${own}` }],
        },
      });
    }
    return out;
  }
  const statement = found.statements
    .map((s) => clip(s, MAX_STATEMENT))
    .find((s) => s.length >= 8);
  const where = found.domains.map(hostOf).find((d) => d.length > 3);
  // As found: a statement often opens on a proper noun ("Harvard Ed.M.").
  const about = statement === undefined ? "" : `, ${statement}`;
  out.push({
    key: `person:${name.toLowerCase()}:${where ?? ""}`,
    kind: "PERSON",
    line: `I found ${name}${about}${where === undefined ? "" : ` (${where})`} — is that you?`,
    recommendation: null,
  });
  return out;
}

export type ConfirmationQueue = {
  readonly enqueue: (
    onboardingSessionId: string,
    items: readonly FoundConfirmation[],
  ) => number;
  /** The next confirmation to ask, once; null when none waits. */
  readonly take: (onboardingSessionId: string) => FoundConfirmation | null;
  readonly size: (onboardingSessionId: string) => number;
};

/** Bounded, in this process: a restart forgets an unasked finding. */
export function createConfirmationQueue(
  maxSessions = 2_000,
): ConfirmationQueue {
  const bySession = new Map<
    string,
    { readonly waiting: FoundConfirmation[]; readonly seen: Set<string> }
  >();
  const of = (id: string) => {
    const existing = bySession.get(id);
    if (existing !== undefined) return existing;
    const created = {
      waiting: [] as FoundConfirmation[],
      seen: new Set<string>(),
    };
    bySession.set(id, created);
    while (bySession.size > maxSessions) {
      const oldest = bySession.keys().next().value;
      if (oldest === undefined) break;
      bySession.delete(oldest);
    }
    return created;
  };
  return {
    enqueue: (id, items) => {
      const entry = of(id);
      let added = 0;
      for (const item of items) {
        if (entry.seen.has(item.key)) continue;
        entry.seen.add(item.key);
        entry.waiting.push(item);
        added += 1;
      }
      return added;
    },
    take: (id) => bySession.get(id)?.waiting.shift() ?? null,
    size: (id) => bySession.get(id)?.waiting.length ?? 0,
  };
}

/**
 * Whether a look-up question is about the person or their own company,
 * which Q answers by searching for them by name. Anything else waits for
 * Home Q once the setup is done: the interview stays the one voice.
 */
export function isSelfLookup(
  question: string,
  names: readonly string[],
): boolean {
  const text = ` ${question.toLowerCase()} `;
  if (/[^a-z](me|my|myself|us|our|ours|we|mine)[^a-z]/u.test(text)) return true;
  return names.some(
    (name) =>
      name.trim().length >= 2 && text.includes(name.trim().toLowerCase()),
  );
}

/** The line for a look-up handled inside the flow. Never a dead end. */
export function lookupLine(input: {
  readonly selfLookup: boolean;
  readonly companyName: string | null;
  readonly personName: string | null;
}): string {
  if (!input.selfLookup) {
    return "That one deserves a proper look; once your setup is done, ask me again on your Home page and I'll research it with you.";
  }
  const names = [input.personName, input.companyName].filter(
    (n): n is string => n !== null && n.trim().length >= 2,
  );
  if (names.length === 0) {
    return "Tell me your company's name and I'll search for it by name — no website needed.";
  }
  return `I'm searching public sources for ${names.join(" and ")} by name now — no website needed — and I'll tell you what I find.`;
}

// ---------------------------------------------------------------------------
// Idempotent and race-safe
// ---------------------------------------------------------------------------

export type TurnSerializer = {
  /**
   * Runs `work` after every earlier turn for `key` has settled. A second
   * call with the same `dedupeKey` while the first is in flight (or within
   * `windowMs` of it finishing) shares the first one's outcome instead of
   * acting on the utterance again -- unless the first was stopped (its
   * signal aborted), when the second runs on its own, after it.
   */
  readonly run: <T>(
    key: string,
    dedupeKey: string,
    work: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>;
};

type SerializedTurn = {
  readonly dedupeKey: string;
  readonly result: Promise<unknown>;
  readonly signal: AbortSignal | undefined;
  finishedAt: number | null;
  failed: boolean;
};

export function createTurnSerializer(options?: {
  readonly windowMs?: number;
  readonly now?: () => number;
  readonly maxKeys?: number;
}): TurnSerializer {
  const windowMs = options?.windowMs ?? 10_000;
  const now = options?.now ?? Date.now;
  const maxKeys = options?.maxKeys ?? 2_000;
  const tails = new Map<string, Promise<void>>();
  const recent = new Map<string, SerializedTurn>();
  const bound = <V>(map: Map<string, V>) => {
    while (map.size > maxKeys) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  };
  const run = <T>(
    key: string,
    dedupeKey: string,
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const last = recent.get(key);
    if (
      last !== undefined &&
      last.dedupeKey === dedupeKey &&
      last.signal?.aborted !== true &&
      !last.failed &&
      (last.finishedAt === null || now() - last.finishedAt <= windowMs)
    ) {
      // The same words, already being acted on: one action, one outcome.
      return last.result as Promise<T>;
    }
    const before = tails.get(key) ?? Promise.resolve();
    const result = before.then(work);
    const entry: SerializedTurn = {
      dedupeKey,
      result,
      signal,
      finishedAt: null,
      failed: false,
    };
    recent.delete(key);
    recent.set(key, entry);
    bound(recent);
    const tail = result.then(
      () => {
        entry.finishedAt = now();
      },
      () => {
        entry.finishedAt = now();
        entry.failed = true;
      },
    );
    tails.delete(key);
    tails.set(key, tail);
    bound(tails);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
  return { run };
}

/** One utterance, as a duplicate is recognised: case and spacing aside. */
export function utteranceKey(utterance: string): string {
  return utterance.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// The conductor
// ---------------------------------------------------------------------------

export type ConductorPortFactory = (input: {
  readonly actor: ActorContext;
  readonly session: ApiSession;
  readonly onboardingSessionId: string;
  readonly journeyType: "founder" | "investor";
}) => KnownAnswerPort & {
  readonly view: () => OnboardingSessionView | null;
  readonly recommendFound?:
    | ((
        items: readonly FoundRecommendation[],
      ) => Promise<
        readonly { readonly stepKey: string; readonly outcome: string }[]
      >)
    | undefined;
};

export type OnboardingConductorDependencies = {
  readonly agent: InterviewAgent;
  /** Where known answers are recorded and findings held, as the person. */
  readonly portFor: ConductorPortFactory;
  /** Public presence by name; absent means nothing is looked up. */
  readonly presence?: PresenceTrigger | undefined;
  readonly queue?: ConfirmationQueue | undefined;
  readonly serializer?: TurnSerializer | undefined;
  readonly logger: Logger;
};

export type OnboardingConductor = InterviewAgent & {
  /** Findings that landed between turns, for the next natural gap. */
  readonly enqueueFound: (
    onboardingSessionId: string,
    found: PresenceFound,
    view: OnboardingSessionView | null,
  ) => number;
};

/**
 * Wraps the interview loop as the one owner of an onboarding turn: every
 * entry (typed route, voice think, duplex ask_q, voice session opening)
 * goes through `turn`, so these rules hold whatever the transport.
 */
export function createOnboardingConductor(
  dependencies: OnboardingConductorDependencies,
): OnboardingConductor {
  const { agent, logger } = dependencies;
  const queue = dependencies.queue ?? createConfirmationQueue();
  const serializer = dependencies.serializer ?? createTurnSerializer();

  const enqueueFound: OnboardingConductor["enqueueFound"] = (
    id,
    found,
    view,
  ) => {
    const added = queue.enqueue(id, confirmationsFromPresence(found, view));
    if (added > 0) {
      // Counts only: never a name, a statement or a domain.
      logger.info(
        { added, subjectType: found.subjectType ?? "PERSON" },
        "onboarding findings queued for confirmation",
      );
    }
    return added;
  };

  const keep = (
    input: InterviewAgentTurnInput,
    text: string,
    stepKey: string | null,
  ) => {
    if (text.length === 0) return;
    void appendOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
      {
        turnRef: randomUUID(),
        turns: [
          {
            role: "Q",
            text: text.slice(0, 4_000),
            channel: input.channel === "voice" ? "VOICE" : "TEXT",
            ...(stepKey === null ? {} : { stepKey }),
          },
        ],
      },
    ).catch((error: unknown) => {
      logger.warn({ err: error }, "the conductor's line was not kept");
    });
  };

  const askingFor = (
    stepKey: string,
    journeyType: "founder" | "investor",
    view: OnboardingSessionView,
  ): InterviewTurnOutcome["asking"] => {
    const step = definitionFor(journeyType).steps.find(
      (s) => s.stepKey === stepKey,
    );
    const open = step === undefined ? null : toOpenStep(step, view);
    if (step === undefined || open === null) return null;
    return {
      stepKey,
      kind: open.kind,
      options: [...(open.options ?? optionsOf(step))],
      maxChoices: open.maxChoices,
    };
  };

  /** Starts (or confirms started) the name searches; findings come back queued. */
  const searchByName = (
    input: InterviewAgentTurnInput,
    view: OnboardingSessionView,
  ) => {
    const actor = input.actor;
    if (actor === undefined || dependencies.presence === undefined) return;
    dependencies.presence.afterInterviewTurn(
      actor,
      view,
      (found) => {
        enqueueFound(input.onboardingSessionId, found, view);
      },
      { organisationName: input.signup?.organisationName ?? null },
    );
  };

  const resumeOpening = async (
    input: InterviewAgentTurnInput,
  ): Promise<InterviewTurnOutcome | null> => {
    // Only a conversation already under way resumes; a first opening is
    // the loop's own greeting.
    const kept = await listOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
    ).catch(() => null);
    const underway =
      kept === null
        ? input.recentTurns.length > 0
        : kept.items.some((t) => t.role === "Q");
    if (!underway) return null;
    const actor = input.actor;
    let view: OnboardingSessionView | null = null;
    if (actor !== undefined) {
      const port = dependencies.portFor({
        actor,
        session: input.session,
        onboardingSessionId: input.onboardingSessionId,
        journeyType: input.journeyType,
      });
      await settleKnownAnswers(port, input.journeyType);
      view = port.view();
    }
    view ??= await getOnboardingSession(
      input.session,
      input.onboardingSessionId,
    );
    const next = nextUnansweredStep(view, input.journeyType);
    let reply = resumeLine(view, input.journeyType);
    let asking =
      next === null ? null : askingFor(next.stepKey, input.journeyType, view);
    // What research found while they were away is the first thing said.
    const waiting = queue.take(input.onboardingSessionId);
    let confirming: InterviewTurnOutcome["confirming"] = undefined;
    if (waiting !== null && view.session.status !== "COMPLETED") {
      reply = `Picking up where we left off. ${waiting.line}`;
      asking = null;
      confirming = { key: waiting.key, kind: waiting.kind };
      await hold(input, waiting);
    }
    searchByName(input, view);
    keep(input, reply, asking?.stepKey ?? null);
    return {
      reply,
      intent: "RESUME",
      asking,
      recorded: [],
      skipped: [],
      questionForQ: null,
      researching: null,
      navigate: null,
      handoff: null,
      pronounce: null,
      warnings: 0,
      view,
      degraded: false,
      reading: null,
      resume: null,
      qualitative: [],
      trace: null,
      askingAbout: asking === null ? [] : [asking.stepKey],
      resumed: true,
      ...(confirming === undefined ? {} : { confirming }),
    };
  };

  const hold = async (
    input: InterviewAgentTurnInput,
    item: FoundConfirmation,
  ): Promise<void> => {
    if (item.recommendation === null || input.actor === undefined) return;
    const port = dependencies.portFor({
      actor: input.actor,
      session: input.session,
      onboardingSessionId: input.onboardingSessionId,
      journeyType: input.journeyType,
    });
    await port.recommendFound?.([item.recommendation]).catch(() => []);
  };

  const conduct = async (
    input: InterviewAgentTurnInput,
  ): Promise<InterviewTurnOutcome> => {
    const opening = input.utterance.trim().length === 0;
    if (opening) {
      const resumed = await resumeOpening(input).catch((error: unknown) => {
        logger.warn({ err: error }, "deterministic resume unavailable");
        return null;
      });
      if (resumed !== null) return resumed;
    }
    const outcome = await agent.turn(input);
    if (input.signal?.aborted === true) return outcome;
    const view = outcome.view;
    const extra: string[] = [];
    let asking = outcome.asking;
    let askingAbout = outcome.askingAbout;
    let confirming: InterviewTurnOutcome["confirming"] = undefined;

    // One brain: a look-up is answered inside the flow, never handed to
    // the general pipeline.
    if (outcome.questionForQ !== null) {
      const company =
        textAnswerOf(view, FOUNDER_STEPS.companyName) ||
        (input.signup?.organisationName?.trim() ?? "") ||
        null;
      const person = input.signup?.displayName?.trim() ?? null;
      const self = isSelfLookup(
        outcome.questionForQ,
        [company, person].filter((n): n is string => n !== null),
      );
      extra.push(
        lookupLine({
          selfLookup: self,
          companyName: company,
          personName: person,
        }),
      );
      if (self) searchByName(input, view);
      agent.researchEnded(input.onboardingSessionId, true);
      logger.info(
        { selfLookup: self },
        "onboarding look-up answered inside the flow",
      );
    } else {
      searchByName(input, view);
    }

    const handingNothing =
      outcome.navigate === null &&
      outcome.handoff === null &&
      outcome.pausing !== true &&
      outcome.conduct?.action !== "ROUTE_AWAY" &&
      outcome.conduct?.action !== "SUSPEND";
    // Research feeds the flow: one finding, at the end of this reply.
    const waiting =
      handingNothing && view.session.status !== "COMPLETED"
        ? queue.take(input.onboardingSessionId)
        : null;
    if (waiting !== null) {
      await hold(input, waiting);
      extra.push(waiting.line);
      asking = null;
      askingAbout = [];
      confirming = { key: waiting.key, kind: waiting.kind };
    } else {
      // Q leads: the reply always ends on the next unanswered step.
      const leadable = {
        ...outcome,
        reply: [outcome.reply, ...extra].join(" ").trim(),
        questionForQ: null,
      };
      if (shouldLead(leadable)) {
        const next = nextUnansweredStep(view, input.journeyType);
        if (next !== null) {
          extra.push(next.question);
          asking = askingFor(next.stepKey, input.journeyType, view);
          askingAbout = [next.stepKey];
        }
      }
    }
    if (extra.length === 0)
      return { ...outcome, questionForQ: null, researching: null };
    const added = extra.join(" ");
    keep(input, added, asking?.stepKey ?? null);
    const tail = outcome.reply.trim().length === 0 ? added : ` ${added}`;
    // Streamed voice already said the loop's sentences; the voice path
    // speaks the remainder of `reply`, so the additions go at the end and
    // are not pushed as a streamed sentence (they would be said twice).
    return {
      ...outcome,
      reply: `${outcome.reply.trim()}${tail}`,
      questionForQ: null,
      researching: null,
      asking,
      askingAbout,
      ...(confirming === undefined ? {} : { confirming }),
    };
  };

  return {
    turn: (input) =>
      serializer.run(
        input.onboardingSessionId,
        `${input.channel}:${utteranceKey(input.utterance)}`,
        () => conduct(input),
        input.signal,
      ),
    researchEnded: agent.researchEnded,
    enqueueFound,
  };
}
