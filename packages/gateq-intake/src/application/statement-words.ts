import {
  GATEQ_STATEMENT_VIEW_VERSION,
  gateqStandingDisagreements,
  gateqStatementsInWords,
  GateqStatementViewV1Schema,
  type GateqCoverageV1,
  type GateqStatementViewV1,
  type GateqStatementWords,
} from "@capital-q/contracts";
import type { GatewayPolicy, QualificationResult } from "@capital-q/gateq";

import type {
  ApplicationDimension,
  ApplicationFact,
  ApplicationId,
} from "../contracts/index.js";
import type {
  ApplicationStatementView,
  DimensionViewItem,
} from "../contracts/statements.js";
import {
  countryName,
  INSTRUMENT_WORDS,
  LEAD_WORDS,
  STAGE_WORDS,
} from "../inbox/domain.js";
import {
  DIMENSION_LABELS,
  explainQualification,
  groupOf,
  INVESTMENT_DIMENSIONS,
} from "./coverage.js";
import { questionNeedsFor, type QuestionNeed } from "./question-needs.js";
import { legacyCarry, type StatementContext } from "./statement-plan.js";
import { projectView } from "./statement-view.js";
import { amountWords } from "./stated-amount.js";

/**
 * Slice 3 of atomic statements (design 2026-11-14): every reader reads the
 * one statement view. This module is where the server puts a statement's
 * value into words, once, and turns the projected view into the wire
 * view (`GateqStatementViewV1`) that founder review, the frozen dossier,
 * the inbox, synthesis and the investor's Q all format with the one shared
 * `gateqStatementsInWords`.
 */

/** What a stated zero is a zero of, when the dimension says it. */
const ZERO_NOUN: Readonly<Partial<Record<ApplicationDimension, string>>> = {
  "claims.revenue": "revenue",
  "claims.traction": "traction yet",
  "company.customers": "customers yet",
  "raise.amount": "raise",
};

const QUANTITY_NOUN: Readonly<Record<string, string>> = {
  revenue: "revenue",
  mrr: "monthly recurring revenue",
  arr: "annual recurring revenue",
  gmv: "GMV",
  paying_customers: "paying customers",
  customers: "customers",
  users: "users",
  daily_active_users: "daily active users",
  weekly_active_users: "weekly active users",
  monthly_active_users: "monthly active users",
  wallets: "wallets",
  transactions: "transactions",
  pilots: "pilots",
  employees: "employees",
  growth_rate_monthly: "monthly growth",
  churn_rate_monthly: "monthly churn",
  retention_rate: "retention",
  gross_margin: "gross margin",
  burn_monthly: "monthly burn",
  runway_months: "months of runway",
  raise_amount: "raise",
  pre_money_valuation: "pre-money valuation",
};

/** Dimensions whose money is read as an amount, not the founder's sentence. */
const AMOUNT_DIMENSIONS: ReadonlySet<ApplicationDimension> = new Set([
  "raise.amount",
  "claims.revenue",
]);

function codeWords(dimension: ApplicationDimension, code: string): string {
  if (dimension === "company.country") return countryName(code);
  if (dimension === "company.stage") return STAGE_WORDS[code] ?? code;
  if (dimension === "raise.instrument") return INSTRUMENT_WORDS[code] ?? code;
  if (dimension === "raise.lead_status") return LEAD_WORDS[code] ?? code;
  return code;
}

/**
 * One statement's value in plain words. A stated zero reads "Zero …",
 * never as an empty or missing value (live D9); an unknown says whether
 * they did not know or preferred not to say; prose stays in their words.
 */
export function statementSummary(
  dimension: ApplicationDimension,
  item: Pick<DimensionViewItem, "value" | "words" | "quantity">,
): string {
  const value = item.value;
  switch (value.kind) {
    case "TEXT":
      return value.text;
    case "CODE":
      return codeWords(dimension, value.code);
    case "MONEY":
      if (!AMOUNT_DIMENSIONS.has(dimension)) return item.words;
      return value.currency === null
        ? `${amountWords(value.amount, "").trim()} (currency not given)`
        : amountWords(value.amount, value.currency);
    case "COUNT":
    case "PERCENT":
      return item.words;
    case "ZERO": {
      const noun =
        (item.quantity === null ? undefined : QUANTITY_NOUN[item.quantity]) ??
        ZERO_NOUN[dimension] ??
        DIMENSION_LABELS[dimension].toLowerCase();
      return `Zero ${noun}${value.currency === undefined ? "" : ` (${value.currency})`}`;
    }
    case "UNKNOWN":
      return value.declined === true ? "Preferred not to say" : "Not known";
  }
}

function wordsOf(
  dimension: ApplicationDimension,
  item: DimensionViewItem,
  turnSeqOf: (item: DimensionViewItem) => number | null,
): GateqStatementWords {
  return {
    statementId: item.statementId,
    sourceKind: item.sourceKind,
    backfilled: item.backfilled,
    valueKind: item.value.kind,
    declined: item.value.kind === "UNKNOWN" && item.value.declined === true,
    summary: statementSummary(dimension, item).slice(0, 2000) || "(blank)",
    words: item.words,
    quantity: item.quantity,
    asOf: item.asOf,
    provenance: item.provenance,
    sourceTurnSeq: turnSeqOf(item),
    statedAt: item.statedAt,
  };
}

/**
 * The wire view of a projected one. `turnSeqs` maps a statement's source
 * turn id (or a carried statement's own id) to the transcript seq a
 * reader cites.
 */
export function statementViewDto(
  view: ApplicationStatementView,
  turnSeqs: ReadonlyMap<string, number> = new Map(),
): GateqStatementViewV1 {
  const turnSeqOf = (item: DimensionViewItem) =>
    (item.sourceTurnId === null ? undefined : turnSeqs.get(item.sourceTurnId)) ??
    turnSeqs.get(item.statementId) ??
    null;
  return GateqStatementViewV1Schema.parse({
    version: GATEQ_STATEMENT_VIEW_VERSION,
    dimensions: view.dimensions.map((entry) => ({
      dimension: entry.dimension,
      label: DIMENSION_LABELS[entry.dimension],
      group: groupOf(entry.dimension),
      status: entry.status,
      statements: entry.items.map((item) =>
        wordsOf(entry.dimension, item, turnSeqOf),
      ),
      superseded: entry.superseded.map((old) => ({
        ...wordsOf(entry.dimension, old.item, turnSeqOf),
        supersededBy: old.supersededBy,
        via: old.via,
      })),
      disagreements: entry.disagreements.map((d) => ({
        key: d.key,
        olderStatementId: d.olderStatementId,
        newerStatementId: d.newerStatementId,
        state: d.state,
        resolvedByStatementId: d.resolvedByStatementId,
        active: d.active,
      })),
    })),
  });
}

/**
 * The view every reader uses: what is on record as statements, plus every
 * current legacy fact no statement accounts for yet (recorded before
 * statements existed, or never touched by a turn since), carried in with
 * the same deterministic ids and BACKFILL flags the write path and the
 * backfill script give them. Pure; nothing is written.
 */
export function effectiveStatementView(input: {
  readonly applicationId: ApplicationId;
  readonly context: StatementContext;
  readonly legacyFacts: readonly ApplicationFact[];
}): {
  readonly view: ApplicationStatementView;
  /** A carried statement's id to the turn seq its legacy fact named. */
  readonly carriedTurnSeqs: ReadonlyMap<string, number>;
} {
  const carried = legacyCarry(input);
  const factSeq = new Map(
    input.legacyFacts.map((fact) => [fact.id as string, fact.sourceTurnSeq]),
  );
  const carriedTurnSeqs = new Map<string, number>();
  for (const statement of carried) {
    const factId = statement.backfillKey?.split(":")[1];
    const seq = factId === undefined ? undefined : factSeq.get(factId);
    if (typeof seq === "number") carriedTurnSeqs.set(statement.id, seq);
  }
  return {
    view: projectView(
      [...input.context.statements, ...carried],
      input.context.links,
      input.context.events,
    ),
    carriedTurnSeqs,
  };
}

function applicantReason(
  reason: QuestionNeed["reason"] | undefined,
): GateqCoverageV1["missing"][number]["reason"] {
  return reason === undefined ||
    reason === "INVESTOR_EMPHASIS" ||
    reason === "NEEDS_SPECIFICS"
    ? "UNDERSTANDING"
    : reason;
}

/** The line limit of the v1 coverage contract's contradictions. */
const CONTRADICTION_LINES = 16;

/**
 * Founder review's coverage from the statement view (slice 3). The same
 * contract as the legacy `coverageFor`, read from the view: an answered
 * dimension's summary is every current statement in words, a stated zero
 * is answered ("Zero revenue"), an unknown and a refusal are reported as
 * such, and every standing disagreement is a line with both values and
 * their sources. More than the contract's 16 lines are counted, not
 * dropped silently (decision 97).
 */
export function coverageFromView(input: {
  readonly policy: GatewayPolicy;
  readonly qualification: QualificationResult;
  readonly facts: readonly ApplicationFact[];
  readonly view: GateqStatementViewV1;
  readonly includeSources?: boolean | undefined;
}): GateqCoverageV1 {
  const reasons = new Map(
    questionNeedsFor({
      policy: input.policy,
      qualification: input.qualification,
      facts: input.facts,
      limit: 64,
    }).map((need) => [need.dimension, need.reason] as const),
  );
  const byDimension = new Map(
    input.view.dimensions.map((d) => [d.dimension, d] as const),
  );
  const answered: GateqCoverageV1["answered"][number][] = [];
  const unknown: GateqCoverageV1["unknown"][number][] = [];
  const declined: GateqCoverageV1["declined"][number][] = [];
  const missing: GateqCoverageV1["missing"][number][] = [];
  for (const entry of INVESTMENT_DIMENSIONS) {
    for (const dimension of entry.dimensions) {
      const base = {
        dimension,
        label: DIMENSION_LABELS[dimension],
        group: entry.group,
      };
      const view = byDimension.get(dimension);
      if (view === undefined || view.status === "UNANSWERED") {
        if (dimension !== "raise.currency")
          missing.push({
            ...base,
            reason: applicantReason(reasons.get(dimension)),
          });
        continue;
      }
      if (view.status === "UNKNOWN") {
        unknown.push(base);
        continue;
      }
      if (view.status === "DECLINED") {
        declined.push(base);
        continue;
      }
      const held = view.statements.filter((s) => s.valueKind !== "UNKNOWN");
      const latest = held.at(-1) ?? view.statements.at(-1);
      if (latest === undefined) continue;
      answered.push({
        ...base,
        summary: held
          .map((s) => s.summary)
          .join("\n")
          .slice(0, 2000),
        provenance: latest.provenance,
        ...(input.includeSources === true
          ? {
              // Slice 3: the source record is the latest statement.
              sourceFactId: latest.statementId,
              sourceTurnSeq: latest.sourceTurnSeq,
            }
          : {}),
      });
    }
  }
  const standing = gateqStandingDisagreements(
    gateqStatementsInWords(input.view),
  ).map((line) => line.text.slice(0, 300));
  const contradictions =
    standing.length <= CONTRADICTION_LINES
      ? standing
      : [
          ...standing.slice(0, CONTRADICTION_LINES - 1),
          `and ${String(standing.length - CONTRADICTION_LINES + 1)} more answers that disagree, all in the application`,
        ];
  const explained = explainQualification(input.policy, input.qualification);
  return {
    version: 1,
    access: explained.access,
    unmet: [...explained.unmet],
    stillNeeded: [...explained.stillNeeded],
    ...(explained.unresolved.length === 0
      ? {}
      : { unresolved: [...explained.unresolved] }),
    answered,
    unknown,
    declined,
    missing,
    contradictions,
  };
}
