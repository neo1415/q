import type { PromptDefinition } from "../definition.js";
import {
  CHART_METRIC_LABELS,
  CHART_METRICS,
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V82_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV82ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV82Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V81 } from "./turn-reader.v81.js";

/**
 * v82 (A8, owner directive 13 Nov 2026). Live: "Chart Ledgerline's monthly
 * recurring revenue over the last few months" searched for "Chart
 * Ledgerline" -- code took the company from capitalised words and the
 * metric from a regex ranking with revenue first. The owner rejected both:
 * Q must not degenerate into keyword routing. The reader already reads
 * every turn by meaning in one pass; v82 has it say what chart is asked
 * for as a typed intent (`chart`): whose figures (as said, or empty for
 * the companies already in context), which canonical metric (a closed
 * list), the period and whether it repeats the previous chart for other
 * companies or another metric. Code resolves names by authorised exact
 * search, validates the metric against the figures read and draws.
 *
 * One sentence of v78's WHAT WAS ASKED is replaced; the output schema adds
 * `chart` to v79's.
 */
export const V82_CHART_ASK_FROM =
  "asksForChart is true only when they ask for a chart, graph or plot of something.";

const METRIC_LIST = CHART_METRICS.map(
  (metric) => `${metric} (${CHART_METRIC_LABELS[metric]})`,
).join(", ");

export const V82_CHART_ASK = `chart: when they want to SEE figures drawn -- a chart, graph, plot, trend line, a picture of how a figure moved, however said and in any language, with or without those words ("how has Ledgerline's revenue moved since June?" when they want it shown, "can I see Ledgerline's MRR trend", "put their ARR side by side visually", "now do the same for Clinicrest" after a chart) -- chart.wanted is true and asksForChart is true; otherwise leave chart out and asksForChart false. A question that only asks for a number ("what's their MRR?") is not a chart. chart.companies: each company whose figures they want drawn, written exactly as they referred to it (never completed, corrected or guessed; a name may be ordinary words, such as "Open Field Analytics" or "Grow Bank"), at most four; empty when they mean the companies already in the conversation ("their", "these two", "it") or their own company. chart.metric: the one figure they want drawn, by meaning, from this closed list: ${METRIC_LIST}; UNSPECIFIED when they did not say which figure ("chart Ledgerline", "show me their traction") -- never pick one for them. chart.period: the months they asked for as from and to, each YYYY-MM or null ("since June 2026" is from 2026-06, to null); leave it out when they named no period, and never turn "the last few months" into dates. chart.sameAsBefore: true when the ask repeats Q's previous chart for other companies or another figure ("now do the same for Clinicrest", "and for ARR?", "same chart for the other one"): put in chart.companies only the companies named now, and in chart.metric the figure named now, or the previous chart's figure from RECENT TURNS when they name none.`;

if (TURN_READER_V81.template.split(V82_CHART_ASK_FROM).length !== 2) {
  throw new Error(
    "TURN_READER v82 replaces v78's asksForChart sentence, which changed",
  );
}

export const TURN_READER_V82: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV82Result
> = {
  ...TURN_READER_V81,
  version: 82,
  status: "ACTIVE",
  changeDescription:
    "A8 (owner directive 13 Nov 2026, no keyword routing): v81 plus a typed chart intent read by meaning in the same pass -- chart.wanted, chart.companies as said (empty for the companies in context), chart.metric from a closed list of canonical chart metrics or UNSPECIFIED, chart.period (YYYY-MM) and chart.sameAsBefore. asksForChart is true exactly when chart.wanted is. Code resolves, validates and draws; no extra model call.",
  effectiveFrom: "2026-11-13",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V82_SCHEMA_VERSION,
    schema: TurnReaderV82ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V81.template.replace(V82_CHART_ASK_FROM, V82_CHART_ASK),
};
