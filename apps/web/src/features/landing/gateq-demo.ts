import {
  GatewayPolicySchema,
  publicProjectionOf,
  qualify,
  type CriterionReasonCode,
  type CriterionStatus,
  type GatewayPolicy,
  type QualificationResult,
  type QualificationSubjectProjection,
} from "@capital-q/gateq/engine";

/**
 * The landing page's "Am I a fit?" demo: the real GateQ engine, run in the
 * visitor's browser against one static, fictional gateway.
 *
 * No seeded demo gateway exists, so the policy is written here and parsed
 * through the engine's own contract at load: if GateQ's contract moves,
 * this fails loudly instead of demonstrating something the product no
 * longer does. Nothing leaves the device: no request, no storage, no
 * model. The answers live in component state and vanish with the tab.
 */

/** Fixed, obviously synthetic ids: version-4 shaped, never a real row. */
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_INVESTOR_NAME = "Demo Ridge Capital";
export const DEMO_INVESTOR_LABEL = "Demo investor (fictional)";

const SECTOR = "sector";
const NODE = {
  fintech: id(101),
  payments: id(102),
  lending: id(103),
  climate: id(104),
  health: id(105),
  consumer: id(106),
  betting: id(107),
} as const;

/** The choices a visitor can make, with the canonical node each one means. */
export const SECTOR_OPTIONS = [
  {
    value: "payments",
    label: "Payments",
    node: NODE.payments,
    ancestors: [NODE.fintech],
  },
  {
    value: "lending",
    label: "Lending",
    node: NODE.lending,
    ancestors: [NODE.fintech],
  },
  { value: "climate", label: "Climate", node: NODE.climate, ancestors: [] },
  { value: "health", label: "Health", node: NODE.health, ancestors: [] },
  {
    value: "betting",
    label: "Online betting",
    node: NODE.betting,
    ancestors: [NODE.consumer],
  },
] as const;

export const STAGE_OPTIONS = [
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b", label: "Series B" },
] as const;

export const COUNTRY_OPTIONS = [
  { value: "NG", label: "Nigeria" },
  { value: "KE", label: "Kenya" },
  { value: "GH", label: "Ghana" },
  { value: "ZA", label: "South Africa" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
] as const;

export const CURRENCY_OPTIONS = ["USD", "GBP", "EUR", "NGN"] as const;

const NOW = "2026-10-01T09:00:00.000Z";

export const DEMO_POLICY: GatewayPolicy = GatewayPolicySchema.parse({
  gateway: {
    id: id(1),
    tenantId: id(2),
    investorOrganisationId: id(3),
    organisationId: id(4),
    publicId: "gq_d3m00000000000000000000000",
    name: DEMO_INVESTOR_NAME,
    status: "ACTIVE",
    createdByUserId: id(5),
    createdAt: NOW,
    updatedAt: NOW,
  },
  version: {
    id: id(6),
    gatewayId: id(1),
    tenantId: id(2),
    versionNumber: 1,
    status: "PUBLISHED",
    inboundMode: "QUALIFIED",
    publicTitle: "Early-stage fintech and climate",
    publicDescription:
      "Pre-seed and seed companies in fintech or climate, in Africa or the UK.",
    qualificationPolicyVersion: "gateq-qualification.v1",
    createdByUserId: id(5),
    publishedByUserId: id(5),
    publishedAt: NOW,
    supersededAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  criteria: [
    {
      id: id(11),
      versionId: id(6),
      position: 1,
      requiredness: "REQUIRED",
      label: "Stage",
      config: { type: "STAGE", allowedStageCodes: ["pre_seed", "seed"] },
    },
    {
      id: id(12),
      versionId: id(6),
      position: 2,
      requiredness: "REQUIRED",
      label: "Sector",
      config: {
        type: "TAXONOMY",
        vocabularyCode: SECTOR,
        allowedNodeIds: [NODE.fintech, NODE.climate],
      },
    },
    {
      id: id(13),
      versionId: id(6),
      position: 3,
      requiredness: "REQUIRED",
      label: "Headquarters",
      config: {
        type: "GEOGRAPHY",
        allowedCountries: ["NG", "KE", "GH", "ZA", "GB"],
      },
    },
    {
      id: id(14),
      versionId: id(6),
      position: 4,
      requiredness: "REQUIRED",
      label: "Round size",
      config: {
        type: "RAISE_SIZE",
        currency: "USD",
        minAmount: "250000",
        maxAmount: "3000000",
      },
    },
    {
      id: id(15),
      versionId: id(6),
      position: 5,
      requiredness: "PREFERRED",
      label: "Our minimum cheque fits your round",
      config: {
        type: "CHEQUE_COMPATIBILITY",
        currency: "USD",
        minCheque: "150000",
        maxCheque: "750000",
      },
    },
    {
      id: id(16),
      versionId: id(6),
      position: 6,
      requiredness: "REQUIRED",
      label: "Sectors we never back",
      config: {
        type: "EXCLUDED_TAXONOMY",
        vocabularyCode: SECTOR,
        excludedNodeIds: [NODE.betting],
      },
    },
  ],
});

/** What the world sees of it: labels, never the configured answers. */
export const DEMO_PUBLIC_GATEWAY = publicProjectionOf({
  policy: DEMO_POLICY,
  organisationDisplayName: DEMO_INVESTOR_NAME,
});

/** A visitor's answers. An empty string is "not saying", which is allowed. */
export type DemoAnswers = {
  readonly stage: string;
  readonly sector: string;
  readonly country: string;
  readonly amount: string;
  readonly currency: string;
};

export const EMPTY_ANSWERS: DemoAnswers = {
  stage: "",
  sector: "",
  country: "",
  amount: "",
  currency: "USD",
};

/** "1,500,000" or "1500000.50" → an exact decimal string, else null. */
export function normaliseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[\s,_]/g, "");
  if (!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * The answers as the bounded projection the engine reads. A blank answer
 * becomes null or an absent classification, never a guess: that is what
 * lets the engine say "unknown" rather than "no".
 */
export function projectionFor(
  answers: DemoAnswers,
): QualificationSubjectProjection {
  const sector = SECTOR_OPTIONS.find((o) => o.value === answers.sector);
  const stage = STAGE_OPTIONS.find((o) => o.value === answers.stage);
  const country = COUNTRY_OPTIONS.find((o) => o.value === answers.country);
  const amount = normaliseAmount(answers.amount);
  const currency = (CURRENCY_OPTIONS as readonly string[]).includes(
    answers.currency,
  )
    ? answers.currency
    : null;
  return {
    subject: {
      kind: "GATEQ_APPLICATION",
      applicationId: id(21),
      tenantId: id(2),
    },
    classifications:
      sector === undefined
        ? []
        : [
            {
              vocabularyCode: SECTOR,
              nodeId: sector.node,
              ancestorNodeIds: [...sector.ancestors],
            },
          ],
    headquartersCountry: country?.value ?? null,
    currentStageCode: stage?.value ?? null,
    raise: amount === null || currency === null ? null : { amount, currency },
  };
}

export function runDemo(answers: DemoAnswers): QualificationResult {
  return qualify({
    policy: DEMO_POLICY,
    projection: projectionFor(answers),
    evaluatedAt: NOW,
  });
}

export const STATUS_WORDS: Readonly<Record<CriterionStatus, string>> = {
  MATCH: "Matched",
  NO_MATCH: "Not matched",
  UNKNOWN: "Unknown",
};

/** Each engine reason, in a sentence. Every code has one (tested). */
export const REASON_COPY: Readonly<Record<CriterionReasonCode, string>> = {
  TAXONOMY_NODE_MATCHED: "Your sector is one they back.",
  TAXONOMY_ANCESTOR_MATCHED:
    "Your sector sits inside one they back (payments is fintech).",
  TAXONOMY_NO_OVERLAP: "Your sector is outside what they back.",
  TAXONOMY_NOT_CLASSIFIED:
    "You didn't say a sector, so this can't be checked yet.",
  GEOGRAPHY_COUNTRY_ALLOWED: "Your headquarters is somewhere they invest.",
  GEOGRAPHY_COUNTRY_NOT_ALLOWED:
    "Your headquarters is outside where they invest.",
  GEOGRAPHY_NOT_DECLARED:
    "You didn't say where you're based, so this can't be checked yet.",
  STAGE_ALLOWED: "Your stage is one they invest at.",
  STAGE_NOT_ALLOWED: "Your stage is outside the stages they invest at.",
  STAGE_NOT_DECLARED:
    "You didn't say your stage, so this can't be checked yet.",
  RAISE_WITHIN_BAND: "Your round is inside their range.",
  RAISE_BELOW_BAND: "Your round is below their range.",
  RAISE_ABOVE_BAND: "Your round is above their range.",
  RAISE_NOT_DECLARED:
    "You didn't give a round size, so this can't be checked yet.",
  RAISE_CURRENCY_DIFFERS:
    "Your round is in a different currency. GateQ never converts, so this stays unknown.",
  CHEQUE_FITS_RAISE: "Their minimum cheque fits inside your round.",
  CHEQUE_EXCEEDS_RAISE: "Their minimum cheque is larger than your whole round.",
  CHEQUE_CURRENCY_DIFFERS:
    "Your round is in a different currency, so the cheque can't be compared.",
  EXCLUSION_MATCHED: "Your sector is one they never back.",
  EXCLUSION_NOT_MATCHED: "Your sector isn't on their exclusion list.",
  EXCLUSION_NOT_ASSESSABLE:
    "Without a sector, an exclusion can't apply. Unknown never excludes.",
};

export const OUTCOME_COPY: Readonly<
  Record<QualificationResult["outcome"], { title: string; body: string }>
> = {
  QUALIFIED: {
    title: "You meet every requirement",
    body: "On what you told it, you meet this investor's published requirements. That is fit with their policy, not a judgement of your company.",
  },
  NOT_QUALIFIED: {
    title: "Not a fit for this investor",
    body: "At least one requirement they published doesn't match. That says nothing about the quality of your company; it saves you both an email.",
  },
  INSUFFICIENT_INFORMATION: {
    title: "Nothing rules you out yet",
    body: "Some requirements are unknown because you didn't answer them. Unknown is not a no: it means the question is still open.",
  },
};
