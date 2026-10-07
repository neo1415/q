import {
  FIT_BAND_LABELS,
  FIT_PARAMETER_LABELS,
  FitProfileDtoSchema,
  QAnswerCardsBlockSchema,
  fitScoreOutOf10,
  type FitProfileDto,
  type QAnswerCard,
  type QAnswerCardLevel,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import { nameKey } from "./card-subjects.js";

/**
 * Answer cards built by code from the fits this run's own tools returned
 * (Zino live 2026-10-07: "list the companies… and their scores against
 * the mandate, with pros and cons" came back as a wall of "Pros: … Cons:
 * …" with no names and no cards).
 *
 * The fit, its score out of 10 and its reasons are the platform's own
 * (`fit.profile` / `fit.top_candidates`, ranking-config, ADR 0052/0059),
 * so nothing here is a model's opinion: the model chose which companies
 * to look at, code says how each one fits. Used when the model's own card
 * set is missing; a model card set, when it came, is kept.
 */

export type RunFit = {
  readonly companyId: string;
  readonly name: string;
  readonly line: string | null;
  readonly profile: FitProfileDto;
};

/** Every fit one tool outcome carries, read through the contract. */
export function fitsInOutcome(
  outcome: Pick<QToolCallOutcome, "toolName" | "result">,
): RunFit[] {
  if (!outcome.result.ok) return [];
  const data = outcome.result.data as {
    readonly status?: unknown;
    readonly name?: unknown;
    readonly profile?: unknown;
    readonly comparison?: { readonly entries?: unknown } | null;
  } | null;
  if (data === null || typeof data !== "object" || data.status !== "OK") {
    return [];
  }
  if (outcome.toolName === "fit.profile") {
    const profile = FitProfileDtoSchema.safeParse(data.profile);
    if (!profile.success || typeof data.name !== "string") return [];
    return [
      {
        companyId: profile.data.companyId,
        name: data.name,
        line: null,
        profile: profile.data,
      },
    ];
  }
  if (outcome.toolName === "fit.top_candidates") {
    const entries = Array.isArray(data.comparison?.entries)
      ? (data.comparison.entries as unknown[])
      : [];
    return entries.flatMap((entry) => {
      const row = entry as {
        readonly name?: unknown;
        readonly line?: unknown;
        readonly profile?: unknown;
      };
      const profile = FitProfileDtoSchema.safeParse(row.profile);
      if (!profile.success || typeof row.name !== "string") return [];
      return [
        {
          companyId: profile.data.companyId,
          name: row.name,
          line: typeof row.line === "string" ? row.line : null,
          profile: profile.data,
        },
      ];
    });
  }
  return [];
}

/** The fits each run's tools returned, by run, bounded like the companies. */
export function createRunFits(limit = 200) {
  const runs = new Map<string, Map<string, RunFit>>();
  return {
    note(
      runId: string,
      outcome: Pick<QToolCallOutcome, "toolName" | "result">,
    ): void {
      const found = fitsInOutcome(outcome);
      if (found.length === 0) return;
      let known = runs.get(runId);
      if (known === undefined) {
        known = new Map();
        runs.set(runId, known);
        if (runs.size > limit) {
          const oldest = runs.keys().next().value;
          if (oldest !== undefined) runs.delete(oldest);
        }
      }
      for (const fit of found) known.set(fit.companyId, fit);
    },
    read(runId: string): readonly RunFit[] {
      return [...(runs.get(runId)?.values() ?? [])];
    },
    take(runId: string): readonly RunFit[] {
      const known = [...(runs.get(runId)?.values() ?? [])];
      runs.delete(runId);
      return known;
    },
  };
}

const LEVEL: Readonly<Record<string, QAnswerCardLevel | null>> = {
  STRONG: "STRONG",
  PARTIAL: "PARTIAL",
  UNKNOWN: "UNKNOWN",
  // No card level says "does not fit"; a mismatch is a reason, never a
  // softened measure.
  MISMATCH: null,
};

const MEASURES_MAX = 8;

function sentence(text: string): string {
  const trimmed = text.trim().slice(0, 158);
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function cardOf(fit: RunFit): Omit<QAnswerCard, "key" | "hue"> {
  const score = fitScoreOutOf10(fit.profile);
  const band = FIT_BAND_LABELS[fit.profile.band];
  const pros = fit.profile.topReasons
    .filter((reason) => reason.outcome === "STRONG")
    .map((reason) => sentence(reason.reason));
  const mismatch = fit.profile.mainMismatch;
  const unknown = fit.profile.parameters.find(
    (parameter) => parameter.applicable && parameter.outcome === "UNKNOWN",
  );
  const con =
    mismatch !== null
      ? sentence(mismatch.reason)
      : unknown === undefined
        ? null
        : sentence(`${FIT_PARAMETER_LABELS[unknown.parameter]} not known yet`);
  const reasons = [...pros.slice(0, con === null ? 3 : 2)];
  if (con !== null) reasons.push(con);
  const measures = fit.profile.parameters
    .filter((parameter) => parameter.applicable)
    .flatMap((parameter) => {
      const level = LEVEL[parameter.outcome] ?? null;
      return level === null
        ? []
        : [
            {
              label: FIT_PARAMETER_LABELS[parameter.parameter],
              level,
              value: null,
            },
          ];
    })
    .slice(0, MEASURES_MAX);
  const known = measures.filter((measure) => measure.level !== "UNKNOWN");
  const numeric = score === null ? null : Number(score);
  return {
    name: fit.name.slice(0, 80),
    line: (fit.line ?? band).slice(0, 140),
    fit:
      numeric === null || !Number.isFinite(numeric) || known.length === 0
        ? null
        : {
            score: numeric,
            measured: known.length,
            of: Math.max(known.length, measures.length),
          },
    reasons: reasons.length > 0 ? reasons : [sentence(band)],
    measures,
    view: null,
    said:
      score === null
        ? `${fit.name}: ${band.toLowerCase()}.`
        : `${fit.name} is ${score} out of 10, a ${band.toLowerCase()}.`,
    sourceCount: 0,
    subject: { kind: "COMPANY", companyId: fit.companyId },
  };
}

/**
 * The ranked cards for the fits in hand, highest score first; null when
 * there are fewer than two (one company is an answer, not a list).
 * Restricted to the companies the answer names when it names any.
 */
export function fitAnswerCardsBlock(
  fits: readonly RunFit[],
  answer: string,
): QAnswerCardsBlock | null {
  const said = nameKey(answer);
  const named = fits.filter((fit) => {
    const key = nameKey(fit.name);
    return key.length > 0 && said.includes(key);
  });
  const chosen = named.length >= 2 ? named : fits;
  if (chosen.length < 2) return null;
  const scored = chosen
    .map((fit, index) => ({ fit, index, card: cardOf(fit) }))
    .sort(
      (a, b) =>
        (b.card.fit?.score ?? -1) - (a.card.fit?.score ?? -1) ||
        a.index - b.index,
    )
    .slice(0, 10);
  const taken = new Set<string>();
  const cards = scored.map(({ card }, at) => {
    let key = nameKey(card.name).slice(0, 48) || "card";
    for (let n = 2; taken.has(key); n += 1) key = `${key}-${String(n)}`;
    taken.add(key);
    return { ...card, key, hue: (at % 7) + 1 };
  });
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title: "Fit against your mandate",
    cards,
    followUps: [],
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The scores and bands Capital Q itself computed this run, so a sentence
 * repeating one ("Portside: 7.5/10, good fit") is not mistaken for an
 * invented score (ADR 0059: the fit tool tells the model to say exactly
 * that, and the recommendation guard used to delete it, names and all).
 */
export function groundedFitWords(fits: readonly RunFit[]): readonly string[] {
  const words = new Set<string>();
  for (const fit of fits) {
    const score = fitScoreOutOf10(fit.profile);
    if (score !== null) {
      words.add(`${score}/10`);
      words.add(`${score} out of 10`);
      words.add(`${score} / 10`);
    }
    words.add(FIT_BAND_LABELS[fit.profile.band].toLowerCase());
  }
  return [...words];
}

/**
 * A short spoken summary of cards code built, for an answer whose words
 * lost their names (orphan "Pros: …" sentences after the guard): the
 * gist, the best two by name, and that the detail is on screen.
 */
export function fitCardsSummary(block: QAnswerCardsBlock): string {
  const best = block.cards.slice(0, 2).map((card) => card.name);
  const count = block.cards.length;
  const lead =
    best.length === 2
      ? `${best[0] ?? ""} and ${best[1] ?? ""} fit your mandate best`
      : `${best[0] ?? ""} fits your mandate best`;
  return `I've scored ${String(count)} companies against your mandate. ${lead}. They're on screen with the pros and cons for each.`;
}

/** Sentences that read as a list item whose name was lost. */
export function hasOrphanListItems(text: string): boolean {
  return /(?:^|[.!?]\s+)(?:Pros?|Cons?)\s*:/u.test(text);
}
