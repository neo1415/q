import { z } from "zod";

import {
  saidByThem,
  STATED_FIGURE_METRICS,
  type StatedFigureMetric,
} from "@capital-q/evidence";
import { StatedFigureReadingSchema } from "@capital-q/q-core";

/**
 * A8 (live 14 Nov 2026, founder.maji-loop on 4d5ab3ac2 and before it on
 * 3293f344e): "Actually October MRR was $110k." went down the tool path
 * with the figure tool offered, the model called no tool and put the
 * figure only in its structured output, and Q said "I haven't saved that
 * yet." with no card. Prompt wording did not make the call reliable.
 *
 * So the figure the run itself read (COMPANY_ANALYST v33 `statedFigures`:
 * metric, amount, currency as stated, period, their words) becomes the
 * figure tool's own arguments when the run did not call it. Code then
 * calls that tool through the run's tool port, exactly as the model would
 * have: the app action's authorize step (their own company only), its
 * check of the quote against their words, no assumed currency, no future
 * date, and the clash with a figure already recorded named on the card.
 * Nothing is recorded until they approve that card. The reading is never
 * written by itself, and no model call is added.
 */
export const STATED_FIGURE_TOOL = "propose_company_figure";

/** The figure tool's arguments (app-actions company-figures RecordTool). */
export type StatedFigureToolArguments = {
  readonly metric: StatedFigureMetric;
  readonly amount: number;
  readonly currency?: string;
  readonly period: string;
  readonly said: string;
};

export type StatedFigureCardDecision =
  | { readonly kind: "PREPARE"; readonly arguments: StatedFigureToolArguments }
  | {
      readonly kind: "NONE";
      readonly reason:
        | "NOT_OFFERED"
        | "MODEL_CALLED"
        | "NO_READING"
        | "INCOMPLETE"
        | "NOT_THEIR_WORDS";
    };

const isMetric = (code: string): code is StatedFigureMetric =>
  Object.hasOwn(STATED_FIGURE_METRICS, code);

/**
 * Whether code prepares the figure card for this run, and with what.
 *
 * - Only where the run was offered the figure tool: that offer is the
 *   founder's own-company condition (never an investor's plan).
 * - Never a second card: a run whose model called the tool (whatever came
 *   of it) is left as it is.
 * - Only a complete reading: a closed-list metric, a month or day, and for
 *   money a currency they stated. Nothing is guessed; an incomplete one
 *   makes no card (the reply may ask).
 * - Only their own words: the quote must be in their messages. The tool
 *   checks it again; this keeps a misquote from becoming a call at all.
 * - One figure per turn, as the tool says.
 */
export function statedFigureCard(input: {
  readonly readings: unknown;
  readonly offered: boolean;
  readonly modelCalled: boolean;
  readonly theirWords: readonly string[];
}): StatedFigureCardDecision {
  if (!input.offered) return { kind: "NONE", reason: "NOT_OFFERED" };
  if (input.modelCalled) return { kind: "NONE", reason: "MODEL_CALLED" };
  const listed = z.array(z.unknown()).safeParse(input.readings);
  const readings = (listed.success ? listed.data : []).flatMap((item) => {
    const read = StatedFigureReadingSchema.safeParse(item);
    return read.success ? [read.data] : [];
  });
  if (readings.length === 0) return { kind: "NONE", reason: "NO_READING" };
  let incomplete = false;
  for (const reading of readings) {
    if (!isMetric(reading.metric) || reading.period === null) {
      incomplete = true;
      continue;
    }
    const money = STATED_FIGURE_METRICS[reading.metric].kind === "MONEY";
    if (money && reading.currency === null) {
      incomplete = true;
      continue;
    }
    if (!saidByThem(reading.quote, input.theirWords)) continue;
    return {
      kind: "PREPARE",
      arguments: {
        metric: reading.metric,
        amount: reading.amount,
        ...(money && reading.currency !== null
          ? { currency: reading.currency }
          : {}),
        period: reading.period,
        said: reading.quote,
      },
    };
  }
  return {
    kind: "NONE",
    reason: incomplete ? "INCOMPLETE" : "NOT_THEIR_WORDS",
  };
}
