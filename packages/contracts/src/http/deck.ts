import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * A company's pitch deck as Q read it (overnight plan A4-A6, 2026-10-06;
 * research docs/research/2026-10-06/pitch-deck.md).
 *
 * Twelve sections, in the same order for every company, so investors
 * compare like with like. Every section and every fact may be unknown, and
 * says why; unknown is never zero and never "weak". Each fact keeps the
 * evidence axes apart (truth class, evidence status) and its slides.
 * Confidence is a word, never an invented percentage.
 *
 * What Q read is a proposal until the founder confirms it (the Write
 * Gate): an investor sees the sections only after that, and only where
 * they may see the deck itself. Coaching (the rubric) is the founder's
 * alone and never reaches ranking, matching or any investor.
 */

export const DECK_SECTIONS = [
  "PROBLEM",
  "SOLUTION",
  "VALUE_PROPOSITION",
  "MARKET",
  "GO_TO_MARKET",
  "BUSINESS_MODEL",
  "TRACTION",
  "COMPETITION",
  "FINANCIALS",
  "THE_ASK",
  "FOUNDERS",
  "TEAM",
] as const;
export const DeckSectionCodeSchema = z.enum(DECK_SECTIONS);
export type DeckSectionCode = z.infer<typeof DeckSectionCodeSchema>;

export const DECK_SECTION_LABELS: Readonly<Record<DeckSectionCode, string>> = {
  PROBLEM: "Problem",
  SOLUTION: "Solution",
  VALUE_PROPOSITION: "Value proposition",
  MARKET: "Market",
  GO_TO_MARKET: "Go-to-market",
  BUSINESS_MODEL: "Business model",
  TRACTION: "Traction",
  COMPETITION: "Competition",
  FINANCIALS: "Financials",
  THE_ASK: "The ask",
  FOUNDERS: "Founders",
  TEAM: "Team",
};

export const DeckConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type DeckConfidence = z.infer<typeof DeckConfidenceSchema>;

/** Why something is unknown; never shown as zero. */
export const DeckUnknownReasonSchema = z.enum([
  "NOT_IN_DECK",
  "UNCLEAR",
  "CONTRADICTORY",
]);
export type DeckUnknownReason = z.infer<typeof DeckUnknownReasonSchema>;

const PagesSchema = z.array(z.number().int().min(1).max(500)).max(12);

export const DeckFactSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    /** The deck's own words or figure; null: unknown (see unknownReason). */
    value: z.string().trim().min(1).max(300).nullable(),
    unknownReason: DeckUnknownReasonSchema.nullable(),
    /** FIGURE: a number (money, %, count); the rubric asks for its date. */
    kind: z.enum(["TEXT", "FIGURE"]),
    /** The month or date the figure is as of, as the deck says; null: undated. */
    asOf: z.string().trim().min(1).max(40).nullable(),
    pages: PagesSchema,
    /** USER_CLAIM: the deck says it; Q_INFERENCE: Q derived it (labelled). */
    truthClass: z.enum(["USER_CLAIM", "Q_INFERENCE"]),
    /** SELF_REPORTED until matched to a data-room document. */
    evidenceStatus: z.enum(["SELF_REPORTED", "DOCUMENT_SUPPORTED"]),
    confidence: DeckConfidenceSchema,
  })
  .strict();
export type DeckFact = z.infer<typeof DeckFactSchema>;

export const DeckSectionSchema = z
  .object({
    section: DeckSectionCodeSchema,
    /** PRESENT: the deck covers it; otherwise unknown, and why. */
    status: z.enum(["PRESENT", "NOT_IN_DECK", "UNCLEAR", "CONTRADICTORY"]),
    /** Q's plain summary of what the deck says; null when not in the deck. */
    summary: z.string().trim().min(1).max(600).nullable(),
    pages: PagesSchema,
    facts: z.array(DeckFactSchema).max(8),
    confidence: DeckConfidenceSchema,
  })
  .strict();
export type DeckSection = z.infer<typeof DeckSectionSchema>;

/** Exactly the twelve, in order: validated by position, not just by count. */
export const DeckSectionsSchema = z
  .array(DeckSectionSchema)
  .length(DECK_SECTIONS.length)
  .refine(
    (sections) =>
      sections.every((section, index) => section.section === DECK_SECTIONS[index]),
    { message: "The twelve sections must be in the standard order." },
  );

/** A section the deck does not cover: honest, never an empty card. */
export function unknownDeckSection(
  section: DeckSectionCode,
  status: "NOT_IN_DECK" | "UNCLEAR" = "NOT_IN_DECK",
): DeckSection {
  return { section, status, summary: null, pages: [], facts: [], confidence: "LOW" };
}

/**
 * Normalise whatever a reader produced into the twelve, in order: a missing
 * section is NOT_IN_DECK; a duplicate keeps the first. Never invents one.
 */
export function orderDeckSections(
  sections: readonly DeckSection[],
): DeckSection[] {
  return DECK_SECTIONS.map(
    (code) =>
      sections.find((section) => section.section === code) ??
      unknownDeckSection(code),
  );
}

// --- coaching (the founder's alone) -------------------------------------------

export const DeckRubricLevelSchema = z.enum([
  "MISSING",
  "MENTIONED",
  "BASIC",
  "CLEAR",
  "STRONG",
  "EXCEPTIONAL",
]);
export type DeckRubricLevel = z.infer<typeof DeckRubricLevelSchema>;

export const DeckCoachingSectionSchema = z
  .object({
    section: DeckSectionCodeSchema,
    /** 0-5 against the research rubric (§4), the same for every company. */
    score: z.number().int().min(0).max(5),
    level: DeckRubricLevelSchema,
    /** Part of the minimum standard (§6): it must reach 3. */
    requiredForMinimum: z.boolean(),
    atStandard: z.boolean(),
    /** What is missing or weak, in plain words. */
    gaps: z.array(z.string().max(240)).max(4),
    /** One sentence: how to improve it. */
    improve: z.string().max(240).nullable(),
  })
  .strict();
export type DeckCoachingSection = z.infer<typeof DeckCoachingSectionSchema>;

export const DeckCoachingCheckSchema = z
  .object({
    code: z.enum(["UNDATED_FIGURES", "CONTRADICTIONS", "ASK_COMPLETE", "LENGTH"]),
    passed: z.boolean(),
    words: z.string().max(240),
  })
  .strict();
export type DeckCoachingCheck = z.infer<typeof DeckCoachingCheckSchema>;

export const DeckCoachingSchema = z
  .object({
    rubricVersion: z.number().int().min(1),
    sections: z.array(DeckCoachingSectionSchema).length(DECK_SECTIONS.length),
    checks: z.array(DeckCoachingCheckSchema).max(8),
    /** "Sections at standard: 8 of 12", never a weighted average. */
    sectionsAtStandard: z.number().int().min(0).max(DECK_SECTIONS.length),
    atMinimumStandard: z.boolean(),
  })
  .strict();
export type DeckCoaching = z.infer<typeof DeckCoachingSchema>;

// --- the deck tab --------------------------------------------------------------

export const COMPANY_DECK_SEGMENT = "/deck" as const;
/** `GET` — a short-lived signed, inline (view-only) read of the deck. */
export const COMPANY_DECK_OPEN_SEGMENT = "/deck/open" as const;
/** `POST` — the founder confirms what Q read (the Write Gate). */
export const DECK_EXTRACTION_CONFIRM_PATH =
  "/v1/documents/:documentId/deck-extractions/:extractionId/confirm" as const;

export const CompanyDeckSchema = z
  .object({
    documentId: UuidSchema,
    title: z.string().min(1).max(200),
    versionNumber: z.number().int().min(1),
    pageCount: z.number().int().min(1).max(10_000).nullable(),
    uploadedAt: UtcTimestampSchema,
    /** The founder's download choice (ADR 0041). False: view only. */
    downloadable: z.boolean(),
    scanned: z.boolean(),
  })
  .strict();
export type CompanyDeck = z.infer<typeof CompanyDeckSchema>;

export const DeckExtractionDtoSchema = z
  .object({
    extractionId: UuidSchema,
    readAt: UtcTimestampSchema,
    /** The deck version Q read. */
    versionNumber: z.number().int().min(1),
    /** The founder confirmed it; only then does an investor see it. */
    confirmed: z.boolean(),
    sections: DeckSectionsSchema,
  })
  .strict();
export type DeckExtractionDto = z.infer<typeof DeckExtractionDtoSchema>;

export const CompanyDeckViewSchema = z
  .object({
    viewer: z.enum(["INVESTOR", "OWNER"]),
    companyId: UuidSchema,
    /** Null: no deck this reader may see (never "no deck exists"). */
    deck: CompanyDeckSchema.nullable(),
    extraction: DeckExtractionDtoSchema.nullable(),
    /** OWNER only; always null for an investor. */
    coaching: DeckCoachingSchema.nullable(),
  })
  .strict();
export type CompanyDeckView = z.infer<typeof CompanyDeckViewSchema>;

export const DeckExtractionConfirmResultSchema = z
  .object({ extractionId: UuidSchema, confirmed: z.literal(true) })
  .strict();
export type DeckExtractionConfirmResult = z.infer<
  typeof DeckExtractionConfirmResultSchema
>;

// --- what the reader stores (internal; never on an investor's wire) ----------

/**
 * Q's reading of one section, as stored: the investor-facing section plus
 * whether the deck meets each rung of the research rubric (§4) for that
 * section. The model judges the content ("is the pain quantified?"); code
 * turns those answers into the 0-5 score, the same way for every company.
 * The criteria are stripped from every investor projection.
 */
export const DeckRubricCriteriaSchema = z
  .object({
    /** The rubric's "3 Clear" for this section is met. */
    clear: z.boolean(),
    /** "4 Strong" is met. */
    strong: z.boolean(),
    /** "5 Exceptional" is met. */
    exceptional: z.boolean(),
    /** One short, specific observation for the founder; null: nothing to add. */
    note: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();
export type DeckRubricCriteria = z.infer<typeof DeckRubricCriteriaSchema>;

export const DeckSectionReadingSchema = DeckSectionSchema.extend({
  criteria: DeckRubricCriteriaSchema,
}).strict();
export type DeckSectionReading = z.infer<typeof DeckSectionReadingSchema>;

/** The investor-facing section: the reading without the rubric. */
export function deckSectionForReaders(reading: DeckSectionReading): DeckSection {
  const { criteria: _criteria, ...section } = reading;
  return section;
}
