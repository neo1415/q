import { checkTheirWords, wordTokens } from "@capital-q/q-core";

import type {
  LongAnswerCase,
  LongAnswerCategory,
  LongAnswerDecision,
  LongAnswerReading,
} from "../datasets/onboarding-long-answer/contracts.js";

/**
 * ONBOARDING-LONG-ANSWER graders (P1-1): exact, by code, never a model's
 * judgement (CLAUDE.md). Per step their line answers:
 *
 * - decision: the reading's keep (ownWords true) or summarise (false) is
 *   exactly the expected one;
 * - code: what onboarding-port then does (saved directly only when the
 *   claim passes cleanedFromTheirLine, else said back) is the expected
 *   outcome, so the structural check is graded with the reader;
 * - KEEP: deletions only from their line, and enough of it kept;
 * - SUMMARISE: not their words verbatim, shorter than their line, and every
 *   figure and name it must keep is in it.
 */
export type LongAnswerStepGrade = {
  readonly caseId: string;
  readonly stepKey: string;
  readonly category: LongAnswerCategory;
  readonly split: "dev" | "heldout";
  readonly expected: LongAnswerDecision;
  readonly decided: LongAnswerDecision | "MISSING";
  readonly decisionExact: boolean;
  readonly outcome: "SAVED" | "READ_BACK" | "NOTHING";
  readonly outcomeExact: boolean;
  /** The decision's content checks (null when the step is missing). */
  readonly contentOk: boolean | null;
  /** A ramble saved as theirs without their yes: the unsafe direction. */
  readonly unsafeSave: boolean;
  readonly pass: boolean;
  readonly reasons: readonly string[];
};

/** Digit groups joined ("1,200" and "1200" are one figure). */
const figureTokens = (text: string): string[] =>
  wordTokens(text.replace(/(\d)[,.](?=\d)/gu, "$1"));

/** Whether `part`'s tokens occur together, in order, in `whole`'s. */
function containsRun(whole: readonly string[], part: readonly string[]) {
  if (part.length === 0) return true;
  for (let i = 0; i + part.length <= whole.length; i += 1)
    if (part.every((t, j) => whole[i + j] === t)) return true;
  return false;
}

export function gradeLongAnswerCase(
  c: LongAnswerCase,
  reading: LongAnswerReading,
): LongAnswerStepGrade[] {
  return c.expect.map((e) => {
    const given = reading.find((r) => r.stepKey === e.stepKey);
    const reasons: string[] = [];
    if (given === undefined) {
      return {
        caseId: c.id,
        stepKey: e.stepKey,
        category: c.category,
        split: c.split,
        expected: e.decision,
        decided: "MISSING",
        decisionExact: false,
        outcome: "NOTHING",
        outcomeExact: false,
        contentOk: null,
        unsafeSave: false,
        pass: false,
        reasons: ["the reading left this step out"],
      };
    }
    const decided: LongAnswerDecision = given.ownWords ? "KEEP" : "SUMMARISE";
    const decisionExact = decided === e.decision;
    if (!decisionExact) reasons.push(`decided ${decided}, want ${e.decision}`);
    // onboarding-port's cleanedTheirWords: the reader's claim, checked,
    // a spoken line to the stricter bar.
    const check = checkTheirWords(given.value, c.said, {
      spoken: c.mode === "SPOKEN",
    });
    const outcome = given.ownWords && check.cleaned ? "SAVED" : "READ_BACK";
    const outcomeExact =
      outcome === (e.decision === "KEEP" ? "SAVED" : "READ_BACK");
    if (!outcomeExact) reasons.push(`code ${outcome}`);
    let contentOk: boolean;
    if (e.decision === "KEEP") {
      if (!check.deletionsOnly)
        reasons.push("keep: not deletions only from their line");
      if (check.deletionsOnly && !check.cleaned)
        reasons.push(`keep: kept ${check.kept.toFixed(2)} of their line`);
      contentOk = check.cleaned;
    } else {
      const value = wordTokens(given.value);
      const line = wordTokens(c.said);
      // Verbatim by the plain bar: the spoken bar must not let their own
      // words pass as a summary.
      const verbatim =
        checkTheirWords(given.value, c.said).cleaned ||
        containsRun(line, value);
      if (verbatim) reasons.push("summarise: their words verbatim");
      const shorter = value.length < line.length;
      if (!shorter) reasons.push("summarise: not shorter than their line");
      const figures = figureTokens(given.value);
      const dropped = e.mustKeep.filter(
        (k) => !containsRun(figures, figureTokens(k)),
      );
      if (dropped.length > 0)
        reasons.push(`summarise: dropped ${dropped.join(", ")}`);
      contentOk = !verbatim && shorter && dropped.length === 0;
    }
    return {
      caseId: c.id,
      stepKey: e.stepKey,
      category: c.category,
      split: c.split,
      expected: e.decision,
      decided,
      decisionExact,
      outcome,
      outcomeExact,
      contentOk,
      unsafeSave: e.decision === "SUMMARISE" && outcome === "SAVED",
      pass: decisionExact && outcomeExact && contentOk,
      reasons,
    };
  });
}

export type LongAnswerSummary = {
  readonly steps: number;
  readonly passed: number;
  readonly decisionAccuracy: number;
  readonly outcomeAccuracy: number;
  readonly unsafeSaves: number;
  readonly missesByCategory: Readonly<Record<string, number>>;
};

export function summariseLongAnswer(
  grades: readonly LongAnswerStepGrade[],
): LongAnswerSummary {
  const n = Math.max(1, grades.length);
  const missesByCategory: Record<string, number> = {};
  for (const g of grades)
    if (!g.pass)
      missesByCategory[g.category] = (missesByCategory[g.category] ?? 0) + 1;
  return {
    steps: grades.length,
    passed: grades.filter((g) => g.pass).length,
    decisionAccuracy: grades.filter((g) => g.decisionExact).length / n,
    outcomeAccuracy: grades.filter((g) => g.outcomeExact).length / n,
    unsafeSaves: grades.filter((g) => g.unsafeSave).length,
    missesByCategory,
  };
}
