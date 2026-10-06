import type {
  CapitalRoundInstrument,
  CapitalRoundNotice,
  CapitalRoundStatus,
  CapitalRoundStep,
  CapitalRoundTerms,
} from "@capital-q/contracts";

/**
 * Round lifecycle, notices and the investor's ownership estimate (plan P8;
 * research: docs/research/2026-10-06/funding-rounds.md). Pure and
 * deterministic: no I/O, no clock unless passed, exact decimals only.
 */

// ---------------------------------------------------------------------------
// Exact decimals
// ---------------------------------------------------------------------------

/** A non-negative exact decimal string as an integer at a fixed scale. */
function scaled(value: string, scale: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  const padded = fraction.padEnd(scale, "0").slice(0, scale);
  return BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt(padded || "0");
}

const SCALE = 6;

/** -1, 0 or 1: exact comparison of two non-negative decimal strings. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = scaled(a, SCALE);
  const y = scaled(b, SCALE);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Exact sum of non-negative decimal strings, normalised (no trailing zeros). */
export function addDecimal(...values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + scaled(value, SCALE), 0n);
  const unit = 10n ** BigInt(SCALE);
  const fraction = (total % unit)
    .toString()
    .padStart(SCALE, "0")
    .replace(/0+$/, "");
  return fraction === ""
    ? (total / unit).toString()
    : `${(total / unit).toString()}.${fraction}`;
}

/** Basis points (0..10000) of part over whole, rounded down; null when whole is 0. */
export function basisPoints(part: string, whole: string): number | null {
  const of = scaled(whole, SCALE);
  if (of <= 0n) return null;
  const bp = (scaled(part, SCALE) * 10000n) / of;
  return Number(bp > 10000n ? 10000n : bp);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type StepRefusal =
  | "NOT_FROM_THIS_STATUS"
  /** Money has closed in it: final-close it instead of cancelling. */
  | "MONEY_HAS_CLOSED";

export type StepOutcome =
  | { readonly ok: true; readonly status: CapitalRoundStatus }
  | { readonly ok: false; readonly refusal: StepRefusal };

/**
 * The lifecycle, one table. PLANNED -> OPEN -> FIRST_CLOSED -> CLOSED;
 * CANCELLED from PLANNED or OPEN (only while no money has closed); a closed
 * round reopens to FIRST_CLOSED (an extension or a second close keeps its
 * earlier closes), a cancelled one to OPEN. A tranche is money closing, so
 * in an open round it is also the first close; after the final close it is
 * milestone money arriving.
 */
const TRANSITIONS: Readonly<
  Record<
    CapitalRoundStatus,
    Partial<Record<CapitalRoundStep, CapitalRoundStatus>>
  >
> = {
  PLANNED: { OPEN: "OPEN", CANCEL: "CANCELLED" },
  OPEN: {
    CLOSE: "FIRST_CLOSED",
    TRANCHE: "FIRST_CLOSED",
    FINAL_CLOSE: "CLOSED",
    CANCEL: "CANCELLED",
  },
  FIRST_CLOSED: {
    CLOSE: "FIRST_CLOSED",
    TRANCHE: "FIRST_CLOSED",
    FINAL_CLOSE: "CLOSED",
  },
  CLOSED: { TRANCHE: "CLOSED", REOPEN: "FIRST_CLOSED" },
  CANCELLED: { REOPEN: "OPEN" },
};

export function nextRoundStatus(
  status: CapitalRoundStatus,
  step: CapitalRoundStep,
  facts: { readonly moneyHasClosed: boolean },
): StepOutcome {
  // A round where money has closed is final-closed, never cancelled: the
  // money happened (FIRST_CLOSED always has; OPEN may have received some).
  if (
    step === "CANCEL" &&
    (status === "FIRST_CLOSED" || facts.moneyHasClosed)
  ) {
    return { ok: false, refusal: "MONEY_HAS_CLOSED" };
  }
  const next = TRANSITIONS[status][step];
  if (next === undefined) return { ok: false, refusal: "NOT_FROM_THIS_STATUS" };
  return { ok: true, status: next };
}

/** The steps a round in this status can take (for the page and Q). */
export function availableRoundSteps(
  status: CapitalRoundStatus,
): readonly CapitalRoundStep[] {
  return Object.keys(TRANSITIONS[status]) as CapitalRoundStep[];
}

/** Statuses in which a round is raising (counts as "open" for overlaps). */
export function isRaising(status: CapitalRoundStatus): boolean {
  return status === "OPEN" || status === "FIRST_CLOSED";
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export type TermsRefusal =
  | "HARD_CAP_BELOW_TARGET"
  | "CLOSE_DATE_BEFORE_OPEN"
  | "EXTENDS_ITSELF";

/** Cross-field rules the schema cannot see. */
export function checkRoundTerms(input: {
  readonly id: string | null;
  readonly target: string;
  readonly openedOn: string | null;
  readonly terms: CapitalRoundTerms;
}): TermsRefusal | null {
  const { terms } = input;
  if (
    terms.hardCap !== null &&
    compareDecimal(terms.hardCap, input.target) < 0
  ) {
    return "HARD_CAP_BELOW_TARGET";
  }
  if (
    terms.targetCloseOn !== null &&
    input.openedOn !== null &&
    terms.targetCloseOn < input.openedOn
  ) {
    return "CLOSE_DATE_BEFORE_OPEN";
  }
  if (input.id !== null && terms.extendsRoundId === input.id) {
    return "EXTENDS_ITSELF";
  }
  return null;
}

export const EMPTY_TERMS: CapitalRoundTerms = {
  targetCloseOn: null,
  valuation: null,
  valuationCap: null,
  discountPercent: null,
  hardCap: null,
  proRataRights: null,
  lead: null,
  extendsRoundId: null,
  reportedRaised: null,
};

/** Flat text of each term, for a history entry's before/after. */
function termText(terms: CapitalRoundTerms): Record<string, string | null> {
  return {
    targetCloseOn: terms.targetCloseOn,
    valuation:
      terms.valuation === null
        ? null
        : `${terms.valuation.amount} ${terms.valuation.basis}`,
    valuationCap: terms.valuationCap,
    discountPercent: terms.discountPercent,
    hardCap: terms.hardCap,
    proRataRights: terms.proRataRights,
    lead:
      terms.lead === null
        ? null
        : terms.lead.kind === "NAMED"
          ? terms.lead.name
          : `relationship:${terms.lead.relationshipId}`,
    extendsRoundId: terms.extendsRoundId,
    reportedRaised: terms.reportedRaised,
  };
}

export type RoundFacts = {
  readonly name: string;
  readonly target: string;
  readonly currency: string;
  readonly instrument: CapitalRoundInstrument;
  readonly openedOn: string | null;
  readonly terms: CapitalRoundTerms;
};

/** What changed between two versions of a round: field, before, after. */
export function roundChanges(
  before: RoundFacts,
  after: RoundFacts,
): { field: string; from: string | null; to: string | null }[] {
  const flat = (facts: RoundFacts): Record<string, string | null> => ({
    name: facts.name,
    target: `${facts.target} ${facts.currency}`,
    instrument: facts.instrument,
    openedOn: facts.openedOn,
    ...termText(facts.terms),
  });
  const from = flat(before);
  const to = flat(after);
  return Object.keys(to)
    .filter((field) => (from[field] ?? null) !== (to[field] ?? null))
    .map((field) => ({
      field,
      from: from[field] ?? null,
      to: to[field] ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export type NoticeInput = {
  readonly round: {
    readonly id: string;
    readonly status: CapitalRoundStatus;
    readonly target: string;
    readonly hardCap: string | null;
    readonly targetCloseOn: string | null;
    readonly reportedRaised: string | null;
  };
  /** In the round's currency: received, confirmed, pledged. */
  readonly sums: {
    readonly raised: string;
    readonly confirmed: string;
    readonly pledged: string;
  };
  readonly otherCurrencyCount: number;
  readonly otherRounds: readonly {
    readonly id: string;
    readonly status: CapitalRoundStatus;
  }[];
  /** YYYY-MM-DD. */
  readonly today: string;
};

/**
 * What the page should say about a round, deterministic and ordered.
 * "Committed" is received plus confirmed (both sides agreed); pledges are
 * one side's word and never make a round oversubscribed.
 */
export function roundNotices(input: NoticeInput): CapitalRoundNotice[] {
  const { round, sums } = input;
  const notices: CapitalRoundNotice[] = [];
  const committed = addDecimal(sums.raised, sums.confirmed);
  if (round.hardCap !== null && compareDecimal(committed, round.hardCap) > 0) {
    notices.push("OVER_HARD_CAP");
  } else if (compareDecimal(committed, round.target) > 0) {
    notices.push("OVER_TARGET");
  }
  if (
    isRaising(round.status) &&
    input.otherRounds.some(
      (other) => other.id !== round.id && isRaising(other.status),
    )
  ) {
    notices.push("OVERLAPS_OPEN_ROUND");
  }
  if (input.otherCurrencyCount > 0) notices.push("OTHER_CURRENCY");
  if (
    round.status === "CLOSED" &&
    compareDecimal(sums.raised, "0") === 0 &&
    round.reportedRaised === null
  ) {
    notices.push("CLOSED_EMPTY");
  }
  if (
    isRaising(round.status) &&
    round.targetCloseOn !== null &&
    round.targetCloseOn < input.today
  ) {
    notices.push("PAST_TARGET_CLOSE");
  }
  return notices;
}

// ---------------------------------------------------------------------------
// The investor's ownership estimate
// ---------------------------------------------------------------------------

/**
 * Their amount over the post-money valuation (a priced round) or over the
 * cap (a SAFE or ASA, read as a post-money cap). An ESTIMATE before later
 * dilution and conversion; null when the currency differs or nothing usable
 * is known. A pre-money valuation alone is not enough: the round's final
 * size, which the investor does not see, decides the post-money.
 */
export function ownershipEstimate(input: {
  readonly amount: string;
  readonly currency: string;
  readonly roundCurrency: string;
  readonly instrument: CapitalRoundInstrument;
  readonly terms: Pick<CapitalRoundTerms, "valuation" | "valuationCap">;
}): { basisPoints: number; from: "POST_MONEY" | "CAP" } | null {
  if (input.currency !== input.roundCurrency) return null;
  const { valuation, valuationCap } = input.terms;
  if (valuation !== null && valuation.basis === "POST_MONEY") {
    const bp = basisPoints(input.amount, valuation.amount);
    return bp === null ? null : { basisPoints: bp, from: "POST_MONEY" };
  }
  if (
    valuationCap !== null &&
    (input.instrument === "SAFE" || input.instrument === "ASA")
  ) {
    const bp = basisPoints(input.amount, valuationCap);
    return bp === null ? null : { basisPoints: bp, from: "CAP" };
  }
  return null;
}
