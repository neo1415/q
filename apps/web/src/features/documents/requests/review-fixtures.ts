import type {
  AssumptionBoardDto,
  DataRoomInvestorView,
  DataRoomOwnerView,
  DocumentAccessDto,
  FolderAccessDto,
  RequestInboxDto,
} from "@capital-q/contracts";

/**
 * Fictional founder-documents data (2026-10-08) for the /dev harness, the
 * browser checks and the render tests. Every company, person and figure is
 * fictional; nothing here is read from or written to a service.
 */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (day: number, hour = 9) =>
  new Date(Date.UTC(2026, 9, day, hour)).toISOString();

export const REVIEW_COMPANY = uuid(1);
export const ZINO = uuid(201);
export const KILN = uuid(202);
export const HARBOUR = uuid(203);
export const MANAGEMENT_ACCOUNTS = uuid(301);
export const CAP_TABLE = uuid(302);
export const UNIT_ECONOMICS = uuid(303);
export const DECK = uuid(304);
export const REQUEST_ACCOUNTS = uuid(401);
export const REQUEST_CAP_TABLE = uuid(402);
export const REQUEST_CONTRACTS = uuid(403);
export const QUESTIONS_SENT = uuid(501);

export function reviewInbox(): RequestInboxDto {
  return {
    companyId: REVIEW_COMPANY,
    folders: [
      { code: "fundraising", label: "Fundraising summary" },
      { code: "cap_table", label: "Cap table and equity" },
      { code: "financials", label: "Financials" },
      { code: "commercial", label: "Customers and contracts" },
      { code: "other", label: "Other documents" },
    ],
    counts: { open: 3, answered: 1, declined: 1 },
    items: [
      {
        kind: "DOCUMENT_REQUEST",
        itemId: REQUEST_ACCOUNTS,
        source: "DILIGENCE",
        requestId: REQUEST_ACCOUNTS,
        relationshipId: ZINO,
        investorOrganisationName: "Zino Capital (fictional)",
        requesterName: "Ada Nwosu",
        title: "Management accounts, last 12 months",
        note: "We'd like to see monthly burn against the plan before our IC on the 14th.",
        requestedAt: at(5),
        status: "OPEN",
        declineNote: null,
        sharedDocument: null,
        accessEndsAt: null,
        dataRoom: null,
      },
      {
        kind: "QUESTIONS",
        itemId: QUESTIONS_SENT,
        relationshipId: ZINO,
        investorOrganisationName: "Zino Capital (fictional)",
        requesterName: "Ada Nwosu",
        askedAt: at(6),
        questions: [
          {
            questionId: uuid(511),
            position: 1,
            question:
              "How many of the 140 SME customers paid in each of the last three months?",
            assumptionId: "TRACTION:1",
            assumptionLabel: "Paying customers",
            askedAt: at(6),
            answer: null,
          },
          {
            questionId: uuid(512),
            position: 2,
            question: "What does the 4% take rate depend on?",
            assumptionId: "BUSINESS_MODEL:1",
            assumptionLabel: "Take rate",
            askedAt: at(6),
            answer: {
              answerId: uuid(521),
              text: "Volume tiers: 4% under ₦50m a month, 3.2% above. Most customers sit in the first tier.",
              answeredAt: at(7),
              truthClass: "USER_CLAIM",
              evidenceStatus: "DOCUMENT_SUPPORTED",
              documents: [
                { documentId: UNIT_ECONOMICS, title: "Unit economics" },
              ],
            },
          },
        ],
      },
      {
        kind: "DOCUMENT_REQUEST",
        itemId: REQUEST_CAP_TABLE,
        source: "DATA_ROOM",
        requestId: REQUEST_CAP_TABLE,
        relationshipId: KILN,
        investorOrganisationName: "Kiln Ventures (fictional)",
        requesterName: "Tomi Bello",
        title: "Cap table summary",
        note: null,
        requestedAt: at(7),
        status: "OPEN",
        declineNote: null,
        sharedDocument: null,
        accessEndsAt: null,
        dataRoom: { documentId: CAP_TABLE, folderCode: "cap_table" },
      },
      {
        kind: "DOCUMENT_REQUEST",
        itemId: uuid(404),
        source: "DATA_ROOM",
        requestId: uuid(404),
        relationshipId: ZINO,
        investorOrganisationName: "Zino Capital (fictional)",
        requesterName: "Ada Nwosu",
        title: "Unit economics",
        note: null,
        requestedAt: at(2),
        status: "SHARED",
        declineNote: null,
        sharedDocument: { documentId: UNIT_ECONOMICS, title: "Unit economics" },
        accessEndsAt: at(31),
        dataRoom: { documentId: UNIT_ECONOMICS, folderCode: "financials" },
      },
      {
        kind: "DOCUMENT_REQUEST",
        itemId: REQUEST_CONTRACTS,
        source: "DILIGENCE",
        requestId: REQUEST_CONTRACTS,
        relationshipId: KILN,
        investorOrganisationName: "Kiln Ventures (fictional)",
        requesterName: "Tomi Bello",
        title: "Top customer contracts",
        note: null,
        requestedAt: at(3),
        status: "DECLINED",
        declineNote: "We'll share these after a term sheet.",
        sharedDocument: null,
        accessEndsAt: null,
        dataRoom: null,
      },
    ],
  };
}

export function reviewOwnerRoom(): DataRoomOwnerView {
  const doc = (
    documentId: string,
    title: string,
    folderCode: string,
    level: DataRoomOwnerView["documents"][number]["level"],
    sharedWith: number,
  ): DataRoomOwnerView["documents"][number] => ({
    documentId,
    title,
    folderCode,
    checklistItemCode: null,
    level,
    visibilityScope:
      level === "PUBLIC"
        ? "network_visible"
        : level === "PRIVATE"
          ? "organisation_private"
          : "specifically_shared",
    kind: "PDF",
    pageCount: 6,
    updatedAt: at(1),
    validUntil: null,
    sharedWith,
    openedBy: sharedWith,
    version: 2,
  });
  return {
    viewer: "OWNER",
    companyId: REVIEW_COMPANY,
    stageCode: "seed",
    countryCode: "NG",
    folders: [
      { code: "fundraising", label: "Fundraising summary" },
      { code: "cap_table", label: "Cap table and equity" },
      { code: "financials", label: "Financials" },
    ],
    documents: [
      doc(
        DECK,
        "Ledgerline pitch deck (fictional)",
        "fundraising",
        "PUBLIC",
        0,
      ),
      doc(CAP_TABLE, "Cap table summary", "cap_table", "ON_REQUEST", 0),
      doc(UNIT_ECONOMICS, "Unit economics", "financials", "SHARED_ONLY", 1),
      doc(
        MANAGEMENT_ACCOUNTS,
        "Management accounts Oct 2025 to Sep 2026",
        "financials",
        "SHARED_ONLY",
        0,
      ),
    ],
    checklist: [],
    requests: [],
  };
}

export function reviewDocumentAccess(): DocumentAccessDto {
  return {
    documentId: UNIT_ECONOMICS,
    title: "Unit economics",
    folderCode: "financials",
    level: "SHARED_ONLY",
    visibilityScope: "specifically_shared",
    version: 2,
    grants: [
      {
        policyId: uuid(601),
        relationshipId: ZINO,
        investorOrganisationName: "Zino Capital (fictional)",
        accessLevel: "view",
        grantedAt: at(7),
        expiresAt: at(36),
      },
      {
        policyId: uuid(602),
        relationshipId: KILN,
        investorOrganisationName: "Kiln Ventures (fictional)",
        accessLevel: "view_download",
        grantedAt: at(4),
        expiresAt: at(21),
      },
    ],
    history: [
      {
        at: at(7),
        what: "SHARED",
        investorOrganisationName: "Zino Capital (fictional)",
        accessLevel: "view",
      },
      {
        at: at(6),
        what: "REVOKED",
        investorOrganisationName: "Harbour Lane Partners (fictional)",
        accessLevel: "view",
      },
      {
        at: at(4),
        what: "SHARED",
        investorOrganisationName: "Kiln Ventures (fictional)",
        accessLevel: "view_download",
      },
    ],
    candidates: [
      {
        relationshipId: HARBOUR,
        investorOrganisationName: "Harbour Lane Partners (fictional)",
      },
      {
        relationshipId: KILN,
        investorOrganisationName: "Kiln Ventures (fictional)",
      },
      {
        relationshipId: ZINO,
        investorOrganisationName: "Zino Capital (fictional)",
      },
    ],
  };
}

export function reviewFolderAccess(): FolderAccessDto {
  return {
    folderCode: "financials",
    label: "Financials",
    documents: [
      {
        documentId: UNIT_ECONOMICS,
        title: "Unit economics",
        level: "SHARED_ONLY",
      },
      {
        documentId: MANAGEMENT_ACCOUNTS,
        title: "Management accounts Oct 2025 to Sep 2026",
        level: "SHARED_ONLY",
      },
    ],
    investors: [
      {
        relationshipId: ZINO,
        investorOrganisationName: "Zino Capital (fictional)",
        documents: 1,
      },
    ],
    candidates: reviewDocumentAccess().candidates,
  };
}

/** The investor's side: the board with one answered and one waiting question. */
export function reviewInvestorBoard(): AssumptionBoardDto {
  return {
    companyId: REVIEW_COMPANY,
    basis: "CONFIRMED_DECK_READING",
    readAt: at(1),
    counts: { evidenced: 1, claimed: 1, unknown: 1 },
    assumptions: [
      {
        id: "BUSINESS_MODEL:1",
        sectionLabel: "Business model",
        label: "Take rate",
        value: "4% of payment volume",
        standing: "EVIDENCED",
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
        unknownReason: null,
        source: "Pitch deck, slide 9",
        restsOn: ["Pricing holds as volume grows"],
        question: "What does the 4% take rate depend on?",
        asked: {
          questionId: uuid(512),
          askedAt: at(6),
          answer: {
            text: "Volume tiers: 4% under ₦50m a month, 3.2% above. Most customers sit in the first tier.",
            answeredAt: at(7),
            evidenceStatus: "DOCUMENT_SUPPORTED",
            documents: [
              { documentId: UNIT_ECONOMICS, title: "Unit economics" },
            ],
          },
        },
      },
      {
        id: "TRACTION:1",
        sectionLabel: "Traction",
        label: "Paying customers",
        value: "140 SMEs",
        standing: "CLAIMED",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        unknownReason: null,
        source: "Pitch deck, slide 7",
        restsOn: ["Customers pay every month"],
        question:
          "How many of the 140 SME customers paid in each of the last three months?",
        asked: { questionId: uuid(511), askedAt: at(6), answer: null },
      },
      {
        id: "TRACTION:unknown",
        sectionLabel: "Traction",
        label: "Net revenue retention",
        value: null,
        standing: "UNKNOWN",
        truthClass: null,
        evidenceStatus: null,
        unknownReason: "NOT_IN_DECK",
        source: null,
        restsOn: [],
        question: "What is your net revenue retention over the last 12 months?",
      },
    ],
  };
}

/** The investor's data room: one shared on request, one declined, one listed. */
export function reviewInvestorRoom(): DataRoomInvestorView {
  const base = {
    kind: "PDF",
    pageCount: 6,
    updatedAt: at(1),
    validUntil: null,
    openedAt: null,
  } as const;
  return {
    viewer: "INVESTOR",
    companyId: REVIEW_COMPANY,
    folders: [
      { code: "cap_table", label: "Cap table and equity" },
      { code: "financials", label: "Financials" },
    ],
    documents: [
      {
        ...base,
        documentId: UNIT_ECONOMICS,
        title: "Unit economics",
        folderCode: "financials",
        shownAs: "SHARED",
        access: "OPEN",
        accessEndsAt: at(36),
      },
      {
        ...base,
        documentId: MANAGEMENT_ACCOUNTS,
        title: "Management accounts Oct 2025 to Sep 2026",
        folderCode: "financials",
        shownAs: "ON_REQUEST",
        access: "REQUESTABLE",
        accessEndsAt: null,
        declined: { note: "We'll share these after a term sheet." },
      },
      {
        ...base,
        documentId: CAP_TABLE,
        title: "Cap table summary",
        folderCode: "cap_table",
        shownAs: "ON_REQUEST",
        access: "REQUESTED",
        accessEndsAt: null,
      },
    ],
  };
}
