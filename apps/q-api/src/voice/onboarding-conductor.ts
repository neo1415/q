import { createHash, randomUUID } from "node:crypto";

import {
  appendOnboardingInterviewTurns,
  getOnboardingSession,
  listOnboardingInterviewTurns,
  type ApiSession,
} from "@capital-q/api-client";
import type { OnboardingSessionView } from "@capital-q/contracts";
import {
  displayOnboardingValue,
  type OnboardingStepManifest,
} from "@capital-q/onboarding";
import {
  FOUNDER_PROFILE_SECTIONS,
  FOUNDER_STEPS,
} from "@capital-q/founder-onboarding";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  textAnswerOf,
  type InterviewAgent,
  type InterviewAgentTurnInput,
} from "./interview-agent.js";
import {
  definitionFor,
  describeValue,
  MONEY_STEP,
  optionsOf,
  toOpenStep,
  type InterviewTurnOutcome,
} from "./interview-steps.js";
import {
  coverageProfileFor,
  isPlatformReference,
  settleMandateStep,
  type FoundRecommendation,
} from "./onboarding-port.js";
import type { PresenceFound, PresenceTrigger } from "./presence-trigger.js";
import { languageInfo } from "@capital-q/q-core/language";

import { replyLanguageOf } from "./reply-language.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";
import { firstNameOf } from "./onboarding-flow.js";
import type { OnboardingConversation } from "./onboarding-conversation.js";
import { HAND_STEP_COPY } from "./step-copy-language.js";
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
  /** Only these steps, in this order (a profile section they came to fill). */
  among?: readonly string[],
): NextStep | null {
  if (view.session.status === "COMPLETED") return null;
  const steps = new Map(
    definitionFor(journeyType).steps.map((s) => [s.stepKey, s] as const),
  );
  const known = new Set(
    answersKnownFromJourney(journeyType).map((k) => k.stepKey),
  );
  const answered = new Set(view.responses.map((r) => r.stepKey));
  const open = view.progress.eligibleSteps.filter((e) => {
    const step = steps.get(e.stepKey);
    return (
      e.status !== "COMPLETED" &&
      e.status !== "SKIPPED" &&
      !answered.has(e.stepKey) &&
      !known.has(e.stepKey) &&
      step !== undefined &&
      // The mandate being defined is the journey's to settle, never asked
      // (QA 25 Oct: "your main investment strategy, or a different one?"
      // on return, after the mandate was confirmed).
      !isPlatformReference(step)
    );
  });
  // Required before optional, otherwise the journey's own order.
  const chosen =
    among === undefined
      ? (open.find((e) => e.required) ?? open[0])
      : among
          .map((key) => open.find((e) => e.stepKey === key))
          .find((e) => e !== undefined);
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

/**
 * What each confirmation confirms: the phases whose answers it sums up
 * (QA 25-26 Oct: "Here's what I understood. Does it look right?" and "Save
 * this as your capital objective?" were asked with nothing of what they
 * confirm).
 */
const CONFIRMS: Readonly<Record<string, readonly string[]>> = {
  "F3.review": ["F1", "F2"],
  "F6.confirm": ["F6"],
  "F8.snapshot": ["F1", "F2", "F5", "F6"],
  "I11.review": ["I2", "I3"],
};
const CONFIRMED_ITEMS = 6;

/**
 * What a confirmation step confirms, read from the session: each answer in
 * its phases, by its label ("Raise target: $1.2 million"). Null when the
 * step confirms nothing on record, or is not a confirmation.
 */
export function confirmedContent(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
  stepKey: string,
): string | null {
  const phases = CONFIRMS[stepKey];
  if (phases === undefined) return null;
  const labels = coverageProfileFor(journeyType).fields;
  const answers = new Map(view.responses.map((r) => [r.stepKey, r.value]));
  const confirmed = definitionFor(journeyType).steps.filter(
    (s) =>
      s.stepKey !== stepKey &&
      s.configuration.stepType !== "confirmation" &&
      phases.includes(s.configuration.phaseKey ?? ""),
  );
  // The currency answered among what is confirmed (the raise's own, not a
  // reporting currency); never assumed.
  const currencyAnswer = confirmed
    .filter((s) => /\.currency$/u.test(s.stepKey))
    .map((s) => answers.get(s.stepKey))
    .find((v) => v?.type === "SINGLE_SELECT");
  const currency =
    currencyAnswer?.type === "SINGLE_SELECT" ? currencyAnswer.optionKey : null;
  const items = confirmed
    .flatMap((s) => {
      const value = answers.get(s.stepKey);
      if (value === undefined) return [];
      const label = (labels[s.stepKey]?.label ?? s.configuration.prompt)
        .replace(/[?:]$/u, "")
        .trim();
      return [`${label}: ${confirmedValue(s, value, currency)}`];
    })
    .slice(0, CONFIRMED_ITEMS);
  return items.length === 0 ? null : items.join("; ");
}

/**
 * One confirmed answer as a person reads it: a sum of money in its own
 * currency ("$1.2 million", live 26 Oct: "Raise target: 1200000"); without
 * a currency on record, the plain figure, grouped ("1,200,000"), never
 * dollars by default.
 */
function confirmedValue(
  step: OnboardingStepManifest,
  value: OnboardingSessionView["responses"][number]["value"],
  currency: string | null,
): string {
  if (value.type === "RANGE" && MONEY_STEP.test(step.stepKey)) {
    const figure = Number.parseFloat(String(value.value));
    if (Number.isFinite(figure)) {
      return currency === null
        ? new Intl.NumberFormat("en-GB").format(figure)
        : describeValue(step, value, currency);
    }
  }
  return displayOnboardingValue(step, value);
}

/**
 * The step a reopening asks: the one chosen, unless it is a confirmation
 * with nothing on record to show, which never asks a bare "does this look
 * right?" — the next open question is asked instead (it still comes back
 * once there is something to confirm).
 */
export function resumeAsk(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
  chosen: NextStep,
): NextStep {
  if (
    CONFIRMS[chosen.stepKey] === undefined ||
    confirmedContent(view, journeyType, chosen.stepKey) !== null
  ) {
    return chosen;
  }
  const others = definitionFor(journeyType)
    .steps.filter((s) => s.configuration.stepType !== "confirmation")
    .map((s) => s.stepKey);
  return nextUnansweredStep(view, journeyType, others) ?? chosen;
}

/** The lines that ask a step, a confirmation with what it confirms. */
function askLines(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
  step: NextStep,
): readonly Line[] {
  const content = confirmedContent(view, journeyType, step.stepKey);
  return [
    ...(content === null ? [] : [{ text: `Here's what I have: ${content}.` }]),
    { text: step.question, stepKey: step.stepKey },
  ];
}

/**
 * The open step Q's last line was asking, when that line carries the step's
 * own question. A reopening asks it again rather than jumping to the next
 * required step (live NEM 2026-10-17: the greeting asked what the company
 * does, voice opened five seconds later and Q asked the stage instead).
 */
export function stepStillAsked(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
  lastQLine: string,
): NextStep | null {
  const said = lastQLine.toLowerCase();
  const step = definitionFor(journeyType).steps.find((s) => {
    const question = SPOKEN_QUESTIONS[s.stepKey] ?? s.configuration.prompt;
    return question.length > 0 && said.includes(question.toLowerCase());
  });
  return step === undefined
    ? null
    : nextUnansweredStep(view, journeyType, [step.stepKey]);
}

// ---------------------------------------------------------------------------
// Q leads
// ---------------------------------------------------------------------------

const PICKING_UP = "Picking up where we left off.";

/** The resume as lines, so each can be said in the person's language. */
export function resumeLines(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
): readonly Line[] {
  if (view.session.status === "COMPLETED") {
    return [
      { text: "Your setup is complete. What would you like to look at next?" },
    ];
  }
  const chosen = nextUnansweredStep(view, journeyType);
  if (chosen === null) {
    return [
      {
        text: "Picking up where we left off: I have what I need. Shall I finish your setup?",
      },
    ];
  }
  return [
    { text: PICKING_UP },
    ...askLines(view, journeyType, resumeAsk(view, journeyType, chosen)),
  ];
}

/** What Q says when a conversation already under way is opened again. */
export function resumeLine(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
): string {
  if (view.session.status === "COMPLETED") {
    return "Your setup is complete. What would you like to look at next?";
  }
  const lines = resumeLines(view, journeyType);
  return lines.map((line) => line.text).join(lines.length > 1 ? " " : "");
}

function asksSomething(reply: string): boolean {
  // The Arabic question mark asks too (multilingual Q, live 2026-10-16).
  return reply.includes("?") || reply.includes("؟");
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

/** The company or firm their session names, from their own answers. */
function organisationNameOf(view: OnboardingSessionView | null): string | null {
  const answer = view?.responses.find(
    (r) =>
      r.stepKey === FOUNDER_STEPS.companyName ||
      r.stepKey === INVESTOR_STEPS.organisationName,
  )?.value;
  const name = answer?.type === "TEXT" ? answer.text.trim() : "";
  return name.length >= 2 ? name : null;
}

/** Whether a found statement names their organisation (its whole name). */
function namesOrganisation(statement: string, organisation: string): boolean {
  const flat = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-z0-9]+/gu, " ")
      .trim();
  const wanted = flat(organisation);
  return wanted.length >= 2 && ` ${flat(statement)} `.includes(` ${wanted} `);
}

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
  // QA QO-24 (23 Oct): "Nem Okafor (transfermarkt) — is that you?" for a
  // founder of a payroll company: a namesake. A person is put to them only
  // when what was found names the company or firm they told us about; with
  // nothing to tie it to them, nothing is asked (unknown stays unknown).
  const organisation = organisationNameOf(view);
  if (
    organisation === null ||
    !found.statements.some((s) => namesOrganisation(s, organisation))
  ) {
    return out;
  }
  const statement = found.statements
    .map((s) => clip(s, MAX_STATEMENT))
    .find((s) => s.length >= 8 && namesOrganisation(s, organisation));
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
  /**
   * Owner 2026-10-27: a brand-new conversation opens with Q's own
   * introduction and first question, built by code (no model, no wait);
   * research on their firm or company starts with it.
   */
  readonly introduction?: Pick<OnboardingConversation, "opening"> | undefined;
  /** Where known answers are recorded and findings held, as the person. */
  readonly portFor: ConductorPortFactory;
  /** Public presence by name; absent means nothing is looked up. */
  readonly presence?: PresenceTrigger | undefined;
  readonly queue?: ConfirmationQueue | undefined;
  readonly serializer?: TurnSerializer | undefined;
  readonly logger: Logger;
  /**
   * Multilingual Q: the language they chose (a tag), or null for
   * Automatic. With it, the conductor's own lines (resume, the next
   * question, a look-up line, a finding) are said in that language.
   */
  readonly languageOf?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  /** Q's shared translation layer (translateLines): each line, or null. */
  readonly localiseWords?:
    | ((
        actor: ActorContext,
        language: string,
        texts: readonly string[],
      ) => Promise<readonly (string | null)[]>)
    | undefined;
};

/** One line the conductor says; a step's question carries its step. */
type Line = { readonly text: string; readonly stepKey?: string | undefined };

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
    turnRef: string = randomUUID(),
  ) => {
    if (text.length === 0) return;
    void appendOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
      {
        turnRef,
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

  /**
   * The conductor's lines in the reply's language (ob1 live on AF): their
   * chosen language, or with Automatic the language of `turnText`. The
   * language's hand step copy first (by subtag), else translateLines; a
   * line with neither stays English. Null: Automatic and their words are
   * not English, with no language to translate into, so no English line
   * should be added.
   */
  const sayIn = async (
    input: InterviewAgentTurnInput,
    lines: readonly Line[],
    turnText: string,
  ): Promise<readonly string[] | null> => {
    const actor = input.actor;
    const chosen =
      actor === undefined || dependencies.languageOf === undefined
        ? null
        : await dependencies.languageOf(actor).catch(() => null);
    const language = replyLanguageOf(chosen, turnText);
    if (language.kind === "ENGLISH") return lines.map((line) => line.text);
    if (language.kind === "THEIRS") return null;
    const hand = HAND_STEP_COPY[languageInfo(language.tag)?.primary ?? ""];
    const handOf = (line: Line) =>
      line.stepKey === undefined ? undefined : hand?.questions[line.stepKey];
    const machine =
      actor === undefined ||
      dependencies.localiseWords === undefined ||
      lines.every((line) => handOf(line) !== undefined)
        ? []
        : await dependencies
            .localiseWords(
              actor,
              language.tag,
              lines.map((line) => line.text),
            )
            .catch(() => []);
    return lines.map((line, i) => handOf(line) ?? machine[i] ?? line.text);
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
    // The mandate being defined is settled here too, not only on a turn
    // (live 26 Oct: a resume left it open until the next typed turn).
    view = await settleMandateStep(
      input.session,
      input.onboardingSessionId,
      view,
      input.journeyType,
    );
    // The profile section they came to fill (lane ov's Overview link,
    // ?section=): its first open step is asked on resume too (live AG
    // 2026-10-16: a resumed conversation ignored the section). A line with
    // its step key, so it is said in their language like any other.
    const section =
      input.journeyType === "founder" && input.focus !== undefined
        ? FOUNDER_PROFILE_SECTIONS.find((s) => s.key === input.focus)
        : undefined;
    const focused =
      section === undefined
        ? null
        : nextUnansweredStep(view, input.journeyType, section.stepKeys);
    // Q's last line still waiting for its answer is asked again; with
    // nothing said back yet there is nothing to pick up from, so it is just
    // asked again.
    const lastQ = kept?.items.findLast((t) => t.role === "Q")?.text ?? "";
    const spoken =
      kept?.items.some((t) => t.role !== "Q") ??
      input.recentTurns.some((t) => t.role === "person");
    const pending =
      focused === null && view.session.status !== "COMPLETED"
        ? stepStillAsked(view, input.journeyType, lastQ)
        : null;
    const asked = focused ?? pending;
    const ask =
      asked === null ? null : resumeAsk(view, input.journeyType, asked);
    const chosen = ask ?? nextUnansweredStep(view, input.journeyType);
    const next =
      chosen === null ? null : resumeAsk(view, input.journeyType, chosen);
    let lines: readonly Line[] =
      ask === null
        ? resumeLines(view, input.journeyType)
        : [
            ...(spoken || focused !== null ? [{ text: PICKING_UP }] : []),
            ...askLines(view, input.journeyType, ask),
          ];
    let asking =
      next === null ? null : askingFor(next.stepKey, input.journeyType, view);
    // What research found while they were away is the first thing said.
    const waiting = queue.take(input.onboardingSessionId);
    let confirming: InterviewTurnOutcome["confirming"] = undefined;
    if (waiting !== null && view.session.status !== "COMPLETED") {
      lines = [{ text: PICKING_UP }, { text: waiting.line }];
      asking = null;
      confirming = { key: waiting.key, kind: waiting.kind };
      await hold(input, waiting);
    }
    // In their language: the one they chose, or (Automatic) the language
    // of their last words; with neither known, English.
    const lastWords =
      kept?.items.findLast((t) => t.role !== "Q")?.text ??
      input.recentTurns.findLast((t) => t.role === "person")?.text ??
      "";
    const reply = (
      (await sayIn(input, lines, lastWords)) ?? lines.map((line) => line.text)
    ).join(" ");
    searchByName(input, view);
    // Once per reopening (live AG 2026-10-16: each load kept the resume line
    // twice). The same line already last in the conversation is not kept
    // again, and two opens of the same conversation state at once share
    // one idempotent reference, so the API keeps one.
    const items = kept?.items ?? [];
    const last = items.at(-1);
    if (!(last?.role === "Q" && last.text.includes(reply))) {
      keep(
        input,
        reply,
        asking?.stepKey ?? null,
        resumeTurnRef(
          input.onboardingSessionId,
          `${items.length}|${last?.createdAt ?? ""}|${reply}`,
        ),
      );
    }
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

  /** A conversation nobody has spoken in yet: Q introduces itself, by code. */
  const firstOpening = async (
    input: InterviewAgentTurnInput,
  ): Promise<InterviewTurnOutcome | null> => {
    const introduction = dependencies.introduction;
    const actor = input.actor;
    if (introduction === undefined || actor === undefined) return null;
    const kept = await listOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
    ).catch(() => null);
    if (
      kept === null ||
      kept.items.length > 0 ||
      input.recentTurns.length > 0
    ) {
      return null;
    }
    // What the platform already holds is on the record before the first
    // question is chosen (live 2026-10-28, founder 7982610e: "What's your
    // company called?" asked for the name typed at sign-up two screens
    // earlier): the journey's choice, and the company or firm they named.
    const port = dependencies.portFor({
      actor,
      session: input.session,
      onboardingSessionId: input.onboardingSessionId,
      journeyType: input.journeyType,
    });
    await settleKnownAnswers(port, input.journeyType);
    const signupName = input.signup?.organisationName?.trim() ?? "";
    if (signupName.length > 0) {
      await port
        .recordKnown(
          input.journeyType === "founder"
            ? FOUNDER_STEPS.companyName
            : INVESTOR_STEPS.organisationName,
          signupName,
        )
        .catch(() => false);
    }
    const view =
      port.view() ??
      (await getOnboardingSession(input.session, input.onboardingSessionId));
    if (view.session.status === "COMPLETED") return null;
    const chosen = nextUnansweredStep(view, input.journeyType);
    const next =
      chosen === null ? null : resumeAsk(view, input.journeyType, chosen);
    const reply = await introduction.opening({
      actor,
      accessToken: input.session.accessToken,
      onboarding: {
        sessionId: input.onboardingSessionId,
        journeyType: input.journeyType,
      },
      firstName: firstNameOf(
        input.signup?.displayName ?? null,
        input.signup?.organisationName ?? null,
      ),
      displayName: input.signup?.displayName ?? null,
      organisationName: input.signup?.organisationName ?? null,
      askStepKey: next?.stepKey ?? null,
    });
    if (reply === null) return null;
    const asking =
      next === null ? null : askingFor(next.stepKey, input.journeyType, view);
    searchByName(input, view);
    keep(
      input,
      reply,
      asking?.stepKey ?? null,
      resumeTurnRef(input.onboardingSessionId, `opening|${reply}`),
    );
    return {
      reply,
      intent: "OPENING",
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
    };
  };

  const conduct = async (
    input: InterviewAgentTurnInput,
  ): Promise<InterviewTurnOutcome> => {
    const opening = input.utterance.trim().length === 0;
    if (opening) {
      const introduced = await firstOpening(input).catch((error: unknown) => {
        logger.warn({ err: error }, "the code opening was unavailable");
        return null;
      });
      if (introduced !== null) return introduced;
      const resumed = await resumeOpening(input).catch((error: unknown) => {
        logger.warn({ err: error }, "deterministic resume unavailable");
        return null;
      });
      if (resumed !== null) return resumed;
    }
    const outcome = await agent.turn(input);
    if (input.signal?.aborted === true) return outcome;
    const view = outcome.view;
    const extra: Line[] = [];
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
      extra.push({
        text: lookupLine({
          selfLookup: self,
          companyName: company,
          personName: person,
        }),
      });
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
      extra.push({ text: waiting.line });
      asking = null;
      askingAbout = [];
      confirming = { key: waiting.key, kind: waiting.kind };
    } else {
      // Q leads: the reply always ends on the next unanswered step.
      const leadable = {
        ...outcome,
        reply: [outcome.reply, ...extra.map((line) => line.text)]
          .join(" ")
          .trim(),
        questionForQ: null,
      };
      if (shouldLead(leadable)) {
        const next = nextUnansweredStep(view, input.journeyType);
        if (next !== null) {
          extra.push({ text: next.question, stepKey: next.stepKey });
          asking = askingFor(next.stepKey, input.journeyType, view);
          askingAbout = [next.stepKey];
        }
      }
    }
    if (extra.length === 0)
      return { ...outcome, questionForQ: null, researching: null };
    // The conductor's own lines, in their language (ob1 live on AF). With
    // Automatic and words not in English, no English line is added: the
    // interviewer was told to end on the next question in their language.
    const said = await sayIn(input, extra, input.utterance);
    if (said === null) {
      return { ...outcome, questionForQ: null, researching: null };
    }
    const added = said.join(" ");
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

/** A stable UUID for one resume line over one conversation state. */
export function resumeTurnRef(sessionId: string, state: string): string {
  const hex = createHash("sha256")
    .update(`resume|${sessionId}|${state}`)
    .digest("hex");
  // Shaped as a version-4-style UUID: the API checks the form only.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
