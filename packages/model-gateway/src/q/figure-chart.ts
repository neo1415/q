import {
  chartableSeries,
  EvidenceStatusSchema,
  TruthClassSchema,
  type EvidenceStatus,
  type QResultBlock,
  type TruthClass,
} from "@capital-q/contracts";

import {
  CHART_METRIC_LABELS,
  CHART_METRICS,
  type AuthorisedFact,
  type ChartMetric,
} from "@capital-q/q-core";

import type { ReadCompanyFigure, RunRead } from "./card-subjects.js";

/**
 * A8 (owner priority, 13 Nov 2026): "show me Ledgerline's revenue growth",
 * "chart MRR for Clinicrest vs Ledgerline", "chart my traction" are
 * answered with an actual chart. Code, never a model, builds it, and only
 * from the figures read_company_figures returned to this run under the
 * Context Firewall (CURRENT claims the company published, at the scopes the
 * plan admitted): each claim's structured value, never a number lifted
 * from prose (a statement, a description, a deck's words or the answer).
 *
 * Two shapes, nothing else:
 * - a time series (LINE) when a company has two or more dated values of one
 *   metric (today: a growth claim's own start and end, such as "MRR grew
 *   from USD 3,000 in June to USD 4,800 in September");
 * - a comparison (BAR) of one metric across two or more companies, every
 *   value in the same kind and, for money, the same currency.
 *
 * Nothing is invented, interpolated, converted or filled: a missing value
 * stays absent, a currency mismatch draws nothing, two different values
 * stated for one date draw nothing (contradictions are never resolved by
 * picking one), and fewer than two comparable points is no chart -- Q's
 * words say what is known instead. Every point keeps its own date, and
 * every series its truth class and evidence status; the source says
 * "company-stated" unless the figure is verified.
 */

type Kind = "MONEY" | "COUNT" | "PERCENT";

type Standing = {
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
};

/** One value of one metric, as one claim states it. */
type Measure = Standing & {
  readonly metric: string;
  readonly kind: Kind;
  readonly currency: string | null;
  readonly value: number;
  /** YYYY-MM-DD, or null when the claim gives no date. */
  readonly asOf: string | null;
  /** A growth claim's own start or end, or a series it was matched into. */
  readonly fromGrowth: boolean;
};

const MONTHLY_REVENUE = "financial.monthly_revenue";
const GROWTH_PREFIX = "growth:";

const DATE = /^(\d{4})-(\d{2})-(\d{2})/u;
const DECIMAL = /^-?\d+(?:\.\d+)?$/u;
const CURRENCY = /^[A-Z]{3}$/u;

function dateOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = DATE.exec(raw.trim());
  return match === null ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

/** A plain number, or a decimal string ("4800"); anything else is unknown. */
function numberOf(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && DECIMAL.test(raw.trim())) {
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function standingOf(figure: ReadCompanyFigure): Standing | null {
  const truth = TruthClassSchema.safeParse(figure.truthClass);
  const evidence = EvidenceStatusSchema.safeParse(figure.evidenceStatus);
  if (!truth.success || !evidence.success) return null;
  const standing = {
    truthClass: truth.data,
    evidenceStatus: evidence.data,
  };
  return chartableSeries(standing) ? standing : null;
}

/** The measures one claim states; none when its value is not structured. */
function measuresOf(figure: ReadCompanyFigure): Measure[] {
  const value = figure.value;
  if (value === null || value === undefined) return [];
  const standing = standingOf(figure);
  if (standing === null) return [];
  const kind = value["kind"];
  const currencyRaw = value["currency"];
  const currency =
    typeof currencyRaw === "string" && CURRENCY.test(currencyRaw)
      ? currencyRaw
      : null;
  // A growth claim states its own period's start and end: two dated values
  // of the metric it grew. Its percentage is not charted (periods differ).
  if (
    value["periodStart"] !== undefined ||
    value["startAmount"] !== undefined
  ) {
    const metric = value["metric"];
    const start = numberOf(value["startAmount"]);
    const end = numberOf(value["endAmount"]);
    const startAt = dateOf(value["periodStart"]);
    const endAt = dateOf(value["periodEnd"]);
    if (
      typeof metric !== "string" ||
      metric.trim().length === 0 ||
      currency === null ||
      start === null ||
      end === null ||
      startAt === null ||
      endAt === null ||
      startAt >= endAt
    ) {
      return [];
    }
    const base = {
      ...standing,
      metric: `${GROWTH_PREFIX}${metric.trim().toUpperCase()}`,
      kind: "MONEY" as const,
      currency,
      fromGrowth: true,
    };
    return [
      { ...base, value: start, asOf: startAt },
      { ...base, value: end, asOf: endAt },
    ];
  }
  const asOf = dateOf(value["asOf"]) ?? dateOf(figure.asOf);
  if (kind === "MONEY") {
    const amount = numberOf(value["amount"]);
    if (amount === null || currency === null) return [];
    return [
      {
        ...standing,
        metric: keyOf(figure.key),
        kind,
        currency,
        value: amount,
        asOf,
        fromGrowth: false,
      },
    ];
  }
  if (kind === "COUNT" || kind === "PERCENT") {
    const number = numberOf(value["value"]);
    if (number === null) return [];
    return [
      {
        ...standing,
        metric: keyOf(figure.key),
        kind,
        currency: null,
        value: number,
        asOf,
        fromGrowth: false,
      },
    ];
  }
  return [];
}

/**
 * A growth claim's end is the company's own monthly revenue claim when
 * both state exactly the same amount, currency and date: then its start is
 * an earlier value of that same metric. An exact match only, never a guess
 * about what a growth figure measured.
 */
function measuresFor(figures: readonly ReadCompanyFigure[]): Measure[] {
  const all = figures.flatMap(measuresOf);
  const monthly = all.filter((one) => one.metric === MONTHLY_REVENUE);
  const growthMetrics = new Set(
    all
      .filter((one) => one.metric.startsWith(GROWTH_PREFIX))
      .map((one) => one.metric),
  );
  const renamed = new Map<string, string>();
  for (const metric of growthMetrics) {
    const points = all
      .filter((one) => one.metric === metric)
      .toSorted((a, b) => (a.asOf ?? "").localeCompare(b.asOf ?? ""));
    const end = points.at(-1);
    if (
      end !== undefined &&
      metric === `${GROWTH_PREFIX}REVENUE` &&
      monthly.some(
        (one) =>
          one.currency === end.currency &&
          one.value === end.value &&
          one.asOf === end.asOf,
      )
    ) {
      renamed.set(metric, MONTHLY_REVENUE);
    }
  }
  return all.map((one) => {
    const metric = renamed.get(one.metric);
    return metric === undefined ? one : { ...one, metric };
  });
}

type MetricWords = { readonly title: string; readonly unit: string };

const KNOWN_METRICS: Readonly<Record<string, MetricWords>> = {
  [MONTHLY_REVENUE]: { title: "Monthly revenue", unit: "a month" },
  "financial.mrr": { title: "Monthly recurring revenue", unit: "a month" },
  "financial.arr": { title: "Annual recurring revenue", unit: "a year" },
  "financial.revenue": { title: "Revenue", unit: "revenue" },
  "financial.burn_rate": { title: "Monthly burn", unit: "a month" },
  "financial.cash_balance": { title: "Cash balance", unit: "cash" },
  "financial.runway_months": { title: "Runway", unit: "months" },
  "traction.customer_count": { title: "Customers", unit: "customers" },
  "traction.churn_rate": { title: "Churn", unit: "%" },
  "team.size": { title: "Team size", unit: "people" },
  "financial.gross_margin": { title: "Gross margin", unit: "%" },
  "financial.contribution_margin": { title: "Contribution margin", unit: "%" },
  "financial.nrr": { title: "Net revenue retention", unit: "%" },
  "traction.active_users": { title: "Active users", unit: "active users" },
  "customers.paying_accounts": {
    title: "Paying accounts",
    unit: "paying accounts",
  },
  "team.employee_count": { title: "Team size", unit: "people" },
  [`${GROWTH_PREFIX}REVENUE`]: { title: "Revenue", unit: "revenue" },
};

function wordsFor(metric: string, kind: Kind): MetricWords {
  const known = KNOWN_METRICS[metric];
  if (known !== undefined) return known;
  const tail = (metric.split(/[.:]/u).at(-1) ?? metric)
    .toLowerCase()
    .replaceAll("_", " ")
    .trim()
    .slice(0, 40);
  const title = `${tail.slice(0, 1).toUpperCase()}${tail.slice(1)}`;
  return {
    title: title.length === 0 ? "Figure" : title,
    unit:
      kind === "PERCENT" ? "%" : kind === "MONEY" ? "amount" : tail || "count",
  };
}

/**
 * The claim keys that state each canonical chart metric (q-core
 * CHART_METRICS), in preference order. This is structured-data mapping --
 * a claim's own key onto the closed list the turn reader chooses from --
 * never a reading of the person's words: which metric they asked for is
 * the reader's (TURN_READER v82 `chart.metric`). A pattern is matched
 * against claim keys only (the demo seed publishes company KPIs under
 * `traction.<code>`, such as traction.logo_retention_6m_pct).
 */
const CHART_METRIC_KEYS: Readonly<
  Record<ChartMetric, readonly (string | RegExp)[]>
> = {
  // Recurring first; a company's monthly revenue claim (often what it
  // calls MRR) after. Each series keeps its own key and its own title.
  MRR: ["financial.mrr", MONTHLY_REVENUE],
  ARR: ["financial.arr"],
  REVENUE: [
    "financial.revenue",
    "traction.revenue",
    "financial.revenue_month",
    `${GROWTH_PREFIX}REVENUE`,
  ],
  // The series a growth claim states (its start and end): see keysFor.
  GROWTH: [],
  GROSS_MARGIN: ["financial.gross_margin"],
  RETENTION: ["financial.nrr", /^traction\.[a-z0-9_]*retention[a-z0-9_]*$/u],
  CHURN: ["traction.churn_rate", /^traction\.[a-z0-9_]*churn[a-z0-9_]*$/u],
  CUSTOMERS: [
    "traction.customer_count",
    "traction.customers",
    "traction.active_customers",
    "customers.paying_accounts",
    "customers.count",
  ],
  USERS: ["traction.active_users", "traction.users"],
  TEAM_SIZE: ["team.employee_count", "team.size"],
  BURN: ["financial.burn_rate", "financial.burn"],
  CASH: ["financial.cash_balance", "financial.cash"],
  RUNWAY: ["financial.runway_months", "financial.runway"],
};

/**
 * One key per stated quantity: `revenue.mrr` is an older spelling of
 * `financial.mrr`, and `revenue.arr` of `financial.arr`.
 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  "revenue.mrr": "financial.mrr",
  "revenue.arr": "financial.arr",
};
function keyOf(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

/** The keys these measures hold that state `metric`, in preference order. */
function keysFor(metric: ChartMetric, measures: readonly Measure[]): string[] {
  if (metric === "GROWTH") {
    return [
      ...new Set(
        measures.filter((one) => one.fromGrowth).map((one) => one.metric),
      ),
    ];
  }
  const present = [...new Set(measures.map((one) => one.metric))].toSorted();
  const keys: string[] = [];
  for (const rule of CHART_METRIC_KEYS[metric]) {
    for (const key of present) {
      const matches = typeof rule === "string" ? key === rule : rule.test(key);
      if (matches && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function monthLabel(asOf: string): string {
  const [year, month] = asOf.split("-");
  return `${MONTHS[Number(month) - 1] ?? month ?? ""} ${year ?? ""}`.trim();
}

const sameStanding = (a: Standing, b: Standing) =>
  a.truthClass === b.truthClass && a.evidenceStatus === b.evidenceStatus;

function sourceOf(standing: Standing): string {
  return standing.truthClass === "VERIFIED"
    ? "Verified figures on Capital Q."
    : "Company-stated on Capital Q, as each claim gives it; not verified by Capital Q.";
}

/**
 * A company's dated values of one metric, oldest first, under one
 * standing. Two values stated for the same date that differ: a
 * contradiction, never resolved here, so no series.
 */
function seriesPoints(measures: readonly Measure[]): Measure[] | null {
  const byDate = new Map<string, Measure>();
  for (const one of measures) {
    if (one.asOf === null) continue;
    const before = byDate.get(one.asOf);
    if (before === undefined) {
      byDate.set(one.asOf, one);
      continue;
    }
    if (before.value !== one.value || before.currency !== one.currency) {
      return null;
    }
    if (!sameStanding(before, one)) return null;
  }
  const points = [...byDate.values()].toSorted((a, b) =>
    (a.asOf ?? "").localeCompare(b.asOf ?? ""),
  );
  const first = points[0];
  if (first === undefined) return [];
  // One series has one standing, one kind and one currency.
  if (
    !points.every(
      (one) =>
        sameStanding(one, first) &&
        one.kind === first.kind &&
        one.currency === first.currency,
    )
  ) {
    return null;
  }
  // Month labels must stay distinct, or the axis would merge two values.
  const labels = new Set(points.map((one) => monthLabel(one.asOf ?? "")));
  return labels.size === points.length ? points : null;
}

type Company = { readonly id: string; readonly name: string };

function timeSeriesChart(
  metric: string,
  companies: readonly (Company & { readonly points: readonly Measure[] })[],
): QResultBlock | null {
  const first = companies[0]?.points[0];
  if (first === undefined) return null;
  const words = wordsFor(metric, first.kind);
  const title =
    companies.length === 1
      ? `${companies[0]?.name ?? ""}: ${words.title.toLowerCase()}`
      : `${words.title}, as each company states it`;
  return {
    kind: "CHART",
    chart: "LINE",
    title: title.slice(0, 120),
    unit: words.unit,
    currency: first.currency,
    series: companies.slice(0, 4).map((company) => {
      const lead = company.points[0] ?? first;
      return {
        label: company.name.slice(0, 60),
        truthClass: lead.truthClass,
        evidenceStatus: lead.evidenceStatus,
        source: sourceOf(lead),
        points: company.points.slice(-24).map((point) => ({
          label: monthLabel(point.asOf ?? ""),
          value: point.value,
          asOf: point.asOf,
        })),
      };
    }),
  };
}

function comparisonChart(
  metric: string,
  latest: readonly (Company & { readonly measure: Measure })[],
): QResultBlock | null {
  const first = latest[0]?.measure;
  if (first === undefined) return null;
  const words = wordsFor(metric, first.kind);
  // One series per standing, so each bar keeps its own claim's standing.
  const groups: { standing: Standing; rows: typeof latest }[] = [];
  for (const row of latest) {
    const group = groups.find((one) => sameStanding(one.standing, row.measure));
    if (group === undefined) {
      groups.push({ standing: row.measure, rows: [row] });
    } else {
      group.rows = [...group.rows, row];
    }
  }
  if (groups.length > 4) return null;
  return {
    kind: "CHART",
    chart: "BAR",
    title: `${words.title}, as each company states it`.slice(0, 120),
    unit: words.unit,
    currency: first.currency,
    series: groups.map((group) => ({
      label: (groups.length === 1
        ? words.title
        : `${words.title} (${group.standing.evidenceStatus
            .toLowerCase()
            .replaceAll("_", " ")})`
      ).slice(0, 60),
      truthClass: group.standing.truthClass,
      evidenceStatus: group.standing.evidenceStatus,
      source: sourceOf(group.standing),
      points: group.rows.map((row) => ({
        label: row.name.slice(0, 40),
        value: row.measure.value,
        asOf: row.measure.asOf,
      })),
    })),
  };
}

type Prepared = Company & { readonly measures: readonly Measure[] };

/**
 * The one chart of exactly these keys' figures for these companies, or
 * null. Keys are tried in order (one canonical metric's keys, preferred
 * first); each draws from one key only, never two keys mixed on one axis.
 * One company: its time series. Two or more: every one of them states the
 * key (a line when each has the same dated points, else their latest
 * values as bars) -- never a chart of only some of them.
 */
function drawKeys(
  companies: readonly Prepared[],
  keys: readonly string[],
): QResultBlock | null {
  if (companies.length === 1) {
    const company = companies[0];
    if (company === undefined) return null;
    for (const key of keys) {
      const points = seriesPoints(
        company.measures.filter((one) => one.metric === key),
      );
      if (points !== null && points.length >= 2) {
        return timeSeriesChart(key, [{ ...company, points }]);
      }
    }
    return null;
  }
  for (const key of keys) {
    const of = companies.map((company) => ({
      ...company,
      own: company.measures.filter((one) => one.metric === key),
    }));
    // Every company the turn is about must have this key: a chart of
    // only some of them would read as the whole comparison.
    if (of.some((company) => company.own.length === 0)) continue;
    const kinds = new Set(of.flatMap((c) => c.own.map((one) => one.kind)));
    const currencies = new Set(
      of.flatMap((c) => c.own.map((one) => one.currency)),
    );
    // Never two currencies or two kinds on one axis; never converted.
    if (kinds.size !== 1 || currencies.size !== 1) continue;
    const series = of.map((company) => ({
      ...company,
      points: seriesPoints(company.own),
    }));
    if (series.some((company) => company.points === null)) continue;
    const dated = series as readonly (Company & {
      readonly points: Measure[];
    })[];
    const axis = (points: readonly Measure[]) =>
      points.map((one) => one.asOf).join("|");
    const firstAxis = axis(dated[0]?.points ?? []);
    if (
      dated.length <= 4 &&
      dated.every(
        (company) =>
          company.points.length >= 2 && axis(company.points) === firstAxis,
      )
    ) {
      return timeSeriesChart(key, dated);
    }
    // Their latest stated values side by side, each with its own date.
    const latest = of.flatMap((company) => {
      const sorted = company.own.toSorted((a, b) =>
        (a.asOf ?? "").localeCompare(b.asOf ?? ""),
      );
      const last = sorted.at(-1);
      return last === undefined
        ? []
        : [{ id: company.id, name: company.name, measure: last }];
    });
    if (latest.length >= 2) {
      const chart = comparisonChart(key, latest);
      if (chart !== null) return chart;
    }
  }
  return null;
}

/** What the chart ask came to; code decides, and the words follow it. */
export type ChartOutcome =
  | {
      readonly kind: "DRAWN";
      readonly metric: ChartMetric;
      readonly block: QResultBlock;
    }
  /** No metric was said and several can be drawn: ask which. */
  | {
      readonly kind: "ASK_METRIC";
      readonly companies: readonly string[];
      readonly available: readonly ChartMetric[];
    }
  /** The metric asked for is not among these companies' figures read. */
  | {
      readonly kind: "NO_DATA";
      readonly metric: ChartMetric;
      readonly missing: readonly string[];
    }
  /** Figures exist but no honest chart does (one point, mixed currency…). */
  | {
      readonly kind: "NOT_DRAWABLE";
      readonly metric: ChartMetric | null;
      readonly companies: readonly string[];
    }
  /** A name said fits more than one company the person may see. */
  | {
      readonly kind: "AMBIGUOUS";
      readonly said: string;
      readonly candidates: readonly string[];
    }
  /** A name said fits no company the person may see. */
  | { readonly kind: "NOT_FOUND"; readonly said: readonly string[] }
  /** No company's figures were read for this turn. */
  | { readonly kind: "NONE" };

/** The metric asked for (a canonical chart metric) or UNSPECIFIED. */
export type ChartMetricAsked = ChartMetric | "UNSPECIFIED";

/** A metric string from a request: a canonical metric, else UNSPECIFIED. */
export function chartMetricOf(raw: string | undefined): ChartMetricAsked {
  return (CHART_METRICS as readonly string[]).includes(raw ?? "")
    ? (raw as ChartMetric)
    : "UNSPECIFIED";
}

/** YYYY-MM months, inclusive; null ends are open. */
export type ChartPeriod = {
  readonly from: string | null;
  readonly to: string | null;
} | null;

function withinPeriod(measures: readonly Measure[], period: ChartPeriod) {
  if (period === null || (period.from === null && period.to === null)) {
    return measures;
  }
  return measures.filter((one) => {
    if (one.asOf === null) return false;
    const month = one.asOf.slice(0, 7);
    return (
      (period.from === null || month >= period.from) &&
      (period.to === null || month <= period.to)
    );
  });
}

/**
 * The chart for this run's figures, decided by code from the reader's
 * typed intent (TURN_READER v82): `metric` is the canonical metric they
 * asked for, or UNSPECIFIED. `companies`: the companies the turn is about,
 * in order (resolved by code); absent: every company whose figures this run
 * read.
 *
 * - A metric asked for is drawn from that metric's keys only. A company
 *   without it is said to be without it: another metric is never put in
 *   its place.
 * - UNSPECIFIED: drawn only when exactly one canonical metric can be drawn
 *   for these companies; with several, ASK_METRIC lists them. There is no
 *   default metric (owner 13 Nov: never revenue first by guess).
 */
export function chartOutcome(input: {
  readonly read: RunRead;
  readonly metric: ChartMetricAsked;
  readonly companies?: readonly string[] | undefined;
  readonly period?: ChartPeriod | undefined;
}): ChartOutcome {
  const wanted = (input.companies ?? [...input.read.companyFigures.keys()])
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 8);
  const nameOf = (id: string): string | undefined => {
    const name = input.read.companyNames.get(id) ?? input.read.profiles.get(id);
    return name === undefined || name.trim().length === 0
      ? undefined
      : name.trim();
  };
  const companies: Prepared[] = wanted.flatMap((id) => {
    const name = nameOf(id);
    if (name === undefined || !input.read.companyFigures.has(id)) return [];
    return [
      {
        id,
        name,
        measures: withinPeriod(
          measuresFor(input.read.companyFigures.get(id) ?? []),
          input.period ?? null,
        ),
      },
    ];
  });
  // A company asked about whose figures were not read (or not admitted to
  // this person) is unknown, never left out of a comparison silently.
  const unread = wanted.filter(
    (id) => !companies.some((company) => company.id === id),
  );
  const names = companies.map((company) => company.name);
  if (input.metric !== "UNSPECIFIED") {
    const metric = input.metric;
    // No companies named or in context: the companies read that state it
    // (an unrelated company read this turn is not "missing" it).
    if (input.companies === undefined) {
      const stating = companies.filter(
        (company) => keysFor(metric, company.measures).length > 0,
      );
      if (companies.length === 0) return { kind: "NONE" };
      if (stating.length === 0) {
        return { kind: "NO_DATA", metric, missing: names };
      }
      const block = drawKeys(
        stating,
        keysFor(
          metric,
          stating.flatMap((company) => company.measures),
        ),
      );
      return block === null
        ? {
            kind: "NOT_DRAWABLE",
            metric,
            companies: stating.map((company) => company.name),
          }
        : { kind: "DRAWN", metric, block };
    }
    const missing = [
      ...unread.map((id) => nameOf(id) ?? "one of the companies"),
      ...companies
        .filter((company) => keysFor(metric, company.measures).length === 0)
        .map((company) => company.name),
    ];
    if (companies.length === 0 && missing.length === 0) return { kind: "NONE" };
    if (missing.length > 0) return { kind: "NO_DATA", metric, missing };
    const keys = keysFor(
      metric,
      companies.flatMap((company) => company.measures),
    );
    const block = drawKeys(companies, keys);
    return block === null
      ? { kind: "NOT_DRAWABLE", metric, companies: names }
      : { kind: "DRAWN", metric, block };
  }
  if (companies.length === 0) return { kind: "NONE" };
  if (input.companies !== undefined && unread.length > 0) {
    return { kind: "NOT_DRAWABLE", metric: null, companies: names };
  }
  const all = companies.flatMap((company) => company.measures);
  // Each canonical metric that draws, once per distinct chart (a growth
  // claim matched into monthly revenue is one series, not two metrics).
  const drawable: { metric: ChartMetric; block: QResultBlock }[] = [];
  for (const metric of CHART_METRICS) {
    const block = drawKeys(companies, keysFor(metric, all));
    if (block === null) continue;
    const same = JSON.stringify(block);
    if (drawable.some((one) => JSON.stringify(one.block) === same)) continue;
    drawable.push({ metric, block });
  }
  const only = drawable.length === 1 ? drawable[0] : undefined;
  if (only !== undefined) {
    return { kind: "DRAWN", metric: only.metric, block: only.block };
  }
  if (drawable.length === 0) {
    return { kind: "NOT_DRAWABLE", metric: null, companies: names };
  }
  return {
    kind: "ASK_METRIC",
    companies: names,
    available: drawable.map((one) => one.metric),
  };
}

/**
 * The chart block for this run's figures, or null when no honest chart
 * exists (chartOutcome, drawn only).
 */
export function figureChartBlock(input: {
  readonly read: RunRead;
  readonly metric: ChartMetricAsked;
  readonly companies?: readonly string[] | undefined;
  readonly period?: ChartPeriod | undefined;
}): QResultBlock | null {
  const outcome = chartOutcome(input);
  return outcome.kind === "DRAWN" ? outcome.block : null;
}

/** The companies of the comparison table this answer carries, if any. */
function tableCompaniesOf(blocks: readonly QResultBlock[]): string[] {
  return (
    blocks
      .flatMap((block) =>
        block.kind === "TABLE" &&
        block.columns.length >= 2 &&
        block.columns.every((column) => column.subject?.kind === "COMPANY")
          ? [
              block.columns.flatMap((column) =>
                column.subject?.kind === "COMPANY"
                  ? [column.subject.companyId]
                  : [],
              ),
            ]
          : [],
      )
      .at(0) ?? []
  );
}

/**
 * The one chart an answer carries, if any (no chart spam): the chart they
 * asked for (the turn reader's chart intent), over the companies code
 * resolved for it, else those the turn compares or the table shows; or,
 * unasked, beside a table of two or more companies, the one canonical
 * metric every one of them states comparably (none when several could
 * be: nothing is chosen for them). None when the answer already carries a
 * chart or nothing honest can be drawn.
 */
export function answerChart(input: {
  readonly read: RunRead;
  readonly metric: ChartMetricAsked;
  readonly asked: boolean;
  readonly compareIds: readonly string[];
  readonly blocks: readonly QResultBlock[];
  /** The companies code resolved for the chart ask, in order. */
  readonly chartIds?: readonly string[] | undefined;
  readonly period?: ChartPeriod | undefined;
}): QResultBlock | null {
  const outcome = answerChartOutcome(input);
  return outcome.kind === "DRAWN" ? outcome.block : null;
}

/** answerChart's decision, with why nothing was drawn when nothing was. */
export function answerChartOutcome(input: {
  readonly read: RunRead;
  readonly metric: ChartMetricAsked;
  readonly asked: boolean;
  readonly compareIds: readonly string[];
  readonly blocks: readonly QResultBlock[];
  readonly chartIds?: readonly string[] | undefined;
  readonly period?: ChartPeriod | undefined;
}): ChartOutcome {
  if (input.blocks.some((block) => block.kind === "CHART")) {
    return { kind: "NONE" };
  }
  const tableCompanies = tableCompaniesOf(input.blocks);
  // Unasked, only beside a table this answer carries: a follow-up about a
  // comparison already on screen answers in words, without a chart again.
  if (!input.asked && tableCompanies.length < 2) return { kind: "NONE" };
  const companies =
    input.asked && input.chartIds !== undefined && input.chartIds.length > 0
      ? input.chartIds
      : input.asked && input.compareIds.length >= 2
        ? input.compareIds
        : tableCompanies.length >= 2
          ? tableCompanies
          : undefined;
  const outcome = chartOutcome({
    read: input.read,
    metric: input.metric,
    companies,
    period: input.period,
  });
  // Unasked, a chart is drawn or nothing is said about one.
  return input.asked || outcome.kind === "DRAWN" ? outcome : { kind: "NONE" };
}

/** A list said plainly: "A", "A and B", "A, B and C". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/**
 * What the answer is told when a chart was asked for and none is drawn:
 * why, and the one short question to ask when one is needed. Code decides;
 * the answer only words it, in the person's language. Null when a chart is
 * drawn (chartFactOf says what is on screen) or nothing was asked.
 */
export function chartNotDrawnFact(
  outcome: ChartOutcome,
): AuthorisedFact | null {
  const statement = ((): string | null => {
    switch (outcome.kind) {
      case "ASK_METRIC":
        return `They asked for a chart${outcome.companies.length === 0 ? "" : ` of ${listed(outcome.companies)}`} without saying which figure. No chart was drawn. Capital Q can chart these published figures: ${listed(outcome.available.map((metric) => CHART_METRIC_LABELS[metric]))}. Ask them, in one short question, which of these to chart. Never choose one for them, and never chart or estimate another figure.`;
      case "NO_DATA":
        return `They asked for a chart of ${CHART_METRIC_LABELS[outcome.metric]}. No chart was drawn: Capital Q holds no published ${CHART_METRIC_LABELS[outcome.metric]} figure that they may see for ${listed(outcome.missing)}. Say so plainly. Never put another figure in its place, and never estimate one.`;
      case "NOT_DRAWABLE":
        return `They asked for a chart${outcome.metric === null ? "" : ` of ${CHART_METRIC_LABELS[outcome.metric]}`}${outcome.companies.length === 0 ? "" : ` for ${listed(outcome.companies)}`}. No chart was drawn: Capital Q does not hold two or more comparable dated published values for it (one value only, different currencies, or values that conflict). Say so plainly and give the figures that are known, with where each comes from. Never estimate, fill or convert a value.`;
      case "AMBIGUOUS":
        return `They asked for a chart about "${outcome.said}", and more than one company on Capital Q has that name: ${listed(outcome.candidates)}. No chart was drawn. Ask them, in one line, which one they mean.`;
      case "NOT_FOUND":
        return `They asked for a chart about ${listed(outcome.said.map((said) => `"${said}"`))}, and Capital Q found no company of that name that they may see. No chart was drawn. Say so plainly, and never chart another company in its place.`;
      case "DRAWN":
      case "NONE":
        return null;
    }
  })();
  return statement === null
    ? null
    : {
        scope: "NETWORK_VISIBLE_DATA",
        statement,
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
        source: "Capital Q's record of the chart it could draw for this answer",
      };
}

/**
 * The could-not line code says when a chart was asked for, nothing was
 * drawn and nothing else was done: the honest reason, never a retry.
 * Null when the answer must ask them (ASK_METRIC, AMBIGUOUS): the
 * question is the answer.
 */
export function chartNotDrawnLine(outcome: ChartOutcome): string | null {
  switch (outcome.kind) {
    case "NO_DATA":
      return `I can't chart that: I don't have a published ${CHART_METRIC_LABELS[outcome.metric]} figure for ${listed(outcome.missing)}, and I won't put another figure in its place.`;
    case "NOT_FOUND":
      return `I can't chart that: I couldn't find ${listed(outcome.said.map((said) => `"${said}"`))} on Capital Q.`;
    case "ASK_METRIC":
    case "AMBIGUOUS":
    case "DRAWN":
      return null;
    case "NOT_DRAWABLE":
    case "NONE":
      return "I can't chart that: I don't have two or more comparable published figures for it. I can give you the figures that are known, with where each one comes from.";
  }
}

/**
 * A8 live 2026-11-13 (Ledgerline): the chart showed four months while the
 * words said the record "doesn't provide each month's value" and quoted
 * another start. The chart code drew is handed to the answer as a fact,
 * point by point, so the words describe what is on screen. Null when no
 * chart is drawn.
 */
export function chartFactOf(block: QResultBlock | null): AuthorisedFact | null {
  if (block?.kind !== "CHART") return null;
  const series = block.series
    .map((one) => {
      const points = one.points
        .map((point) => `${point.label} ${point.value.toLocaleString("en-US")}`)
        .join("; ");
      return `${one.label}: ${points}`;
    })
    .join(". ");
  const first = block.series[0];
  if (first === undefined) return null;
  const unit = [block.currency ?? null, block.unit ?? null]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" ");
  return {
    scope: "NETWORK_VISIBLE_DATA",
    statement:
      `Shown on screen now, drawn by Capital Q from the company's own published figures (${first.source}): "${block.title}"${unit.length === 0 ? "" : ` (${unit})`}. ${series}. ` +
      "Describe this series as shown, month by month where it helps; never say the monthly values are unavailable, and never give a different figure for a month shown here.",
    truthClass: first.truthClass,
    evidenceStatus: first.evidenceStatus,
    source: "Capital Q chart of company-stated figures",
  };
}

/**
 * The previous chart Q drew in this conversation, read back from its own
 * CHART block (code made it, so this is structured data): the companies
 * it drew (a line's series, a bar's points) and its canonical metric, from
 * the title code gave it. For a follow-up the reader read as repeating it
 * (`chart.sameAsBefore`). Null when Q drew no chart before.
 */
export function previousChartOf(
  history: readonly {
    readonly role: string;
    readonly blocks?: readonly QResultBlock[] | undefined;
  }[],
): {
  readonly companies: readonly string[];
  readonly metric: ChartMetric | null;
} | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "Q") continue;
    const block = (message.blocks ?? []).find((one) => one.kind === "CHART");
    if (block?.kind !== "CHART") continue;
    const companies =
      block.chart === "LINE"
        ? block.series.map((series) => series.label)
        : block.series.flatMap((series) =>
            series.points.map((point) => point.label),
          );
    const lowered = block.title.toLowerCase();
    const titled = Object.entries(KNOWN_METRICS).find(
      ([, words]) =>
        lowered.endsWith(`: ${words.title.toLowerCase()}`) ||
        lowered === `${words.title.toLowerCase()}, as each company states it`,
    );
    const key = titled?.[0];
    const metric =
      key === undefined
        ? null
        : (CHART_METRICS.find((one) =>
            CHART_METRIC_KEYS[one].some((rule) =>
              typeof rule === "string" ? rule === key : rule.test(key),
            ),
          ) ?? null);
    return {
      companies: companies.filter(
        (name, at, all) => name.trim().length > 0 && all.indexOf(name) === at,
      ),
      metric,
    };
  }
  return null;
}
