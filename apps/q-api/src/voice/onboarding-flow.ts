import type { OnboardingState } from "@capital-q/q-tools";

import {
  EVIDENCE_QUESTION_FALLBACK,
  EVIDENCE_QUESTIONS,
  SPOKEN_QUESTIONS,
} from "./step-copy.js";

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
  /**
   * Saved already; the ask is for a document that supports it (QA F-132).
   * Not the step's own question, so its controls do not go with it.
   */
  readonly evidence: boolean;
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
          question: (top.reason === "EVIDENCE_NEEDED"
            ? (EVIDENCE_QUESTIONS[top.stepKey] ?? EVIDENCE_QUESTION_FALLBACK)
            : (SPOKEN_QUESTIONS[top.stepKey] ?? topStep.question)
          ).slice(0, 300),
          optional: !topStep.required && topStep.priority !== "ESSENTIAL",
          confirming: top.reason === "CONFIRM_PROPOSAL",
          evidence: top.reason === "EVIDENCE_NEEDED",
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

/** The offer to skip an optional question, as code says it. */
const OPTIONAL_TAIL = "We can come back to this if you'd rather skip it.";

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
    return `${trimmed} ${ask}${flow.next.optional ? ` ${OPTIONAL_TAIL}` : ""}`.trim();
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
    // An answer still saving is answered (live f46ddb69: the website was
    // asked again while its save was queued).
    if (step.status !== "ANSWERED" && step.savePending !== true) continue;
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
  let dropped = false;
  for (const sentence of sentences) {
    // The skip offer belongs to the question it follows: with that
    // question gone, it goes too (QA F-132: "…(sector). We can come back
    // to this if you'd rather skip it." with nothing asked).
    if (dropped && sentence.trim() === OPTIONAL_TAIL) {
      dropped = false;
      continue;
    }
    dropped = false;
    const lower = normalWords(sentence);
    const hit = cores.find((core) => lower.includes(core));
    if (hit === undefined || !sentence.includes("?")) {
      kept.push(sentence);
      continue;
    }
    dropped = true;
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
 * The model's sentences that say again what code's receipt already said
 * (QA 24 Oct: "Got it, I've saved Haddad Gulf Partners (firm). Haddad Gulf
 * Partners is noted."; "…Venture capital fund (how you invest). Venture
 * capital fund is saved as how you invest."). A sentence that claims a save
 * and names a value the receipt said is taken out; a sentence asking
 * something is always kept. The values are the receipt's own, from code.
 */
export function withoutRepeatedReceipt(
  reply: string,
  receiptValues: readonly string[],
): string {
  const values = receiptValues
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 3);
  if (values.length === 0) return reply;
  const sentences = reply.match(/[^.?!]+[.?!]*/g) ?? [reply];
  const kept = sentences.filter((sentence) => {
    if (sentence.includes("?") || !SAVE_CLAIM.test(sentence)) return true;
    const lower = sentence.toLowerCase();
    return !values.some((value) => lower.includes(value));
  });
  if (kept.length === sentences.length) return reply;
  return kept
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "confirmed", "kept", "reflected": a claim that something was settled. */
const SETTLED_CLAIM =
  /\b(?:confirmed|accepted|kept|locked in|all set|reflected|taken care of)\b/iu;
/** What a deck read-back is called in a reply. */
const READING_TERM =
  /\b(?:deck|read[- ]?back|points|document|upload|what (?:i|you) (?:read|found|picked up))\b/iu;

/**
 * A claim that the readings from their document are settled while they
 * are still waiting on the person (QA F-134, 25 Oct: "The deck points are
 * confirmed." with five read-back facts PENDING). The claim is read from
 * state: unless a reading was accepted this turn, any sentence saying the
 * deck's points are confirmed or kept is taken out while readings wait. A
 * sentence asking something is always kept.
 */
export function withoutUnbackedReadingClaims(
  reply: string,
  state: { readonly acceptedThisTurn: boolean; readonly stillWaiting: number },
): string {
  if (state.acceptedThisTurn || state.stillWaiting === 0) return reply;
  const sentences = reply.match(/[^.?!]+[.?!]*/g) ?? [reply];
  const kept = sentences.filter(
    (sentence) =>
      sentence.includes("?") ||
      !(SETTLED_CLAIM.test(sentence) && READING_TERM.test(sentence)),
  );
  if (kept.length === sentences.length) return reply;
  return kept
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A claim that something was excluded, filtered, matched or saved. */
const CATEGORY_CLAIM =
  /\b(?:exclud\w*|filter\w*|ruled out|never (?:be )?shown|matched|saved|recorded|noted)\b/iu;
/** The sentence says the opposite: not matched, not a category. */
const NOT_CLAIMED =
  /\b(?:not|couldn't|could not|no category|didn't|did not|isn't|wasn't|as you said it)\b/iu;

/**
 * A claim that their words were saved as a category when no category
 * matched them (QA F-137: "The exclusions are now saved as sectors to
 * exclude outright: crypto and gambling" with only Gambling saved; "crypto"
 * was kept in their words). Each sentence claiming an exclusion or save
 * that names such words is taken out, unless it says they did not match.
 * A sentence asking something is always kept.
 */
export function withoutUnbackedCategoryClaims(
  reply: string,
  keptInWords: readonly string[],
): string {
  const words = keptInWords
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3);
  if (words.length === 0) return reply;
  const sentences = reply.match(/[^.?!]+[.?!]*/g) ?? [reply];
  const kept = sentences.filter((sentence) => {
    if (sentence.includes("?")) return true;
    const lower = sentence.toLowerCase();
    return !(
      CATEGORY_CLAIM.test(sentence) &&
      !NOT_CLAIMED.test(sentence) &&
      words.some((w) => lower.includes(w))
    );
  });
  if (kept.length === sentences.length) return reply;
  return kept
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
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

/** A sentence of Q's saying something is saved, kept or set up. */
const KEPT_CLAIM =
  /\b(saved|recorded|on (?:your|the) record|noted|captured|logged|stored|kept|set up|locked in|all set)\b/iu;

/**
 * Only what COMMITTED is confirmed (live 2026-10-28: "Your $50k–$100k cheque
 * range is kept." for a change that was only queued, and "Harmattan Angels
 * is set up" with no firm). Each of Q's sentences claiming a save that names
 * a field still being saved is taken out, and one line of code's own says
 * what is still saving; the next turn confirms it. A question is kept. The
 * labels are the journey's own; the sentences are Q's, never the person's.
 */
export function withStillSaving(
  reply: string,
  /** Labels of fields whose save is queued, not committed. */
  savingLabels: readonly string[],
): string {
  const labels = [
    ...new Set(savingLabels.map((l) => l.trim()).filter((l) => l.length > 0)),
  ];
  if (labels.length === 0) return reply;
  const terms = labels.flatMap((label) => {
    const lower = label.toLowerCase();
    const head = lower.split(/\s+/u).at(-1) ?? lower;
    return head.length >= 4 && head !== lower ? [lower, head] : [lower];
  });
  const names = (sentence: string) => {
    const lower = sentence.toLowerCase();
    return terms.some((term) => lower.includes(term));
  };
  const sentences = reply.match(/[^.?!]+[.?!]*/g) ?? [reply];
  const kept = sentences.filter(
    (sentence) =>
      sentence.includes("?") || !(KEPT_CLAIM.test(sentence) && names(sentence)),
  );
  const line = `Still saving your ${spokenList(labels.map((l) => l.toLowerCase()))}; I'll confirm once ${labels.length === 1 ? "it's" : "they're"} in.`;
  // Before the closing question, so the reply still ends by asking it.
  const last = kept.at(-1);
  const body =
    last !== undefined && last.includes("?")
      ? [...kept.slice(0, -1), ` ${line} `, last]
      : [...kept, ` ${line}`];
  return body
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "a", "a and b", "a, b and c". */
function spokenList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/**
 * What code says when they pause ("I'll continue this later"; owner
 * 2026-10-28): one short line, what is saved and what is still open, and
 * that Q carries on from here. No question: the screen then takes them
 * into the app, as the Continue later button does.
 */
export function pausingLine(
  journey: "founder" | "investor",
  state: OnboardingState,
  labelOf: (stepKey: string) => string | undefined,
): string {
  const saved = state.steps.filter((s) => s.status === "ANSWERED").length;
  const open = state.steps
    .filter((s) => s.status === "OPEN" && s.required && s.kind !== "YES_NO")
    .map((s) => labelOf(s.stepKey)?.toLowerCase() ?? s.question);
  const named = open.slice(0, 4);
  const more = open.length - named.length;
  const stillOpen =
    open.length === 0
      ? "nothing required is still open"
      : `still open: ${spokenList(named)}${more > 0 ? ` and ${String(more)} more` : ""}`;
  const into =
    journey === "investor"
      ? "Discover already works from what you've told me"
      : "your home page is ready";
  return `Of course. ${saved === 1 ? "One thing" : `${String(saved)} things`} you've told me ${saved === 1 ? "is" : "are"} saved, and ${stillOpen}. Pick this up whenever you like; I'll carry on from here, and ${into}.`;
}

/** Why finishing waits: what is left is answered and still being saved. */
export const STILL_SAVING_FINISH_REASON =
  "Everything needed is answered, and some of it is still being saved; finishing waits until it is.";

/**
 * Why finishing stopped short of a review step: its read-back has not been
 * shown. The caller reads back what is saved and asks for their yes.
 */
export const REVIEW_NOT_SHOWN_REASON =
  "The review has not been shown to them yet: read back what is saved and ask if it is right; finish on their yes.";

/**
 * What code says when they asked to finish (typed, live 2026-10-28, D3).
 * Finished: one line that it is done. Not yet: one line naming exactly
 * which required things are still open, then the first of them asked.
 * Null when the port could not say what is missing: the model's reply
 * stands. No "we'll pause here", and nothing about leaving.
 */
export function finishingLine(
  journey: "founder" | "investor",
  finished: {
    readonly completed: boolean;
    readonly missing: readonly {
      readonly stepKey: string;
      readonly question: string;
    }[];
    readonly reason?: string | undefined;
  },
  copy: {
    readonly labelOf: (stepKey: string) => string | undefined;
    readonly questionOf: (stepKey: string) => string | null;
    /**
     * What is saved, "Label: value" each, and the review step to ask: for a
     * review not shown yet, the read-back the person says yes to.
     */
    readonly review?:
      | { readonly saved: readonly string[]; readonly stepKey: string }
      | undefined;
  },
): { readonly reply: string; readonly asking: string | null } | null {
  if (
    !finished.completed &&
    finished.reason === REVIEW_NOT_SHOWN_REASON &&
    copy.review !== undefined
  ) {
    // Every saved essential, grouped by the setup's own sections (bounded
    // by reviewOf), never a prefix cut at a count (production re-test
    // 2026-10-28: the founder's read-back stopped at paying customers and
    // left out revenue, its currency, the raise and the instrument).
    const saved = copy.review.saved
      .map((line) => line.trim().replace(/[.;\s]+$/u, ""))
      .filter((line) => line.length > 0);
    return {
      reply: `Here's what I have saved: ${saved.length === 0 ? "nothing yet" : saved.join(". ")}. Is that all right? Say yes and I'll finish, or tell me what to change.`,
      asking: copy.review.stepKey,
    };
  }
  if (!finished.completed && finished.reason === STILL_SAVING_FINISH_REASON) {
    return {
      reply:
        "That's everything I need from you. A few of your answers are still being saved; I'll finish your setup as soon as they're in.",
      asking: null,
    };
  }
  if (finished.completed) {
    return {
      reply:
        journey === "investor"
          ? "That's everything I need. Your mandate is saved and live: Discover will show you companies matched to it."
          : "That's everything I need. Your company profile is saved, and investors who fit will now be matched to it.",
      asking: null,
    };
  }
  const [first] = finished.missing;
  if (first === undefined) return null;
  // The setup's own spoken question, never its internal field labels
  // (production re-test 2026-10-28: "I still need 2 things: discovery and
  // inbound"). The rest are asked in turn, one at a time.
  const count =
    finished.missing.length === 1
      ? "one more answer from you"
      : `${String(finished.missing.length)} more answers from you, starting with this one`;
  const question = (copy.questionOf(first.stepKey) ?? first.question).trim();
  return {
    reply: `Before I can finish, I still need ${count}. ${question.endsWith("?") ? question : `${question}?`}`,
    asking: first.stepKey,
  };
}
