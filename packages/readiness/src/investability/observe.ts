import {
  deckAskTerms,
  EVIDENCE_STATUSES,
  type DeckFact,
  type DeckSection,
  type DeckSectionCode,
  type EvidenceStatus,
  type LifecycleStatus,
  type TruthClass,
} from "@capital-q/contracts";

import { observationWeight } from "../investiq/assess-v1.js";
import type { InvestIQObservation } from "../investiq/contracts.js";
import { stageBandOf, type StageBand } from "../investiq/method-v1.js";
import {
  INVESTOR_ELIGIBLE_SCOPES,
  type InvestabilityInputs,
} from "./inputs.js";

/**
 * investability-inputs.v1: investor-eligible inputs -> InvestIQ v1
 * observations. Pure and deterministic: no clock, model or I/O. Every rule
 * is listed in INVESTABILITY_INPUT_RULES and in INVESTIQ-METHODOLOGY.md.
 *
 * Readings, per InvestIQ v1 anchors (2 = stage-appropriate baseline):
 *   RECORDED            the fact is on record (most inputs)
 *   SUPPORTS_STRENGTH   affirmative evidence ABOVE the stage baseline,
 *                       from a rule below (e.g. dated, quantified traction
 *                       at pre-seed/seed)
 *   INDICATES_WEAKNESS  affirmative evidence BELOW the stage baseline,
 *                       never a missing document (e.g. a Series A deck
 *                       that says "pre-revenue")
 * Absent evidence produces no observation: the criterion stays UNKNOWN,
 * which lowers coverage and confidence, never the score.
 *
 * Stage-aware: a pre-seed company is never read as weak for having no
 * revenue; the same pre-revenue statement at Series A or growth is.
 *
 * No volume bonus, and more information never dilutes a strength: per
 * criterion, signals with the same evidence weight are merged into ONE
 * observation whose reading is the affirmed one (strength or weakness over
 * "recorded"); strength and weakness together are kept apart so InvestIQ
 * marks the criterion CONFLICTED (withheld, investigated, never
 * penalised). Contradictory deck facts are CONTRADICTORY: withheld.
 */

/** v2 (ADR 0075): unconfirmed reads of open decks and investor-visible pitches. */
export const INVESTABILITY_INPUTS_VERSION = "investability-inputs.v2";

type Reading = InvestIQObservation["reading"];
type SourceKind = InvestIQObservation["provenance"]["sourceKind"];

type Signal = {
  readonly criterion: string;
  readonly reading: Reading;
  readonly statement: string;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly lifecycleStatus: LifecycleStatus;
  readonly sourceKind: SourceKind;
  readonly sourceRef: string | null;
  readonly observedAt: string | null;
  /** The rule that produced it (INVESTABILITY_INPUT_RULES). */
  readonly rule: string;
};

/** Every producer rule, for the trace, the "why" and the methodology doc. */
export const INVESTABILITY_INPUT_RULES = {
  "deck.section": "A confirmed deck section is on record for its criterion.",
  "deck.traction.early_dated_figure":
    "Pre-seed/seed: dated, quantified traction is above the stage baseline.",
  "deck.traction.late_pre_revenue":
    "Series A/growth: a stated pre-revenue position is below the stage baseline.",
  "deck.customers.early_figure":
    "Pre-seed/seed: a quantified customer base is above the stage baseline.",
  "deck.financials.early_historical":
    "Pre-seed/seed: dated historical financial figures exceed the stage baseline.",
  "deck.team.early_depth":
    "Pre-seed/seed: three or more named team facts show depth above baseline.",
  "deck.contradiction":
    "A contradictory deck fact withholds its criterion until reconciled.",
  "founder.prior_delivery":
    "A network-visible background line naming a prior company founded or an exit.",
  "founder.background":
    "A network-visible founder background line is on record.",
  "profile.description": "The listed profile describes the product.",
  "profile.business_model": "The listed profile declares its business model.",
  "verification.organisation":
    "The organisation is verified by Capital Q (platform verified).",
  "claim.network": "A network-visible evidence claim is on record.",
  "deck.unconfirmed":
    "ADR 0075: Q's reading of an unreviewed section of a deck open to all investors (Q inference, self-reported; never quoted).",
  "pitch.presented":
    "ADR 0075: the founder presents the product in a pitch investors may play.",
  "pitch.transcript":
    "ADR 0075: the pitch's generated transcript speaks to the topic (fixed patterns; never quoted).",
} as const;
export type InvestabilityInputRule = keyof typeof INVESTABILITY_INPUT_RULES;

const DECK_SECTION_CRITERION: Readonly<
  Partial<Record<DeckSectionCode, string>>
> = {
  PROBLEM: "pt.product_definition",
  SOLUTION: "pt.product_definition",
  VALUE_PROPOSITION: "pt.product_definition",
  MARKET: "mo.market_size",
  GO_TO_MARKET: "cp.distribution",
  BUSINESS_MODEL: "cp.business_model",
  TRACTION: "cp.traction",
  COMPETITION: "pt.competitive_advantage",
  FOUNDERS: "fl.founder_quality",
  TEAM: "fl.leadership_depth",
};

/** Network-visible claim types by their first segment. Others are not graded. */
const CLAIM_CRITERION: Readonly<Record<string, string>> = {
  financial: "fh.historical_financials",
  revenue: "fh.historical_financials",
  traction: "cp.traction",
  metric: "cp.traction",
  customers: "cp.customer_base",
  market: "mo.market_size",
  team: "fl.leadership_depth",
  compliance: "gir.regulatory_exposure",
  capital: "cs.raise_amount",
};

const PRE_REVENUE = /\bpre[- ]?revenue\b|\bno revenue\b/iu;
const CUSTOMER =
  /\b(customers?|clients?|users?|merchants?|subscribers?|accounts?|schools?|farmers?|patients?|pilots?)\b/iu;
const PROJECTION =
  /\b(forecast|projection|projected|plan(?:ned)?|target|budget)\b/iu;
const CASH = /\b(burn|runway|cash)\b/iu;
const PRICING = /\b(pric\w*|fee|subscription|commission|take rate|margin)\b/iu;
const USE_OF_FUNDS = /\b(use of funds|allocation|spend|hire|hiring)\b/iu;
const PRIOR_DELIVERY = /\b(founded|co-?founded|exit(?:ed)?|acquired|sold)\b/iu;

const early = (stage: StageBand | null) =>
  stage === "PRE_SEED" || stage === "SEED";
const late = (stage: StageBand | null) =>
  stage === "SERIES_A" || stage === "GROWTH";

const datedFigure = (fact: DeckFact) =>
  fact.kind === "FIGURE" && fact.value !== null && fact.asOf !== null;

const known = (fact: DeckFact) =>
  fact.value !== null && fact.unknownReason === null;

function strongest(statuses: readonly EvidenceStatus[]): EvidenceStatus {
  let best: EvidenceStatus = "SELF_REPORTED";
  for (const s of statuses) {
    if (EVIDENCE_STATUSES.indexOf(s) > EVIDENCE_STATUSES.indexOf(best)) {
      best = s;
    }
  }
  return best;
}

function factText(fact: DeckFact): string {
  return `${fact.label} ${fact.value ?? ""}`;
}

function iso(value: string | null): string | null {
  if (value === null) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function clip(text: string, max = 300): string {
  const one = text.replace(/\s+/gu, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function deckSignals(
  section: DeckSection,
  stage: StageBand | null,
  deck: NonNullable<InvestabilityInputs["deck"]>,
): Signal[] {
  if (section.status === "NOT_IN_DECK" || section.status === "UNCLEAR") {
    return [];
  }
  const facts = section.facts.filter(known);
  const base = {
    truthClass:
      facts.length > 0 && facts.every((f) => f.truthClass === "Q_INFERENCE")
        ? ("Q_INFERENCE" as const)
        : ("USER_CLAIM" as const),
    evidenceStatus: strongest(facts.map((f) => f.evidenceStatus)),
    sourceKind: "DECK" as const,
    sourceRef: `${deck.extractionId}:${section.section}`,
    observedAt: iso(deck.readAt),
  };
  const out: Signal[] = [];
  const add = (
    criterion: string,
    reading: Reading,
    rule: InvestabilityInputRule,
    statement: string,
    overrides: Partial<Signal> = {},
  ) =>
    out.push({
      ...base,
      lifecycleStatus: "CURRENT",
      criterion,
      reading,
      rule,
      statement: clip(statement),
      ...overrides,
    });

  const contradictory =
    section.status === "CONTRADICTORY" ||
    section.facts.some((f) => f.unknownReason === "CONTRADICTORY");
  const primary = DECK_SECTION_CRITERION[section.section];
  const summary = section.summary ?? section.section.toLowerCase();

  if (contradictory && primary !== undefined) {
    add(
      primary,
      "RECORDED",
      "deck.contradiction",
      `Contradictory: ${summary}`,
      {
        lifecycleStatus: "CONTRADICTORY",
      },
    );
  }

  switch (section.section) {
    case "TRACTION": {
      const said = [section.summary ?? "", ...facts.map(factText)].join(" ");
      const preRevenue = PRE_REVENUE.test(said);
      const dated = facts.filter(datedFigure);
      if (preRevenue && late(stage)) {
        add(
          "cp.traction",
          "INDICATES_WEAKNESS",
          "deck.traction.late_pre_revenue",
          `Pre-revenue at a stage that expects revenue: ${summary}`,
        );
      } else if (!preRevenue && dated.length > 0 && early(stage)) {
        add(
          "cp.traction",
          "SUPPORTS_STRENGTH",
          "deck.traction.early_dated_figure",
          `Dated traction: ${dated.map(factText).join("; ")}`,
          { evidenceStatus: strongest(dated.map((f) => f.evidenceStatus)) },
        );
      } else {
        add("cp.traction", "RECORDED", "deck.section", summary);
      }
      const customers = facts.filter((f) => CUSTOMER.test(factText(f)));
      if (customers.length > 0) {
        const figure = customers.some((f) => f.kind === "FIGURE");
        add(
          "cp.customer_base",
          figure && early(stage) ? "SUPPORTS_STRENGTH" : "RECORDED",
          figure && early(stage)
            ? "deck.customers.early_figure"
            : "deck.section",
          `Customers: ${customers.map(factText).join("; ")}`,
          {
            evidenceStatus: strongest(customers.map((f) => f.evidenceStatus)),
          },
        );
      }
      return out;
    }
    case "FINANCIALS": {
      const projections = facts.filter((f) => PROJECTION.test(factText(f)));
      const cash = facts.filter((f) => CASH.test(factText(f)));
      const historical = facts.filter(
        (f) =>
          datedFigure(f) &&
          !PROJECTION.test(factText(f)) &&
          !CASH.test(factText(f)),
      );
      if (historical.length > 0) {
        add(
          "fh.historical_financials",
          early(stage) ? "SUPPORTS_STRENGTH" : "RECORDED",
          early(stage) ? "deck.financials.early_historical" : "deck.section",
          `Historical figures: ${historical.map(factText).join("; ")}`,
          {
            evidenceStatus: strongest(historical.map((f) => f.evidenceStatus)),
          },
        );
      }
      if (projections.length > 0) {
        add(
          "fh.forecasts",
          "RECORDED",
          "deck.section",
          `Forecast: ${projections.map(factText).join("; ")}`,
        );
      }
      if (cash.length > 0) {
        add(
          "fh.cash_flow",
          "RECORDED",
          "deck.section",
          `Cash: ${cash.map(factText).join("; ")}`,
        );
      }
      if (contradictory) {
        add(
          "fh.historical_financials",
          "RECORDED",
          "deck.contradiction",
          `Contradictory: ${summary}`,
          { lifecycleStatus: "CONTRADICTORY" },
        );
      }
      if (
        historical.length + projections.length + cash.length === 0 &&
        section.summary !== null
      ) {
        add("fh.forecasts", "RECORDED", "deck.section", summary);
      }
      return out;
    }
    case "THE_ASK": {
      const ask = deckAskTerms([section]);
      if (ask.amount !== undefined) {
        add(
          "cs.raise_amount",
          "RECORDED",
          "deck.section",
          `Raise: ${ask.amount}`,
        );
      }
      if (ask.instrument !== undefined) {
        add(
          "cs.investment_structure",
          "RECORDED",
          "deck.section",
          `Instrument: ${ask.instrument}`,
        );
      }
      const funds = facts.filter((f) => USE_OF_FUNDS.test(factText(f)));
      if (funds.length > 0) {
        add(
          "cs.use_of_funds",
          "RECORDED",
          "deck.section",
          `Use of funds: ${funds.map(factText).join("; ")}`,
        );
      }
      if (contradictory) {
        add(
          "cs.raise_amount",
          "RECORDED",
          "deck.contradiction",
          `Contradictory: ${summary}`,
          { lifecycleStatus: "CONTRADICTORY" },
        );
      }
      return out;
    }
    case "TEAM": {
      add(
        "fl.leadership_depth",
        facts.length >= 3 && early(stage) ? "SUPPORTS_STRENGTH" : "RECORDED",
        facts.length >= 3 && early(stage)
          ? "deck.team.early_depth"
          : "deck.section",
        summary,
      );
      return out;
    }
    case "BUSINESS_MODEL": {
      add("cp.business_model", "RECORDED", "deck.section", summary);
      const pricing = facts.filter((f) => PRICING.test(factText(f)));
      if (pricing.length > 0) {
        add(
          "cp.revenue_model",
          "RECORDED",
          "deck.section",
          `Revenue model: ${pricing.map(factText).join("; ")}`,
        );
      }
      return out;
    }
    case "MARKET":
    case "PROBLEM":
    case "SOLUTION":
    case "VALUE_PROPOSITION":
    case "GO_TO_MARKET":
    case "COMPETITION":
    case "FOUNDERS": {
      if (primary !== undefined) {
        add(primary, "RECORDED", "deck.section", summary);
      }
      return out;
    }
  }
}

/** Observation source prefixes the "why" reads to decide what it may quote. */
export const UNCONFIRMED_DECK_REF = "deck-unconfirmed:";
export const PITCH_REF = "pitch:";

const PITCH_RULES: readonly {
  readonly criterion: string;
  readonly pattern: RegExp;
  /** The words must come with a figure (a digit) to count. */
  readonly figure: boolean;
}[] = [
  {
    criterion: "cp.traction",
    pattern: /\b(revenue|arr|mrr|sales|gmv|growing|growth)\b/iu,
    figure: true,
  },
  {
    criterion: "cp.customer_base",
    pattern: /\b(customers?|clients?|users?|merchants?|subscribers?)\b/iu,
    figure: true,
  },
  {
    criterion: "fl.founder_quality",
    pattern:
      /\b(co-?founders?|founded|years of experience|previously|ceo|cto)\b/iu,
    figure: false,
  },
  {
    criterion: "fl.leadership_depth",
    pattern: /\b(our team|engineers|hired|head of)\b/iu,
    figure: false,
  },
  {
    criterion: "mo.market_size",
    pattern: /\b(market|tam|billion)\b/iu,
    figure: false,
  },
  {
    criterion: "pt.competitive_advantage",
    pattern: /\b(compet\w*|alternatives?|unlike)\b/iu,
    figure: false,
  },
  {
    criterion: "cp.revenue_model",
    pattern: /\b(pric\w*|subscription|commission|fee|per month)\b/iu,
    figure: false,
  },
  {
    criterion: "cp.distribution",
    pattern: /\b(distribution|channels?|partners?|sell to|go-to-market)\b/iu,
    figure: false,
  },
  {
    criterion: "cs.raise_amount",
    pattern: /\b(raising|raise)\b/iu,
    figure: true,
  },
];

/**
 * ADR 0075: the pitch investors may play. Its existence records that the
 * founder presented the product; its generated transcript, read by fixed
 * patterns (never a model), records which topics they spoke to. Each is Q's
 * inference of what was said: self-reported at the most, never quoted,
 * never a strength or a weakness on its own.
 */
function pitchSignals(
  pitch: NonNullable<InvestabilityInputs["pitch"]>,
): Signal[] {
  const base = {
    reading: "RECORDED" as const,
    truthClass: "Q_INFERENCE" as const,
    evidenceStatus: "SELF_REPORTED" as const,
    lifecycleStatus: "CURRENT" as const,
    sourceKind: "Q_EXTRACTION" as const,
    sourceRef: `${PITCH_REF}${pitch.mediaAssetId}`,
    observedAt: iso(pitch.readyAt),
  };
  const out: Signal[] = [
    {
      ...base,
      criterion: "pt.product_definition",
      statement: "The founder presents the product in their pitch video.",
      rule: "pitch.presented",
    },
  ];
  const text = (pitch.transcript ?? "").slice(0, 20_000);
  if (text.trim() === "") return out;
  const sentences = text.split(/(?<=[.!?])\s+/u);
  for (const rule of PITCH_RULES) {
    const said = sentences.some(
      (sentence) =>
        rule.pattern.test(sentence) && (!rule.figure || /\d/u.test(sentence)),
    );
    if (said) {
      out.push({
        ...base,
        criterion: rule.criterion,
        statement: "Stated in their pitch video.",
        rule: "pitch.transcript",
      });
    }
  }
  return out;
}

/** The single rule that turns the inputs into observations. */
export function observeInvestability(
  inputs: InvestabilityInputs,
): readonly InvestIQObservation[] {
  if (!inputs.profile.listed) return [];
  const stage = stageBandOf(inputs.stageCode);
  const signals: Signal[] = [];

  // Listed profile: the founder's own words, shown to the network.
  const profileAt = iso(inputs.profile.updatedAt);
  if (inputs.profile.description) {
    signals.push({
      criterion: "pt.product_definition",
      reading: "RECORDED",
      statement: "The listed profile describes the product.",
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      sourceKind: "PROFILE",
      sourceRef: null,
      observedAt: profileAt,
      rule: "profile.description",
    });
  }
  if (inputs.businessModelCodes.length > 0) {
    signals.push({
      criterion: "cp.business_model",
      reading: "RECORDED",
      statement: `Declared business model: ${[...inputs.businessModelCodes].sort().join(", ")}`,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      sourceKind: "PROFILE",
      sourceRef: null,
      observedAt: profileAt,
      rule: "profile.business_model",
    });
  }

  // Verification shown to the network: evidence quality, never merit.
  if (inputs.verification.organisation) {
    signals.push({
      criterion: "gir.incorporation",
      reading: "RECORDED",
      statement: "The organisation is verified by Capital Q.",
      truthClass: "VERIFIED",
      evidenceStatus: "PLATFORM_VERIFIED",
      lifecycleStatus: "CURRENT",
      sourceKind: "THIRD_PARTY",
      sourceRef: "verification:organisation",
      observedAt: iso(inputs.verification.decidedAt),
      rule: "verification.organisation",
    });
  }

  // Founders' network-visible background lines, as one founder signal.
  const lines = inputs.founders.filter(
    (line) => line.visibilityScope === "network_visible",
  );
  if (lines.length > 0) {
    const prior = lines.filter((line) =>
      PRIOR_DELIVERY.test(`${line.title} ${line.detail ?? ""}`),
    );
    const chosen = prior.length > 0 ? prior : lines;
    signals.push({
      criterion: "fl.founder_quality",
      reading: prior.length > 0 ? "SUPPORTS_STRENGTH" : "RECORDED",
      statement: clip(
        `Founder background: ${chosen.map((l) => l.title).join("; ")}`,
      ),
      truthClass: "USER_CLAIM",
      evidenceStatus: chosen.some((l) => l.documentSupported)
        ? "DOCUMENT_SUPPORTED"
        : "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      sourceKind: "PROFILE",
      sourceRef: `founder:${[...chosen.map((l) => l.id)].sort()[0] ?? ""}`,
      observedAt: profileAt,
      rule: prior.length > 0 ? "founder.prior_delivery" : "founder.background",
    });
  }

  // Network-visible claims only; anything else is dropped here as well as
  // in the reader (defence in depth for the Context Firewall).
  for (const claim of inputs.claims) {
    if (
      !(INVESTOR_ELIGIBLE_SCOPES as readonly string[]).includes(
        claim.visibilityScope,
      )
    ) {
      continue;
    }
    const head = claim.claimType.split(".")[0] ?? "";
    const criterion = CLAIM_CRITERION[head];
    if (criterion === undefined) continue;
    signals.push({
      criterion,
      reading: "RECORDED",
      statement: clip(claim.statement),
      truthClass: claim.truthClass,
      evidenceStatus: claim.evidenceStatus,
      lifecycleStatus: claim.lifecycleStatus,
      sourceKind: "CLAIM",
      sourceRef: claim.id,
      observedAt: iso(claim.assertedAt),
      rule: "claim.network",
    });
  }

  if (inputs.deck !== null) {
    for (const section of inputs.deck.sections) {
      signals.push(...deckSignals(section, stage, inputs.deck));
    }
    // ADR 0075: Q's reading of sections the founder has not reviewed yet,
    // as Q's inference of what their own deck says: self-reported at the
    // most, never document-supported, never quoted. Q's own uncertainty
    // (a "contradictory" read) is not evidence of a contradiction here.
    const shown = new Set(
      inputs.deck.sections
        .filter((s) => s.status !== "UNCLEAR" && s.status !== "NOT_IN_DECK")
        .map((s) => s.section),
    );
    for (const section of inputs.deck.unconfirmed ?? []) {
      if (shown.has(section.section)) continue;
      for (const signal of deckSignals(section, stage, inputs.deck)) {
        if (signal.lifecycleStatus !== "CURRENT") continue;
        signals.push({
          ...signal,
          truthClass: "Q_INFERENCE",
          evidenceStatus: "SELF_REPORTED",
          sourceKind: "Q_EXTRACTION",
          sourceRef: `${UNCONFIRMED_DECK_REF}${inputs.deck.extractionId}:${section.section}`,
          rule: "deck.unconfirmed",
        });
      }
    }
  }

  if (inputs.pitch !== null && inputs.pitch !== undefined) {
    signals.push(...pitchSignals(inputs.pitch));
  }

  return mergeSignals(signals);
}

/**
 * One observation per (criterion, evidence weight, conflict class): the
 * affirmed reading wins over "recorded" at the same weight, so adding a
 * recorded fact can never dilute a strength or a weakness, and ten copies
 * of one fact count once.
 */
function mergeSignals(signals: readonly Signal[]): InvestIQObservation[] {
  const groups = new Map<string, Signal[]>();
  for (const s of signals) {
    const draft = toObservation(s, "x");
    const w = observationWeight(draft).toFixed(4);
    const conflictClass =
      s.lifecycleStatus === "CONTRADICTORY" || s.lifecycleStatus === "DISPUTED"
        ? "conflict"
        : s.reading === "INDICATES_WEAKNESS"
          ? "weak"
          : "plain";
    const key = `${s.criterion}|${w}|${conflictClass}|${s.truthClass}|${s.evidenceStatus}|${s.lifecycleStatus}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: InvestIQObservation[] = [];
  for (const [key, members] of [...groups.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const sorted = [...members].sort((a, b) =>
      `${a.rule}|${a.sourceRef ?? ""}|${a.statement}` <
      `${b.rule}|${b.sourceRef ?? ""}|${b.statement}`
        ? -1
        : 1,
    );
    const strength = sorted.filter((s) => s.reading === "SUPPORTS_STRENGTH");
    const weakness = sorted.filter((s) => s.reading === "INDICATES_WEAKNESS");
    const chosen = weakness[0] ?? strength[0] ?? sorted[0];
    if (chosen === undefined) continue;
    const latest = sorted
      .map((s) => s.observedAt)
      .filter((t): t is string => t !== null)
      .sort()
      .at(-1);
    out.push(
      toObservation(
        { ...chosen, observedAt: latest ?? null },
        `${key.split("|")[0] ?? ""}:${hashKey(key)}`,
      ),
    );
  }
  return out;
}

function toObservation(s: Signal, id: string): InvestIQObservation {
  return {
    id,
    criterion: s.criterion,
    reading: s.reading,
    statement: s.statement.length === 0 ? s.rule : s.statement,
    truthClass: s.truthClass,
    evidenceStatus: s.evidenceStatus,
    lifecycleStatus: s.lifecycleStatus,
    provenance: {
      sourceKind: s.sourceKind,
      sourceRef: s.sourceRef === null ? null : s.sourceRef.slice(0, 200),
      observedAt: s.observedAt,
    },
  };
}

/** Short, stable, readable id suffix (FNV-1a). */
function hashKey(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
