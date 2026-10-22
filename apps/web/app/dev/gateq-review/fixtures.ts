import {
  GATEQ_INBOX_VIEWS,
  type ApplicationContactDto,
  type ApplicationCoverageDto,
  type ApplicationSummaryDto,
  type DataRoomOwnerView,
  type DataRoomPreviewDto,
  type FounderApplicationDto,
  type GateqDossierV1,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GateqInboxItemDto,
  type GateqInboxView,
  type GatewayPolicyDto,
  type PublicGatewayDto,
} from "@capital-q/contracts";

import {
  EMPTY_ANSWERS,
  type FormAnswers,
  type InterviewLine,
} from "@/features/gateq/form/form-model";
import type { FoundStartup } from "@/features/gateq/page/gateq-actions";

/**
 * Fictional data for /dev/gateq-review, typed against the real contracts.
 * Every name, company, email and fund here is invented (Harbourline,
 * Kestrel and so on); nothing is read from a service. The shapes follow
 * the feature's own tests (gateq-inbox, gateq-dossier,
 * gateq-founder-applications, gateq-form, own-room).
 */

export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hoursAgo = (now: number, hours: number) =>
  new Date(now - hours * 3_600_000).toISOString();

export const FUND = "Harbourline Capital";
export const GATE_LINK = "https://capitalq.app/g/harbourline-seed";
export const PUBLIC_ID = "gq_review00000000000000000000";

// --- the investor's inbox ---------------------------------------------------

const MH = { userId: id(901), name: "Mira Halden", initials: "MH" };
const TR = { userId: id(902), name: "Tomas Reyner", initials: "TR" };
const IC = { userId: id(903), name: "Ines Calder", initials: "IC" };

const item = (n: number, over: Partial<GateqInboxItemDto>, now: number) =>
  ({
    applicationId: id(n),
    reference: `ga_review${String(n)}`,
    companyName: "",
    oneLiner: null,
    stage: "Seed",
    sector: "Fintech",
    country: "Portugal",
    raise: { amount: "2000000", currency: "EUR" },
    fit: "FITS",
    rules: { met: 4, total: 4, unknown: 0 },
    starred: false,
    unread: false,
    labels: [],
    assignee: null,
    folder: "INBOX",
    replyBy: null,
    replyState: "ON_TRACK",
    daysLeft: 8,
    submittedAt: hoursAgo(now, 30),
    ...over,
  }) satisfies GateqInboxItemDto;

function inboxItems(now: number): GateqInboxItemDto[] {
  return [
    item(
      1,
      {
        companyName: "Larkspur Energy",
        oneLiner: "Rooftop solar leases for small workshops",
        sector: "Energy",
        country: "Spain",
        starred: true,
        unread: true,
        labels: ["IC next week"],
        assignee: MH,
        replyState: "DUE_SOON",
        daysLeft: 0,
        submittedAt: hoursAgo(now, 2),
      },
      now,
    ),
    item(
      2,
      {
        companyName: "Kestrel Health",
        oneLiner: "Gets clinics paid for insurance claims in weeks",
        sector: "Health",
        unread: true,
        labels: ["Health"],
        assignee: TR,
        fit: "PARTIAL",
        rules: { met: 3, total: 4, unknown: 1 },
        daysLeft: 6,
        submittedAt: hoursAgo(now, 20),
      },
      now,
    ),
    item(
      3,
      {
        companyName: "Fernway Pay",
        oneLiner: "Card payments for corner shops",
        sector: "Payments",
        country: "Ireland",
        unread: true,
        replyState: "OVERDUE",
        daysLeft: -2,
        submittedAt: hoursAgo(now, 320),
      },
      now,
    ),
    item(
      4,
      {
        companyName: "Quillfield Ledger",
        oneLiner: "Crop loans repaid at harvest",
        stage: "Pre-seed",
        sector: "Agriculture finance",
        country: "Netherlands",
        labels: ["Asked for more"],
        assignee: MH,
        daysLeft: 4,
        submittedAt: hoursAgo(now, 100),
      },
      now,
    ),
    item(
      5,
      {
        companyName: "Brightmoor Savings",
        oneLiner: "Savings accounts that keep pace with prices",
        stage: "Pre-seed",
        daysLeft: 9,
        submittedAt: hoursAgo(now, 124),
      },
      now,
    ),
    item(
      6,
      {
        companyName: "Saltmarsh Payroll",
        oneLiner: "Payroll for teams spread across borders",
        stage: "Series A",
        sector: "HR software",
        country: "United Kingdom",
        fit: "NOT_A_FIT",
        rules: { met: 3, total: 4, unknown: 0 },
        daysLeft: 9,
        submittedAt: hoursAgo(now, 150),
      },
      now,
    ),
    item(
      7,
      {
        companyName: "Cobbleway Wholesale",
        oneLiner: "Wholesale stock delivered overnight",
        sector: "Commerce",
        starred: true,
        labels: ["Fintech"],
        assignee: IC,
        daysLeft: 10,
        submittedAt: hoursAgo(now, 170),
      },
      now,
    ),
  ];
}

/** Kestrel Health's submission carries the frozen dossier (slice 1). */
export const DOSSIER_ITEM = id(2);

const DOSSIER: GateqDossierV1 = {
  schemaVersion: "gateq-dossier.v1",
  generatedAt: "2026-10-19T10:00:00.000Z",
  application: {
    reference: "ga_review2",
    submittedAt: "2026-10-19T10:00:00Z",
  },
  company: {
    name: "Kestrel Health",
    description: "Gets clinics paid for insurance claims in weeks",
    website: "kestrelhealth.example",
    country: "Portugal",
    stage: "Seed",
    sectorPhrases: ["Health"],
    note: null,
  },
  contact: {
    name: "Noor Ellery",
    email: "noor@kestrelhealth.example",
    role: "Founder & CEO",
    companyName: "Kestrel Health",
    phone: null,
    preferredChannel: "EMAIL",
    emailConfirmed: true,
    confirmedVia: "EMAIL_CODE",
  },
  qualification: {
    outcome: "INSUFFICIENT_INFORMATION",
    access: "NEEDS_INFORMATION",
    criteria: [
      { label: "Pre-seed or seed", requiredness: "REQUIRED", status: "MATCH" },
      { label: "Southern Europe", requiredness: "REQUIRED", status: "MATCH" },
      { label: "€500k to €3M", requiredness: "REQUIRED", status: "UNKNOWN" },
      { label: "Has a lead", requiredness: "PREFERRED", status: "NO_MATCH" },
    ],
  },
  dimensions: [
    {
      group: "COMPANY",
      label: "Company",
      facts: [
        {
          dimension: "STAGE",
          label: "Stage",
          summary: "Seed",
          provenance: "APPLICANT_PROVIDED",
          sourceFactId: id(1001),
          sourceTurnSeq: null,
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
      ],
    },
    {
      group: "TRACTION",
      label: "Traction",
      facts: [
        {
          dimension: "REVENUE",
          label: "Revenue",
          summary: "€38k MRR",
          provenance: "DOCUMENT_SUPPORTED",
          sourceFactId: id(1002),
          sourceTurnSeq: null,
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          dimension: "CUSTOMERS",
          label: "Customers",
          summary: "About 40 clinics",
          provenance: "ESTIMATED",
          sourceFactId: id(1003),
          sourceTurnSeq: 4,
          truthClass: "ESTIMATE",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          dimension: "BURN",
          label: "Monthly burn",
          summary: "not known yet",
          provenance: "UNKNOWN",
          sourceFactId: id(1004),
          sourceTurnSeq: 6,
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
        },
      ],
    },
  ],
  unknowns: [{ dimension: "BURN", label: "Monthly burn", group: "TRACTION" }],
  declined: [
    { dimension: "VALUATION", label: "Valuation", group: "FUNDRAISING" },
  ],
  missing: [
    {
      dimension: "TEAM_SIZE",
      label: "Team size",
      group: "TEAM",
      reason: "REQUIRED_BY_GATEWAY",
    },
  ],
  contradictions: ["Revenue: €38k MRR in the deck, €29k MRR in the interview"],
  documents: [{ documentId: id(709), title: "Pitch deck v3" }],
  diligenceQuestions: [
    {
      dimension: "BURN",
      basis: "UNKNOWN",
      question: "What is the current monthly net burn?",
    },
    {
      dimension: "TEAM_SIZE",
      basis: "MISSING",
      question: "How many people work on Kestrel full time?",
    },
  ],
  transcript: { turnCount: 4 },
  synthesis: null,
};

const TRANSCRIPT = [
  {
    seq: 1,
    role: "Q" as const,
    text: "Who pays Kestrel today: the clinics, or the insurers?",
    at: "2026-10-19T09:00:00.000Z",
  },
  {
    seq: 2,
    role: "PERSON" as const,
    text: "The clinics: a monthly fee plus 1% of what we recover.",
    at: "2026-10-19T09:01:00.000Z",
  },
  {
    seq: 3,
    role: "Q" as const,
    text: "Your deck says about 40 clinics. How many paid last month?",
    at: "2026-10-19T09:02:00.000Z",
  },
  {
    seq: 4,
    role: "PERSON" as const,
    text: "36 paid; four are on a free pilot until November.",
    at: "2026-10-19T09:03:00.000Z",
  },
];

function detailOf(
  entry: GateqInboxItemDto,
  now: number,
  solo: boolean,
): GateqInboxDetailDto {
  const dossier = entry.applicationId === DOSSIER_ITEM;
  return {
    item: entry,
    rules: [
      {
        label: "Pre-seed or seed",
        dimension: "STAGE",
        required: true,
        standing: entry.fit === "NOT_A_FIT" ? "DOES_NOT_MEET" : "MEETS",
      },
      {
        label: "Fintech, health, agriculture finance",
        dimension: "TAXONOMY",
        required: true,
        standing: "MEETS",
      },
      {
        label: "Southern and western Europe",
        dimension: "GEOGRAPHY",
        required: true,
        standing: "MEETS",
      },
      {
        label: "€300k to €3M",
        dimension: "RAISE_SIZE",
        required: true,
        standing: entry.fit === "PARTIAL" ? "NOT_ANSWERED" : "MEETS",
      },
    ],
    answers: [
      { label: "Stage", value: entry.stage ?? "" },
      { label: "Sector", value: entry.sector ?? "" },
      { label: "Based in", value: entry.country ?? "" },
      { label: "Raising", value: "€2M" },
      { label: "Instrument", value: "SAFE" },
      { label: "Lead investor", value: "Looking for a lead" },
    ],
    note: `We're ${entry.companyName}. ${entry.oneLiner ?? ""}. Revenue is €38k a month and grew 3x this year. We're closing on 14 November and would value an investor who knows the market.`,
    contact: dossier
      ? { name: "Noor Ellery", email: "noor@kestrelhealth.example" }
      : { name: "Ari Vantelle", email: "ari@founder.example" },
    shared: [
      { documentId: id(701), title: "Pitch deck, 16 slides" },
      { documentId: id(702), title: "Key numbers, monthly" },
    ],
    notes: solo
      ? []
      : [
          {
            id: id(601),
            author: TR,
            body: "Sharp on unit economics in the interview. Mira, worth an IC slot?",
            createdAt: hoursAgo(now, 10),
          },
        ],
    activity: [
      { at: entry.submittedAt, text: "Applied through Seed gate" },
      { at: entry.submittedAt, text: "Q checked it against your rules" },
      ...(solo || entry.assignee === null
        ? []
        : [
            {
              at: hoursAgo(now, 1),
              text: `Assigned to ${entry.assignee.name} by Tomas Reyner`,
            },
          ]),
    ],
    messages: [],
    dossier: dossier ? DOSSIER : null,
    transcript: dossier ? TRANSCRIPT : null,
  };
}

export function inboxFixture(
  now: number,
  options: { readonly member: boolean; readonly empty: boolean },
): {
  readonly inbox: GateqInboxDto;
  readonly details: Readonly<Record<string, GateqInboxDetailDto>>;
} {
  const items = options.empty ? [] : inboxItems(now);
  const counts = Object.fromEntries(
    GATEQ_INBOX_VIEWS.map((view) => [view, 0]),
  ) as Record<GateqInboxView, number>;
  Object.assign(counts, {
    INBOX: items.filter((entry) => entry.unread).length,
    STARRED: items.filter((entry) => entry.starred).length,
  });
  return {
    inbox: {
      gateway: {
        id: id(800),
        name: "Seed gate",
        publicId: PUBLIC_ID,
        replyWithinDays: 10,
      },
      viewer: { userId: MH.userId, canDecide: !options.member, solo: false },
      view: "INBOX",
      counts,
      items,
      labels: ["IC next week", "Health", "Fintech", "Asked for more"],
      members: [MH, TR, IC],
    },
    details: Object.fromEntries(
      items.map((entry) => [entry.applicationId, detailOf(entry, now, false)]),
    ),
  };
}

// --- the investor's gate and Find -------------------------------------------

export const POLICY: GatewayPolicyDto = {
  gateway: {
    id: id(800),
    publicId: PUBLIC_ID,
    name: "Seed gate",
    status: "ACTIVE",
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  version: {
    id: id(801),
    versionNumber: 3,
    status: "PUBLISHED",
    inboundMode: "QUALIFIED",
    publicTitle: "Harbourline Capital seed gate",
    publicDescription: null,
    publishedAt: "2026-10-01T09:00:00.000Z",
  },
  criteria: [
    {
      id: id(811),
      position: 1,
      requiredness: "REQUIRED",
      label: "Pre-seed or seed",
      config: { type: "STAGE", allowedStageCodes: ["pre_seed", "seed"] },
    },
    {
      id: id(812),
      position: 2,
      requiredness: "REQUIRED",
      label: "Fintech, health, agriculture finance",
      config: {
        type: "TAXONOMY",
        vocabularyCode: "sector",
        allowedNodeIds: [id(821)],
      },
    },
    {
      id: id(813),
      position: 3,
      requiredness: "REQUIRED",
      label: "Southern and western Europe",
      config: { type: "GEOGRAPHY", allowedCountries: ["PT", "ES", "IE"] },
    },
    {
      id: id(814),
      position: 4,
      requiredness: "REQUIRED",
      label: "€300k to €3M",
      config: {
        type: "RAISE_SIZE",
        currency: "EUR",
        minAmount: "300000",
        maxAmount: "3000000",
      },
    },
  ],
};

export const FIND_TEXT =
  "Seed fintech in Portugal or Spain with at least €30k monthly revenue, raising under €2M";

export const FOUND: readonly FoundStartup[] = [
  {
    companyId: id(301),
    name: "Brightmoor Savings",
    oneLiner: "Savings accounts that keep pace with prices",
    stage: "pre_seed",
    country: "PT",
  },
  {
    companyId: id(302),
    name: "Fernway Pay",
    oneLiner: "Card payments for corner shops",
    stage: "seed",
    country: "ES",
  },
  {
    companyId: id(303),
    name: "Cobbleway Wholesale",
    oneLiner: "Wholesale stock delivered overnight, pay later",
    stage: "seed",
    country: "PT",
  },
];

// --- the founder's applications ---------------------------------------------

const RULES_STOOD: FounderApplicationDto["rules"] = [
  { label: "Pre-seed or seed", required: true, standing: "MEETS" },
  { label: "Health or fintech", required: true, standing: "MEETS" },
  { label: "Southern Europe", required: true, standing: "MEETS" },
  { label: "Has a lead investor", required: false, standing: "NOT_ANSWERED" },
];

export const APPLICATIONS: readonly FounderApplicationDto[] = [
  {
    applicationId: id(402),
    fund: "Wrenfield Angels",
    sentAt: "2026-10-08T09:00:00.000Z",
    status: "REPLIED",
    reasonCode: null,
    message:
      "Thanks Noor. Could you share your last six months of key numbers before we talk?",
    rules: RULES_STOOD,
    replyBy: "2026-10-22",
    investorOrganisationId: id(92),
  },
  {
    applicationId: id(401),
    fund: "Harbourline Capital",
    sentAt: "2026-10-16T09:00:00.000Z",
    status: "SENT",
    reasonCode: null,
    message: null,
    rules: RULES_STOOD,
    replyBy: "2026-10-30",
    investorOrganisationId: id(91),
  },
  {
    applicationId: id(404),
    fund: "Oakhaven Fund",
    sentAt: "2026-09-22T09:00:00.000Z",
    status: "PASSED",
    reasonCode: "CHEQUE_DOES_NOT_FIT",
    message:
      "Thank you for applying. Your round is larger than the cheques we write, so we can't take it on.",
    rules: [
      { label: "Seed or Series A", required: true, standing: "MEETS" },
      { label: "Health", required: true, standing: "MEETS" },
      { label: "€250k to €1M", required: true, standing: "DOES_NOT_MEET" },
    ],
    replyBy: null,
    investorOrganisationId: id(94),
  },
];

/** Which application each founder state opens in its sheet. */
export const FOUNDER_SHEETS: Readonly<Record<string, string>> = {
  replied: id(402),
  waiting: id(401),
  passed: id(404),
};

// --- the public gate form ----------------------------------------------------

export const GATEWAY: PublicGatewayDto = {
  publicId: PUBLIC_ID,
  organisationDisplayName: FUND,
  title: "Apply to Harbourline Capital",
  description:
    "We back early companies making money and care move better in southern Europe.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [
    { label: "Pre-seed or seed", requiredness: "REQUIRED", dimension: "STAGE" },
    {
      label: "Fintech, health, or agriculture finance",
      requiredness: "REQUIRED",
      dimension: "TAXONOMY",
    },
    {
      label: "Southern Europe",
      requiredness: "REQUIRED",
      dimension: "GEOGRAPHY",
    },
    {
      label: "€500k to €3M",
      requiredness: "REQUIRED",
      dimension: "RAISE_SIZE",
    },
  ],
  publishedAt: "2026-10-05T09:00:00.000Z",
  replyWithinDays: 10,
};

export const KESTREL: FormAnswers = {
  ...EMPTY_ANSWERS,
  companyName: "Kestrel Health",
  oneLiner: "Gets clinics paid for insurance claims in weeks, not months.",
  stage: "seed",
  sectors: ["Health"],
  country: "PT",
  band: "1m_3m",
  currency: "EUR",
  amount: "1,200,000",
  instrument: "SAFE",
  lead: "LOOKING",
  contactEmail: "noor@kestrelhealth.example",
  note: "Hello Harbourline team, we help clinics get paid by insurers in weeks instead of months. About 40 clinics use Kestrel today and revenue has grown 3x this year. We're raising €1.2M and would value an investor who knows health payments.",
};

/** Half the page answered: the company, but no round yet. */
export const KESTREL_PARTIAL: FormAnswers = {
  ...EMPTY_ANSWERS,
  companyName: "Kestrel Health",
  oneLiner: KESTREL.oneLiner,
  stage: "seed",
  sectors: ["Health"],
  contactEmail: KESTREL.contactEmail,
};

/** A required rule not met: based outside where the fund invests. */
export const KESTREL_ELSEWHERE: FormAnswers = { ...KESTREL, country: "US" };

export const summary = (
  over: Partial<ApplicationSummaryDto>,
): ApplicationSummaryDto => ({
  reference: "ga_review",
  status: "IN_PROGRESS",
  declaredName: "Kestrel Health",
  facts: [],
  documentCount: 0,
  submittedAt: null,
  access: "MAY_APPLY",
  unmet: [],
  stillNeeded: [],
  ...over,
});

export const CONTACT: ApplicationContactDto = {
  name: "Noor Ellery",
  email: "noor@kestrelhealth.example",
  role: "Founder & CEO",
  companyName: "Kestrel Health",
  phone: null,
  preferredChannel: "EMAIL",
  emailConfirmed: true,
  confirmedVia: "EMAIL_CODE",
};

export const INTERVIEW: readonly InterviewLine[] = [
  {
    from: "Q",
    text: "Who pays Kestrel today: the clinics, or the insurers?",
  },
  {
    from: "YOU",
    text: "The clinics: a monthly fee plus 1% of what we recover.",
  },
  {
    from: "Q",
    text: "Your deck says about 40 clinics. How many paid in the last full month?",
  },
];

export const COVERAGE: ApplicationCoverageDto = {
  coverage: {
    version: 1,
    access: "MAY_APPLY",
    unmet: [],
    stillNeeded: [],
    answered: [
      {
        dimension: "STAGE",
        label: "Stage",
        group: "COMPANY",
        summary: "Seed",
        provenance: "APPLICANT_PROVIDED",
      },
      {
        dimension: "CUSTOMERS",
        label: "Customers",
        group: "TRACTION",
        summary: "About 40 clinics",
        provenance: "DOCUMENT_SUPPORTED",
      },
    ],
    unknown: [{ dimension: "BURN", label: "Monthly burn", group: "TRACTION" }],
    declined: [
      { dimension: "VALUATION", label: "Valuation", group: "FUNDRAISING" },
    ],
    missing: [
      {
        dimension: "TEAM_SIZE",
        label: "Team size",
        group: "TEAM",
        reason: "UNDERSTANDING",
      },
    ],
    contradictions: [
      "Clinics: about 40 in the deck, 36 paying in the interview",
    ],
  },
  contact: { required: true, confirmed: true },
  documentCount: 1,
  transcriptTurns: 3,
};

// --- the founder's own data room ---------------------------------------------

export const ROOM_COMPANY = id(1);
const WRENFIELD = id(70);
const NORTHMERE = id(71);
const OAKHAVEN = id(72);

const doc = (
  n: number,
  over: Partial<DataRoomOwnerView["documents"][number]>,
): DataRoomOwnerView["documents"][number] => ({
  documentId: id(100 + n),
  title: `Document ${String(n)}`,
  folderCode: "fundraising",
  checklistItemCode: null,
  level: "PUBLIC",
  visibilityScope: "network_visible",
  kind: "PDF",
  pageCount: 14,
  updatedAt: "2026-10-12T09:00:00.000Z",
  validUntil: null,
  sharedWith: 0,
  openedBy: 0,
  version: 1,
  ...over,
});

export function ownerView(outline: boolean): DataRoomOwnerView {
  return {
    viewer: "OWNER",
    companyId: ROOM_COMPANY,
    stageCode: "seed",
    countryCode: "PT",
    folders: [
      { code: "fundraising", label: "Fundraising summary" },
      { code: "financials", label: "Financials" },
      { code: "corporate", label: "Company and incorporation" },
    ],
    documents: [
      doc(1, { title: "Kestrel seed deck (Oct 2026)", openedBy: 2 }),
      doc(2, { title: "One-page summary", pageCount: 1 }),
      doc(3, {
        title: "Key numbers, monthly",
        folderCode: "financials",
        level: "ON_REQUEST",
        kind: "Sheet",
        pageCount: null,
      }),
      doc(4, {
        title: "Management accounts, last 12 months",
        folderCode: "financials",
        level: "SHARED_ONLY",
        visibilityScope: "specifically_shared",
        sharedWith: 1,
      }),
      doc(5, {
        title: "Cap table",
        folderCode: "corporate",
        level: "PRIVATE",
        visibilityScope: "organisation_private",
        kind: "Sheet",
        pageCount: null,
      }),
    ],
    checklist: [],
    requests: [
      {
        requestId: id(200),
        relationshipId: OAKHAVEN,
        documentId: id(103),
        documentTitle: "Key numbers, monthly",
        requesterName: "Rhea Tamsin",
        requesterOrganisationName: "Oakhaven Fund",
        note: "Ahead of our partner meeting on Thursday.",
        requestedAt: "2026-10-20T09:00:00.000Z",
        status: "OPEN",
        accessEndsAt: null,
      },
    ],
    outlineBeforeConnection: outline,
  };
}

const INVESTORS: DataRoomPreviewDto["investors"] = [
  {
    relationshipId: WRENFIELD,
    investorOrganisationName: "Wrenfield Angels",
    connection: "CONNECTED",
  },
  {
    relationshipId: NORTHMERE,
    investorOrganisationName: "Northmere Ventures",
    connection: "CONNECTED",
  },
  {
    relationshipId: OAKHAVEN,
    investorOrganisationName: "Oakhaven Fund",
    connection: "CONNECTED",
  },
];

const investorDoc = (
  n: number,
  title: string,
  folderCode: string,
  shownAs: "PUBLIC" | "ON_REQUEST" | "SHARED",
  access: "OPEN" | "REQUESTABLE" | "REQUESTED",
) => ({
  documentId: id(100 + n),
  title,
  folderCode,
  shownAs,
  access,
  kind: "PDF",
  pageCount: 14,
  updatedAt: "2026-10-12T09:00:00.000Z",
  validUntil: null,
  openedAt: null,
  accessEndsAt: null,
});

/** The API's previews, by relationship id ("none": not yet connected). */
export function roomPreviews(
  outline: boolean,
): Readonly<Record<string, DataRoomPreviewDto>> {
  const connected = (
    relationshipId: string,
    name: string,
    shared: boolean,
    requested = false,
  ): DataRoomPreviewDto => ({
    companyId: ROOM_COMPANY,
    as: {
      relationshipId,
      investorOrganisationName: name,
      connection: "CONNECTED",
    },
    view: {
      viewer: "INVESTOR",
      companyId: ROOM_COMPANY,
      access: "CONNECTED",
      folders: [
        { code: "fundraising", label: "Fundraising summary" },
        { code: "financials", label: "Financials" },
      ],
      documents: [
        investorDoc(
          1,
          "Kestrel seed deck (Oct 2026)",
          "fundraising",
          "PUBLIC",
          "OPEN",
        ),
        investorDoc(2, "One-page summary", "fundraising", "PUBLIC", "OPEN"),
        investorDoc(
          3,
          "Key numbers, monthly",
          "financials",
          "ON_REQUEST",
          requested ? "REQUESTED" : "REQUESTABLE",
        ),
        ...(shared
          ? [
              investorDoc(
                4,
                "Management accounts, last 12 months",
                "financials",
                "SHARED",
                "OPEN",
              ),
            ]
          : []),
      ],
    },
    investors: INVESTORS,
  });
  return {
    none: {
      companyId: ROOM_COMPANY,
      as: {
        relationshipId: null,
        investorOrganisationName: null,
        connection: "NOT_CONNECTED",
      },
      view: {
        viewer: "INVESTOR",
        companyId: ROOM_COMPANY,
        access: "LOCKED",
        locked: {
          reason: "NOT_CONNECTED",
          outline: outline
            ? [
                {
                  code: "fundraising",
                  label: "Fundraising summary",
                  documents: 2,
                },
                { code: "financials", label: "Financials", documents: 2 },
              ]
            : null,
        },
        folders: [],
        documents: [],
      },
      investors: INVESTORS,
    },
    [WRENFIELD]: connected(WRENFIELD, "Wrenfield Angels", true),
    [NORTHMERE]: connected(NORTHMERE, "Northmere Ventures", false),
    [OAKHAVEN]: connected(OAKHAVEN, "Oakhaven Fund", false, true),
  };
}
