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
): string | null {
  const first = displayName?.trim().split(/\s+/)[0] ?? "";
  return first.length >= 2 && first.length <= 40 ? first : null;
}

const quoted = (text: string) => `"${text.replace(/"/g, "'").slice(0, 200)}"`;

export function onboardingFlowFor(input: {
  readonly journey: "founder" | "investor";
  readonly opening: boolean;
  readonly state: OnboardingState;
  readonly firstName: string | null;
  /** What the platform already holds that is worth saying (the company or firm). */
  readonly knownName: string | null;
}): OnboardingFlow {
  const { state } = input;
  const byKey = new Map(state.steps.map((s) => [s.stepKey, s]));
  const [top] = state.next ?? [];
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
  if (next !== null) {
    lines.push(
      next.confirming
        ? `Then ask them to confirm, in one grouped question, the values on offer (${quoted(next.question)} first).`
        : `Then ask exactly one question, the most valuable one now: ${quoted(next.question)}.`,
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
