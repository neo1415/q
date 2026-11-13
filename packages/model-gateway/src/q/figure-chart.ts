import {
  chartableSeries,
  EvidenceStatusSchema,
  TruthClassSchema,
  type EvidenceStatus,
  type QResultBlock,
  type TruthClass,
} from "@capital-q/contracts";

import type { AuthorisedFact } from "@capital-q/q-core";

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
      { ...standing, metric: figure.key, kind, currency, value: amount, asOf },
    ];
  }
  if (kind === "COUNT" || kind === "PERCENT") {
    const number = numberOf(value["value"]);
    if (number === null) return [];
    return [
      {
        ...standing,
        metric: figure.key,
        kind,
        currency: null,
        value: number,
        asOf,
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
  "revenue.mrr": { title: "Monthly recurring revenue", unit: "a month" },
  "financial.arr": { title: "Annual recurring revenue", unit: "a year" },
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
 * Which metric the person most likely means, from the metric's own words
 * in what they said; with none, a fixed order (revenue first). This only
 * chooses among figures already read; whether a chart was asked for is the
 * turn reader's (asksForChart), never a word list.
 */
const METRIC_WORDS: readonly (readonly [RegExp, RegExp])[] = [
  [
    /\b(?:mrr|monthly (?:recurring )?revenue)\b/iu,
    /^financial\.monthly_revenue$|mrr$/u,
  ],
  [/\b(?:arr|annual(?:ised|ized)? (?:recurring )?revenue)\b/iu, /\.arr$/u],
  [/\b(?:revenue|sales|growth|traction)\b/iu, /revenue|mrr|^growth:/u],
  [/\b(?:customers?|clients?|accounts?)\b/iu, /^customers\./u],
  [/\busers?\b/iu, /users/u],
  [/\bmargins?\b/iu, /margin/u],
  [/\bretention|nrr\b/iu, /nrr/u],
  [/\b(?:team|headcount|employees|staff)\b/iu, /employee/u],
];
const DEFAULT_ORDER: readonly RegExp[] = [
  /^financial\.monthly_revenue$/u,
  /mrr$/u,
  /\.arr$/u,
  /^growth:/u,
  /^customers\./u,
  /users/u,
  /margin/u,
];

function metricRank(metric: string, question: string): number {
  const asked = METRIC_WORDS.findIndex(
    ([said, key]) => said.test(question) && key.test(metric),
  );
  if (asked >= 0) return asked;
  const fallback = DEFAULT_ORDER.findIndex((key) => key.test(metric));
  return METRIC_WORDS.length + (fallback < 0 ? DEFAULT_ORDER.length : fallback);
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

/**
 * The chart for this run's figures, or null when no honest chart exists.
 * `companies`: the companies the turn is about, in order (a comparison's
 * named or resolved companies); absent: every company whose figures this
 * run read. One company: its time series. Two or more: one metric for
 * every one of them (a line when each has the same dated points, else
 * their latest values as bars) -- never a chart of only some of them.
 */
export function figureChartBlock(input: {
  readonly read: RunRead;
  readonly question: string;
  readonly companies?: readonly string[] | undefined;
}): QResultBlock | null {
  const ids = (input.companies ?? [...input.read.companyFigures.keys()])
    .filter((id, index, all) => all.indexOf(id) === index)
    .filter((id) => input.read.companyFigures.has(id))
    .slice(0, 8);
  const companies = ids.flatMap((id) => {
    const name = input.read.companyNames.get(id) ?? input.read.profiles.get(id);
    if (name === undefined || name.trim().length === 0) return [];
    return [
      {
        id,
        name: name.trim(),
        measures: measuresFor(input.read.companyFigures.get(id) ?? []),
      },
    ];
  });
  if (companies.length === 0) return null;
  // A comparison of named companies is all of them or no chart: one whose
  // figures were not read (or not admitted) is unknown, never left out.
  const wanted = new Set(input.companies ?? []);
  if (wanted.size >= 2 && companies.length < wanted.size) return null;
  const metrics = [
    ...new Set(
      companies.flatMap((company) => company.measures.map((one) => one.metric)),
    ),
  ].toSorted(
    (a, b) => metricRank(a, input.question) - metricRank(b, input.question),
  );

  if (companies.length === 1) {
    const company = companies[0];
    if (company === undefined) return null;
    for (const metric of metrics) {
      const points = seriesPoints(
        company.measures.filter((one) => one.metric === metric),
      );
      if (points !== null && points.length >= 2) {
        return timeSeriesChart(metric, [{ ...company, points }]);
      }
    }
    return null;
  }

  for (const metric of metrics) {
    const of = companies.map((company) => ({
      ...company,
      own: company.measures.filter((one) => one.metric === metric),
    }));
    // Every company the turn is about must have this metric: a chart of
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
      return timeSeriesChart(metric, dated);
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
      const chart = comparisonChart(metric, latest);
      if (chart !== null) return chart;
    }
  }
  return null;
}

/**
 * The one chart an answer carries, if any (no chart spam): the chart they
 * asked for (the turn reader's asksForChart), over the companies the turn
 * compares or the table shows; or, unasked, beside a table of two or more
 * companies, one metric every one of them states comparably. None when the
 * answer already carries a chart or nothing honest can be drawn.
 */
export function answerChart(input: {
  readonly read: RunRead;
  readonly question: string;
  readonly asked: boolean;
  readonly compareIds: readonly string[];
  readonly blocks: readonly QResultBlock[];
}): QResultBlock | null {
  if (input.blocks.some((block) => block.kind === "CHART")) return null;
  const tableCompanies =
    input.blocks
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
      .at(0) ?? [];
  // Unasked, only beside a table this answer carries: a follow-up about a
  // comparison already on screen answers in words, without a chart again.
  if (!input.asked && tableCompanies.length < 2) return null;
  const companies =
    input.asked && input.compareIds.length >= 2
      ? input.compareIds
      : tableCompanies.length >= 2
        ? tableCompanies
        : undefined;
  return figureChartBlock({
    read: input.read,
    question: input.question,
    companies,
  });
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
