import {
  FIT_PARAMETERS,
  type FitBand,
  type FitCompanyDto,
  type FitComparisonDto,
  type FitConfidence,
  type FitOutcome,
  type FitParameter,
  type FitParameterResultDto,
  type FitProfileDto,
  type IncomingConnectionRequestDto,
  type QViewDto,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";

/**
 * Fictional fixtures for the match design review (brief B1-B4). Every
 * company is invented. The fit profiles follow the real model's shape and
 * the real reason templates (fit-reasons.v1): bands and confidence are the
 * ones `ranking-config.v4` gives these outcome patterns (see the
 * discovery fit tests' "approved mockup" case). Nothing here is read from,
 * or written to, anywhere.
 */

export const COMPUTED_AT = "2026-10-05T21:40:00.000Z";

const id = (n: number) =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Weight order of ranking-config.v4, to pick top reasons as the model does. */
const WEIGHT: Readonly<Record<FitParameter, number>> = {
  STAGE: 0.18,
  SECTOR: 0.18,
  GEOGRAPHY: 0.14,
  CHEQUE_SIZE: 0.12,
  TRACTION: 0.1,
  TEAM: 0.08,
  THESIS: 0.08,
  BUSINESS_MODEL: 0.06,
  ROUND_TERMS: 0.06,
};

const CODE: Readonly<Record<string, FitOutcome>> = {
  S: "STRONG",
  P: "PARTIAL",
  M: "MISMATCH",
  U: "UNKNOWN",
};

function profile(
  companyId: string,
  band: FitBand,
  confidence: FitConfidence,
  pattern: string,
  reasons: readonly string[],
): FitProfileDto {
  const parameters: FitParameterResultDto[] = FIT_PARAMETERS.map(
    (parameter, i) => {
      const outcome = CODE[pattern[i] ?? "U"] ?? "UNKNOWN";
      return {
        parameter,
        outcome,
        reason: reasons[i] ?? "",
        evidenceStatus: outcome === "UNKNOWN" ? null : "SELF_REPORTED",
        stale: false,
        applicable: true,
      };
    },
  );
  const byWeight = (a: FitParameterResultDto, b: FitParameterResultDto) =>
    WEIGHT[b.parameter] - WEIGHT[a.parameter];
  return {
    companyId,
    configVersion: "ranking-config.v4",
    configLabel: "4",
    band,
    confidence,
    parameters,
    topReasons: [
      ...parameters.filter((p) => p.outcome === "STRONG").sort(byWeight),
      ...parameters.filter((p) => p.outcome === "PARTIAL").sort(byWeight),
    ].slice(0, 3),
    mainMismatch:
      parameters.filter((p) => p.outcome === "MISMATCH").sort(byWeight)[0] ??
      null,
    hardRule: null,
    computedAt: COMPUTED_AT,
  };
}

type Company = {
  readonly fit: FitCompanyDto;
  readonly view: QViewDto;
};

function company(
  n: number,
  name: string,
  line: string,
  band: FitBand,
  confidence: FitConfidence,
  pattern: string,
  reasons: readonly string[],
  view: Omit<
    Extract<QViewDto, { status: "READY" }>,
    "status" | "companyId" | "truthClass" | "configVersion"
  >,
): Company {
  const companyId = id(n);
  return {
    fit: {
      companyId,
      name,
      line,
      profile: profile(companyId, band, confidence, pattern, reasons),
    },
    view: {
      status: "READY",
      companyId,
      truthClass: "Q_INFERENCE",
      configVersion: "ranking-config.v4",
      ...view,
    },
  };
}

export const SUNLINE = company(
  1,
  "Sunline Energy",
  "Seed · Clean energy · Kenya",
  "STRONG_FIT",
  "HIGH",
  "SSSSSSSPS",
  [
    "Raising seed; you invest at pre-seed to seed.",
    "Clean energy, one of your sectors.",
    "Based in Kenya; you invest there.",
    "$2M round; your $300k fits.",
    "Subscription per shop, a model you prefer.",
    "$58k a month, above your $50k minimum.",
    "Two full-time founders, one technical; meets what you look for.",
    "Some overlap with your thesis.",
    "SAFE, lead committed; fits how you invest.",
  ],
  {
    verdict: "WORTH_A_LOOK",
    summary:
      "Fastest growth of the three, and revenue is backed by bank statements.",
    mainRisk: "repayment rates in the dry season.",
    unknowns: [],
  },
);

export const KORA = company(
  2,
  "Kora Health",
  "Seed · Health insurance software · Nigeria",
  "GOOD_FIT",
  "MEDIUM",
  "SSSSSPSSU",
  [
    "Raising seed; you invest at pre-seed to seed.",
    "Health insurance software, one of your sectors.",
    "Based in Nigeria; you invest there.",
    "$1.2M round; your $250k fits.",
    "Fee per paid claim, a model you prefer.",
    "$31k a month, below your $50k minimum.",
    "Technical co-founder, 8 years in the field; meets what you look for.",
    "Close to your thesis.",
    "Round terms not shared.",
  ],
  {
    verdict: "WORTH_A_LOOK",
    summary:
      "Revenue matches the accounts they shared. Ask how they compare with other claims tools: the deck doesn't say.",
    mainRisk: null,
    unknowns: ["Round terms"],
  },
);

export const HARVEST = company(
  3,
  "Harvest Ledger",
  "Pre-seed · Agriculture finance · Ghana",
  "PARTIAL_FIT",
  "LOW",
  "SPPSUUPSU",
  [
    "Raising pre-seed; you invest at pre-seed to seed.",
    "Agriculture finance, close to your sectors.",
    "Based in Ghana; in a region you invest in.",
    "$600k round; your $300k fits.",
    "Business model not clear yet.",
    "No traction data shared yet.",
    "Strong lender, no technical co-founder yet; part of what you look for.",
    "Close to your thesis.",
    "Round terms not shared.",
  ],
  {
    verdict: "MAYBE",
    summary:
      "Early, with a strong lending team. Too little shared to judge: ask for loan book numbers first.",
    mainRisk: null,
    unknowns: ["Traction", "Round terms"],
  },
);

export const FREIGHTLY = company(
  4,
  "Freightly",
  "Series A · Logistics · Egypt",
  "WEAK_FIT",
  "HIGH",
  "MPMMSSSPP",
  [
    "Raising Series A; your mandate is pre-seed to seed.",
    "Logistics, close to your sectors.",
    "Based in Egypt; outside your regions.",
    "Raising $6M; your range is $100k–$500k.",
    "Marketplace take-rate, a model you prefer.",
    "$210k a month, above your $50k minimum.",
    "Experienced, full-time team; meets what you look for.",
    "Some overlap with your thesis.",
    "Needs a lead; you sometimes lead.",
  ],
  {
    verdict: "PROBABLY_NOT",
    summary:
      "A good company outside your mandate: stage, cheque and region all sit outside what you set.",
    mainRisk: null,
    unknowns: [],
  },
);

export const TALLY = company(
  5,
  "Tally Pay",
  "Seed · Payments · United Arab Emirates",
  "GOOD_FIT",
  "HIGH",
  "SSPSSPPSS",
  [
    "Raising seed; you invest at pre-seed to seed.",
    "Payments, one of your sectors.",
    "Based in United Arab Emirates; in a region you invest in.",
    "$1.5M round; your $300k fits.",
    "Take-rate on payments, a model you prefer.",
    "$44k a month, below your $50k minimum.",
    "Strong commercial founder, CTO part-time; part of what you look for.",
    "Close to your thesis.",
    "SAFE led by a known fund; fits how you invest.",
  ],
  {
    verdict: "WORTH_A_LOOK",
    summary:
      "Clean round with a named lead. Ask about licences in each country.",
    mainRisk: null,
    unknowns: [],
  },
);

export const ALL = [SUNLINE, KORA, HARVEST, FREIGHTLY, TALLY] as const;

export const FITS: ReadonlyMap<string, FitCompanyDto> = new Map(
  ALL.map((c) => [c.fit.companyId, c.fit]),
);
export const VIEWS: ReadonlyMap<string, QViewDto | null> = new Map(
  ALL.map((c) => [c.fit.companyId, c.view]),
);

export function requests(now: number): readonly IncomingConnectionRequestDto[] {
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const rows: readonly (readonly [Company, number])[] = [
    [SUNLINE, 2],
    [KORA, 4],
    [HARVEST, 8],
    [FREIGHTLY, 5],
  ];
  return rows.map(([c, days], n): IncomingConnectionRequestDto => ({
    interestId: `a0000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
    relationshipId: `b0000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
    companyId: c.fit.companyId,
    companyName: c.fit.name,
    requestedAt: ago(days),
    response: "PENDING",
    respondedAt: null,
    connection: null,
  }));
}

export function relationships(now: number): readonly RelationshipSummaryDto[] {
  const ago = (hours: number) =>
    new Date(now - hours * 3_600_000).toISOString();
  const rows: readonly [
    Company,
    RelationshipSummaryDto["state"],
    RelationshipSummaryDto["nextStep"],
    number,
  ][] = [
    [KORA, "CONNECTED", "SCHEDULE_MEETING", 20],
    [SUNLINE, "IN_DILIGENCE", "NONE", 3],
    [TALLY, "INTEREST_EXPRESSED", "AWAIT_ANSWER", 50],
    [HARVEST, "MEETING_HELD", "DECIDE_NEXT_STEP", 80],
  ];
  return rows.map(([c, state, nextStep, hours], n) => ({
    relationshipId: `d0000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
    counterpart: { kind: "COMPANY", id: c.fit.companyId, name: c.fit.name },
    state,
    stateSince: ago(hours),
    nextStep,
  }));
}

export const TOP3: FitComparisonDto = {
  configVersion: "ranking-config.v4",
  configLabel: "4",
  parameters: [...FIT_PARAMETERS],
  entries: [SUNLINE, TALLY, KORA].map((c, j) => ({
    position: j + 1,
    companyId: c.fit.companyId,
    name: c.fit.name,
    line: c.fit.line,
    sources: j === 1 ? ["RELATIONSHIP"] : ["REQUEST"],
    profile: c.fit.profile,
    // The model marks a best only where one is strictly better; on these
    // three outcome patterns no row has one.
    bestOn: [],
  })),
  considered: 46,
  leftOut: { outsideMandate: 5, notEnoughInformation: 3 },
  computedAt: COMPUTED_AT,
};
