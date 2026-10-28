import { createHash } from "node:crypto";

import {
  QFindingIdSchema,
  type QArtifactFinding,
  type TruthClass,
  type EvidenceStatus,
} from "@capital-q/contracts";

/**
 * Claims vs evidence (diligence audit 2026-10-28). A diligence memo set
 * nothing the company says against anything public: the specialist's
 * contradictions were computed and dropped, and public facts were never
 * compared with the company's own figures.
 *
 * Deterministic, never a model: a company's stated figure (its record's
 * USER_CLAIM or self-reported findings, and figures in its data room as
 * the person may read it) is paired with an admitted public fact about the
 * same company and the same measure (revenue, customers, funding,
 * headcount), in the same currency and period. Within 15% is CORROBORATED,
 * beyond it CONTRADICTED -- both sides shown, neither picked. A claim with
 * nothing comparable is UNVERIFIED, which is not a mark against it.
 * Contradictions Capital Q's own record already holds are shown as they
 * stand, every side labelled.
 */

export const CLAIM_MEASURES = [
  "FUNDING",
  "REVENUE",
  "CUSTOMERS",
  "EMPLOYEES",
] as const;
export type ClaimMeasure = (typeof CLAIM_MEASURES)[number];

const MEASURE_WORDS: Readonly<Record<ClaimMeasure, RegExp>> = {
  FUNDING:
    /\b(?:raised|raise|funding|seed round|pre-seed|series [a-e]|investment round|backed with)\b/iu,
  REVENUE:
    /\b(?:revenue|revenues|arr|mrr|annual recurring revenue|turnover|sales|gmv|income)\b/iu,
  CUSTOMERS:
    /\b(?:customers|clients|merchants|users|subscribers|businesses served)\b/iu,
  EMPLOYEES: /\b(?:employees|staff|headcount|team of|people employed)\b/iu,
};

const MONEY_MEASURES: ReadonlySet<ClaimMeasure> = new Set([
  "FUNDING",
  "REVENUE",
]);

/** Within this ratio, two figures agree. */
const AGREEMENT_RATIO = 1.15;

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = {
  $: "USD",
  "£": "GBP",
  "€": "EUR",
};
const MONEY =
  /(?:([$£€])\s?|\b(USD|EUR|GBP|KES|KSH|NGN|ZAR|GHS)\s?)(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|mn|bn|[kmb])?\b/iu;
const COUNT =
  /\b(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|[km])?\+?\s+(?:paying\s+|active\s+|enterprise\s+|business\s+)?(?:customers|clients|merchants|users|subscribers|businesses|employees|staff|people)\b/iu;
const TEAM_OF = /\bteam of\s+(\d[\d,]*)\b/iu;
const YEAR = /\b(20\d\d)\b/u;

function scale(unit: string | undefined): number {
  switch ((unit ?? "").toLowerCase()) {
    case "k":
    case "thousand":
      return 1_000;
    case "m":
    case "mn":
    case "million":
      return 1_000_000;
    case "b":
    case "bn":
    case "billion":
      return 1_000_000_000;
    default:
      return 1;
  }
}

export type MeasuredFigure = {
  readonly measure: ClaimMeasure;
  readonly value: number;
  /** ISO code for money; null for a count. */
  readonly currency: string | null;
  /** The year the statement names, if any. */
  readonly year: string | null;
};

/** The measure and figure a statement states, or null. */
export function measureOf(statement: string): MeasuredFigure | null {
  const measure = CLAIM_MEASURES.find((one) =>
    MEASURE_WORDS[one].test(statement),
  );
  if (measure === undefined) return null;
  const year = YEAR.exec(statement)?.[1] ?? null;
  if (MONEY_MEASURES.has(measure)) {
    const money = MONEY.exec(statement);
    if (money === null) return null;
    const raw = Number((money[3] ?? "").replace(/,/gu, ""));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const code = (money[2] ?? "").toUpperCase();
    return {
      measure,
      value: raw * scale(money[4]),
      currency:
        money[1] !== undefined
          ? (CURRENCY_SYMBOL[money[1]] ?? null)
          : code === "KSH"
            ? "KES"
            : code,
      year,
    };
  }
  const count = COUNT.exec(statement) ?? TEAM_OF.exec(statement);
  if (count === null) return null;
  const raw = Number((count[1] ?? "").replace(/,/gu, ""));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return {
    measure,
    value: raw * scale(count[2]),
    currency: null,
    year,
  };
}

export type CompanyClaim = {
  readonly statement: string;
  /** Where it was stated, as the person reads it ("its record", "data room: Q3 report"). */
  readonly source: string;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
};

export type PublicEvidence = {
  readonly statement: string;
  /** The S number the document's Sources list gives it. */
  readonly sourceIndex: number;
  readonly domain: string;
  readonly asOf: string | null;
};

export type ClaimStatus = "CORROBORATED" | "CONTRADICTED" | "UNVERIFIED";

export type ClaimRow = {
  readonly measure: ClaimMeasure | null;
  readonly status: ClaimStatus;
  readonly claim: CompanyClaim;
  /** What it was set against: public facts, or the record's other statements. */
  readonly evidence: readonly {
    readonly statement: string;
    readonly source: string;
    readonly sourceIndex: number | null;
  }[];
  /** Why it is UNVERIFIED when something was found but not comparable. */
  readonly note: string | null;
};

function mentions(statement: string, name: string): boolean {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (escaped.length < 2) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(statement);
}

function agrees(a: number, b: number): boolean {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return low > 0 && high / low <= AGREEMENT_RATIO;
}

export const CLAIM_ROWS_MAX = 16;

/** Every stated figure set against the public facts about the company. */
export function matchClaims(input: {
  readonly companyName: string | null;
  readonly claims: readonly CompanyClaim[];
  readonly evidence: readonly PublicEvidence[];
  /** Contradictions the record already holds: each set's statements. */
  readonly recordContradictions?: readonly (readonly string[])[] | undefined;
}): readonly ClaimRow[] {
  const name = input.companyName;
  // A public fact counts only when it names the company: a market's
  // revenue is not the company's.
  const about = input.evidence
    .filter((fact) => name !== null && mentions(fact.statement, name))
    .map((fact) => ({ fact, figure: measureOf(fact.statement) }))
    .filter(
      (entry): entry is { fact: PublicEvidence; figure: MeasuredFigure } =>
        entry.figure !== null,
    );
  const rows: ClaimRow[] = [];
  const seen = new Set<string>();
  for (const claim of input.claims) {
    const key = claim.statement.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const stated = measureOf(claim.statement);
    if (stated === null) continue;
    const same = about.filter(
      (entry) =>
        entry.figure.measure === stated.measure &&
        entry.figure.currency === stated.currency,
    );
    // A different period is a different figure, not a contradiction.
    const comparable = same.filter(
      (entry) =>
        stated.year === null ||
        entry.figure.year === null ||
        entry.figure.year === stated.year,
    );
    const against = comparable.map((entry) => ({
      statement: entry.fact.statement,
      source: `${entry.fact.domain} [S${String(entry.fact.sourceIndex)}]`,
      sourceIndex: entry.fact.sourceIndex,
      agrees: agrees(entry.figure.value, stated.value),
    }));
    const contradicting = against.filter((one) => !one.agrees);
    const supporting = against.filter((one) => one.agrees);
    const strip = (one: (typeof against)[number]) => ({
      statement: one.statement,
      source: one.source,
      sourceIndex: one.sourceIndex,
    });
    if (contradicting.length > 0) {
      rows.push({
        measure: stated.measure,
        status: "CONTRADICTED",
        claim,
        // Both sides: what disagrees, and anything that agrees.
        evidence: [...contradicting, ...supporting].slice(0, 3).map(strip),
        note: null,
      });
    } else if (supporting.length > 0) {
      rows.push({
        measure: stated.measure,
        status: "CORROBORATED",
        claim,
        evidence: supporting.slice(0, 2).map(strip),
        note: null,
      });
    } else {
      rows.push({
        measure: stated.measure,
        status: "UNVERIFIED",
        claim,
        evidence: [],
        note:
          same.length > comparable.length
            ? "Public figures found are for a different period."
            : null,
      });
    }
  }
  for (const statements of input.recordContradictions ?? []) {
    const [first, ...others] = statements.filter(
      (one) => one.trim().length > 0,
    );
    if (first === undefined || others.length === 0) continue;
    rows.push({
      measure: measureOf(first)?.measure ?? null,
      status: "CONTRADICTED",
      claim: {
        statement: first,
        source: "Capital Q's record",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
      evidence: others.slice(0, 3).map((statement) => ({
        statement,
        source: "Capital Q's record (a conflicting statement)",
        sourceIndex: null,
      })),
      note: null,
    });
  }
  // Contradictions first: they matter most to a decision.
  const order: Readonly<Record<ClaimStatus, number>> = {
    CONTRADICTED: 0,
    UNVERIFIED: 1,
    CORROBORATED: 2,
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) => order[a.row.status] - order[b.row.status] || a.index - b.index,
    )
    .map((entry) => entry.row)
    .slice(0, CLAIM_ROWS_MAX);
}

const STATUS_WORDS: Readonly<Record<ClaimStatus, string>> = {
  CORROBORATED: "CORROBORATED",
  CONTRADICTED: "CONTRADICTED",
  UNVERIFIED: "UNVERIFIED",
};

function findingId(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return QFindingIdSchema.parse(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
}

export const CLAIMS_HEADING = "Claims vs evidence";

/**
 * The section, written by code: one line per claim, its status, the claim
 * with where it was stated, and what it was set against. Each row is also
 * a finding with its own truth, evidence and lifecycle axes.
 */
export function claimsSection(
  rows: readonly ClaimRow[],
  seed: string,
): {
  readonly heading: string;
  readonly body: string;
  readonly findings: readonly QArtifactFinding[];
} {
  const intro =
    "Set by Capital Q's code, not written by a model: each figure the company states, against public sources about the company and the other statements on record. CORROBORATED: a public source agrees within 15%. CONTRADICTED: a source disagrees; both sides are shown and neither is picked. UNVERIFIED: nothing comparable was found, which is not evidence against it.";
  if (rows.length === 0) {
    return {
      heading: CLAIMS_HEADING,
      body: `${intro}\nNo stated figure (revenue, customers, funding or headcount) was found in what you may read of the company's record or data room, so there was nothing to check.`,
      findings: [],
    };
  }
  const lines = rows.map((row) => {
    const against =
      row.evidence.length === 0
        ? row.note === null
          ? "No public source states a comparable figure."
          : row.note
        : row.evidence
            .map((one) => `${one.statement} (${one.source})`)
            .join(" / ");
    return `${STATUS_WORDS[row.status]} | Stated: ${row.claim.statement} (${row.claim.source}, ${row.claim.truthClass}) | Evidence: ${against}`;
  });
  const findings = rows.slice(0, 12).map((row, index): QArtifactFinding => ({
    findingId: findingId(
      `${seed}:claim:${String(index)}:${row.claim.statement}`,
    ),
    type: row.status === "CONTRADICTED" ? "RISK" : "OBSERVATION",
    statement:
      `${STATUS_WORDS[row.status]}: ${row.claim.statement} (${row.claim.source})${
        row.evidence.length === 0
          ? ""
          : ` -- against: ${row.evidence.map((one) => `${one.statement} (${one.source})`).join(" / ")}`
      }`.slice(0, 2_000),
    // The claim stays the company's claim, whatever a source says.
    truthClass: row.claim.truthClass,
    evidenceStatus:
      row.status === "CORROBORATED"
        ? "MULTI_SOURCE_SUPPORTED"
        : row.claim.evidenceStatus,
    lifecycleStatus:
      row.status === "CONTRADICTED" ? "CONTRADICTORY" : "CURRENT",
    confidence:
      row.status === "CONTRADICTED"
        ? "CONFLICTING_EVIDENCE"
        : row.status === "UNVERIFIED"
          ? "INSUFFICIENT_EVIDENCE"
          : "MODERATE",
    evidenceRefs: [],
    subjects: [],
  }));
  return {
    heading: CLAIMS_HEADING,
    body: [intro, "Status | Stated | Evidence", ...lines].join("\n"),
    findings,
  };
}
