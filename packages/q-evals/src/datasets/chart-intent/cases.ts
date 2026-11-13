/**
 * A8 chart-intent eval (owner directive 13 Nov 2026: Q must not degenerate
 * into keyword routing). Natural paraphrases, follow-ups and negatives for
 * TURN_READER v82's typed `chart` intent, each with the intent a correct
 * reading carries. Graded by code (test/chart-intent.live.test.ts), never
 * by a model. Synthetic, fictional companies only.
 *
 * `expected.companies` is compared case-insensitively as a set; `metric`
 * exactly; `sameAsBefore` only where it is stated. `null` expects no chart
 * (chart absent or chart.wanted false, and asksForChart false).
 */

import type { ChartMetric } from "@capital-q/q-core";

export type ChartIntentTurn = {
  readonly role: "USER" | "Q";
  readonly text: string;
};

export type ChartIntentExpected = {
  readonly companies: readonly string[];
  readonly metric: ChartMetric | "UNSPECIFIED";
  readonly sameAsBefore?: boolean | undefined;
  readonly periodFrom?: string | null | undefined;
};

export type ChartIntentCase = {
  readonly id: string;
  readonly said: string;
  readonly recent: readonly ChartIntentTurn[];
  readonly expected: ChartIntentExpected | null;
};

const LEDGERLINE_CHART: readonly ChartIntentTurn[] = [
  { role: "USER", text: "Chart Ledgerline's MRR" },
  {
    role: "Q",
    text: "Here is Ledgerline's monthly recurring revenue as the company states it: USD 30,000 in June 2026 rising to USD 42,000 in September 2026.",
  },
];

const TWO_SHOWN: readonly ChartIntentTurn[] = [
  { role: "USER", text: "Which seed fintechs fit my mandate?" },
  {
    role: "Q",
    text: "Two fit best: Ledgerline (B2B payments, Lagos) and Clinicrest (clinic software, Nairobi).",
  },
];

export const CHART_INTENT_CASES: readonly ChartIntentCase[] = [
  // Paraphrases of one intent: Ledgerline, MRR.
  {
    id: "para-01 chart verb",
    said: "Chart Ledgerline's monthly recurring revenue over the last few months.",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "MRR" },
  },
  {
    id: "para-02 no chart word, moved",
    said: "Can you show me how Ledgerline's MRR has moved over time?",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "MRR" },
  },
  {
    id: "para-03 trend",
    said: "can I see Ledgerline's MRR trend",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "MRR" },
  },
  {
    id: "para-04 spoken",
    said: "uh so can you like pull up ledgerline's mrr for me, like visually, how it's been going",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "MRR" },
  },
  {
    id: "para-05 picture",
    said: "I'd like a picture of Ledgerline's recurring revenue month by month.",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "MRR" },
  },
  {
    id: "para-06 French",
    said: "Montre-moi l'évolution du MRR de Ledgerline sur un graphique.",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "MRR" },
  },
  {
    id: "para-07 Spanish",
    said: "Muéstrame en un gráfico cómo ha evolucionado el MRR de Ledgerline.",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "MRR" },
  },
  {
    id: "para-08 period",
    said: "Plot Ledgerline's MRR since June 2026",
    recent: [],
    expected: {
      companies: ["Ledgerline"],
      metric: "MRR",
      periodFrom: "2026-06",
    },
  },
  // Each metric by meaning.
  {
    id: "metric-01 ARR",
    said: "Graph Ledgerline's annual recurring revenue",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "ARR" },
  },
  {
    id: "metric-02 retention",
    said: "show me visually how well Ledgerline keeps its customers over time",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "RETENTION" },
  },
  {
    id: "metric-03 users",
    said: "Can I see a chart of how many people actively use Ledgerline?",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "USERS" },
  },
  {
    id: "metric-04 burn",
    said: "Draw Clinicrest's monthly burn for me",
    recent: [],
    expected: { companies: ["Clinicrest"], metric: "BURN" },
  },
  {
    id: "metric-05 unspecified",
    said: "Chart Ledgerline for me",
    recent: [],
    expected: { companies: ["Ledgerline"], metric: "UNSPECIFIED" },
  },
  // Names made of ordinary words; never completed.
  {
    id: "names-01 ordinary words",
    said: "put open field analytics and grow bank's ARR side by side on a chart",
    recent: [],
    expected: {
      companies: ["Open Field Analytics", "Grow Bank"],
      metric: "ARR",
    },
  },
  {
    id: "names-02 partial name as said",
    said: "chart Kestrel's revenue",
    recent: [],
    expected: { companies: ["Kestrel"], metric: "REVENUE" },
  },
  // Context and follow-ups.
  {
    id: "context-01 their (companies in context)",
    said: "chart their MRR side by side",
    recent: TWO_SHOWN,
    expected: { companies: [], metric: "MRR" },
  },
  {
    id: "follow-01 same for Clinicrest",
    said: "Now do the same for Clinicrest",
    recent: LEDGERLINE_CHART,
    expected: { companies: ["Clinicrest"], metric: "MRR", sameAsBefore: true },
  },
  {
    id: "follow-02 another metric",
    said: "and for ARR?",
    recent: LEDGERLINE_CHART,
    expected: { companies: [], metric: "ARR", sameAsBefore: true },
  },
  {
    id: "follow-03 spoken repeat",
    said: "okay cool same chart but for clinicrest please",
    recent: LEDGERLINE_CHART,
    expected: { companies: ["Clinicrest"], metric: "MRR", sameAsBefore: true },
  },
  // Negatives: no chart.
  {
    id: "neg-01 a number only",
    said: "What's Ledgerline's MRR?",
    recent: [],
    expected: null,
  },
  {
    id: "neg-02 chart a course",
    said: "Help me chart a course for our seed raise",
    recent: [],
    expected: null,
  },
  {
    id: "neg-03 graph theory",
    said: "Graph theory aside, who leads Ledgerline?",
    recent: [],
    expected: null,
  },
  {
    id: "neg-04 after a chart, a question",
    said: "Why did it jump in August?",
    recent: LEDGERLINE_CHART,
    expected: null,
  },
  {
    id: "neg-05 plot as a story",
    said: "What's the plot of Ledgerline's founder story?",
    recent: [],
    expected: null,
  },
];

/** The reading's chart intent, as the grader sees it. */
export type ChartIntentReading = {
  readonly asksForChart?: boolean | undefined;
  readonly chart?:
    | {
        readonly wanted: boolean;
        readonly companies: readonly string[];
        readonly metric: string;
        readonly period: {
          readonly from: string | null;
          readonly to: string | null;
        } | null;
        readonly sameAsBefore: boolean;
      }
    | null
    | undefined;
};

/** True when the reading carries the expected intent; why not otherwise. */
export function gradeChartIntent(
  expected: ChartIntentExpected | null,
  reading: ChartIntentReading | null,
): true | string {
  if (reading === null) return "not read";
  const chart = reading.chart?.wanted === true ? reading.chart : null;
  if (expected === null) {
    if (chart !== null || reading.asksForChart === true) {
      return `read a chart: ${JSON.stringify(reading.chart ?? null)}`;
    }
    return true;
  }
  if (chart === null) return "no chart read";
  if (reading.asksForChart !== true) return "asksForChart not set";
  const norm = (names: readonly string[]) =>
    [...new Set(names.map((name) => name.trim().toLowerCase()))].toSorted();
  if (
    JSON.stringify(norm(chart.companies)) !==
    JSON.stringify(norm(expected.companies))
  ) {
    return `companies ${JSON.stringify(chart.companies)}`;
  }
  if (chart.metric !== expected.metric) return `metric ${chart.metric}`;
  if (
    expected.sameAsBefore !== undefined &&
    chart.sameAsBefore !== expected.sameAsBefore
  ) {
    return `sameAsBefore ${String(chart.sameAsBefore)}`;
  }
  if (
    expected.periodFrom !== undefined &&
    (chart.period?.from ?? null) !== expected.periodFrom
  ) {
    return `period ${JSON.stringify(chart.period)}`;
  }
  return true;
}
