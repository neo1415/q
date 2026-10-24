import type { OnboardingState } from "@capital-q/q-tools";

import { SPOKEN_QUESTIONS } from "./step-copy.js";

/**
 * A proactive onboarding interview (owner requirement 2026-10-16).
 *
 * Q speaks first, warmly, by first name, with what it already knows, and
 * every turn ends in the single most valuable next question from the
 * coverage model's "next" ordering, never "how can I help". When the
 * essentials are in, Q says so, names what is optional and offers to
 * finish or go on. Founders get company questions; investors get mandate
 * questions, because coverage is per journey.
 *
 * Code picks WHAT comes next (coverage); the model words it. The one line
 * code may add is the journey's own question, when a reply would
 * otherwise end without one.
 */

export type FlowNext = {
  readonly stepKey: string;
  readonly question: string;
  readonly optional: boolean;
  readonly confirming: boolean;
};

export type OnboardingFlow = {
  /** Guidance for this turn, for the model's turn notes. */
  readonly note: string;
  /** What to ask next, or null when the essentials are done. */
  readonly next: FlowNext | null;
  readonly essentialsDone: boolean;
  /** Labels of what is still open but optional, for the closing summary. */
  readonly optionalLeft: readonly string[];
};

export function firstNameOf(
  displayName: string | null | undefined,
  /**
   * The company or firm they named at sign-up. QA F-48 (23 Oct): a display
   * name that began with the firm's name greeted them "Audit, you're with
   * Audit Ridge Capital". A first word that is also the organisation's
   * first word may not be a given name, so no name is used: no name is
   * better than a wrong one.
   */
  organisationName?: string | null,
): string | null {
  const first = displayName?.trim().split(/\s+/)[0] ?? "";
  if (first.length < 2 || first.length > 40) return null;
  const organisationFirst =
    organisationName?.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? "";
  return organisationFirst.length > 0 &&
    organisationFirst === first.toLocaleLowerCase()
    ? null
    : first;
}

const quoted = (text: string) => `"${text.replace(/"/g, "'").slice(0, 200)}"`;

export function onboardingFlowFor(input: {
  readonly journey: "founder" | "investor";
  readonly opening: boolean;
  readonly state: OnboardingState;
  readonly firstName: string | null;
  /** What the platform already holds that is worth saying (the company or firm). */
  readonly knownName: string | null;
  /**
   * The open step of the profile section they came to fill (lane ov's
   * Overview link): asked first, before coverage's own next question.
   */
  readonly focusStepKey?: string | null | undefined;
}): OnboardingFlow {
  const { state } = input;
  const byKey = new Map(state.steps.map((s) => [s.stepKey, s]));
  const focused =
    input.focusStepKey === null || input.focusStepKey === undefined
      ? undefined
      : byKey.get(input.focusStepKey);
  const [top] =
    focused !== undefined && focused.status === "OPEN"
      ? [{ stepKey: focused.stepKey, reason: "IMPORTANT_MISSING" as const }]
      : (state.next ?? []);
  const topStep = top === undefined ? undefined : byKey.get(top.stepKey);
  const essentialsOpen = state.steps.some(
    (s) =>
      s.status === "OPEN" &&
      s.savePending !== true &&
      (s.required || s.priority === "ESSENTIAL") &&
      s.coverage !== "KNOWN" &&
      s.coverage !== "CONFIRMED_SAVED" &&
      s.coverage !== "INAPPLICABLE" &&
      s.coverage !== "DEFERRABLE",
  );
  const essentialsDone = !essentialsOpen;
  const optionalLeft = state.steps
    .filter(
      (s) =>
        s.status === "OPEN" &&
        !s.required &&
        s.priority !== "ESSENTIAL" &&
        s.coveredBy === undefined &&
        (s.coverage === "DEFERRABLE" || s.coverage === "MISSING"),
    )
    .map((s) => s.question)
    .slice(0, 4);

  const next: FlowNext | null =
    top === undefined ||
    topStep === undefined ||
    (essentialsDone && top.reason === "OPTIONAL_OFFER")
      ? null
      : {
          stepKey: top.stepKey,
          question: (SPOKEN_QUESTIONS[top.stepKey] ?? topStep.question).slice(
            0,
            300,
          ),
          optional: !topStep.required && topStep.priority !== "ESSENTIAL",
          confirming: top.reason === "CONFIRM_PROPOSAL",
        };

  const minutes = Math.max(1, state.minutesLeft ?? 10);
  const about =
    input.journey === "founder"
      ? "get their company profile ready"
      : "get their investment mandate ready";
  const lines: string[] = [];
  if (input.opening) {
    lines.push(
      `Speak first: open warmly${input.firstName === null ? "" : ` by first name (${input.firstName})`}, in two short sentences at most.${
        input.knownName === null
          ? ""
          : ` Say what you already have: ${quoted(input.knownName)} as their ${input.journey === "founder" ? "company" : "firm"}.`
      } Say you'll ${about} and that it takes about ${String(minutes)} minutes.`,
    );
  } else {
    lines.push(
      "First acknowledge, in one short line, only what a tool result says was saved this turn (never more).",
    );
  }
  if (focused !== undefined && next?.stepKey === focused.stepKey) {
    lines.push(
      "They came here to fill this part of their company profile: ask about it now, before anything else.",
    );
  }
  if (next !== null) {
    lines.push(
      next.confirming
        ? `Then ask them to confirm, in one grouped question, the values on offer (${quoted(next.question)} first).`
        : `Then ask exactly one question, the most valuable one still open after your writes. Before this turn that was ${quoted(next.question)}; if you have just recorded it, ask the next one the tool results list as still open instead, never one already answered.`,
    );
    if (next.optional) {
      lines.push(
        'It is optional: offer to skip it ("we can come back to this").',
      );
    }
    lines.push(
      "Never ask how you can help, never end without that question, and do not interrogate: warm, concise, plain English.",
    );
  } else if (essentialsDone && !state.completed) {
    lines.push(
      `Every essential is covered: say so in one line${
        optionalLeft.length === 0
          ? ""
          : `, sum up in one line what is optional (${optionalLeft.map(quoted).join(", ")})`
      }, and ask whether they would like to finish now or keep going.`,
    );
  }
  return { note: lines.join(" "), next, essentialsDone, optionalLeft };
}

/** Whether a reply already puts a question to the person. */
export function asksSomething(reply: string): boolean {
  return /\?/.test(reply) || /؟/.test(reply);
}

/**
 * The backstop: a non-final reply that asks nothing gets the journey's own
 * next question (or the finish-or-continue question) appended.
 */
export function withNextQuestion(
  reply: string,
  flow: OnboardingFlow,
  completed: boolean,
): string {
  if (completed || asksSomething(reply)) return reply;
  const trimmed = reply.trim();
  if (flow.next !== null) {
    const ask = flow.next.question.endsWith("?")
      ? flow.next.question
      : `${flow.next.question}?`;
    return `${trimmed} ${ask}${flow.next.optional ? " We can come back to this if you'd rather skip it." : ""}`.trim();
  }
  if (flow.essentialsDone) {
    return `${trimmed} Would you like to finish now, or keep going with the optional details?`.trim();
  }
  return reply;
}

/**
 * A question the reply asks that the record already answers (live
 * acceptance 2026-10-16: "...description noted. In a sentence or two, what
 * does the company do?"). Each such sentence, in the journey's own wording,
 * is taken out; the backstop then asks what is really next.
 */
export function withoutAnsweredQuestions(
  reply: string,
  state: OnboardingState,
  spoken: Readonly<Record<string, string>>,
): string {
  const cores: string[] = [];
  for (const step of state.steps) {
    if (step.status !== "ANSWERED") continue;
    for (const wording of [spoken[step.stepKey], step.question]) {
      const core = questionCore(wording);
      if (core !== null) cores.push(core);
    }
  }
  if (cores.length === 0) return reply;
  // Sentence by sentence: an asked sentence that carries an answered
  // question's core is cut back to what comes before it ("Is that right —
  // and, first, what does the company do?" keeps "Is that right?"), or
  // dropped when nothing does (live 2026-10-16, after accepted findings).
  const sentences = reply.match(/[^.?!]+[.?!]*/g) ?? [reply];
  const kept: string[] = [];
  for (const sentence of sentences) {
    const lower = normalWords(sentence);
    const hit = cores.find((core) => lower.includes(core));
    if (hit === undefined || !sentence.includes("?")) {
      kept.push(sentence);
      continue;
    }
    const cut = sentence.search(/\s*(?:[—–;:]|,\s*and\b|\band\b,?\s*first\b)/u);
    const before = cut > 0 ? sentence.slice(0, cut).trim() : "";
    if (
      before.length > 0 &&
      !cores.some((core) => normalWords(before).includes(core))
    ) {
      kept.push(` ${before.replace(/[,\s]+$/u, "")}?`);
    }
  }
  return kept
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Lower-case words only, single-spaced. */
function normalWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The part of a question that identifies it, without a lead-in: "In a
 * sentence or two, what does the company do?" -> "what does the company
 * do". Null when too short to be distinctive.
 */
function questionCore(wording: string | undefined): string | null {
  if (wording === undefined) return null;
  const clauses = wording.split(/[,;:—–]/u);
  const last = normalWords(clauses.at(-1) ?? wording);
  const core = last.split(" ").length >= 3 ? last : normalWords(wording);
  return core.split(" ").length >= 3 ? core : null;
}

/** A sentence that says something went on the record. */
const SAVE_CLAIM =
  /\b(saved|recorded|on (?:your|the) record|noted|captured|logged|stored)\b/iu;

/**
 * Nothing was committed this turn, so nothing may be said to be saved
 * (live 2026-10-16: "$1,200,000 is saved for the raise" with no write;
 * "Noted." for a figure that was refused). Each sentence claiming a save is
 * taken out; where one was, the reply says plainly it is not saved yet.
 */
export function withoutUnbackedSaveClaims(
  reply: string,
  committedThisTurn: boolean,
  /** Said in their place, in the person's language; empty says nothing. */
  notSavedYet = "I haven't saved that yet.",
): string {
  if (committedThisTurn) return reply;
  const sentences = reply.match(/[^.?!]+[.?!]*/g) ?? [reply];
  // What was on the record before this turn may be said to be ("your
  // website is already saved"); only a claim about this turn is checked.
  const kept = sentences.filter(
    (sentence) =>
      !SAVE_CLAIM.test(sentence) ||
      /\b(already|earlier|before|previously)\b/iu.test(sentence),
  );
  if (kept.length === sentences.length) return reply;
  return `${notSavedYet} ${kept.join("").trim()}`.trim();
}

/**
 * A "saved" claim naming a field that is not on the record (live AG
 * 2026-10-16: "I've saved your ... geography, sectors" when neither was
 * written). Each sentence claiming a save that names such a field, by its
 * label, is taken out; what was saved is said only by its own result.
 */
export function withoutUnbackedFieldClaims(
  reply: string,
  /** Labels of fields on their path with nothing on the record. */
  notOnRecord: readonly string[],
): string {
  const terms = notOnRecord
    .map((label) => label.trim().toLowerCase())
    .filter((label) => label.length >= 4)
    .map((label) => label.replace(/s$/u, ""));
  if (terms.length === 0) return reply;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const naming = new RegExp(`\\b(?:${terms.map(escape).join("|")})s?\\b`, "iu");
  const sentences = reply.match(/[^.?!]+[.?!]*/g) ?? [reply];
  const kept = sentences.filter(
    (sentence) =>
      !(
        SAVE_CLAIM.test(sentence) &&
        naming.test(sentence) &&
        !/\b(?:not|haven't|hasn't|isn't|yet)\b/iu.test(sentence)
      ),
  );
  if (kept.length === sentences.length) return reply;
  return kept.join("").trim();
}
