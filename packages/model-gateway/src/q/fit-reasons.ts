import {
  fitScoreOutOf10,
  type FitOutcome,
  type FitParameter,
} from "@capital-q/contracts";

import type { RunFit } from "./fit-cards.js";

/**
 * Why the companies just ranked fit (owner live 17 Nov 2026, conversation
 * 9995dcca, run 333d9645). "So, why are they the strongest fits? Don't
 * just repeat the descriptions" came back as the same ranked list and the
 * same tie line. A "why" about the list just shown is answered with the
 * reasons: each top company's measures from its stored fit profile --
 * which matched, which only partly, which miss, which are not known -- in
 * words code writes from the levels alone. No re-ranking, no tie line, no
 * card set (the cards are already on screen), no number a model made.
 */

/** Companies explained at most; the rest of the list is on screen. */
export const FIT_REASONS_MAX = 5;

const SPOKEN: Readonly<Record<FitParameter, string>> = {
  STAGE: "stage",
  SECTOR: "sector",
  GEOGRAPHY: "geography",
  CHEQUE_SIZE: "cheque size",
  BUSINESS_MODEL: "business model",
  TRACTION: "traction",
  TEAM: "team",
  THESIS: "thesis",
  ROUND_TERMS: "round terms",
};

function listed(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

function scoreOf(fit: RunFit): string | null {
  return fitScoreOutOf10(fit.profile);
}

/**
 * The companies a "why" is about: the leading score's whole tie, at least
 * the first three, at most FIT_REASONS_MAX, in the order shown.
 */
export function reasonSubjects(fits: readonly RunFit[]): readonly RunFit[] {
  const first = fits[0];
  if (first === undefined) return [];
  const top = scoreOf(first);
  let n = 1;
  while (
    n < fits.length &&
    top !== null &&
    scoreOf(fits[n] as RunFit) === top
  ) {
    n += 1;
  }
  return fits.slice(0, Math.min(Math.max(n, 3), FIT_REASONS_MAX));
}

type Measures = Readonly<Record<FitOutcome, readonly string[]>>;

function measuresOf(fit: RunFit): Measures {
  const out: Record<FitOutcome, string[]> = {
    STRONG: [],
    PARTIAL: [],
    MISMATCH: [],
    UNKNOWN: [],
  };
  for (const row of fit.profile.parameters) {
    // A parameter they declared no preference on counts for nothing.
    if (!row.applicable) continue;
    out[row.outcome].push(SPOKEN[row.parameter]);
  }
  return out;
}

/**
 * The spoken reasons for the companies just ranked; null when there is
 * nothing to say from their profiles (the full path answers then).
 */
export function fitReasonsAnswer(fits: readonly RunFit[]): string | null {
  const subjects = reasonSubjects(fits);
  if (subjects.length === 0) return null;
  // Companies with the same measures are said together, once.
  const groups = new Map<
    string,
    { names: string[]; scores: Set<string>; measures: Measures }
  >();
  for (const fit of subjects) {
    const measures = measuresOf(fit);
    const key = JSON.stringify(measures);
    const group = groups.get(key) ?? {
      names: [],
      scores: new Set<string>(),
      measures,
    };
    group.names.push(fit.name);
    group.scores.add(scoreOf(fit) ?? "none");
    groups.set(key, group);
  }
  const sentences: string[] = [];
  for (const { names, scores, measures } of groups.values()) {
    const many = names.length > 1;
    const who = listed(names);
    const parts: string[] = [];
    if (measures.STRONG.length > 0) {
      parts.push(
        `${many ? "match" : "matches"} your mandate on ${listed(measures.STRONG)}`,
      );
    }
    if (measures.PARTIAL.length > 0) {
      parts.push(`only partly on ${listed(measures.PARTIAL)}`);
    }
    if (measures.MISMATCH.length > 0) {
      parts.push(
        `${many ? "fall" : "falls"} outside it on ${listed(measures.MISMATCH)}`,
      );
    }
    const known =
      measures.STRONG.length +
      measures.PARTIAL.length +
      measures.MISMATCH.length;
    if (known === 0) {
      sentences.push(
        `For ${who}, nothing on your mandate is known yet beyond what makes ${many ? "them" : "it"} eligible.`,
      );
      continue;
    }
    const score = scores.size === 1 ? [...scores][0] : undefined;
    const allStrong =
      measures.PARTIAL.length === 0 && measures.MISMATCH.length === 0;
    // Why the number is what it is, from the levels: every measure known
    // is a strong match. Said only when that is so and the score is one.
    const because =
      allStrong && score !== undefined && score !== "none"
        ? `; every measure on record is a strong match, which is why ${many ? "they're" : "it's"} at ${score}`
        : "";
    sentences.push(`${who} ${parts.join(", ")}${because}.`);
    if (measures.UNKNOWN.length > 0) {
      const unknown = listed(measures.UNKNOWN);
      sentences.push(
        `${unknown.charAt(0).toUpperCase()}${unknown.slice(1)} ${measures.UNKNOWN.length === 1 ? "isn't" : "aren't"} known yet for ${many ? (names.length === 2 ? "either" : "any of them") : "it"}.`,
      );
    }
  }
  sentences.push("That's fit with your mandate, not a judgement of quality.");
  return sentences.join(" ");
}
