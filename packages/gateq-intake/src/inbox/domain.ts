import type {
  GateqFitBand,
  GateqInboxItemDto,
  GateqInboxView,
  GateqPassReason,
  GateqReplyState,
} from "@capital-q/contracts";

/**
 * F4: the investor's GateQ inbox, as pure functions over what was
 * submitted. Nothing here decides fit: the band is the engine's outcome
 * recorded at submission, the rules are its per-criterion statuses, and
 * the founder's answers are their own words. Unknown stays unknown.
 */

// ---------------------------------------------------------------------------
// Reading the frozen submission
// ---------------------------------------------------------------------------

type FactValue =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "CODE"; readonly code: string }
  | {
      readonly kind: "AMOUNT";
      readonly amount: string;
      readonly currency: string;
    }
  | { readonly kind: "PHRASES"; readonly phrases: readonly string[] }
  | { readonly kind: "NONE" };

export type SnapshotFact = {
  readonly dimension: string;
  readonly value: FactValue;
  readonly provenance: string;
};

export type Submitted = {
  readonly declaredName: string | null;
  readonly reference: string;
  readonly facts: readonly SnapshotFact[];
  readonly documentIds: readonly string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function factValue(value: unknown): FactValue | null {
  if (!isRecord(value)) return null;
  switch (value["kind"]) {
    case "TEXT":
      return typeof value["text"] === "string"
        ? { kind: "TEXT", text: value["text"] }
        : null;
    case "CODE":
      return typeof value["code"] === "string"
        ? { kind: "CODE", code: value["code"] }
        : null;
    case "AMOUNT":
      return typeof value["amount"] === "string" &&
        typeof value["currency"] === "string"
        ? {
            kind: "AMOUNT",
            amount: value["amount"],
            currency: value["currency"],
          }
        : null;
    case "PHRASES":
      return Array.isArray(value["phrases"])
        ? {
            kind: "PHRASES",
            phrases: value["phrases"].filter(
              (p): p is string => typeof p === "string",
            ),
          }
        : null;
    case "NONE":
      return { kind: "NONE" };
    default:
      return null;
  }
}

/** The submission's snapshot, read defensively: it is stored JSON. */
export function readSnapshot(snapshot: unknown): Submitted {
  const record = isRecord(snapshot) ? snapshot : {};
  const facts = Array.isArray(record["facts"]) ? record["facts"] : [];
  return {
    declaredName:
      typeof record["declaredName"] === "string"
        ? record["declaredName"]
        : null,
    reference:
      typeof record["reference"] === "string" ? record["reference"] : "",
    facts: facts.flatMap((fact): SnapshotFact[] => {
      if (!isRecord(fact) || typeof fact["dimension"] !== "string") return [];
      const value = factValue(fact["value"]);
      return value === null
        ? []
        : [
            {
              dimension: fact["dimension"],
              value,
              provenance:
                typeof fact["provenance"] === "string"
                  ? fact["provenance"]
                  : "UNKNOWN",
            },
          ];
    }),
    documentIds: Array.isArray(record["documentIds"])
      ? record["documentIds"].filter(
          (id): id is string =>
            typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id),
        )
      : [],
  };
}

export type CriterionRead = {
  readonly label: string;
  readonly dimension: string;
  readonly required: boolean;
  readonly status: "MATCH" | "NO_MATCH" | "UNKNOWN" | "NOT_APPLICABLE";
};

export type QualificationRead = {
  readonly outcome: "QUALIFIED" | "NOT_QUALIFIED" | "INSUFFICIENT_INFORMATION";
  readonly criteria: readonly CriterionRead[];
};

export function readQualification(qualification: unknown): QualificationRead {
  const record = isRecord(qualification) ? qualification : {};
  const outcome = record["outcome"];
  const criteria = Array.isArray(record["criteria"]) ? record["criteria"] : [];
  return {
    // An outcome we cannot read is not a fit: it is "not enough to say".
    outcome:
      outcome === "QUALIFIED" || outcome === "NOT_QUALIFIED"
        ? outcome
        : "INSUFFICIENT_INFORMATION",
    criteria: criteria.flatMap((c): CriterionRead[] => {
      if (!isRecord(c) || typeof c["label"] !== "string") return [];
      const status = c["status"];
      return [
        {
          label: c["label"],
          dimension: typeof c["type"] === "string" ? c["type"] : "",
          required: c["requiredness"] === "REQUIRED",
          status:
            status === "MATCH" ||
            status === "NO_MATCH" ||
            status === "NOT_APPLICABLE"
              ? status
              : "UNKNOWN",
        },
      ];
    }),
  };
}

export function fitBandOf(read: QualificationRead): GateqFitBand {
  if (read.outcome === "QUALIFIED") return "FITS";
  if (read.outcome === "NOT_QUALIFIED") return "NOT_A_FIT";
  return "PARTIAL";
}

export function rulesOf(read: QualificationRead) {
  const counted = read.criteria.filter((c) => c.status !== "NOT_APPLICABLE");
  return {
    met: counted.filter((c) => c.status === "MATCH").length,
    total: counted.length,
    unknown: counted.filter((c) => c.status === "UNKNOWN").length,
  };
}

const STAGE_WORDS: Readonly<Record<string, string>> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c_plus: "Series C or later",
};

const INSTRUMENT_WORDS: Readonly<Record<string, string>> = {
  SAFE: "SAFE",
  EQUITY: "Equity",
  CONVERTIBLE_NOTE: "Convertible note",
  NOT_DECIDED: "Not decided",
};

const LEAD_WORDS: Readonly<Record<string, string>> = {
  HAS_LEAD: "Has a lead",
  LOOKING: "Looking for a lead",
  NOT_NEEDED: "No lead needed",
};

let regions: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

/** What the founder told the gate, in words, with "not said" kept as such. */
export function profileOf(submitted: Submitted) {
  const current = new Map(
    submitted.facts.map((fact) => [fact.dimension, fact.value]),
  );
  const text = (dimension: string): string | null => {
    const value = current.get(dimension);
    return value?.kind === "TEXT" ? value.text : null;
  };
  const code = (dimension: string): string | null => {
    const value = current.get(dimension);
    return value?.kind === "CODE" ? value.code : null;
  };
  const amount = current.get("raise.amount");
  const sectors = current.get("company.sector_phrases");
  const stage = code("company.stage");
  const country = code("company.country");
  return {
    companyName: submitted.declaredName ?? text("company.name") ?? "A company",
    oneLiner: text("company.description"),
    website: text("company.website"),
    stage: stage === null ? null : (STAGE_WORDS[stage] ?? stage),
    sector: sectors?.kind === "PHRASES" ? sectors.phrases.join(", ") : null,
    country: country === null ? null : countryName(country),
    raise:
      amount?.kind === "AMOUNT"
        ? { amount: amount.amount, currency: amount.currency }
        : null,
    instrument: (() => {
      const value = code("raise.instrument");
      return value === null ? null : (INSTRUMENT_WORDS[value] ?? value);
    })(),
    lead: (() => {
      const value = code("raise.lead_status");
      return value === null ? null : (LEAD_WORDS[value] ?? value);
    })(),
    note: text("application.note"),
    contactName: text("contact.name"),
    contactEmail: text("contact.email"),
    /** Asked and declined: "I'd rather not say". */
    declined: submitted.facts
      .filter((fact) => fact.value.kind === "NONE")
      .map((fact) => fact.dimension),
  };
}

export function moneyWords(raise: {
  readonly amount: string;
  readonly currency: string;
}): string {
  const value = Number(raise.amount);
  const symbol = raise.currency === "USD" ? "$" : `${raise.currency} `;
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${symbol}${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) return `${symbol}${Math.round(value / 1_000)}k`;
  return `${symbol}${raise.amount}`;
}

// ---------------------------------------------------------------------------
// The reply promise
// ---------------------------------------------------------------------------

/** Monday to Friday; public holidays are not modelled, and the copy says "working days". */
export function addWorkingDays(from: Date, days: number): Date {
  const at = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  let left = days;
  while (left > 0) {
    at.setUTCDate(at.getUTCDate() + 1);
    const day = at.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return at;
}

export function workingDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const sign = end >= start ? 1 : -1;
  let count = 0;
  const cursor = new Date(Math.min(start, end));
  const stop = Math.max(start, end);
  while (cursor.getTime() < stop) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return sign * count;
}

export function replyPromise(input: {
  readonly submittedAt: Date;
  readonly replyWithinDays: number | null;
  readonly answered: boolean;
  readonly now: Date;
}): {
  readonly replyBy: string | null;
  readonly state: GateqReplyState;
  readonly daysLeft: number | null;
} {
  if (input.replyWithinDays === null) {
    return {
      replyBy: null,
      state: input.answered ? "ANSWERED" : "NONE",
      daysLeft: null,
    };
  }
  const due = addWorkingDays(input.submittedAt, input.replyWithinDays);
  const replyBy = due.toISOString().slice(0, 10);
  if (input.answered) return { replyBy, state: "ANSWERED", daysLeft: null };
  const daysLeft = workingDaysBetween(input.now, due);
  // Front's model: a warning once three quarters of the time has gone.
  const state: GateqReplyState =
    daysLeft < 0
      ? "OVERDUE"
      : daysLeft <= Math.floor(input.replyWithinDays / 4)
        ? "DUE_SOON"
        : "ON_TRACK";
  return { replyBy, state, daysLeft };
}

// ---------------------------------------------------------------------------
// Views, counts and order
// ---------------------------------------------------------------------------

export function inView(
  item: Pick<
    GateqInboxItemDto,
    "folder" | "starred" | "fit" | "assignee" | "rules"
  >,
  view: GateqInboxView,
  viewerUserId: string,
): boolean {
  switch (view) {
    case "INBOX":
      return item.folder === "INBOX";
    case "STARRED":
      return item.starred;
    case "ASSIGNED_TO_ME":
      return item.folder === "INBOX" && item.assignee?.userId === viewerUserId;
    case "FITS":
      // F28: zero rules checked is a neutral bucket, never "fits".
      return (
        item.folder === "INBOX" && item.fit === "FITS" && item.rules.total > 0
      );
    case "PARTIAL":
      return item.folder === "INBOX" && item.fit === "PARTIAL";
    case "NOT_A_FIT":
      return item.folder === "INBOX" && item.fit === "NOT_A_FIT";
    case "PASSED":
      return item.folder === "PASSED";
    case "ARCHIVED":
      return item.folder === "ARCHIVED";
  }
}

const FIT_ORDER: Readonly<Record<GateqFitBand, number>> = {
  FITS: 0,
  PARTIAL: 1,
  NOT_A_FIT: 2,
};

/**
 * Closest to the promised reply first, then best fit, then oldest: founder
 * trust and "reply to every qualified application" over activity volume.
 */
export function inboxOrder(a: GateqInboxItemDto, b: GateqInboxItemDto): number {
  const due = (item: GateqInboxItemDto) =>
    item.daysLeft === null ? Number.POSITIVE_INFINITY : item.daysLeft;
  return (
    due(a) - due(b) ||
    FIT_ORDER[a.fit] - FIT_ORDER[b.fit] ||
    Date.parse(b.submittedAt) - Date.parse(a.submittedAt)
  );
}

export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "");
  const letters =
    parts.length === 1
      ? (parts[0] ?? "").slice(0, 2)
      : `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`;
  return letters.toUpperCase() || "?";
}

// ---------------------------------------------------------------------------
// Q's help: proposals and drafts, never decisions
// ---------------------------------------------------------------------------

export const PASS_REASON_WORDS: Readonly<Record<GateqPassReason, string>> = {
  OUTSIDE_STAGE: "Outside our stage",
  OUTSIDE_SECTOR: "Outside our sector",
  CHEQUE_DOES_NOT_FIT: "Cheque doesn't fit",
  TIMING: "Timing",
  OTHER: "Other",
};

/** The reason a rule-based mismatch suggests; the investor can pick another. */
export function suggestedReason(read: QualificationRead): GateqPassReason {
  const missed = read.criteria.find(
    (c) => c.required && c.status === "NO_MATCH",
  );
  const byDimension: Readonly<Record<string, GateqPassReason>> = {
    STAGE: "OUTSIDE_STAGE",
    TAXONOMY: "OUTSIDE_SECTOR",
    EXCLUDED_TAXONOMY: "OUTSIDE_SECTOR",
    RAISE_SIZE: "CHEQUE_DOES_NOT_FIT",
    CHEQUE_COMPATIBILITY: "CHEQUE_DOES_NOT_FIT",
  };
  return (
    (missed === undefined ? undefined : byDimension[missed.dimension]) ??
    "OTHER"
  );
}

/**
 * A first draft of a respectful, specific pass. Q may rephrase it in the
 * investor's style; whoever sends it approves the exact words.
 */
export function draftPassMessage(input: {
  readonly founderName: string | null;
  readonly companyName: string;
  readonly fund: string;
  readonly reason: GateqPassReason;
}): string {
  const hello =
    input.founderName === null
      ? "Hi,"
      : `Hi ${input.founderName.split(/\s+/)[0]},`;
  const why: Readonly<Record<GateqPassReason, string>> = {
    OUTSIDE_STAGE: `${input.companyName} is at a different stage from where we invest, so we can't take this round.`,
    OUTSIDE_SECTOR: `${input.companyName} sits outside the sectors we back, so we can't take this round.`,
    CHEQUE_DOES_NOT_FIT: `the size of this round doesn't fit the cheques we write, so we can't take it.`,
    TIMING: `the timing doesn't work for us right now, so we can't take this round.`,
    OTHER: `we've decided not to take this round.`,
  };
  return `${hello} thank you for applying to ${input.fund}. After looking at it carefully, ${why[input.reason]} We'd be glad to hear from you when you raise next.`;
}

export type TriageProposal = {
  readonly applicationId: string;
  readonly companyName: string;
  readonly propose: "REVIEW_FIRST" | "ASK_FOR_MORE" | "PREPARE_PASS";
  readonly why: string;
  readonly suggestedReason: GateqPassReason | null;
};

/**
 * Q's triage (F4): a proposal for each open application, from the engine's
 * outcome and the reply promise alone. Q never passes on anyone's behalf:
 * a PREPARE_PASS is a draft for a person to approve.
 */
export function triage(
  items: readonly (Pick<
    GateqInboxItemDto,
    "applicationId" | "companyName" | "fit" | "rules" | "replyState" | "folder"
  > & {
    readonly read: QualificationRead;
  })[],
): readonly TriageProposal[] {
  return items
    .filter((item) => item.folder === "INBOX")
    .map((item) => {
      // F28: a gate with no published rules checked nothing; never "meets
      // every rule".
      if (item.rules.total === 0) {
        return {
          applicationId: item.applicationId,
          companyName: item.companyName,
          propose: "REVIEW_FIRST" as const,
          why: "Your gate has no published rules yet, so nothing was checked.",
          suggestedReason: null,
        };
      }
      if (item.fit === "NOT_A_FIT") {
        return {
          applicationId: item.applicationId,
          companyName: item.companyName,
          propose: "PREPARE_PASS" as const,
          why: "A required rule of your gate is not met.",
          suggestedReason: suggestedReason(item.read),
        };
      }
      if (item.fit === "PARTIAL" || item.rules.unknown > 0) {
        return {
          applicationId: item.applicationId,
          companyName: item.companyName,
          propose: "ASK_FOR_MORE" as const,
          why: `${item.rules.unknown} of your rules ${item.rules.unknown === 1 ? "is" : "are"} unanswered; unknown is not a no.`,
          suggestedReason: null,
        };
      }
      return {
        applicationId: item.applicationId,
        companyName: item.companyName,
        propose: "REVIEW_FIRST" as const,
        why:
          item.replyState === "DUE_SOON" || item.replyState === "OVERDUE"
            ? "Meets every rule, and your reply promise is close."
            : "Meets every rule of your gate.",
        suggestedReason: null,
      };
    });
}
