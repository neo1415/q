import { fitScoreOutOf10, type FitProfileDto } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import {
  fitSweepCardsBlock,
  fitsInOutcome,
  readFitSets,
  type RunFit,
} from "./fit-cards.js";
import { ownSetOf } from "./fit-sweep.js";

/**
 * Audit 2026-11-15, RC2: ranking shortcuts dropped the person's stated
 * condition. "Show me the ones with actual revenue", "pre-revenue",
 * "outside my preferred sectors" (an investor) and "which would be poor
 * fits", "leave out the ones I'm already talking to" (a founder) each got
 * the plain top of the fit ranking, and Q later admitted answering the
 * wrong question.
 *
 * The conditions are the turn reader's (TURN_READER v89
 * `question.listConditions`, with v88's `excludeRelationships`), never a
 * phrase list. This module applies them deterministically, from the
 * records the person may see, BEFORE ranking: an item whose standing on a
 * condition is not on record is never counted as failing it (unknown is
 * never "no revenue" or "outside"), it is left out of the list and named
 * as unknown. The answer is written from the final list and says which
 * condition it applied; `violatingItems` is the last code check that no
 * item shown breaks a stated condition.
 */

export type ListConditions = NonNullable<QAnswerRequest["listConditions"]>;

/** The conditions this turn carries, merged with v88's exclusion. */
export function listConditionsOf(
  request: Pick<QAnswerRequest, "listConditions" | "excludeRelationships">,
): ListConditions | null {
  const read = request.listConditions;
  const exclude = request.excludeRelationships === true;
  if (read === undefined && !exclude) return null;
  return {
    relationship: read?.relationship ?? (exclude ? "EXCLUDE_IN_CONTACT" : null),
    revenue: read?.revenue ?? null,
    sector: read?.sector ?? null,
    stage: read?.stage ?? null,
    geography: read?.geography ?? null,
    order: read?.order ?? "BEST_FIRST",
  };
}

/**
 * Live re-check 15 Nov 2026 (T7): the conditions of the list Q showed just
 * before, carried to a follow-up on it. Each condition this turn's reading
 * states replaces the carried one; the order is this turn's when it read
 * any conditions at all ("and the poor fits?" is worst first). Null with
 * nothing carried and nothing read.
 */
export function carriedListConditions(
  read: ListConditions | null,
  carried: ListConditions | null,
): ListConditions | null {
  if (carried === null) return read;
  if (read === null) return carried;
  return {
    relationship: read.relationship ?? carried.relationship,
    revenue: read.revenue ?? carried.revenue,
    sector: read.sector ?? carried.sector,
    stage: read.stage ?? carried.stage,
    geography: read.geography ?? carried.geography,
    order: read.order,
  };
}

/** Any condition at all, the relationship exclusion included. */
export function hasAnyCondition(conditions: ListConditions | null): boolean {
  return (
    conditions !== null &&
    (conditions.relationship !== null ||
      conditions.revenue !== null ||
      conditions.sector !== null ||
      conditions.stage !== null ||
      conditions.geography !== null ||
      conditions.order === "WORST_FIRST")
  );
}

/**
 * A condition beyond v88's relationship exclusion (which the investor fit
 * sweep already applies): these need the conditioned lane.
 */
export function needsConditionedLane(
  conditions: ListConditions | null,
): boolean {
  return (
    conditions !== null &&
    (conditions.relationship === "ONLY_IN_CONTACT" ||
      conditions.revenue !== null ||
      conditions.sector !== null ||
      conditions.stage !== null ||
      conditions.geography !== null ||
      conditions.order === "WORST_FIRST")
  );
}

export type Dimension = "revenue" | "sector" | "stage" | "geography";
export const DIMENSIONS: readonly Dimension[] = [
  "revenue",
  "sector",
  "stage",
  "geography",
];

/** Where one item stands on one dimension, from its records. */
export type Standing = "MEETS" | "FAILS" | "UNKNOWN";
export type Judge<T> = (item: T, dimension: Dimension) => Standing;

export type ConditionsApplied<T> = {
  /** Items that meet every stated condition, in the input order. */
  readonly kept: readonly T[];
  /** Items left out because a stated condition is not on record for them. */
  readonly unknown: readonly {
    readonly item: T;
    readonly dimensions: readonly Dimension[];
  }[];
  /** How many failed a stated condition on their records. */
  readonly failed: number;
};

/** The dimensions a condition was stated on. */
export function statedDimensions(
  conditions: ListConditions,
): readonly Dimension[] {
  return DIMENSIONS.filter((dimension) => conditions[dimension] !== null);
}

/**
 * Apply the stated dimension conditions. Never throws. An item FAILS when
 * a record says so; UNKNOWN never counts as failing, and an item with any
 * unknown stated dimension (and none failed) is reported, not shown.
 */
export function applyConditions<T>(
  items: readonly T[],
  conditions: ListConditions,
  judge: Judge<T>,
): ConditionsApplied<T> {
  const stated = statedDimensions(conditions);
  const kept: T[] = [];
  const unknown: { item: T; dimensions: Dimension[] }[] = [];
  let failed = 0;
  for (const item of items) {
    const standings = stated.map((dimension) => ({
      dimension,
      standing: judge(item, dimension),
    }));
    if (standings.some((one) => one.standing === "FAILS")) {
      failed += 1;
      continue;
    }
    const open = standings.filter((one) => one.standing === "UNKNOWN");
    if (open.length > 0) {
      unknown.push({ item, dimensions: open.map((one) => one.dimension) });
      continue;
    }
    kept.push(item);
  }
  return { kept, unknown, failed };
}

/** The final check: items shown that break a stated condition. */
export function violatingItems<T>(
  shown: readonly T[],
  conditions: ListConditions,
  judge: Judge<T>,
  inContact: (item: T) => boolean,
): readonly T[] {
  const stated = statedDimensions(conditions);
  return shown.filter(
    (item) =>
      (conditions.relationship === "EXCLUDE_IN_CONTACT" && inContact(item)) ||
      (conditions.relationship === "ONLY_IN_CONTACT" && !inContact(item)) ||
      stated.some((dimension) => judge(item, dimension) !== "MEETS"),
  );
}

// ---------------------------------------------------------------------
// Revenue, from the company's own published figures (read_company_figures).
// ---------------------------------------------------------------------

export type RevenueState = "HAS_REVENUE" | "PRE_REVENUE" | "UNKNOWN";

/**
 * Claim keys that state revenue (structured-data mapping on the company's
 * own claim keys, never the person's words). A business model, a target,
 * a forecast or an expectation is not revenue.
 */
const REVENUE_KEY = /(?:^|[._])(?:revenue|mrr|arr|sales|gmv)(?:[._]|$)/u;
const NOT_REVENUE_KEY =
  /model|expect|forecast|target|projection|plan|goal|growth|trend|status|stage/u;
const STATUS_KEY = /(?:^|[._])revenue[._](?:status|stage|state)$/u;

function amountOf(
  value: Readonly<Record<string, unknown>> | null,
): number | null {
  if (value === null) return null;
  for (const key of ["amount", "value", "minor", "amountMinor"]) {
    const raw = value[key];
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^-?\d+(?:\.\d+)?$/u.test(raw.trim())
          ? Number(raw)
          : Number.NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isForecast(value: Readonly<Record<string, unknown>> | null): boolean {
  return (
    value !== null &&
    (value["forecast"] === true ||
      value["isForecast"] === true ||
      value["actual"] === false ||
      value["kind"] === "FORECAST" ||
      value["basis"] === "FORECAST")
  );
}

/**
 * Whether the company has revenue, from the figures it published as this
 * reader may see them. A positive current revenue figure is revenue; a
 * stated zero (or a stated pre-revenue status) is pre-revenue; nothing on
 * record, or records that contradict each other, is UNKNOWN -- never
 * "no revenue" (CLAUDE.md: unknown stays unknown; contradictions are never
 * resolved by picking one).
 */
export function revenueStateOf(figuresData: unknown): RevenueState {
  const figures = (figuresData as { figures?: unknown } | null)?.figures;
  if (!Array.isArray(figures)) return "UNKNOWN";
  let positive = false;
  let zero = false;
  for (const raw of figures as unknown[]) {
    const figure = raw as {
      readonly key?: unknown;
      readonly value?: unknown;
      readonly earlier?: unknown;
    };
    if (typeof figure.key !== "string" || figure.earlier === true) continue;
    const key = figure.key.toLowerCase();
    const value =
      typeof figure.value === "object" && figure.value !== null
        ? (figure.value as Readonly<Record<string, unknown>>)
        : null;
    if (STATUS_KEY.test(key)) {
      const raw = value?.["code"] ?? value?.["status"] ?? value?.["value"];
      // Only a written status counts; an object or number is not a code.
      const code = (typeof raw === "string" ? raw : "").toLowerCase();
      if (/pre[_ -]?revenue|no[_ -]?revenue/u.test(code)) zero = true;
      else if (/revenue|recurring|paying/u.test(code)) positive = true;
      continue;
    }
    if (!REVENUE_KEY.test(key) || NOT_REVENUE_KEY.test(key)) continue;
    if (isForecast(value)) continue;
    const amount = amountOf(value);
    if (amount === null) continue;
    if (amount > 0) positive = true;
    else if (amount === 0) zero = true;
  }
  if (positive && zero) return "UNKNOWN";
  return positive ? "HAS_REVENUE" : zero ? "PRE_REVENUE" : "UNKNOWN";
}

// ---------------------------------------------------------------------
// The investor lane: companies, judged on the investor's own fit.
// ---------------------------------------------------------------------

const PARAMETER: Readonly<Record<Exclude<Dimension, "revenue">, string>> = {
  sector: "SECTOR",
  stage: "STAGE",
  geography: "GEOGRAPHY",
};
const HARD_RULE: Readonly<Record<Exclude<Dimension, "revenue">, string>> = {
  sector: "EXCLUDED_SECTOR",
  stage: "STAGE_OUTSIDE_STRICT_RANGE",
  geography: "EXCLUDED_GEOGRAPHY",
};

/**
 * Inside or outside the mandate on one parameter, from the platform's own
 * fit (ranking-config): STRONG or PARTIAL is inside, MISMATCH (or the
 * investor's own declared exclusion on it) is outside, UNKNOWN or a
 * parameter they declared nothing on is not known.
 */
export function mandateSide(
  profile: FitProfileDto,
  dimension: Exclude<Dimension, "revenue">,
): "INSIDE" | "OUTSIDE" | "UNKNOWN" {
  if (profile.hardRule?.code === HARD_RULE[dimension]) return "OUTSIDE";
  const row = profile.parameters.find(
    (one) => one.parameter === PARAMETER[dimension],
  );
  if (row === undefined || !row.applicable) return "UNKNOWN";
  if (row.outcome === "MISMATCH") return "OUTSIDE";
  if (row.outcome === "STRONG" || row.outcome === "PARTIAL") return "INSIDE";
  return "UNKNOWN";
}

export function judgeCompany(
  conditions: ListConditions,
  revenue: ReadonlyMap<string, RevenueState>,
): Judge<RunFit> {
  return (fit, dimension) => {
    if (dimension === "revenue") {
      const state = revenue.get(fit.companyId) ?? "UNKNOWN";
      if (state === "UNKNOWN" || conditions.revenue === null) return "UNKNOWN";
      return state === conditions.revenue ? "MEETS" : "FAILS";
    }
    const wanted = conditions[dimension];
    const side = mandateSide(fit.profile, dimension);
    if (side === "UNKNOWN" || wanted === null) return "UNKNOWN";
    return side === wanted ? "MEETS" : "FAILS";
  };
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

export function counted(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

const SIDE_WORDS: Readonly<
  Record<
    "INVESTOR" | "FOUNDER",
    Readonly<
      Record<
        Exclude<Dimension, "revenue">,
        Readonly<Record<"INSIDE" | "OUTSIDE", string>>
      >
    >
  >
> = {
  INVESTOR: {
    sector: {
      INSIDE: "are inside your preferred sectors",
      OUTSIDE: "are outside your preferred sectors",
    },
    stage: {
      INSIDE: "are at a stage you invest in",
      OUTSIDE: "are outside the stages you invest in",
    },
    geography: {
      INSIDE: "are in your regions",
      OUTSIDE: "are outside your regions",
    },
  },
  FOUNDER: {
    sector: {
      INSIDE: "publish a sector that matches your company",
      OUTSIDE: "publish a sector that isn't your company's",
    },
    stage: {
      INSIDE: "publish a stage that matches yours",
      OUTSIDE: "publish a stage that isn't yours",
    },
    geography: {
      INSIDE: "invest where you are",
      OUTSIDE: "don't publish your geography",
    },
  },
};

/**
 * The stated conditions as plural predicates ("have revenue on record",
 * "are outside your preferred sectors"), for the answer's own words.
 */
export function conditionWords(
  conditions: ListConditions,
  side: "INVESTOR" | "FOUNDER",
): readonly string[] {
  const words: string[] = [];
  if (conditions.revenue === "HAS_REVENUE")
    words.push("have revenue on record");
  if (conditions.revenue === "PRE_REVENUE") words.push("are pre-revenue");
  for (const dimension of ["sector", "stage", "geography"] as const) {
    const wanted = conditions[dimension];
    if (wanted !== null) words.push(SIDE_WORDS[side][dimension][wanted]);
  }
  return words;
}

const SINGULAR: readonly (readonly [RegExp, string])[] = [
  [/^have /u, "has "],
  [/^are /u, "is "],
  [/^publish /u, "publishes "],
  [/^invest /u, "invests "],
  [/^don't /u, "doesn't "],
];

/**
 * The predicates joined; for one item, "has" and "is" for "have", "are".
 * Each predicate agrees on its own (live re-check of 3b7145616: "one has
 * revenue on record and are outside your preferred sectors" -- only the
 * joined sentence's first verb was made singular).
 */
export function predicate(words: readonly string[], one: boolean): string {
  return listed(
    one
      ? words.map((word) =>
          SINGULAR.reduce((text, [from, to]) => text.replace(from, to), word),
        )
      : words,
  );
}

const DIMENSION_WORDS: Readonly<Record<Dimension, string>> = {
  revenue: "revenue",
  sector: "sector",
  stage: "stage",
  geography: "geography",
};

/** "For X and Y, whether they have revenue isn't on record, so I left them out." */
export function unknownLine(
  unknown: readonly {
    readonly name: string;
    readonly dimensions: readonly Dimension[];
  }[],
): string {
  if (unknown.length === 0) return "";
  const dims = [...new Set(unknown.flatMap((one) => one.dimensions))].map(
    (dimension) => DIMENSION_WORDS[dimension],
  );
  const names = unknown.slice(0, 6).map((one) => one.name);
  const more = unknown.length - names.length;
  const who = `${listed(names)}${more > 0 ? ` and ${counted(more)} more` : ""}`;
  const what =
    dims.length === 1 && dims[0] === "revenue"
      ? "whether they have revenue isn't on record"
      : `their ${listed(dims)} ${dims.length === 1 ? "isn't" : "aren't"} on record against this`;
  return ` For ${who}, ${what}, so I've left ${unknown.length === 1 ? "it" : "them"} out rather than guess; unknown isn't the same as no.`;
}

function scoreOf(fit: RunFit): number {
  const shown = fitScoreOutOf10(fit.profile);
  return shown === null ? -1 : Number(shown);
}

export type ConditionedListAnswer = {
  readonly text: string;
  readonly block: ReturnType<typeof fitSweepCardsBlock>;
  readonly shown: readonly RunFit[];
  readonly considered: number;
  readonly unknown: number;
  readonly excludedInContact: number;
  readonly calls: readonly QToolCallOutcome[];
};

const POOL_MAX = 24;
const CARDS_MAX = 10;

/**
 * An investor's ranked list of companies under stated conditions. The pool
 * is the companies they asked about: those Q just showed ("the ones with
 * revenue" of them), their own relationships (ONLY_IN_CONTACT), or the
 * catalog's best matches on their mandate (up to 24, the same fit service
 * ranks every match), widened by their own candidates. Conditions are
 * applied before ranking; the order is best or worst first as asked.
 * Null when it cannot be honoured here (a tool it needs is not offered or
 * nothing could be read): the full path answers instead, never the plain
 * ranking.
 */
export async function runConditionedCompanyList(
  input: ConditionedCompanyListInput,
): Promise<ConditionedListAnswer | null> {
  const first = await conditionedCompanyListOnce(input);
  const shownBefore = input.within?.length ?? 0;
  if (first === null || shownBefore === 0 || first.shown.length > 0) {
    return first;
  }
  /*
   * Live re-check 15 Nov 2026 (T2, "the weakest fits outside my sectors"
   * after a mandate ranking): the condition was applied only to the ten
   * companies just shown -- in-sector by construction -- and Q said none
   * exist. When the condition rules out everything shown, the same
   * conditions are applied to the catalog's candidate pool, and the
   * answer says it looked wider. Should that read fail, Q says plainly it
   * looked only at the list shown and offers to look wider.
   */
  const words = conditionWords(input.conditions, "INVESTOR");
  const these = `the ${counted(shownBefore)} ${shownBefore === 1 ? "company" : "companies"} I just showed`;
  const wider = await conditionedCompanyListOnce({ ...input, within: null });
  if (wider === null) {
    return {
      ...first,
      text: `${first.text} I only looked at ${these}; say if you want me to look across Capital Q.`,
    };
  }
  const none =
    words.length > 0
      ? `None of ${these} ${predicate(words, shownBefore === 1)}, so I looked wider.`
      : `I couldn't rank ${these} that way, so I looked wider.`;
  return {
    ...wider,
    text: `${none} ${wider.text}`,
    calls: [...first.calls, ...wider.calls],
  };
}

type ConditionedCompanyListInput = {
  readonly conditions: ListConditions;
  /** The companies the question is about, when it is about those shown. */
  readonly within: readonly string[] | null;
  readonly count: number | null;
  readonly discover: {
    readonly sectors: readonly string[];
    readonly countries: readonly string[];
    readonly stages: readonly string[];
  } | null;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  /** Their own relationships and saves (list_my_relationships' data). */
  readonly own: Promise<unknown>;
  /** Whom the account digest says they are in touch with. */
  readonly inTouch: Promise<ReadonlySet<string>>;
};

async function conditionedCompanyListOnce(
  input: ConditionedCompanyListInput,
): Promise<ConditionedListAnswer | null> {
  const { conditions, tools, context, available } = input;
  // An "outside my mandate" or "weakest first" ask is answered from more
  // than the catalog's best matches on the mandate, which are inside it by
  // construction: the catalog in name order is read beside them.
  const beyondBest =
    conditions.order === "WORST_FIRST" ||
    conditions.sector === "OUTSIDE" ||
    conditions.stage === "OUTSIDE" ||
    conditions.geography === "OUTSIDE";
  const poolMax = beyondBest ? POOL_MAX * 2 : POOL_MAX;
  let widePool = false;
  if (!available.has("fit_profile") && !available.has("fit_top_candidates"))
    return null;
  if (conditions.revenue !== null && !available.has("read_company_figures"))
    return null;
  const calls: QToolCallOutcome[] = [];
  const read = async (
    name: string,
    args: Record<string, unknown>,
    id: string,
  ): Promise<QToolCallOutcome | null> => {
    const outcome = await tools
      .execute({ callId: id, name, arguments: args }, context)
      .catch(() => null);
    if (outcome !== null) calls.push(outcome);
    return outcome;
  };
  const [ownData, digestInTouch] = await Promise.all([
    input.own.catch(() => null),
    input.inTouch.catch(() => new Set<string>()),
  ]);
  const own = ownSetOf(ownData);
  const inContact = new Set([
    ...own.relationships.map((row) => row.id),
    ...digestInTouch,
  ]);
  // The pool, before any condition.
  let pool: string[];
  if (input.within !== null && input.within.length > 0) {
    pool = [...input.within];
  } else if (conditions.relationship === "ONLY_IN_CONTACT") {
    pool = [...inContact];
  } else {
    const catalog = available.has("discover_companies")
      ? await read(
          "discover_companies",
          {
            sectors: [...(input.discover?.sectors ?? [])],
            countries: [...(input.discover?.countries ?? [])],
            stages: [...(input.discover?.stages ?? [])],
            limit: POOL_MAX,
            order: "FIT",
          },
          "q-conditions-catalog",
        )
      : null;
    const companies =
      catalog !== null && catalog.result.ok
        ? (catalog.result.data as { companies?: unknown } | null)?.companies
        : undefined;
    const idsOf = (list: unknown): string[] =>
      Array.isArray(list)
        ? (list as { companyId?: unknown }[]).flatMap((one) =>
            typeof one.companyId === "string" ? [one.companyId] : [],
          )
        : [];
    pool = idsOf(companies);
    if (beyondBest && catalog !== null && catalog.result.ok) {
      const byName = await read(
        "discover_companies",
        {
          sectors: [...(input.discover?.sectors ?? [])],
          countries: [...(input.discover?.countries ?? [])],
          stages: [...(input.discover?.stages ?? [])],
          limit: POOL_MAX,
          order: "NAME",
        },
        "q-conditions-catalog-names",
      );
      const more =
        byName !== null && byName.result.ok
          ? idsOf(
              (byName.result.data as { companies?: unknown } | null)?.companies,
            )
          : [];
      for (const id of more) if (!pool.includes(id)) pool.push(id);
      widePool = more.length > 0;
    }
    if (pool.length === 0 && available.has("fit_top_candidates")) {
      const top = await read(
        "fit_top_candidates",
        { limit: CARDS_MAX },
        "q-conditions-top",
      );
      pool = top === null ? [] : fitsInOutcome(top).map((fit) => fit.companyId);
    }
    for (const row of [...own.relationships, ...own.saved]) {
      if (!pool.includes(row.id)) pool.push(row.id);
    }
  }
  const excludedInContact =
    conditions.relationship === "EXCLUDE_IN_CONTACT"
      ? pool.filter((id) => inContact.has(id)).length
      : 0;
  pool = [...new Set(pool)]
    .filter((id) =>
      conditions.relationship === "EXCLUDE_IN_CONTACT"
        ? !inContact.has(id)
        : conditions.relationship === "ONLY_IN_CONTACT"
          ? inContact.has(id)
          : true,
    )
    .slice(0, poolMax);
  const outcomes = await readFitSets({
    ids: pool,
    read,
    sets: available.has("fit_top_candidates"),
    source: "FEED",
    callId: "q-conditions-fit",
  });
  const position = new Map(pool.map((id, at) => [id, at]));
  const byId = new Map<string, RunFit>();
  for (const fit of outcomes.flatMap((outcome) =>
    outcome === null ? [] : fitsInOutcome(outcome),
  )) {
    if (position.has(fit.companyId) && !byId.has(fit.companyId))
      byId.set(fit.companyId, fit);
  }
  const fits = [...byId.values()];
  if (fits.length === 0 && pool.length > 0) return null;
  // Revenue, from each company's own published figures, as this reader
  // may see them (read_company_figures' admission is get_company's).
  const revenue = new Map<string, RevenueState>();
  if (conditions.revenue !== null) {
    const states = await Promise.all(
      fits.map(async (fit, at) => {
        const outcome = await read(
          "read_company_figures",
          { companyId: fit.companyId },
          `q-conditions-figures-${String(at)}`,
        );
        return [
          fit.companyId,
          outcome !== null && outcome.result.ok
            ? revenueStateOf(outcome.result.data)
            : "UNKNOWN",
        ] as const;
      }),
    );
    for (const [id, state] of states) revenue.set(id, state);
  }
  const judge = judgeCompany(conditions, revenue);
  const applied = applyConditions(fits, conditions, judge);
  const worst = conditions.order === "WORST_FIRST";
  const ranked = applied.kept
    .map((fit) => ({
      fit,
      score: scoreOf(fit),
      at: position.get(fit.companyId) ?? 0,
    }))
    // Worst first ranks only what can be scored: an unscored company is
    // not known to be a poor fit.
    .filter((one) => !worst || one.score >= 0)
    .sort((a, b) =>
      worst
        ? a.score - b.score || a.at - b.at
        : b.score - a.score || a.at - b.at,
    )
    .map((one) => one.fit);
  const count = Math.min(Math.max(input.count ?? CARDS_MAX, 1), CARDS_MAX);
  let shown = ranked.slice(0, count);
  // The last code check: nothing shown breaks a stated condition.
  const broken = new Set(
    violatingItems(shown, conditions, judge, (fit) =>
      inContact.has(fit.companyId),
    ).map((fit) => fit.companyId),
  );
  if (broken.size > 0)
    shown = shown.filter((fit) => !broken.has(fit.companyId));
  const words = conditionWords(conditions, "INVESTOR");
  const leftOut =
    conditions.relationship === "EXCLUDE_IN_CONTACT"
      ? excludedInContact > 0
        ? `Leaving out the ${excludedInContact === 1 ? "company" : `${counted(excludedInContact)} companies`} you're already in touch with. `
        : "None of these is a company you're already in touch with. "
      : conditions.relationship === "ONLY_IN_CONTACT"
        ? "Only companies you're already in touch with. "
        : "";
  const scope =
    input.within !== null && input.within.length > 0
      ? `Of the ${counted(input.within.length)} companies I just showed`
      : conditions.relationship === "ONLY_IN_CONTACT"
        ? `Of the ${counted(pool.length)} companies you're in touch with`
        : widePool
          ? `Of the ${counted(fits.length)} companies on Capital Q I checked`
          : `Of the ${counted(fits.length)} companies closest to your mandate that I checked`;
  const unknown = unknownLine(
    applied.unknown.map((one) => ({
      name: one.item.name,
      dimensions: one.dimensions,
    })),
  );
  const label =
    words.length === 0
      ? ""
      : `: ${predicate(words, false).replace(/^(?:are|have) /u, "")}`;
  const block = fitSweepCardsBlock(
    shown,
    worst
      ? `Weakest fits against your mandate${label}`
      : `Fit against your mandate${label}`,
  );
  const named = shown.map((fit) => {
    const score = fitScoreOutOf10(fit.profile);
    return score === null ? fit.name : `${fit.name} at ${score}`;
  });
  const which =
    words.length === 0
      ? ""
      : `${ranked.length === 1 ? "one" : counted(ranked.length)} ${predicate(words, ranked.length === 1)}`;
  const ranking =
    shown.length < ranked.length
      ? `The best ${counted(shown.length)}, ranked by fit with your mandate`
      : "Ranked by fit with your mandate";
  const head =
    shown.length === 0
      ? words.length > 0
        ? `${scope}, I can't show you any that ${predicate(words, false)}.`
        : worst
          ? `${scope}, none can be scored against your mandate yet, so I can't name the weakest fits.`
          : `${scope}, none is left to show.`
      : worst
        ? `${scope}${which.length > 0 ? `, ${which}` : ""}. The weakest fits against your mandate, weakest first: ${listed(named)}.`
        : which.length > 0
          ? `${scope}, ${which}. ${ranking}: ${listed(named)}.`
          : `${scope}, ranked by fit with your mandate: ${listed(named)}.`;
  const revenueNote =
    conditions.revenue !== null && shown.length > 0
      ? " Revenue is as each company states it on Capital Q, not verified."
      : "";
  const onScreen =
    shown.length === 0
      ? ""
      : ` ${shown.length === 1 ? "It's" : "They're"} on screen.`;
  return {
    text: `${leftOut}${head}${revenueNote}${unknown}${onScreen}`.trim(),
    block,
    shown,
    considered: fits.length,
    unknown: applied.unknown.length,
    excludedInContact,
    calls,
  };
}
