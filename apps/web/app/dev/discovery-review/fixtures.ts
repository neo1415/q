import type {
  CompanyDto,
  CompanyNetworkPreview,
  ConnectionStatusDto,
  DiscoveredInvestorDto,
  FitComparisonDto,
  IncomingInterestDto,
  InvestorGateFitDto,
  MarketplaceReadinessAssessment,
  PublicCardDto,
} from "@capital-q/contracts";

import type { InvestorProfileReads } from "@/features/investors/investor-profile";
import type { InterestFacts } from "@/features/network/interest-cards";
import type { ShortlistRow } from "@/features/discover/shortlist-data";
import type { PaletteResult } from "@/features/search/search-actions";
import type { RecentItem } from "@/features/search/recent-opened";

import { ALL as MATCH_COMPANIES, TOP3 } from "../match/fixtures";

/**
 * Fictional fixtures for the discovery design review (/dev/discovery-review):
 * Search and its palette, the investors directory and an investor's page,
 * Saved / Passed / Compare, investor interest and Visibility. Every
 * investor, company and person is invented; nothing is read from or
 * written to anywhere. Shapes are the real contracts, so a contract change
 * breaks this file at typecheck rather than the screenshots.
 */

const id = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The founder's own company in the founder-side pages. */
export const BRIGHTFOLD = {
  id: id("e2000000", 1),
  name: "Brightfold Logistics (fictional)",
} as const;

/** The investor in the investor-side pages (Saved / Passed / Compare). */
export const HARBOURLINE_ID = id("e1000000", 1);
const KESTREL_ID = id("e1000000", 2);
const NORTHBOUND_ID = id("e1000000", 3);
const LARCHMERE_ID = id("e1000000", 4);
const TIDEWATER_ID = id("e1000000", 5);
const ASHGROVE_ID = id("e1000000", 6);

export const REVIEW_VIEWER = "review-viewer-fictional";

// ---------------------------------------------------------------------------
// Investors as Discover reads them (DiscoveredInvestorDto + card + gate)
// ---------------------------------------------------------------------------

function investor(
  investorOrganisationId: string,
  displayName: string,
  investorType: string,
  rest: Partial<DiscoveredInvestorDto> = {},
): DiscoveredInvestorDto {
  return {
    investorOrganisationId,
    displayName,
    investorType,
    websiteUrl: null,
    hqCountry: null,
    publicDescription: null,
    deploymentState: null,
    inboundPreference: null,
    photoUrl: null,
    reasons: [],
    ...rest,
  };
}

export const INVESTORS: readonly DiscoveredInvestorDto[] = [
  investor(HARBOURLINE_ID, "Harbourline Ventures (fictional)", "VC", {
    websiteUrl: "https://harbourline.example",
    hqCountry: "GB",
    publicDescription:
      "We back seed-stage companies that move goods more cheaply across East and West Africa: freight, warehousing and the software between them.\n\nWe like founders who have run the operation themselves before writing the software for it.",
    deploymentState: "ACTIVELY_INVESTING",
    inboundPreference: "OPEN",
    reasons: [
      { kind: "STAGE_IN_RANGE", detail: "Seed" },
      { kind: "SECTOR_MATCH", detail: "Logistics" },
      { kind: "GEOGRAPHY_MATCH", detail: "Kenya" },
    ],
  }),
  investor(KESTREL_ID, "Kestrel Angels (fictional)", "SYNDICATE", {
    hqCountry: "KE",
    deploymentState: "SELECTIVE",
    inboundPreference: "OPEN",
    reasons: [{ kind: "GEOGRAPHY_MATCH", detail: "Kenya" }],
  }),
  investor(
    NORTHBOUND_ID,
    "Northbound Family Office (fictional)",
    "FAMILY_OFFICE",
    {
      hqCountry: "NG",
      deploymentState: "ACTIVELY_INVESTING",
      inboundPreference: "QUALIFIED",
    },
  ),
  investor(LARCHMERE_ID, "Larchmere Capital (fictional)", "VC", {
    hqCountry: "ZA",
    deploymentState: "PAUSED",
    inboundPreference: "CLOSED",
  }),
  investor(TIDEWATER_ID, "Tidewater Accelerator (fictional)", "ACCELERATOR"),
  investor(ASHGROVE_ID, "Ashgrove Corporate Ventures (fictional)", "CVC", {
    hqCountry: "RW",
    deploymentState: "ACTIVELY_INVESTING",
    inboundPreference: "OPEN",
  }),
];

function card(
  handle: string,
  name: string,
  fields: PublicCardDto["fields"],
  verified: PublicCardDto["verified"] = [],
): PublicCardDto {
  return {
    kind: "CARD",
    handle,
    subjectType: "INVESTOR_ORGANISATION",
    name,
    fields,
    verified,
    demoAttested: [],
    audience: "PARTICIPANT",
    indexable: false,
  };
}

export const HARBOURLINE_CARD = card(
  "harbourline",
  "Harbourline Ventures (fictional)",
  [
    { key: "mandateStages", value: "Pre-seed; Seed", scope: "network_visible" },
    {
      key: "mandateSectors",
      value: "Logistics; Supply chain software",
      scope: "network_visible",
    },
    {
      key: "mandateGeographies",
      value: "Kenya; Nigeria; Ghana",
      scope: "network_visible",
    },
    {
      key: "mandateTypicalCheque",
      value: "USD 250,000 to 750,000",
      scope: "network_visible",
    },
    {
      key: "mandateBusinessModels",
      value: "Subscription; Marketplace",
      scope: "network_visible",
    },
    {
      key: "mandateCustomerTypes",
      value: "SMEs; Enterprise",
      scope: "network_visible",
    },
    {
      key: "mandateLookFor",
      value: "Operators turned founders; Paying customers before the round",
      scope: "network_visible",
    },
  ],
  ["ORGANISATION_VERIFIED"],
);

export const CARDS: ReadonlyMap<string, PublicCardDto | null> = new Map([
  [HARBOURLINE_ID, HARBOURLINE_CARD],
  [
    KESTREL_ID,
    card("kestrel-angels", "Kestrel Angels (fictional)", [
      { key: "mandateStages", value: "Pre-seed", scope: "network_visible" },
      {
        key: "mandateSectors",
        value: "Fintech; Logistics",
        scope: "network_visible",
      },
      {
        key: "mandateTypicalCheque",
        value: "USD 50,000",
        scope: "network_visible",
      },
    ]),
  ],
  [
    NORTHBOUND_ID,
    card("northbound-fo", "Northbound Family Office (fictional)", [
      { key: "mandateStages", value: "Series A", scope: "network_visible" },
      { key: "mandateSectors", value: "Health", scope: "network_visible" },
    ]),
  ],
  [
    ASHGROVE_ID,
    card("ashgrove-cv", "Ashgrove Corporate Ventures (fictional)", [
      { key: "mandateSectors", value: "Mobility", scope: "network_visible" },
    ]),
  ],
]);

export const HARBOURLINE_GATE: InvestorGateFitDto = {
  investorOrganisationId: HARBOURLINE_ID,
  publicId: "harbourline-seed",
  title: "Harbourline seed applications",
  acceptingApplications: true,
  criteria: [
    {
      label: "Seed",
      requiredness: "REQUIRED",
      dimension: "STAGE",
      standing: "MET",
    },
    {
      label: "Logistics",
      requiredness: "REQUIRED",
      dimension: "TAXONOMY",
      standing: "MET",
    },
    {
      label: "No crypto lending",
      requiredness: "REQUIRED",
      dimension: "EXCLUDED_TAXONOMY",
      standing: "MET",
    },
    {
      label: "East or West Africa",
      requiredness: "REQUIRED",
      dimension: "GEOGRAPHY",
      standing: "MET",
    },
    {
      label: "Raising USD 1m to 3m",
      requiredness: "PREFERRED",
      dimension: "RAISE_SIZE",
      standing: "UNKNOWN",
    },
  ],
};

/** Harbourline with its gate closed: the card says Open to founders. */
export const HARBOURLINE_GATE_CLOSED: InvestorGateFitDto = {
  ...HARBOURLINE_GATE,
  acceptingApplications: false,
};

export const GATES: ReadonlyMap<string, InvestorGateFitDto> = new Map([
  [HARBOURLINE_ID, HARBOURLINE_GATE],
  [
    KESTREL_ID,
    {
      investorOrganisationId: KESTREL_ID,
      publicId: "kestrel",
      title: "Kestrel rules",
      acceptingApplications: false,
      criteria: [
        {
          label: "Pre-seed",
          requiredness: "REQUIRED",
          dimension: "STAGE",
          standing: "NOT_MET",
        },
        {
          label: "Fintech",
          requiredness: "PREFERRED",
          dimension: "TAXONOMY",
          standing: "MET",
        },
      ],
    },
  ],
]);

/** Which sheet a directory state opens, and how the request reads. */
export const SHEET_INVESTOR = {
  request: KESTREL_ID,
  sent: KESTREL_ID,
  requested: KESTREL_ID,
  connected: KESTREL_ID,
  declined: KESTREL_ID,
  loading: KESTREL_ID,
  failed: KESTREL_ID,
  gate: HARBOURLINE_ID,
  closed: LARCHMERE_ID,
  "not-qualified": NORTHBOUND_ID,
  "not-stated": TIDEWATER_ID,
} as const;
export type SheetState = keyof typeof SHEET_INVESTOR;

const REQUESTED_AT = "2026-10-17T10:20:00.000Z";

function requestOf(
  investorOrganisationId: string,
  response: "PENDING" | "ACCEPTED" | "DECLINED",
): NonNullable<ConnectionStatusDto["request"]> {
  return {
    interestId: id("e3000000", 1),
    relationshipId: id("e4000000", 1),
    investorOrganisationId,
    requestedAt: REQUESTED_AT,
    response,
    respondedAt: response === "PENDING" ? null : "2026-10-19T08:00:00.000Z",
    connection:
      response === "ACCEPTED"
        ? {
            connectionId: id("e5000000", 1),
            status: "ACTIVE",
            connectedAt: "2026-10-19T08:00:00.000Z",
          }
        : null,
  };
}

/** Where Brightfold stands with the sheet's investor, per state. */
export function connectionStatus(
  state: SheetState,
  investorOrganisationId: string,
): ConnectionStatusDto {
  switch (state) {
    case "requested":
      return {
        canRequest: false,
        notAccepted: null,
        request: requestOf(investorOrganisationId, "PENDING"),
      };
    case "connected":
      return {
        canRequest: false,
        notAccepted: null,
        request: requestOf(investorOrganisationId, "ACCEPTED"),
      };
    case "declined":
      return {
        canRequest: false,
        notAccepted: null,
        request: requestOf(investorOrganisationId, "DECLINED"),
      };
    case "not-qualified":
      return { canRequest: false, notAccepted: "NOT_QUALIFIED", request: null };
    case "not-stated":
      return { canRequest: false, notAccepted: "NOT_STATED", request: null };
    case "closed":
      return { canRequest: false, notAccepted: "CLOSED", request: null };
    case "request":
    case "sent":
    case "gate":
    case "loading":
    case "failed":
      return { canRequest: true, notAccepted: null, request: null };
  }
}

/** The request the review's "send" answers with. */
export function sentRequest(investorOrganisationId: string) {
  return {
    request: requestOf(investorOrganisationId, "PENDING"),
    deduplicated: false,
  };
}

// ---------------------------------------------------------------------------
// One investor's page (InvestorProfileReads)
// ---------------------------------------------------------------------------

/** Everything published: card, gate, website, reasons, prefill. */
export function harbourlineFull(
  record: InvestorProfileReads["record"] = undefined,
  status: ConnectionStatusDto | null = {
    canRequest: true,
    notAccepted: null,
    request: null,
  },
): InvestorProfileReads {
  const found = INVESTORS[0];
  if (found === undefined) throw new Error("fixtures: no investor");
  return {
    investor: found,
    status,
    card: HARBOURLINE_CARD,
    gate: HARBOURLINE_GATE,
    reasons: found.reasons,
    record,
    prefill: {
      companyName: BRIGHTFOLD.name,
      oneLiner: "Shared warehousing for small importers in Mombasa.",
      stageCode: "SEED",
      country: "KE",
    },
  };
}

/** Harbourline, already in touch: accepted request, Connected in the CRM. */
export function harbourlineInTouch(): InvestorProfileReads {
  const request = requestOf(HARBOURLINE_ID, "ACCEPTED");
  return harbourlineFull(
    { state: "CONNECTED", nextStep: "SCHEDULE_MEETING" },
    { canRequest: false, notAccepted: null, request },
  );
}

/** Nothing published: no card, no gate, no website, no description. */
export function tidewaterUnpublished(): InvestorProfileReads {
  const found = INVESTORS.find(
    (item) => item.investorOrganisationId === TIDEWATER_ID,
  );
  if (found === undefined) throw new Error("fixtures: no investor");
  return {
    investor: found,
    status: null,
    card: null,
    gate: null,
    reasons: [],
    record: undefined,
    prefill: null,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const KIVU_COMPANY = id("e2000000", 2);
const OKAPI_COMPANY = id("e2000000", 3);

export const PALETTE_NAMES: PaletteResult = {
  kind: "NAMES",
  query: "har",
  people: [
    {
      name: "Harbourline Ventures (fictional)",
      detail: "In your Discover",
      href: `/investors/${HARBOURLINE_ID}`,
      kind: "investor",
      photoUrl: null,
    },
    {
      name: "Harrowgate Freight (fictional)",
      detail: "Your relationship",
      href: `/relationships/company/${KIVU_COMPANY}`,
      kind: "company",
      companyId: KIVU_COMPANY,
    },
  ],
  videos: [],
};

export const PALETTE_VIDEOS: PaletteResult = {
  kind: "NAMES",
  query: "freight",
  people: [
    {
      name: "Harrowgate Freight (fictional)",
      detail: "Your relationship",
      href: `/relationships/company/${KIVU_COMPANY}`,
      kind: "company",
      companyId: KIVU_COMPANY,
    },
  ],
  videos: [
    {
      companyId: KIVU_COMPANY,
      mediaAssetId: id("e6000000", 1),
      company: "Harrowgate Freight (fictional)",
      title: "Cross-border freight in one invoice",
      durationSeconds: 58,
    },
    {
      companyId: OKAPI_COMPANY,
      mediaAssetId: id("e6000000", 2),
      company: "Okapi Cold Chain (fictional)",
      title: "Cold rooms by the hour",
      durationSeconds: 104,
    },
    {
      companyId: OKAPI_COMPANY,
      mediaAssetId: id("e6000000", 3),
      company: "Okapi Cold Chain (fictional)",
      title: null,
      durationSeconds: null,
    },
  ],
};

export const PALETTE_CARD: PaletteResult = {
  kind: "CARD",
  card: {
    handle: "okapi-cold",
    name: "Okapi Cold Chain (fictional)",
    subjectType: "COMPANY",
    descriptor: "Seed · Rwanda",
    tagline: "Cold storage small farmers can rent by the hour.",
    place: "Kigali, Rwanda",
    website: { url: "https://okapi-cold.example", label: "okapi-cold.example" },
    verified: [],
    connectHref: null,
  },
};

/** What each palette state is asked, and what it answers. */
export const PALETTE_STATES = {
  "palette-empty": { query: "", answer: { kind: "EMPTY" } },
  "palette-names": { query: "har", answer: PALETTE_NAMES },
  "palette-videos": { query: "freight", answer: PALETTE_VIDEOS },
  "palette-no-match": {
    query: "zebedee",
    answer: { kind: "NAMES", query: "zebedee", people: [], videos: [] },
  },
  "palette-card": { query: "@okapi-cold", answer: PALETTE_CARD },
  "palette-no-card": {
    query: "@nobody-here",
    answer: { kind: "NO_CARD", handle: "nobody-here" },
  },
  "palette-error": { query: "harbour", answer: { kind: "ERROR" } },
} as const satisfies Record<
  string,
  { readonly query: string; readonly answer: PaletteResult }
>;
export type PaletteState = keyof typeof PALETTE_STATES;

/** "Recently opened" as this browser would have kept it. */
export const RECENT: readonly RecentItem[] = [
  {
    kind: "person",
    name: "Harbourline Ventures (fictional)",
    href: `/investors/${HARBOURLINE_ID}`,
    entity: "investor",
    where: "In Discover",
    line: "Investor",
  },
  {
    kind: "person",
    name: "Okapi Cold Chain (fictional)",
    href: "/@okapi-cold",
    entity: "company",
    where: "Found by handle",
    line: "Seed · Rwanda",
  },
  {
    kind: "video",
    companyId: KIVU_COMPANY,
    mediaAssetId: id("e6000000", 1),
    company: "Harrowgate Freight (fictional)",
    title: "Cross-border freight in one invoice",
    durationSeconds: 58,
  },
  {
    kind: "video",
    companyId: OKAPI_COMPANY,
    mediaAssetId: id("e6000000", 2),
    company: "Okapi Cold Chain (fictional)",
    title: "Cold rooms by the hour",
    durationSeconds: 104,
  },
];

// ---------------------------------------------------------------------------
// Saved / Passed / Compare (investor side, the match review's companies)
// ---------------------------------------------------------------------------

export const SAVED_ROWS: readonly ShortlistRow[] = MATCH_COMPANIES.map((c) => ({
  companyId: c.fit.companyId,
  name: c.fit.name,
  description: `${c.fit.name.replace(/ \(fictional\)$/u, "")} in one line, as its founder wrote it.`,
  facts: c.fit.line,
  band: c.fit.profile.band,
}));

export const PASSED_ROWS: readonly ShortlistRow[] = SAVED_ROWS.slice(3);

export { TOP3 };

/** The picked companies side by side, as the fit model would order them. */
export function comparisonOf(ids: readonly string[]): FitComparisonDto {
  const picked = MATCH_COMPANIES.filter((c) => ids.includes(c.fit.companyId));
  return {
    ...TOP3,
    entries: picked.map((c, at) => ({
      position: at + 1,
      companyId: c.fit.companyId,
      name: c.fit.name,
      line: c.fit.line,
      sources: ["SAVED"],
      profile: c.fit.profile,
      bestOn: [],
    })),
    considered: picked.length,
    leftOut: { outsideMandate: 0, notEnoughInformation: 0 },
  };
}

// ---------------------------------------------------------------------------
// Investor interest (founder side)
// ---------------------------------------------------------------------------

function interest(
  n: number,
  investorOrganisationId: string,
  investorName: string,
  investorType: string,
  expressedAt: string,
  response: IncomingInterestDto["response"],
): IncomingInterestDto {
  return {
    interestId: id("e7000000", n),
    investorOrganisationId,
    investorName,
    investorPhotoUrl: null,
    investorType,
    expressedAt,
    response,
    respondedAt: response === "PENDING" ? null : "2026-10-20T09:00:00.000Z",
    connection:
      response === "ACCEPTED"
        ? {
            connectionId: id("e5000000", n),
            status: "ACTIVE",
            connectedAt: "2026-10-20T09:00:00.000Z",
          }
        : null,
  };
}

/** Relative to the page's clock, so "Today" and "2 days ago" stay true. */
export function interestItems(now: number): readonly IncomingInterestDto[] {
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
  return [
    interest(
      1,
      HARBOURLINE_ID,
      "Harbourline Ventures (fictional)",
      "VC",
      ago(0),
      "PENDING",
    ),
    interest(
      2,
      KESTREL_ID,
      "Kestrel Angels (fictional)",
      "SYNDICATE",
      ago(2),
      "PENDING",
    ),
    interest(
      3,
      NORTHBOUND_ID,
      "Northbound Family Office (fictional)",
      "FAMILY_OFFICE",
      ago(9),
      "PENDING",
    ),
    interest(
      4,
      ASHGROVE_ID,
      "Ashgrove Corporate Ventures (fictional)",
      "CVC",
      ago(20),
      "ACCEPTED",
    ),
    interest(
      5,
      LARCHMERE_ID,
      "Larchmere Capital (fictional)",
      "VC",
      ago(30),
      "DECLINED",
    ),
  ];
}

export const INTEREST_FACTS: ReadonlyMap<string, InterestFacts> = new Map([
  [
    HARBOURLINE_ID,
    {
      deployment: "Actively investing",
      looksFor:
        "Pre-seed and Seed, Logistics and Supply chain software, in Kenya, Nigeria and Ghana.",
      matches: { STAGE: "ok", SECTOR: "ok", GEOGRAPHY: "ok" },
    },
  ],
  [
    KESTREL_ID,
    {
      deployment: "Investing selectively",
      looksFor: "Pre-seed, Fintech and Logistics.",
      matches: { STAGE: "no", SECTOR: "part", GEOGRAPHY: "ok" },
    },
  ],
  [
    ASHGROVE_ID,
    {
      deployment: "Actively investing",
      looksFor: "Mobility.",
      matches: { STAGE: "unk", SECTOR: "no", GEOGRAPHY: "unk" },
    },
  ],
  [
    LARCHMERE_ID,
    {
      deployment: "Paused",
      looksFor: null,
      matches: { STAGE: "unk", SECTOR: "unk", GEOGRAPHY: "unk" },
    },
  ],
]);

// ---------------------------------------------------------------------------
// Visibility (founder side)
// ---------------------------------------------------------------------------

const STAMP = "2026-10-18T12:00:00.000Z";

function company(
  visibility: CompanyDto["marketplaceVisibility"],
  readiness: string,
): CompanyDto {
  return {
    id: BRIGHTFOLD.id,
    canonicalName: BRIGHTFOLD.name,
    legalName: null,
    slug: "brightfold-logistics-fictional",
    websiteUrl: "https://brightfold.example",
    foundedDate: "2024-03-01",
    headquartersCountry: "KE",
    headquartersCity: "Mombasa",
    currentStageCode: "SEED",
    primaryDescription: null,
    shortDescription: "Shared warehousing for small importers in Mombasa.",
    companyStatus: "active",
    marketplaceVisibility: visibility,
    marketplaceReadinessState: readiness,
    pitch: null,
    version: 7,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function preview(networkVisible: boolean): CompanyNetworkPreview {
  return {
    companyId: BRIGHTFOLD.id,
    canonicalName: BRIGHTFOLD.name,
    legalName: null,
    websiteUrl: "https://brightfold.example",
    foundedDate: "2024-03-01",
    headquartersCountry: "KE",
    headquartersCity: "Mombasa",
    currentStageCode: "SEED",
    shortDescription: "Shared warehousing for small importers in Mombasa.",
    primaryDescription: null,
    companyStatus: "active",
    networkVisible,
    pitch: null,
    facts: [],
  };
}

type Outcome =
  MarketplaceReadinessAssessment["requirements"][number]["outcome"];

function readiness(
  outcomes: readonly [Outcome, Outcome, Outcome, Outcome, Outcome, Outcome],
  verificationAvailable: boolean,
  sectorDeclared = true,
): MarketplaceReadinessAssessment {
  const [active, profile, discovery, founder, organisation, documents] =
    outcomes;
  const ready = outcomes.every(
    (outcome) => outcome === "SATISFIED" || outcome === "NOT_APPLICABLE",
  );
  return {
    companyId: BRIGHTFOLD.id,
    policyVersion: "marketplace-readiness.v1",
    state: ready ? "marketplace_ready" : "requirements_outstanding",
    verificationAvailable,
    requirements: [
      {
        requirement: "COMPANY_ACTIVE",
        outcome: active,
        description: "The company is active on Capital Q.",
      },
      {
        requirement: "MINIMUM_COMPANY_PROFILE",
        outcome: profile,
        description:
          "The profile has a description, a stage and where you are based.",
      },
      {
        requirement: "DISCOVERY_VISIBILITY_CONFIRMED",
        outcome: discovery,
        description: "You chose to be visible to investors.",
      },
      {
        requirement: "FOUNDER_IDENTITY_VERIFIED",
        outcome: founder,
        description: "A founder's identity is verified.",
      },
      {
        requirement: "ORGANISATION_VERIFIED",
        outcome: organisation,
        description: "The company is verified.",
      },
      {
        requirement: "REQUIRED_DOCUMENTATION",
        outcome: documents,
        description: "Required documents are on file.",
      },
    ],
    assessedAt: STAMP,
    discoverability: {
      sectorDeclared,
      stageDeclared: true,
      countryDeclared: true,
    },
  };
}

export const VISIBILITY = {
  /** Private: not visible, not recommended, verification not available. */
  private: {
    company: company("organisation_private", "requirements_outstanding"),
    preview: preview(false),
    readiness: readiness(
      [
        "SATISFIED",
        "SATISFIED",
        "OUTSTANDING",
        "OUTSTANDING",
        "OUTSTANDING",
        "NOT_APPLICABLE",
      ],
      false,
      false,
    ),
  },
  /** Discoverable, not yet recommended; verification can be done today. */
  discoverable: {
    company: company("network_visible", "requirements_outstanding"),
    preview: preview(true),
    readiness: readiness(
      [
        "SATISFIED",
        "SATISFIED",
        "SATISFIED",
        "OUTSTANDING",
        "OUTSTANDING",
        "NOT_APPLICABLE",
      ],
      true,
    ),
  },
  /** Discoverable and can be included in recommendations. */
  recommended: {
    company: company("network_visible", "marketplace_ready"),
    preview: preview(true),
    readiness: readiness(
      [
        "SATISFIED",
        "SATISFIED",
        "SATISFIED",
        "SATISFIED",
        "SATISFIED",
        "NOT_APPLICABLE",
      ],
      true,
    ),
  },
  /** Discoverable; the readiness read failed. */
  "readiness-unread": {
    company: company("network_visible", "requirements_outstanding"),
    preview: preview(true),
    readiness: null,
  },
} as const;
export type VisibilityState = keyof typeof VISIBILITY;
