import {
  DECK_SECTIONS,
  type CompanyDeckView,
  type CompanyProfileDto,
  type DataRoomInvestorView,
  type DataRoomOwnerView,
  type DeckCoaching,
  type DeckSection,
  type DeckSectionCode,
  type FounderPersonDto,
} from "@capital-q/contracts";

/**
 * Fictional Kora Health, for the design-review page only (overnight A1-A7).
 * Every name, figure and document is invented; nothing here is read from or
 * written to any service.
 */

export const REVIEW_COMPANY_ID = "6f1d3c2a-4b5e-4f70-8a91-0b2c3d4e5f60";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const reviewPitchRaise = {
  kind: "RAISE" as const,
  statement: "We're raising $750,000 on a SAFE for our seed round.",
  pitchId: id(901),
  pitchTitle: "Elevator pitch",
  atSeconds: 41,
  money: { amount: "750000", currency: "USD" },
  stageCode: "seed",
  instrument: "SAFE",
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  source: "PITCH_VIDEO" as const,
};
const reviewPitchClaims = [
  reviewPitchRaise,
  {
    ...reviewPitchRaise,
    kind: "INSTRUMENT" as const,
  },
  ...[
    ["Forty-two clinics on paid plans", 22],
    ["Claims paid in 19 days on average, down from 94", 27],
  ].map(([statement, atSeconds]) => ({
    ...reviewPitchRaise,
    kind: "TRACTION" as const,
    statement: String(statement),
    atSeconds: Number(atSeconds),
    money: null,
    stageCode: null,
    instrument: null,
  })),
  {
    ...reviewPitchRaise,
    kind: "USE_OF_FUNDS" as const,
    statement: "The money goes to two engineers and our first three states.",
    atSeconds: 47,
    money: null,
    stageCode: null,
    instrument: null,
  },
];

export function reviewProfile(
  viewer: "INVESTOR" | "OWNER",
  empty = false,
): CompanyProfileDto {
  return {
    viewer,
    companyId: REVIEW_COMPANY_ID,
    canonicalName: "Kora Health",
    shortDescription:
      "Gets clinics paid for insurance claims in weeks, not months.",
    currentStageCode: "seed",
    headquartersCountry: "NG",
    headquartersCity: "Lagos",
    photoUrl: null,
    coverUrl: null,
    overview: {
      legalName: "Kora Health Technologies Ltd",
      websiteUrl: "https://kora.example",
      foundedDate: "2021-03-01",
      primaryDescription:
        "Kora files and chases insurance claims for small clinics in Nigeria, so they are paid in weeks rather than months.",
      sectorNodeIds: [],
      raise: null,
      organisationVerified: true,
      facts: [],
      deck: null,
      // What the fictional pitch says (2026-10-08 overview review).
      pitchClaims: empty ? [] : reviewPitchClaims,
      raiseFromPitch: empty ? null : reviewPitchRaise,
      pitchRaiseNotice:
        empty || viewer === "INVESTOR"
          ? null
          : { state: "SHOWN_FROM_PITCH", said: reviewPitchRaise },
      team: empty
        ? []
        : [
            {
              name: "Amara Okafor",
              relationshipType: "team_member",
              businessTitle: "CEO",
              isFounder: true,
              shortBio:
                "6 years building payments products. Studied computer science in Lagos.",
            },
            {
              name: "Tunde Bello",
              relationshipType: "team_member",
              businessTitle: "CTO",
              isFounder: true,
              shortBio:
                "8 years building hospital software. Led a 20-person engineering team.",
            },
            {
              name: "Ifeoma Nwosu",
              relationshipType: "team_member",
              businessTitle: "Head of clinic success",
              isFounder: false,
              shortBio: null,
            },
            {
              name: "Kwame Asante",
              relationshipType: "team_member",
              businessTitle: "Senior engineer",
              isFounder: false,
              shortBio: null,
            },
            {
              name: "Maya Adeyemi",
              relationshipType: "team_member",
              businessTitle: "Engineer",
              isFounder: false,
              shortBio: null,
            },
            {
              name: "Ben Okoro",
              relationshipType: "team_member",
              businessTitle: "Sales lead",
              isFounder: false,
              shortBio: null,
            },
            {
              name: "Leila Hassan",
              relationshipType: "advisor",
              businessTitle: "Finance",
              isFounder: false,
              shortBio: null,
            },
          ],
    },
    videos: empty
      ? []
      : [
          {
            mediaAssetId: id(901),
            aspectRatio: "9:16",
            durationSeconds: 58,
            captionState: "READY",
            title: "Elevator pitch",
          },
          {
            mediaAssetId: id(902),
            aspectRatio: "16:9",
            durationSeconds: 134,
            captionState: "READY",
            title: "Product demo: filing a claim",
          },
          {
            mediaAssetId: id(903),
            aspectRatio: "9:16",
            durationSeconds: 100,
            captionState: "READY",
            title: "Why we started Kora",
          },
          {
            mediaAssetId: id(904),
            aspectRatio: "9:16",
            durationSeconds: 45,
            captionState: "NOT_REQUESTED",
            title: "Traction update, September",
          },
        ],
  } as CompanyProfileDto;
}

const doc = (
  n: number,
  title: string,
  folderCode: string,
  shownAs: "PUBLIC" | "ON_REQUEST" | "SHARED",
  access: "OPEN" | "REQUESTABLE" | "REQUESTED",
  extra: {
    pages?: number;
    opened?: string;
    kind?: string;
    validUntil?: string;
    ends?: string;
  } = {},
) => ({
  documentId: id(100 + n),
  title,
  folderCode,
  shownAs,
  access,
  kind: extra.kind ?? "PDF",
  pageCount: extra.pages ?? null,
  updatedAt: "2026-09-12T10:00:00.000Z",
  validUntil: extra.validUntil ?? null,
  openedAt: extra.opened ?? null,
  accessEndsAt: extra.ends ?? null,
});

export const FOLDERS = [
  { code: "fundraising", label: "Fundraising summary" },
  { code: "corporate", label: "Company and incorporation" },
  { code: "kyc_kyb", label: "Identity and ownership (KYC/KYB)" },
  { code: "cap_table", label: "Cap table and equity" },
  { code: "financials", label: "Financials" },
  { code: "tax", label: "Tax and compliance" },
  { code: "legal_ip", label: "Legal and IP" },
  { code: "team", label: "Team" },
];

export function reviewInvestorRoom(empty = false): DataRoomInvestorView {
  return {
    viewer: "INVESTOR",
    companyId: REVIEW_COMPANY_ID,
    folders: empty ? [] : FOLDERS,
    documents: empty
      ? []
      : [
          doc(1, "One-page summary", "fundraising", "PUBLIC", "OPEN", {
            pages: 1,
            opened: "2026-10-02T09:00:00.000Z",
          }),
          doc(2, "Use of funds", "fundraising", "PUBLIC", "OPEN", { pages: 2 }),
          doc(3, "Key numbers, monthly", "fundraising", "SHARED", "OPEN", {
            kind: "Sheet",
            opened: "2026-10-03T09:00:00.000Z",
            ends: "2026-11-02T09:00:00.000Z",
          }),
          doc(
            4,
            "Certificate of incorporation (CAC)",
            "corporate",
            "PUBLIC",
            "OPEN",
            { pages: 2 },
          ),
          doc(
            5,
            "Memorandum and articles",
            "corporate",
            "ON_REQUEST",
            "REQUESTABLE",
            { pages: 31 },
          ),
          doc(
            6,
            "Company status report (CAC)",
            "corporate",
            "ON_REQUEST",
            "REQUESTABLE",
            { pages: 3, validUntil: "2027-03-01" },
          ),
          doc(
            7,
            "Shareholders and directors register",
            "kyc_kyb",
            "SHARED",
            "OPEN",
            { pages: 4 },
          ),
          doc(8, "Cap table summary", "cap_table", "ON_REQUEST", "REQUESTED", {
            pages: 1,
          }),
          doc(9, "Signed SAFEs", "cap_table", "ON_REQUEST", "REQUESTABLE"),
          doc(
            10,
            "Management accounts, Jan–Aug 2026",
            "financials",
            "ON_REQUEST",
            "REQUESTABLE",
            { kind: "Sheet" },
          ),
          doc(11, "Tax clearance certificate (TCC)", "tax", "PUBLIC", "OPEN", {
            pages: 1,
          }),
          doc(
            12,
            "Trademark registration",
            "legal_ip",
            "ON_REQUEST",
            "REQUESTABLE",
            { pages: 2 },
          ),
          doc(13, "Team bios and org chart", "team", "PUBLIC", "OPEN", {
            pages: 3,
          }),
        ],
  };
}

export function reviewOwnerRoom(empty = false): DataRoomOwnerView {
  const owned = (
    n: number,
    title: string,
    folderCode: string,
    level: "PUBLIC" | "ON_REQUEST" | "SHARED_ONLY" | "PRIVATE",
    item: string | null,
    stats: { openedBy?: number; sharedWith?: number; pages?: number } = {},
  ) => ({
    documentId: id(200 + n),
    title,
    folderCode,
    checklistItemCode: item,
    level,
    visibilityScope:
      level === "PUBLIC"
        ? ("network_visible" as const)
        : level === "PRIVATE"
          ? ("organisation_private" as const)
          : ("specifically_shared" as const),
    kind: "PDF",
    pageCount: stats.pages ?? null,
    updatedAt: "2026-09-12T10:00:00.000Z",
    validUntil: null,
    sharedWith: stats.sharedWith ?? 0,
    openedBy: stats.openedBy ?? 0,
    version: 1,
  });
  const documents = empty
    ? []
    : [
        owned(1, "One-page summary", "fundraising", "PUBLIC", "one_pager", {
          openedBy: 7,
          pages: 1,
        }),
        owned(2, "Use of funds", "fundraising", "PUBLIC", "use_of_funds", {
          openedBy: 7,
          pages: 2,
        }),
        owned(
          3,
          "Key numbers, monthly",
          "fundraising",
          "ON_REQUEST",
          "key_metrics",
          { sharedWith: 2, openedBy: 1 },
        ),
        owned(
          4,
          "Certificate of incorporation (CAC)",
          "corporate",
          "PUBLIC",
          "certificate_of_incorporation",
          { openedBy: 7, pages: 2 },
        ),
        owned(
          5,
          "Memorandum and articles",
          "corporate",
          "ON_REQUEST",
          "constitution",
          { pages: 31 },
        ),
        owned(
          6,
          "Shareholders and directors register",
          "kyc_kyb",
          "ON_REQUEST",
          "registry_extract",
          { sharedWith: 2, openedBy: 1, pages: 4 },
        ),
        owned(7, "Beneficial owners", "kyc_kyb", "SHARED_ONLY", null, {
          sharedWith: 1,
          pages: 3,
        }),
        owned(8, "Directors' passports and NIN", "kyc_kyb", "PRIVATE", null),
        owned(
          9,
          "Cap table summary",
          "cap_table",
          "ON_REQUEST",
          "cap_table_summary",
          { pages: 1 },
        ),
      ];
  const checklist = [
    ["pitch_deck", "fundraising", "Pitch deck", true],
    ["one_pager", "fundraising", "One-page summary", true],
    [
      "certificate_of_incorporation",
      "corporate",
      "Certificate of incorporation (CAC)",
      true,
    ],
    [
      "registry_extract",
      "kyc_kyb",
      "Shareholders and directors (CAC 1.1)",
      true,
    ],
    ["founder_agreement", "cap_table", "Founder agreement and vesting", !empty],
    [
      "ip_assignment_founders",
      "legal_ip",
      "IP assignment from the founders",
      !empty,
    ],
    ["cap_table_summary", "cap_table", "Cap table summary", true],
    ["safes_notes", "cap_table", "Signed SAFEs and notes", !empty],
    ["financial_model", "financials", "Financial model", !empty],
    ["key_metrics", "fundraising", "Key numbers dashboard", true],
    ["use_of_funds", "fundraising", "Use of funds", true],
    [
      "management_accounts",
      "financials",
      "Management accounts (last 6-12 months)",
      !empty,
    ],
    ["constitution", "corporate", "Memorandum and articles (MemArt)", true],
    ["good_standing", "corporate", "Company status report (CAC)", false],
    ["tax_clearance", "tax", "TIN and tax clearance certificate (TCC)", !empty],
    ["data_protection", "legal_ip", "NDPC registration", !empty],
    ["sector_licences", "legal_ip", "Sector licences (or not needed)", false],
    ["team_bios", "team", "Team bios and org chart", !empty],
  ] as const;
  return {
    viewer: "OWNER",
    companyId: REVIEW_COMPANY_ID,
    stageCode: "seed",
    countryCode: "NG",
    folders: FOLDERS,
    documents,
    checklist: checklist.map(([code, folderCode, label, present]) => ({
      code,
      folderCode,
      label,
      defaultLevel: "ON_REQUEST" as const,
      present: empty ? false : present,
    })),
    requests: empty
      ? []
      : [
          {
            requestId: id(301),
            relationshipId: id(401),
            documentId: id(209),
            documentTitle: "Cap table, September 2026",
            requesterName: "Daniel Reyes",
            requesterOrganisationName: "Northbound Capital",
            note: "Preparing for our committee on 20 October.",
            requestedAt: "2026-10-05T09:00:00.000Z",
            status: "OPEN",
            accessEndsAt: null,
          },
        ],
  };
}

const present = (
  section: DeckSectionCode,
  summary: string,
  facts: DeckSection["facts"],
  pages: number[],
): DeckSection => ({
  section,
  status: "PRESENT",
  summary,
  pages,
  facts,
  confidence: "MEDIUM",
});
const claim = (
  label: string,
  value: string,
  page: number,
  asOf: string | null = null,
) => ({
  label,
  value,
  unknownReason: null,
  kind: "FIGURE" as const,
  asOf,
  pages: [page],
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  confidence: "HIGH" as const,
});

const SECTIONS: DeckSection[] = DECK_SECTIONS.map((code) => {
  switch (code) {
    case "PROBLEM":
      return present(
        code,
        "Clinics in Nigeria lose 18–25% of insurance claims to rejections and slow paperwork, and wait about three months to be paid. Small clinics feel it most: they can't afford billing staff.",
        [
          claim("Claims rejected", "18–25%", 2),
          claim("Average wait to be paid", "94 days", 2),
        ],
        [2, 3],
      );
    case "SOLUTION":
      return present(
        code,
        "Kora files each claim the day of the visit and chases it until the clinic is paid, through an app the front desk already uses.",
        [],
        [4, 5],
      );
    case "VALUE_PROPOSITION":
      return present(
        code,
        "Clinics are paid in weeks rather than months, with fewer rejected claims.",
        [claim("Time to payment", "21 days", 5, "Aug 2026")],
        [5],
      );
    case "MARKET":
      return present(
        code,
        "One top-down figure for Nigerian health insurance claims, from a 2022 report.",
        [claim("Claims market", "$1.2bn", 6)],
        [6],
      );
    case "GO_TO_MARKET":
      return present(
        code,
        "HMOs introduce Kora to their clinics; a sales lead converts them.",
        [],
        [7],
      );
    case "BUSINESS_MODEL":
      return present(
        code,
        "3% of each claim paid, charged to the clinic.",
        [claim("Take rate", "3%", 8)],
        [8],
      );
    case "TRACTION":
      return present(
        code,
        "140 clinics live; monthly revenue grew from $9k to $41k over nine months.",
        [
          claim("Monthly revenue", "$41k", 9, "Sep 2026"),
          claim("Clinics live", "140", 9, "Sep 2026"),
        ],
        [9],
      );
    case "COMPETITION":
      return {
        section: code,
        status: "NOT_IN_DECK",
        summary: null,
        pages: [],
        facts: [],
        confidence: "LOW",
      };
    case "FINANCIALS":
      return present(
        code,
        "2025 revenue and monthly spend; no forward plan.",
        [claim("2025 revenue", "$210k", 11, "Dec 2025")],
        [11],
      );
    case "THE_ASK":
      return present(
        code,
        "Raising $1.5m on a SAFE: 45% engineering, 35% sales, 20% operations; 20 months of runway.",
        [claim("Raising", "$1.5m", 13), claim("Runway", "20 months", 13)],
        [13],
      );
    case "FOUNDERS":
      return present(
        code,
        "Amara Okafor (CEO, payments) and Tunde Bello (CTO, hospital software).",
        [],
        [14],
      );
    case "TEAM":
      return present(
        code,
        "9 people; hiring a head of sales and a data lead with this round.",
        [
          { ...claim("Head of sales", "Hiring", 14), kind: "TEXT" as const },
          { ...claim("Data lead", "Hiring", 14), kind: "TEXT" as const },
        ],
        [14],
      );
  }
});

const COACHING: DeckCoaching = {
  rubricVersion: 1,
  sections: DECK_SECTIONS.map((code) => {
    const score =
      code === "COMPETITION"
        ? 0
        : code === "MARKET" || code === "GO_TO_MARKET" || code === "FINANCIALS"
          ? 2
          : code === "VALUE_PROPOSITION" ||
              code === "BUSINESS_MODEL" ||
              code === "TEAM"
            ? 3
            : 4;
    const required = [
      "PROBLEM",
      "SOLUTION",
      "MARKET",
      "BUSINESS_MODEL",
      "TRACTION",
      "FOUNDERS",
      "THE_ASK",
    ].includes(code);
    const words: Partial<Record<DeckSectionCode, string>> = {
      COMPETITION:
        "There's no competition slide. Every company has competition, even paper and spreadsheets. Name 3 to 5 and say why clinics pick you.",
      MARKET:
        "One big top-down number from a 2022 report. Build it bottom-up instead: clinics you can reach × what each pays you.",
      GO_TO_MARKET:
        "You say HMOs introduce clinics, but not what it costs to win a clinic or how long it takes. Add both, even as ranges.",
      FINANCIALS:
        "You show 2025 and monthly spend, but no plan for the next 18 months. Add a simple monthly plan with headcount.",
    };
    return {
      section: code,
      score,
      level:
        (
          [
            "MISSING",
            "MENTIONED",
            "BASIC",
            "CLEAR",
            "STRONG",
            "EXCEPTIONAL",
          ] as const
        )[score] ?? "MISSING",
      requiredForMinimum: required,
      atStandard: score >= 3,
      gaps: words[code] === undefined ? [] : [words[code] ?? ""],
      improve: null,
    };
  }),
  checks: [
    {
      code: "CONTRADICTIONS",
      passed: true,
      words: "No conflicting numbers between your deck and data room",
    },
    {
      code: "UNDATED_FIGURES",
      passed: false,
      words: "2 numbers have no date: slides 6 and 8",
    },
    {
      code: "ASK_COMPLETE",
      passed: true,
      words: "The ask says how much and what the money is for",
    },
  ],
  sectionsAtStandard: 8,
  atMinimumStandard: false,
};

export function reviewDeck(
  viewer: "INVESTOR" | "OWNER",
  state: "full" | "empty" | "downloadable" = "full",
): CompanyDeckView {
  if (state === "empty")
    return {
      viewer,
      companyId: REVIEW_COMPANY_ID,
      deck: null,
      extraction: null,
      coaching: null,
    };
  return {
    viewer,
    companyId: REVIEW_COMPANY_ID,
    deck: {
      documentId: id(501),
      title: "Kora Health seed deck",
      versionNumber: 3,
      pageCount: 14,
      uploadedAt: "2026-09-28T10:00:00.000Z",
      downloadable: state === "downloadable",
      scanned: true,
    },
    extraction: {
      extractionId: id(601),
      readAt: "2026-09-28T11:00:00.000Z",
      versionNumber: 3,
      confirmed: viewer === "INVESTOR",
      sections: SECTIONS,
    },
    coaching: viewer === "OWNER" ? COACHING : null,
  };
}

export function reviewFounder(full = true): FounderPersonDto {
  return {
    companyId: REVIEW_COMPANY_ID,
    companyName: "Kora Health",
    position: 1,
    name: "Amara Okafor",
    roleLine: "Co-founder and CEO, Kora Health",
    location: full ? "Lagos, Nigeria" : null,
    identityVerified: false,
    age: full ? 34 : null,
    buildingSince: full ? 2015 : null,
    companiesFounded: full ? 2 : null,
    exits: full ? "1, in 2019" : null,
    inTheirWords: full
      ? "My mother ran a clinic in Enugu and spent every Friday chasing insurers. I've spent my career on payments, and Kora is the tool she needed."
      : null,
    lookingFor: full
      ? "Investors who know health insurance in West Africa and can open doors to HMOs."
      : null,
    background: full
      ? [
          {
            from: "2021",
            to: null,
            current: true,
            title: "Co-founder and CEO, Kora Health",
            detail: "Lagos",
            evidence: "FOUNDERS_CLAIM",
          },
          {
            from: "2015",
            to: "2021",
            current: false,
            title: "Product lead, a pan-African payments company",
            detail: "Grew merchant payments from 2 to 9 countries",
            evidence: "FOUNDERS_CLAIM",
          },
          {
            from: "2017",
            to: "2019",
            current: false,
            title: "Co-founder, ShopRun (sold 2019)",
            detail: "Grocery delivery, acquired by a retail group",
            evidence: "MATCHES_SHARED_DOCUMENT",
          },
          {
            from: "2010",
            to: "2014",
            current: false,
            title: "BSc Computer Science, University of Lagos",
            detail: null,
            evidence: "FOUNDERS_CLAIM",
          },
        ]
      : [],
  };
}
