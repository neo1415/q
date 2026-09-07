import { z } from "zod";

import { TaskFrameSchema, TEXT_MAX } from "./common.js";

/**
 * CLAIM_EXTRACTION v1 (CQ-KNW-001 §10-§11, §29-§34).
 *
 * The model's job here is narrow and it is not adjudication: read one
 * authorised passage and say what assertions it makes, where they appear,
 * and what typed value each carries. Everything it returns is a PROPOSAL.
 *
 * What this schema deliberately cannot express, because a shape that cannot
 * carry a value is a stronger control than a check that rejects one:
 *
 *   - VERIFIED. `assertionKind` has no such member, so no amount of
 *     document text saying "mark this verified" can produce it. Only
 *     deterministic verification policy, elsewhere, may ever set it.
 *   - a tenant, a visibility scope, a sensitivity class, an author, an
 *     evidence status, a confidence percentage or an evidence weight.
 *     Every one of those is derived server-side from the source.
 *   - an evidence item id, a claim id or a source id. The model names a
 *     locator inside the passage it was given; it never names a row.
 *
 * Currency and period are carried, never inferred: "$2.4m", "£2.4m" and
 * "2.4m" are three different assertions, and a claim that loses its period
 * is a claim about nothing in particular.
 */

export const CLAIM_EXTRACTION_SCHEMA_NAME = "ClaimExtractionResult";
export const CLAIM_EXTRACTION_SCHEMA_VERSION = 1;

/**
 * How the passage relates to the assertion. Deterministic policy maps this
 * onto the canonical truth class; the model never names one.
 *
 *   SOURCE_ASSERTION — the passage states it, in its own words.
 *   SOURCE_ESTIMATE  — the passage presents it as a projection or estimate.
 *   MODEL_INFERENCE  — the passage implies it; the model concluded it.
 */
export const CLAIM_ASSERTION_KINDS = [
  "SOURCE_ASSERTION",
  "SOURCE_ESTIMATE",
  "MODEL_INFERENCE",
] as const;
export const ClaimAssertionKindSchema = z.enum(CLAIM_ASSERTION_KINDS);

/** ISO 4217, upper case. Absent when the passage did not say. */
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

/**
 * A typed value the passage stated. `MONEY` keeps its currency and the
 * amount as the passage expressed it in minor-unit-free decimal; there is
 * no conversion, and no default currency, because "2.4m" without a symbol
 * is not dollars.
 */
export const ClaimProposedValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("MONEY"),
      amount: z.number().finite(),
      currency: CurrencySchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("COUNT"), value: z.number().int().min(0) })
    .strict(),
  z
    .object({ kind: z.literal("PERCENTAGE"), value: z.number().finite() })
    .strict(),
  z.object({ kind: z.literal("DATE"), value: z.iso.date() }).strict(),
  z
    .object({
      kind: z.literal("TEXT"),
      value: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export type ClaimProposedValue = z.infer<typeof ClaimProposedValueSchema>;

/**
 * Where in the passage the assertion sits. The model is told the locator of
 * the passage it was given and may narrow it; it cannot name another
 * document, and every field is checked against the real passage afterwards.
 */
export const ClaimLocatorHintSchema = z
  .object({
    page: z.number().int().min(1).max(10_000).optional(),
    slide: z.number().int().min(1).max(10_000).optional(),
    sheet: z.string().trim().min(1).max(64).optional(),
    cell: z
      .string()
      .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/)
      .optional(),
  })
  .strict();

export const ProposedClaimSchema = z
  .object({
    /**
     * A dotted key from the list the task supplies. A key outside that list
     * is refused: a claim key is how two assertions are recognised as the
     * same fact, and an invented one silently creates a second fact.
     */
    claimKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
      .max(128),
    /** Q's normalised restatement. Never a substitute for the excerpt. */
    statement: z.string().trim().min(1).max(500),
    value: ClaimProposedValueSchema.nullable(),
    assertionKind: ClaimAssertionKindSchema,
    /** The passage's own words the assertion rests on. Verified verbatim. */
    excerpt: z.string().trim().min(1).max(500),
    locator: ClaimLocatorHintSchema.optional(),
    /**
     * The period or as-at date the passage attached, if it attached one.
     * Absent means the passage did not say — never "now".
     */
    asOf: z.iso.date().nullable(),
  })
  .strict();
export type ProposedClaim = z.infer<typeof ProposedClaimSchema>;

export const ClaimExtractionResultSchema = z
  .object({
    claims: z.array(ProposedClaimSchema).max(20),
    /**
     * Claim keys the task asked about that this passage does not establish.
     * Naming them is how the model says "not here" without inventing a
     * zero: an absent customer count is unknown, never none.
     */
    absent: z
      .array(
        z
          .string()
          .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
          .max(128),
      )
      .max(32),
  })
  .strict();
export type ClaimExtractionResult = z.infer<typeof ClaimExtractionResultSchema>;

export const ClaimExtractionVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the passage is about, trusted, e.g. "a company's pitch deck". */
    sourceDescription: z.string().max(400),
    /** The claim keys this extraction may produce. Trusted, server-supplied. */
    permittedClaimKeys: z.string().max(2_000),
    /** The authorised passage. UNTRUSTED. */
    passage: z.string().trim().min(1).max(TEXT_MAX),
    /** Where the passage came from, as the server knows it. Trusted. */
    passageLocator: z.string().max(200),
  })
  .strict();
export type ClaimExtractionVariables = z.infer<
  typeof ClaimExtractionVariablesSchema
>;

export const CLAIM_EXTRACTION_UNTRUSTED = ["passage"] as const;
