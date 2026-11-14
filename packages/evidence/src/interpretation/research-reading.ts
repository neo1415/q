import { createHash } from "node:crypto";

import { z } from "zod";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { EvidenceService } from "../application/service.js";
import {
  EvidenceItemIdSchema,
  EvidenceSourceIdSchema,
} from "../contracts/index.js";
import { ClaimProposalSchema } from "./contracts.js";
import { excerptIsPresent } from "./policy.js";
import type { StatedFigureMetric } from "./stated-figure.js";

/**
 * Research readings (decisions 92-96): what a public page REPORTS about a
 * company, kept as cited research evidence -- never a canonical company
 * fact, never the company's own claim, never verified.
 *
 *   a source reporting a claim       -> a ResearchReading (this file)
 *   other sources agreeing/differing -> a ResearchReadingLink, derived in
 *                                       code; corroboration is NOT
 *                                       independent verification
 *   the founder confirming it        -> their USER_CLAIM (web-figure.ts),
 *                                       keeping the reading as provenance
 *   independently verified           -> unchanged (verification workflow)
 *
 * ADR-001 axes as they stand (no class is redefined here): a reading's
 * truth class is UNKNOWN; its evidence status is NO_EVIDENCE when a third
 * party reports it and SELF_REPORTED only when the page is the company's
 * own website (ADR 0009 §8). Stored as an evidence item the item rule
 * forbids NO_EVIDENCE, so the item carries SELF_REPORTED with reliability
 * SECONDARY_EXTERNAL and `reportedBy: THIRD_PARTY`; the proposal in
 * docs/adr/proposals/2026-11-14-research-evidence-standing.md asks the owner
 * for a dedicated class instead.
 *
 * Fundraising concepts are distinct and never substituted (decision 95):
 * money sought, commitments announced, funding completed and valuation are
 * separate metrics, each needing its own wording in the page's quote; a
 * reading labelled "completed" whose quote only says "seeking" is dropped,
 * never relabelled.
 *
 * Pure apart from `recordResearchReadings` / `listResearchReadings`, which
 * go through the Evidence application services (authorised, audited).
 * Nothing here calls a model.
 */

export const RESEARCH_READINGS_VERSION = "research-readings-v1" as const;

export const RESEARCH_READING_METRICS = {
  AMOUNT_SOUGHT: { kind: "MONEY", label: "funding being sought" },
  COMMITMENT_ANNOUNCED: {
    kind: "MONEY",
    label: "funding commitments announced",
  },
  FUNDING_COMPLETED: { kind: "MONEY", label: "funding raised (completed)" },
  VALUATION: { kind: "MONEY", label: "valuation" },
  REVENUE: { kind: "MONEY", label: "revenue" },
  MRR: { kind: "MONEY", label: "MRR" },
  ARR: { kind: "MONEY", label: "ARR" },
  CUSTOMERS: { kind: "COUNT", label: "customers" },
  USERS: { kind: "COUNT", label: "users" },
} as const satisfies Readonly<
  Record<string, { readonly kind: "MONEY" | "COUNT"; readonly label: string }>
>;
export type ResearchReadingMetric = keyof typeof RESEARCH_READING_METRICS;
const METRIC_CODES = Object.keys(RESEARCH_READING_METRICS) as [
  ResearchReadingMetric,
  ...ResearchReadingMetric[],
];

export const VALUATION_BASES = ["PRE_MONEY", "POST_MONEY", "UNSTATED"] as const;
export type ValuationBasis = (typeof VALUATION_BASES)[number];

/**
 * The claim keys the extractor may use for a page, each onto exactly one
 * metric. A closed list: the key, not the number, keeps "$2m sought" and
 * "$2m raised" apart.
 */
const CLAIM_KEY_READING: ReadonlyMap<
  string,
  { readonly metric: ResearchReadingMetric; readonly basis?: ValuationBasis }
> = new Map([
  ["capital.amount_sought", { metric: "AMOUNT_SOUGHT" }],
  ["capital.commitment_announced", { metric: "COMMITMENT_ANNOUNCED" }],
  ["capital.funding_completed", { metric: "FUNDING_COMPLETED" }],
  ["capital.valuation_pre_money", { metric: "VALUATION", basis: "PRE_MONEY" }],
  [
    "capital.valuation_post_money",
    { metric: "VALUATION", basis: "POST_MONEY" },
  ],
  ["capital.valuation", { metric: "VALUATION", basis: "UNSTATED" }],
  ["financial.revenue", { metric: "REVENUE" }],
  ["financial.mrr", { metric: "MRR" }],
  ["financial.arr", { metric: "ARR" }],
  ["traction.customer_count", { metric: "CUSTOMERS" }],
  ["traction.active_users", { metric: "USERS" }],
]);
export const RESEARCH_READING_CLAIM_KEYS: readonly string[] = [
  ...CLAIM_KEY_READING.keys(),
];

/** Trusted text for the extraction frame: what each fundraising key means. */
export const RESEARCH_READING_KEY_GUIDE =
  "Fundraising keys are distinct: capital.amount_sought = money the company is seeking; capital.commitment_announced = commitments or pledges announced; capital.funding_completed = money raised or closed; capital.valuation_pre_money / _post_money / capital.valuation (basis unstated).";

/**
 * The page's own wording each fundraising concept needs. A check on the
 * quote the extractor returned (structured validation of its label), not a
 * reading of anyone's request.
 */
const CONCEPT_WORDS: Partial<Record<ResearchReadingMetric, RegExp>> = {
  AMOUNT_SOUGHT:
    /\b(?:seek(?:s|ing)?|(?:is|are|was|were|currently|now) raising|looking to raise|aim(?:s|ing)? to raise|plan(?:s|ning)? to raise|hop(?:es|ing) to raise|in talks to raise|targets?|targeting|to raise)\b/iu,
  COMMITMENT_ANNOUNCED:
    /\b(?:commit(?:s|ted|ment|ments)?|pledge(?:s|d)?|first close|soft[- ]circled|announce(?:s|d)?)\b/iu,
  FUNDING_COMPLETED:
    /\b(?:raised|closed|completed|secured|landed|bagged|raises|has raised|received)\b/iu,
  VALUATION: /\bvalu(?:ed|ation|ing)\b/iu,
};
const PRE_MONEY = /\bpre[- ]?money\b/iu;
const POST_MONEY = /\bpost[- ]?money\b/iu;
const ROUND =
  /\b(pre-seed|pre seed|seed|series [a-h](?:[1-9]|\+)?|bridge|angel|growth|mezzanine)\b(?: round| funding)?/iu;
const APPROXIMATE =
  /\b(?:about|around|approximately|roughly|nearly|almost|some|close to|an estimated|circa)\b|~/iu;
const AT_LEAST =
  /\b(?:over|more than|in excess of|upwards of|at least|north of)\b/iu;
const AT_MOST = /\b(?:up to|under|less than|below|at most)\b/iu;
const SECONDHAND =
  /\b(?:reportedly|according to (?:people|sources|a person)|sources (?:say|said)|is said to|people familiar)\b/iu;

const DECIMAL = /^\d{1,15}(?:\.\d{1,4})?$/u;

/** Instruction-shaped wording: data about the page, never a figure's context. */
const INSTRUCTION_SHAPED =
  /\b(?:ignore (?:all |any )?(?:previous |prior |earlier |your )?instructions|disregard (?:all |any |your )?|system\s*:|assistant\s*:|developer\s*:|mark (?:this|it|every|them)\b[^.]{0,60}\bverified|you are now)/iu;

const normal = (text: string): string =>
  text.replace(/\s+/gu, " ").trim().toLowerCase();

/** Whether the quote sits in an instruction-shaped sentence of the page. */
function inInstructionText(quote: string, text: string): boolean {
  const wanted = normal(quote);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/u);
  const holding = sentences.filter((sentence) =>
    normal(sentence).includes(wanted),
  );
  // A quote spanning sentences: judged against the whole page.
  return (holding.length === 0 ? [text] : holding).some((sentence) =>
    INSTRUCTION_SHAPED.test(sentence),
  );
}

export const ResearchReadingValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("MONEY"),
      amount: z.string().regex(DECIMAL),
      currency: z.string().regex(/^[A-Z]{3}$/u),
    })
    .strict(),
  z
    .object({ kind: z.literal("COUNT"), value: z.number().int().min(0) })
    .strict(),
]);
export type ResearchReadingValue = z.infer<typeof ResearchReadingValueSchema>;

/** Where the reading was read. Server-assembled, never a model's. */
export const ResearchReadingSourceSchema = z
  .object({
    url: z.string().url().max(2_048),
    domain: z.string().max(253),
    /** Independence key: syndicated copies of one story share it. */
    publisher: z.string().max(253),
    title: z.string().max(300).nullable(),
    /** YYYY-MM-DD the page says it was published; null when it does not. */
    publishedOn: z.iso.date().nullable(),
    retrievedAt: z.iso.datetime({ offset: true }),
    /** sha256 of the fetched text the quote is in. */
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    /** The company's own website (its own public statement), not a third party. */
    companyOwnSite: z.boolean(),
    /** Set only when the page is recorded as the owning company's evidence. */
    evidenceSourceId: z.string().uuid().nullable(),
    excerptItemId: z.string().uuid().nullable(),
  })
  .strict();
export type ResearchReadingSource = z.infer<typeof ResearchReadingSourceSchema>;

export const ResearchReadingSchema = z
  .object({
    metric: z.enum(METRIC_CODES),
    value: ResearchReadingValueSchema,
    /** VALUATION only; null for every other metric. */
    valuationBasis: z.enum(VALUATION_BASES).nullable(),
    /** A fundraising round named in the quote ("Series A"); null when none. */
    roundName: z.string().max(40).nullable(),
    /** The date the figure is for, when the page gives one; null: unknown. */
    asOf: z.iso.date().nullable(),
    /** The page's own words, verbatim. */
    quote: z.string().trim().min(1).max(500),
    uncertainty: z
      .object({
        approximate: z.boolean(),
        bound: z.enum(["AT_LEAST", "AT_MOST"]).nullable(),
        /** The page attributes it to unnamed others ("reportedly"). */
        secondhand: z.boolean(),
        /** The page gives it as an estimate. */
        estimate: z.boolean(),
      })
      .strict(),
    source: ResearchReadingSourceSchema,
    // The standing, fixed by code: a page never raises it.
    truthClass: z.literal("UNKNOWN"),
    evidenceStatus: z.enum(["NO_EVIDENCE", "SELF_REPORTED"]),
    reliabilityClass: z.literal("SECONDARY_EXTERNAL"),
    reportedBy: z.enum(["THIRD_PARTY", "COMPANY_OWN_SITE"]),
  })
  .strict()
  .refine(
    (reading) =>
      reading.value.kind === RESEARCH_READING_METRICS[reading.metric].kind,
    { message: "the value's kind does not fit the metric", path: ["value"] },
  );
export type ResearchReading = z.infer<typeof ResearchReadingSchema>;

/** One fetched page offered for reading, with its server-known provenance. */
export type ResearchReadingPage = Omit<ResearchReadingSource, "contentHash"> & {
  /** The fetched text. Untrusted data. */
  readonly text: string;
};

export function researchContentHash(text: string): string {
  return createHash("sha256").update(text.normalize("NFC")).digest("hex");
}

function readingValue(
  raw: unknown,
  kind: "MONEY" | "COUNT",
): ResearchReadingValue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (kind === "MONEY") {
    if (
      value["kind"] !== "MONEY" ||
      typeof value["amount"] !== "number" ||
      !Number.isFinite(value["amount"]) ||
      value["amount"] < 0 ||
      typeof value["currency"] !== "string"
    ) {
      return null;
    }
    const amount = Number(value["amount"].toFixed(4)).toString();
    const parsed = ResearchReadingValueSchema.safeParse({
      kind: "MONEY",
      amount,
      currency: value["currency"],
    });
    return parsed.success ? parsed.data : null;
  }
  return value["kind"] === "COUNT" &&
    typeof value["value"] === "number" &&
    Number.isInteger(value["value"]) &&
    value["value"] >= 0
    ? { kind: "COUNT", value: value["value"] }
    : null;
}

function roundOf(quote: string): string | null {
  const match = ROUND.exec(quote);
  if (match?.[1] === undefined) return null;
  const word = match[1].toLowerCase().replace(/\s+/gu, " ");
  if (word.startsWith("series "))
    return `Series ${word.slice(7).toUpperCase()}`;
  if (word === "pre seed" || word === "pre-seed") return "Pre-seed";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The readings worth keeping from an extractor's raw output over one or
 * more fetched pages (a batch). Pure. Each proposal is attributed to every
 * page whose own text contains its quote -- never to a page by a marker the
 * text could forge -- and anything that does not pass is dropped, never
 * repaired.
 */
export function researchReadingsFromProposals(input: {
  readonly proposals: readonly unknown[];
  readonly pages: readonly ResearchReadingPage[];
  /** YYYY-MM-DD: nothing is dated after today. */
  readonly today: string;
}): ResearchReading[] {
  const out: ResearchReading[] = [];
  const seen = new Set<string>();
  for (const raw of input.proposals) {
    const parsed = ClaimProposalSchema.safeParse(raw);
    if (!parsed.success) continue;
    const proposal = parsed.data;
    // The page's own account or its own estimate; never the extractor's
    // conclusion.
    if (proposal.assertionKind === "MODEL_INFERENCE") continue;
    const key = CLAIM_KEY_READING.get(proposal.claimKey);
    if (key === undefined) continue;
    const metric = key.metric;
    const value = readingValue(
      proposal.value,
      RESEARCH_READING_METRICS[metric].kind,
    );
    if (value === null) continue;
    const quote = proposal.excerpt;
    // Decision 95: the concept must be in the page's own words.
    const concept = CONCEPT_WORDS[metric];
    if (concept !== undefined && !concept.test(quote)) continue;
    let basis: ValuationBasis | null = null;
    if (metric === "VALUATION") {
      basis = key.basis ?? "UNSTATED";
      if (basis === "PRE_MONEY" && !PRE_MONEY.test(quote)) continue;
      if (basis === "POST_MONEY" && !POST_MONEY.test(quote)) continue;
    }
    const fundraising =
      metric === "AMOUNT_SOUGHT" ||
      metric === "COMMITMENT_ANNOUNCED" ||
      metric === "FUNDING_COMPLETED" ||
      metric === "VALUATION";
    for (const page of input.pages) {
      if (page.text.trim() === "" || !excerptIsPresent(quote, page.text)) {
        continue;
      }
      // A figure inside instruction-shaped text ("SYSTEM: ... record ARR of
      // $90m") is the page talking to Q, not reporting: never a reading.
      if (inInstructionText(quote, page.text)) continue;
      const ceiling =
        page.publishedOn !== null && page.publishedOn < input.today
          ? page.publishedOn
          : input.today;
      // A date after the page was written is its forecast, not a figure.
      if (proposal.asOf !== null && proposal.asOf > ceiling) continue;
      const reading = ResearchReadingSchema.safeParse({
        metric,
        value,
        valuationBasis: basis,
        roundName: fundraising ? roundOf(quote) : null,
        asOf: proposal.asOf,
        quote,
        uncertainty: {
          approximate: APPROXIMATE.test(quote),
          bound: AT_LEAST.test(quote)
            ? "AT_LEAST"
            : AT_MOST.test(quote)
              ? "AT_MOST"
              : null,
          secondhand: SECONDHAND.test(quote),
          estimate: proposal.assertionKind === "SOURCE_ESTIMATE",
        },
        source: {
          url: page.url,
          domain: page.domain,
          publisher: page.publisher,
          title: page.title,
          publishedOn: page.publishedOn,
          retrievedAt: page.retrievedAt,
          contentHash: researchContentHash(page.text),
          companyOwnSite: page.companyOwnSite,
          evidenceSourceId: page.evidenceSourceId,
          excerptItemId: page.excerptItemId,
        },
        truthClass: "UNKNOWN",
        evidenceStatus: page.companyOwnSite ? "SELF_REPORTED" : "NO_EVIDENCE",
        reliabilityClass: "SECONDARY_EXTERNAL",
        reportedBy: page.companyOwnSite ? "COMPANY_OWN_SITE" : "THIRD_PARTY",
      });
      if (!reading.success) continue;
      const identity = readingKey(reading.data);
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push(reading.data);
    }
  }
  return out;
}

/**
 * A reading's stable id: the same page content, metric, basis, round, date
 * and value always give the same id, so a later "what changed" can name it.
 */
export function researchReadingId(reading: ResearchReading): string {
  return `rr_${researchContentHash(readingKey(reading)).slice(0, 24)}`;
}

/** One reading's identity: page content, metric, basis, round, date, value. */
export function readingKey(reading: ResearchReading): string {
  return JSON.stringify([
    reading.source.contentHash,
    reading.metric,
    reading.valuationBasis,
    reading.roundName,
    reading.asOf,
    reading.value,
  ]);
}

// ---------------------------------------------------------------------------
// Corroboration and contradiction, in code
// ---------------------------------------------------------------------------

/** Relative difference within which two figures are one number rounded. */
export const READING_AGREEMENT_TOLERANCE = 0.05;

export type ResearchReadingLink = {
  readonly kind: "CORROBORATES" | "CONTRADICTS";
  /** Indexes into the readings list. */
  readonly between: readonly [number, number];
  /** Always true: same-publisher copies are never linked. */
  readonly independentPublishers: true;
  /** Always false: agreement between reports is not verification (decision 92). */
  readonly independentVerification: false;
};

function periodOf(reading: ResearchReading): string | null {
  // A month's figure is that month; a day narrows to its month.
  return reading.asOf === null ? null : reading.asOf.slice(0, 7);
}

/** Whether two readings are about the same thing, so their values can be compared. */
function comparable(a: ResearchReading, b: ResearchReading): boolean {
  if (a.metric !== b.metric || a.valuationBasis !== b.valuationBasis) {
    return false;
  }
  const fundraising =
    a.metric === "AMOUNT_SOUGHT" ||
    a.metric === "COMMITMENT_ANNOUNCED" ||
    a.metric === "FUNDING_COMPLETED" ||
    a.metric === "VALUATION";
  if (fundraising) {
    // One round is one event: a different round, or a round on one side
    // only, is a different event, never a contradiction.
    if (a.roundName !== b.roundName) return false;
    if (a.roundName !== null) return true;
  }
  const pa = periodOf(a);
  const pb = periodOf(b);
  // Undated against undated, or different periods: history or unknown,
  // never a contradiction.
  return pa !== null && pa === pb;
}

function valuesAgree(
  a: ResearchReadingValue,
  b: ResearchReadingValue,
): boolean | null {
  if (a.kind !== b.kind) return null;
  if (a.kind === "MONEY" && b.kind === "MONEY") {
    // Never converted between currencies: different currencies are not
    // comparable (unknown), never a contradiction.
    if (a.currency !== b.currency) return null;
    const x = Number(a.amount);
    const y = Number(b.amount);
    const largest = Math.max(x, y);
    return (
      largest === 0 || Math.abs(x - y) / largest <= READING_AGREEMENT_TOLERANCE
    );
  }
  if (a.kind === "COUNT" && b.kind === "COUNT") {
    const largest = Math.max(a.value, b.value);
    return (
      largest === 0 ||
      Math.abs(a.value - b.value) / largest <= READING_AGREEMENT_TOLERANCE
    );
  }
  return null;
}

/**
 * Corroboration and contradiction between readings from independent
 * publishers. Deterministic; never a model. Two copies from one publisher
 * (or one syndicated story) are one report, so they are never linked.
 */
export function linkResearchReadings(
  readings: readonly ResearchReading[],
): ResearchReadingLink[] {
  const links: ResearchReadingLink[] = [];
  for (let i = 0; i < readings.length; i += 1) {
    for (let j = i + 1; j < readings.length; j += 1) {
      const a = readings[i];
      const b = readings[j];
      if (a === undefined || b === undefined) continue;
      if (a.source.publisher === b.source.publisher) continue;
      if (!comparable(a, b)) continue;
      const agree = valuesAgree(a.value, b.value);
      if (agree === null) continue;
      links.push({
        kind: agree ? "CORROBORATES" : "CONTRADICTS",
        between: [i, j],
        independentPublishers: true,
        independentVerification: false,
      });
    }
  }
  return links;
}

// ---------------------------------------------------------------------------
// Attribution, in Capital Q's words
// ---------------------------------------------------------------------------

function valueWords(value: ResearchReadingValue): string {
  if (value.kind === "COUNT") return value.value.toLocaleString("en-GB");
  const amount = Number(value.amount);
  return `${value.currency} ${amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

function sourceWords(source: ResearchReadingSource): string {
  const title = source.title === null ? "" : `"${source.title.slice(0, 120)}" `;
  const when =
    source.publishedOn === null
      ? `undated, read ${source.retrievedAt.slice(0, 10)}`
      : source.publishedOn;
  return `${title}(${source.domain}, ${when})`;
}

function readingWords(reading: ResearchReading): string {
  const metric = RESEARCH_READING_METRICS[reading.metric].label;
  const basis =
    reading.valuationBasis === "PRE_MONEY"
      ? " (pre-money)"
      : reading.valuationBasis === "POST_MONEY"
        ? " (post-money)"
        : reading.metric === "VALUATION"
          ? " (pre/post-money not stated)"
          : "";
  const round = reading.roundName === null ? "" : `, ${reading.roundName}`;
  const bound =
    reading.uncertainty.bound === "AT_LEAST"
      ? "at least "
      : reading.uncertainty.bound === "AT_MOST"
        ? "at most "
        : reading.uncertainty.approximate
          ? "about "
          : "";
  const when = reading.asOf === null ? "" : ` as of ${reading.asOf}`;
  return `${metric}${basis}${round}: ${bound}${valueWords(reading.value)}${when}`;
}

/**
 * Said once with the lines, never per line (owner addendum 14 Nov: answer
 * first, no repeated disclaimers). Not independently verified is not false.
 */
export const RESEARCH_READINGS_STANDING =
  "These are figures public pages report, read by Capital Q: lead with them, attributed to their source and date. Independent sources agreeing makes a report more credible but is not verification, and a report that is not independently verified is not therefore wrong. They are not the company's own record unless it says so, and an identity or company check (KYB) does not confirm any of them.";

/**
 * One trusted line per reading for Q's answer: what is reported, by whom,
 * when, which independent sources agree or differ, and its standing.
 * Never "verified", never "the company's figure".
 */
export function researchReadingLines(
  readings: readonly ResearchReading[],
  links: readonly ResearchReadingLink[] = linkResearchReadings(readings),
): string[] {
  return readings.map((reading, index) => {
    const others = (kind: ResearchReadingLink["kind"]) =>
      links
        .filter(
          (link) =>
            link.kind === kind &&
            (link.between[0] === index || link.between[1] === index),
        )
        .map((link) => {
          const other =
            readings[
              link.between[0] === index ? link.between[1] : link.between[0]
            ];
          return other === undefined
            ? null
            : kind === "CONTRADICTS"
              ? `${sourceWords(other.source)} reports ${valueWords(other.value)}`
              : sourceWords(other.source);
        })
        .filter((words): words is string => words !== null);
    const corroborated = others("CORROBORATES");
    const contradicted = others("CONTRADICTS");
    const by =
      reading.reportedBy === "COMPANY_OWN_SITE"
        ? "stated on the company's own website"
        : "reported by";
    const caveats = [
      reading.uncertainty.secondhand
        ? "the page attributes it to unnamed sources"
        : null,
      reading.uncertainty.estimate ? "the page gives it as an estimate" : null,
    ].filter((words): words is string => words !== null);
    return [
      `${readingWords(reading)} -- ${by} ${sourceWords(reading.source)}: "${reading.quote.slice(0, 200)}"`,
      corroborated.length === 0
        ? ""
        : `; corroborated by ${corroborated.join(", ")} (agreement between reports, not verification)`,
      contradicted.length === 0
        ? ""
        : `; differs from ${contradicted.join(", ")} (both kept; unresolved)`,
      caveats.length === 0 ? "" : `; ${caveats.join("; ")}`,
      ` [${researchReadingId(reading)}]`,
    ].join("");
  });
}

// ---------------------------------------------------------------------------
// Persistence for the owning company's recorded research (ADR 0009 §6)
// ---------------------------------------------------------------------------

export const RESEARCH_READING_EVIDENCE_TYPE = "public_web.reading";

export type ResearchReadingEvidence = Pick<
  EvidenceService,
  "getEvidenceSource" | "listEvidenceItems" | "createEvidenceItem"
>;

/**
 * Keeps readings of pages recorded as the owning company's evidence, one
 * item each under that page's PUBLIC_WEB source, once (by reading key).
 * Readings of a page that is not recorded (an investor's transient
 * research) are never written: ADR 0009 §6.
 */
export async function recordResearchReadings(
  evidence: ResearchReadingEvidence,
  command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly readings: readonly ResearchReading[];
    readonly correlationId: CorrelationId;
  },
): Promise<{ readonly recorded: number; readonly existing: number }> {
  const { actor, companyId, correlationId } = command;
  const kept = await listResearchReadings(evidence, { actor, companyId });
  const known = new Set(kept.map((entry) => readingKey(entry.reading)));
  let recorded = 0;
  let existing = 0;
  for (const reading of command.readings) {
    const sourceId = reading.source.evidenceSourceId;
    if (sourceId === null) continue;
    if (known.has(readingKey(reading))) {
      existing += 1;
      continue;
    }
    const source = await evidence.getEvidenceSource({
      actor,
      sourceId: EvidenceSourceIdSchema.parse(sourceId),
    });
    if (
      source.sourceType !== "PUBLIC_WEB" ||
      source.subjectType !== "COMPANY" ||
      source.subjectId !== companyId ||
      source.sourceUrl !== reading.source.url
    ) {
      continue;
    }
    await evidence.createEvidenceItem({
      actor,
      correlationId,
      input: {
        sourceId: source.id,
        evidenceType: RESEARCH_READING_EVIDENCE_TYPE,
        summary: reading.quote,
        structuredValue: {
          kind: "research_reading",
          version: RESEARCH_READINGS_VERSION,
          readingId: researchReadingId(reading),
          reading: reading as unknown as Record<string, unknown>,
        },
        locator: { kind: "statement" },
        validFrom:
          reading.asOf === null ? null : `${reading.asOf}T00:00:00.000Z`,
        // An evidence item cannot be NO_EVIDENCE (the item rule); the
        // page's own unverified account, from a secondary external source.
        // `reading.reportedBy` keeps who reported it.
        evidenceStatus: "SELF_REPORTED",
        reliabilityClass: "SECONDARY_EXTERNAL",
      },
    });
    known.add(readingKey(reading));
    recorded += 1;
  }
  return { recorded, existing };
}

/** The owning company's kept readings, each with its evidence item id. */
export async function listResearchReadings(
  evidence: Pick<EvidenceService, "listEvidenceItems">,
  query: { readonly actor: ActorContext; readonly companyId: string },
): Promise<{ readonly itemId: string; readonly reading: ResearchReading }[]> {
  const items = await evidence.listEvidenceItems({
    actor: query.actor,
    subject: { subjectType: "COMPANY", subjectId: query.companyId },
  });
  return items.flatMap((item) => {
    if (item.evidenceType !== RESEARCH_READING_EVIDENCE_TYPE) return [];
    const parsed = ResearchReadingSchema.safeParse(
      item.structuredValue?.["reading"],
    );
    return parsed.success
      ? [{ itemId: EvidenceItemIdSchema.parse(item.id), reading: parsed.data }]
      : [];
  });
}

/** The stated-figure metric a reading may be adopted as, if any. */
export function adoptableMetric(
  reading: ResearchReading,
): StatedFigureMetric | null {
  switch (reading.metric) {
    case "REVENUE":
    case "MRR":
    case "ARR":
    case "CUSTOMERS":
    case "USERS":
      return reading.metric;
    // Fundraising figures have no founder figure card yet; they stay
    // research evidence.
    case "AMOUNT_SOUGHT":
    case "COMMITMENT_ANNOUNCED":
    case "FUNDING_COMPLETED":
    case "VALUATION":
      return null;
  }
}
