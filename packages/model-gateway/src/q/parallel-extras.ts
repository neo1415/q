import type { ModelMessage } from "@capital-q/contracts";
import type { CompanyAnalystV26Result } from "@capital-q/q-core";

/**
 * Owner 2026-10-22: the answer and its extras are written at the same
 * time.
 *
 * The answer prose is 14-29% of the analyst's object and streams first;
 * the findings and cards after it are most of the rest (round 5b output
 * split), and a person waits for them. So while one call writes the
 * answer, a second call, given the same messages, writes only the
 * findings and the cards.
 *
 * The cost was the owner's call: the second call reads the whole context
 * again (about 44k input tokens a turn), so input spend per typed turn
 * roughly doubles. It is switched by `parallelExtras` (q-api:
 * CQ_Q_PARALLEL_EXTRAS=off turns it off).
 *
 * Two writers can disagree, so code checks the pair before they are
 * joined (`joinExtras`). The set-wide checks the message already runs
 * (result-blocks.ts) then run over the joined set, as they would over
 * one call's.
 */

/** Told to the answer's writer, on turns that split. */
export const EXTRAS_ELSEWHERE_NOTE: ModelMessage = {
  role: "SYSTEM",
  content:
    "A second writer, working from these same facts at the same time, writes this turn's findings and cards. Leave `findings`, `answerCards` and `comparisonCards` out of your object and write everything else as usual. Do not say in the answer that cards or findings follow.",
};

/**
 * Coordinator 2026-10-25 (I21): told to the one writer of a comparison
 * code resolved, which has no extras' writer. The table and its verdict
 * are Capital Q's and go out with the answer; cards and findings would
 * only restate them.
 */
export const TABLE_IS_THE_COMPARISON: ModelMessage = {
  role: "SYSTEM",
  content:
    "Capital Q shows this comparison's table on their screen with the answer, and its verdict leads it. Leave `findings`, `answerCards` and `comparisonCards` out of your object and write everything else as usual. Do not say in the answer that a table or cards follow.",
};

/** Told to the extras' writer, in place of the note above. */
export const EXTRAS_ONLY_NOTE: ModelMessage = {
  role: "SYSTEM",
  content:
    "Another writer is writing this turn's answer prose now, from the same facts. Your object is for its `findings` and, where the question compares or ranks companies, its `answerCards` or `comparisonCards`, under the same rules as always: every finding stands on the facts and tool results above, with its truth class and evidence status. Set `answer` to one short sentence stating the main point, which nobody reads, `responseShape` and `insufficientEvidence` as you judge them and `recommendation` to null. Leave every other field out. Call no tool.",
};

/** The extras' writer's messages: the round's own, with its note swapped. */
export function extrasMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  return [
    ...messages.filter((message) => message !== EXTRAS_ELSEWHERE_NOTE),
    EXTRAS_ONLY_NOTE,
  ];
}

export type ExtrasJoin =
  | "JOINED"
  /** The answer wrote its own; one writer's set is never mixed with another's. */
  | "ANSWER_OWN"
  /** The answer asked, or declined: it committed to nothing extras could support. */
  | "ANSWER_UNCOMMITTED"
  /** The extras' call failed, was cancelled or wrote nothing usable. */
  | "NO_EXTRAS";

type Extras = Pick<
  CompanyAnalystV26Result,
  "findings" | "answerCards" | "comparisonCards"
>;

/**
 * The numbers a text states, each in the forms a source might hold it:
 * "$1.2M" is "1.2" and "1200000"; "45%" is "45". Digits only, so a
 * currency sign or a thousands separator never matters.
 */
export function statedNumbers(text: string): readonly (readonly string[])[] {
  const found: (readonly string[])[] = [];
  const pattern =
    /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|mn|bn|b|million|billion|thousand)?\b/giu;
  for (const match of text.matchAll(pattern)) {
    const whole = (match[1] ?? "").replace(/,/gu, "");
    const fraction = match[2] ?? "";
    const literal = fraction.length > 0 ? `${whole}.${fraction}` : whole;
    // A lone digit (a list position, "one of 3") says nothing checkable.
    if (literal.length < 2) continue;
    const forms = [literal];
    const suffix = (match[3] ?? "").toLowerCase();
    const scale =
      suffix === "k" || suffix === "thousand"
        ? 3
        : suffix === "m" || suffix === "mn" || suffix === "million"
          ? 6
          : suffix === "b" || suffix === "bn" || suffix === "billion"
            ? 9
            : 0;
    if (scale > 0) {
      const digits = `${whole}${fraction}`;
      const zeros = scale - fraction.length;
      if (zeros >= 0) forms.push(`${digits}${"0".repeat(zeros)}`);
    }
    found.push(forms);
  }
  return found;
}

/**
 * A number the extras' writer stated that is in neither the answer nor
 * anything both writers were given. One writer would have had to invent
 * it, and the two writers then say different things.
 */
function groundedIn(statement: string, known: ReadonlySet<string>): boolean {
  return statedNumbers(statement).every((forms) =>
    forms.some((form) => known.has(form)),
  );
}

/**
 * The answer with the extras' findings and cards, after the pair checks:
 *
 * - an answer that asked a question back or declined keeps no extras;
 * - a field the answer wrote itself is kept as the answer wrote it;
 * - a finding stating a number found in neither the answer nor the
 *   messages both writers read is left out.
 */
export function joinExtras(
  answer: CompanyAnalystV26Result,
  extras: Extras | null,
  read: readonly ModelMessage[],
): {
  readonly value: CompanyAnalystV26Result;
  readonly join: ExtrasJoin;
  readonly ungrounded: number;
} {
  if (answer.declined || answer.clarifyingQuestions.length > 0) {
    return { value: answer, join: "ANSWER_UNCOMMITTED", ungrounded: 0 };
  }
  if (
    answer.findings.length > 0 ||
    answer.answerCards !== null ||
    answer.comparisonCards !== null
  ) {
    return { value: answer, join: "ANSWER_OWN", ungrounded: 0 };
  }
  if (
    extras === null ||
    (extras.findings.length === 0 &&
      extras.answerCards === null &&
      extras.comparisonCards === null)
  ) {
    return { value: answer, join: "NO_EXTRAS", ungrounded: 0 };
  }
  // Every form of every number either writer was given, or the answer said.
  const known = new Set(
    statedNumbers(
      [answer.answer, ...read.map((message) => message.content)].join("\n"),
    ).flat(),
  );
  const findings = extras.findings.filter((finding) =>
    groundedIn(finding.statement, known),
  );
  return {
    value: {
      ...answer,
      findings,
      answerCards: extras.answerCards,
      comparisonCards: extras.comparisonCards,
    },
    join: "JOINED",
    ungrounded: extras.findings.length - findings.length,
  };
}
