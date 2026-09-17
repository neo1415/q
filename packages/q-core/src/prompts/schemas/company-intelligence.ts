import { z } from "zod";

import { QConfidenceLevelSchema, TruthClassSchema } from "@capital-q/contracts";

import { LIST_MAX, ModelStatementSchema, STATEMENT_MAX } from "./common.js";

/**
 * The company dimensions Company Intelligence understands in V1
 * (CQ-Q-020 §5, §13, §24-§33).
 *
 * A closed vocabulary, because an open one would let a model invent a
 * dimension and then report a gap in it. Each name is a question about the
 * business, not a score of it: there is no QUALITY, no READINESS and no FIT
 * here, and there must never be — those are InvestIQ's governed methodology
 * and the recommendation layer's, and inventing them here would create a
 * second, ungoverned answer to a question Capital Q answers elsewhere.
 */
export const COMPANY_INTELLIGENCE_DIMENSIONS = [
  "DESCRIPTION",
  "BUSINESS_MODEL",
  "PRODUCT",
  "MARKET",
  "CUSTOMERS",
  "TRACTION",
  "FINANCIAL",
  "TEAM",
  "STRATEGY",
  "CAPITAL_OBJECTIVE",
] as const;
export type CompanyIntelligenceDimension =
  (typeof COMPANY_INTELLIGENCE_DIMENSIONS)[number];
export const CompanyIntelligenceDimensionSchema = z.enum(
  COMPANY_INTELLIGENCE_DIMENSIONS,
);

/**
 * How well a dimension is evidenced. These are the ADR-001 evidence
 * statuses plus one honest extra.
 *
 * INSUFFICIENT is not a low score — it says Capital Q has not been shown
 * enough to speak, which is a different statement from "this is weak" and
 * must never be rendered as one (§19, §37). There is no percentage here on
 * purpose: "evidence completeness 72%" would be a number nobody measured.
 */
export const COMPANY_EVIDENCE_COVERAGE = [
  "INSUFFICIENT",
  "SELF_REPORTED",
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
] as const;
export type CompanyEvidenceCoverage =
  (typeof COMPANY_EVIDENCE_COVERAGE)[number];
export const CompanyEvidenceCoverageSchema = z.enum(COMPANY_EVIDENCE_COVERAGE);

/**
 * What kind of thing changed (§66). Reuses the dimension vocabulary rather
 * than inventing a parallel enum of change types: a revenue change is a
 * change in FINANCIAL, and saying it twice in two vocabularies would let
 * them drift apart.
 */
export const CompanyMaterialChangeSchema = z
  .object({
    dimension: CompanyIntelligenceDimensionSchema,
    statement: ModelStatementSchema,
    /** What it changed from and to, in the subject's own terms. */
    fromStatement: z.string().max(STATEMENT_MAX).nullable(),
    toStatement: z.string().max(STATEMENT_MAX).nullable(),
    /** When the newer reading started applying. */
    validFrom: z.string().max(40).nullable(),
  })
  .strict();
export type CompanyMaterialChange = z.infer<typeof CompanyMaterialChangeSchema>;

const CITATION_LABEL = /^F[0-9]{1,3}$/;
const CITATIONS_MAX = 8;

/**
 * The citation labels a model wrote, reduced to the ones that could
 * resolve.
 *
 * The task asks for bare "F<n>" labels and mostly gets them. Live, a model
 * that had just read PUBLIC WEB SOURCE entries wrote "S1", "[F3]", a
 * domain name and once a whole sentence, and the entire answer — prose the
 * person had already been read — was refused for a label the specialist
 * would have dropped anyway. A citation that names nothing the model was
 * shown resolves to nothing whether it is dropped before the schema or
 * after it; dropping it here means a stray label costs a citation, never
 * the answer. What survives is still only a well-formed label, checked
 * against the render by the specialist as before.
 */
export function readCitationLabels(value: unknown): readonly string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const labels = items
    .flatMap((item) => (typeof item === "string" ? item.split(/[,\s]+/) : []))
    .map((item) =>
      item
        .trim()
        .replace(/^[[(#"'`]+/, "")
        .replace(/[\])"'`.;:]+$/, "")
        .toUpperCase(),
    )
    .filter((item) => CITATION_LABEL.test(item));
  return [...new Set(labels)].slice(0, CITATIONS_MAX);
}

/**
 * A finding as a model may state it in the Company Intelligence task.
 *
 * Deliberately close to `ModelFinding` but dimension-aware and
 * citation-bearing. `citations` are the opaque `F<n>` labels the render
 * showed; the specialist resolves them to real evidence references and
 * drops what does not resolve, so a model cannot cite a document, a slide
 * or a knowledge object that was never handed to it (§61, §89, §90).
 */
export const CompanyIntelligenceFindingSchema = z
  .object({
    dimension: CompanyIntelligenceDimensionSchema,
    type: z.enum([
      "FACT",
      "OBSERVATION",
      "INFERENCE",
      "RISK",
      "STRENGTH",
      "GAP",
      "UNCERTAINTY",
    ]),
    statement: ModelStatementSchema,
    truthClass: TruthClassSchema,
    confidence: QConfidenceLevelSchema,
    /** Labels of the supplied facts this rests on, e.g. ["F3","F7"]. */
    citations: z
      .preprocess(
        readCitationLabels,
        z.array(z.string().regex(CITATION_LABEL)).max(CITATIONS_MAX),
      )
      .default([]),
    /** Stated assumptions. Surfaced, never hidden (§63). */
    assumptions: z.array(ModelStatementSchema).max(5).default([]),
  })
  .strict();
export type CompanyIntelligenceFinding = z.infer<
  typeof CompanyIntelligenceFindingSchema
>;

export const CompanyDimensionCoverageSchema = z
  .object({
    dimension: CompanyIntelligenceDimensionSchema,
    coverage: CompanyEvidenceCoverageSchema,
  })
  .strict();

/**
 * The structured half of a company investigation, as the model produces it
 * (§60). Everything security- or truth-critical — which contradictions are
 * open, what is stale, what the coverage actually is — is computed
 * deterministically by the specialist and is NOT taken from here; these
 * fields are the model's reading, checked against that computation.
 */
export const CompanyIntelligenceModelOutputSchema = z
  .object({
    findings: z
      .array(CompanyIntelligenceFindingSchema)
      .max(LIST_MAX)
      .default([]),
    coverage: z.array(CompanyDimensionCoverageSchema).max(16).default([]),
    missingInformation: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    materialChanges: z.array(CompanyMaterialChangeSchema).max(12).default([]),
  })
  .strict();
export type CompanyIntelligenceModelOutput = z.infer<
  typeof CompanyIntelligenceModelOutputSchema
>;
