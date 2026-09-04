import { z } from "zod";

/**
 * Shapes of the server-assembled step contexts: the mandate candidates
 * (I1), the deterministic mandate review (I11) and the handoff (I12).
 * Projections of canonical Investor, Mandate, Taxonomy and portfolio state
 * plus typed onboarding-only answers. Labels and values only: no synthesis,
 * no score, no recommendation, no claim that Q or GateQ did anything.
 */

const Labelled = z.object({ key: z.string(), label: z.string() });
export type LabelledValue = z.infer<typeof Labelled>;

export const InvestorMandateCandidateSchema = z.object({
  mandateId: z.string(),
  name: z.string(),
  status: z.enum(["DRAFT", "ACTIVE"]),
  version: z.number().int(),
});

export const InvestorMandatesContextSchema = z.object({
  kind: z.literal("investor.mandates"),
  investorOrganisationId: z.string(),
  candidates: z.array(InvestorMandateCandidateSchema),
  /** True when exactly one draft exists and can be preselected. */
  suggestedMandateId: z.string().nullable(),
});
export type InvestorMandatesContext = z.infer<
  typeof InvestorMandatesContextSchema
>;

const TaxonomyItem = z.object({
  nodeId: z.string(),
  label: z.string(),
  vocabularyCode: z.string(),
  strength: z.string(),
  isExclusion: z.boolean(),
});

const CodedItem = z.object({
  code: z.string(),
  label: z.string(),
  strength: z.string(),
  isExclusion: z.boolean(),
});

export const InvestorReviewContextSchema = z.object({
  kind: z.literal("investor.review"),
  investor: z.object({
    investorOrganisationId: z.string(),
    displayName: z.string(),
    investorType: z.string(),
    deploymentState: Labelled.nullable(),
    representativeTitle: z.string().nullable(),
  }),
  mandate: z.object({
    mandateId: z.string(),
    name: z.string(),
    status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]),
    version: z.number().int(),
    stages: z.array(Labelled),
    stageRange: z
      .object({ min: z.string().nullable(), max: z.string().nullable() })
      .nullable(),
    cheque: z
      .object({
        currency: z.string(),
        min: z.string().nullable(),
        typical: z.string().nullable(),
        max: z.string().nullable(),
      })
      .nullable(),
    investmentRoles: z.array(Labelled),
    geographies: z.array(TaxonomyItem),
    sectors: z.array(TaxonomyItem),
    businessAttributes: z.array(CodedItem),
    founderPreferences: z.array(CodedItem),
    greenFlags: z.array(CodedItem),
    avoid: z.array(CodedItem),
    hardExclusions: z.array(z.union([CodedItem, TaxonomyItem])),
    customCriteria: z.array(z.string()),
    discoveryMode: Labelled.nullable(),
    /** Whether a free-text narrative exists. Never its content. */
    rawTextRecorded: z.boolean(),
  }),
  portfolio: z.array(z.object({ id: z.string(), companyName: z.string() })),
  /** Onboarding-only answers that have no canonical home yet. */
  onboardingOnly: z.object({
    revenueState: Labelled.nullable(),
    inboundPreference: Labelled.nullable(),
  }),
});
export type InvestorReviewContext = z.infer<typeof InvestorReviewContextSchema>;

export const InvestorHandoffContextSchema = z.object({
  kind: z.literal("investor.handoff"),
  mandate: z.object({
    mandateId: z.string(),
    status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]),
    version: z.number().int(),
    effectiveFrom: z.string().nullable(),
  }),
  /** Recommendation is not implemented; the handoff says so honestly. */
  recommendation: z.literal("NOT_AVAILABLE"),
  inboundPreference: Labelled.nullable(),
});
export type InvestorHandoffContext = z.infer<
  typeof InvestorHandoffContextSchema
>;
