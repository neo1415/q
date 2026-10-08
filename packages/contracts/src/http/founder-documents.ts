import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ASSUMPTION_QUESTION_MAX_LENGTH } from "./assumptions.js";
import {
  DATA_ROOM_GRANT_DAYS,
  DataRoomCodeSchema,
  DataRoomFolderSchema,
  DataRoomLevelSchema,
  type DataRoomLevel,
} from "./data-room.js";

/**
 * Founder documents (2026-10-08; design docs/design/2026-10-08/founder-docs).
 *
 * The founder's side of everything investors ask for, in one inbox (the
 * Documents page's Requested tab): a named diligence request, a request
 * for data-room documents, and questions sent from "Assumptions to test".
 * Answering never invents a looser rule: every share is the existing
 * disclosure policy (relationship_shared, the relationship as recipient,
 * `view` or `view_download`, an expiry), audited and revocable; an answer
 * is the founder's claim (USER_CLAIM), recorded through the Knowledge
 * Write Gate, never verified by being said.
 */

// --- the Documents page ------------------------------------------------------

export const DOCUMENTS_TABS = ["mine", "requested", "data-room"] as const;
export const DocumentsTabSchema = z.enum(DOCUMENTS_TABS);
export type DocumentsTab = z.infer<typeof DocumentsTabSchema>;

/** Where a notification about one request opens (`item` is the request or question set). */
export function documentsRequestLink(itemId: string): string {
  return `/documents?tab=requested&item=${encodeURIComponent(itemId)}`;
}

// --- access levels, in words -------------------------------------------------

/**
 * V1 disclosure access levels. `view` is shown inline with the reader's
 * name over every page and no download; it is a platform access policy,
 * not DRM, and the words never claim it prevents a screenshot.
 */
export const DOCUMENT_ACCESS_LEVELS = ["view", "view_download"] as const;
export const DocumentAccessLevelSchema = z.enum(DOCUMENT_ACCESS_LEVELS);
export type DocumentAccessLevel = z.infer<typeof DocumentAccessLevelSchema>;

export const DOCUMENT_ACCESS_LEVEL_WORDS: Readonly<
  Record<DocumentAccessLevel, string>
> = {
  view: "View only, watermarked",
  view_download: "View and download",
};

export const GrantDaysSchema = z
  .number()
  .int()
  .refine((days) => (DATA_ROOM_GRANT_DAYS as readonly number[]).includes(days), {
    message: "Choose 7, 14, 30 or 90 days.",
  });

/**
 * The eight ADR-001 scopes in plain words, as a company document's access
 * editor shows them. Four are offered (each is one data-room level, whose
 * scope the database derives); four are shown as not available, with the
 * reason, so nothing is hidden and nothing is merged.
 */
export const DOCUMENT_SCOPE_CHOICES = [
  {
    scope: "organisation_private",
    level: "PRIVATE",
    words: "Only my team",
    detail: "People in your company.",
  },
  {
    scope: "specifically_shared",
    level: "SHARED_ONLY",
    words: "Only investors I choose",
    detail: "Nobody else sees even the title.",
  },
  {
    scope: "specifically_shared",
    level: "ON_REQUEST",
    words: "Listed; opens when I approve",
    detail: "Investors who can find you see the title and can ask.",
  },
  {
    scope: "network_visible",
    level: "PUBLIC",
    words: "Investors on Capital Q who can find us",
    detail: "They can open it. Never a public web link.",
  },
] as const satisfies readonly {
  scope: string;
  level: DataRoomLevel;
  words: string;
  detail: string;
}[];

export const DOCUMENT_SCOPES_NOT_OFFERED = [
  {
    scope: "personal_private",
    words: "Only me",
    reason: "Company documents belong to the company.",
  },
  {
    scope: "founder_private",
    words: "Founders only",
    reason: "Not separate from your team for documents yet.",
  },
  {
    scope: "investor_private",
    words: "An investor's private notes",
    reason: "That is the investor's own space, not yours.",
  },
  {
    scope: "relationship_shared",
    words: "Everyone in one relationship",
    reason: "Used for each investor you share with, below.",
  },
  {
    scope: "public_external",
    words: "Anyone on the web",
    reason: "Documents never get a public link.",
  },
] as const;

// --- the inbox ---------------------------------------------------------------

/** `GET /v1/companies/:companyId/requests` — the company's own team only. */
export const COMPANY_REQUESTS_SEGMENT = "/requests" as const;

export const RequestSourceSchema = z.enum(["DATA_ROOM", "DILIGENCE"]);
export type RequestSource = z.infer<typeof RequestSourceSchema>;

const Party = {
  relationshipId: UuidSchema,
  investorOrganisationName: z.string().max(200).nullable(),
  requesterName: z.string().max(200).nullable(),
};

export const DocumentRequestItemSchema = z
  .object({
    kind: z.literal("DOCUMENT_REQUEST"),
    /** Stable inbox id, also the notification's `item`: the request id. */
    itemId: UuidSchema,
    source: RequestSourceSchema,
    requestId: UuidSchema,
    ...Party,
    /** What they asked for, in their words or the document's title. */
    title: z.string().min(1).max(300),
    note: z.string().max(1000).nullable(),
    requestedAt: UtcTimestampSchema,
    status: z.enum(["OPEN", "SHARED", "DECLINED"]),
    declineNote: z.string().max(1000).nullable(),
    /** The document that answered it (uploaded or picked). */
    sharedDocument: z
      .object({ documentId: UuidSchema, title: z.string().max(300) })
      .strict()
      .nullable(),
    accessEndsAt: UtcTimestampSchema.nullable(),
    /**
     * The intersection with the data room: the requested (or sharing)
     * document is filed there, in this folder. Null: not in the data room.
     */
    dataRoom: z
      .object({ documentId: UuidSchema, folderCode: DataRoomCodeSchema })
      .strict()
      .nullable(),
  })
  .strict();
export type DocumentRequestItem = z.infer<typeof DocumentRequestItemSchema>;

export const QuestionAnswerSchema = z
  .object({
    answerId: UuidSchema,
    text: z.string().min(1).max(2000),
    answeredAt: UtcTimestampSchema,
    /** Always the founder's claim. */
    truthClass: z.literal("USER_CLAIM"),
    evidenceStatus: z.enum(["SELF_REPORTED", "DOCUMENT_SUPPORTED"]),
    documents: z
      .array(
        z
          .object({ documentId: UuidSchema, title: z.string().max(300) })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

export const InvestorQuestionSchema = z
  .object({
    questionId: UuidSchema,
    position: z.number().int().min(1).max(5),
    question: z.string().min(3).max(ASSUMPTION_QUESTION_MAX_LENGTH),
    assumptionId: z.string().max(40).nullable(),
    assumptionLabel: z.string().max(120).nullable(),
    askedAt: UtcTimestampSchema,
    /** The latest answer; null: not answered yet. */
    answer: QuestionAnswerSchema.nullable(),
  })
  .strict();
export type InvestorQuestion = z.infer<typeof InvestorQuestionSchema>;

export const QuestionSetItemSchema = z
  .object({
    kind: z.literal("QUESTIONS"),
    /** The first question's id: the notification's `item`. */
    itemId: UuidSchema,
    ...Party,
    askedAt: UtcTimestampSchema,
    questions: z.array(InvestorQuestionSchema).min(1).max(5),
  })
  .strict();
export type QuestionSetItem = z.infer<typeof QuestionSetItemSchema>;

export const RequestInboxItemSchema = z.discriminatedUnion("kind", [
  DocumentRequestItemSchema,
  QuestionSetItemSchema,
]);
export type RequestInboxItem = z.infer<typeof RequestInboxItemSchema>;

export const RequestInboxDtoSchema = z
  .object({
    companyId: UuidSchema,
    items: z.array(RequestInboxItemSchema).max(400),
    counts: z
      .object({
        open: z.number().int().min(0),
        answered: z.number().int().min(0),
        declined: z.number().int().min(0),
      })
      .strict(),
    /** Where an upload can be filed. */
    folders: z.array(DataRoomFolderSchema).max(40),
  })
  .strict();
export type RequestInboxDto = z.infer<typeof RequestInboxDtoSchema>;

/** An item is open while something in it waits for the founder. */
export function inboxItemOpen(item: RequestInboxItem): boolean {
  return item.kind === "DOCUMENT_REQUEST"
    ? item.status === "OPEN"
    : item.questions.some((question) => question.answer === null);
}

// --- answering a document request ------------------------------------------

/** `POST` — share a document (just uploaded, or one they have) for the request. */
export const DOCUMENT_REQUEST_FULFIL_PATH =
  "/v1/document-requests/:requestId/fulfil" as const;
/** `POST` — decline, with an optional note the investor sees. */
export const DOCUMENT_REQUEST_DECLINE_PATH =
  "/v1/document-requests/:requestId/decline" as const;

export const FulfilDocumentRequestSchema = z
  .object({
    source: RequestSourceSchema,
    documentId: UuidSchema,
    /** File it in this data-room folder (shared only); absent: leave as filed. */
    folderCode: DataRoomCodeSchema.optional(),
    accessLevel: DocumentAccessLevelSchema,
    days: GrantDaysSchema,
  })
  .strict();
export type FulfilDocumentRequest = z.infer<typeof FulfilDocumentRequestSchema>;

export const DeclineDocumentRequestSchema = z
  .object({
    source: RequestSourceSchema,
    note: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();
export type DeclineDocumentRequest = z.infer<
  typeof DeclineDocumentRequestSchema
>;

export const DocumentRequestResultSchema = z
  .object({
    requestId: UuidSchema,
    status: z.enum(["SHARED", "DECLINED"]),
  })
  .strict();
export type DocumentRequestResult = z.infer<typeof DocumentRequestResultSchema>;

// --- the access editor ---------------------------------------------------------

/** `GET` — who can see one document, and its history. */
export const DOCUMENT_ACCESS_PATH =
  "/v1/data-room/documents/:documentId/access" as const;
/** `POST` — share one document with one investor relationship. */
export const DOCUMENT_GRANTS_PATH =
  "/v1/data-room/documents/:documentId/grants" as const;
/** `GET` — who can see a folder's documents. */
export const FOLDER_ACCESS_PATH =
  "/v1/companies/:companyId/data-room/folders/:folderCode/access" as const;
/** `POST` — share every document in a folder with one relationship. */
export const FOLDER_GRANTS_PATH =
  "/v1/companies/:companyId/data-room/folders/:folderCode/grants" as const;
/** `POST` — set every document in a folder to one level. */
export const FOLDER_LEVEL_PATH =
  "/v1/companies/:companyId/data-room/folders/:folderCode/level" as const;
/** `POST` — take one share back. */
export const DOCUMENT_GRANT_REVOKE_PATH =
  "/v1/data-room/grants/:policyId/revoke" as const;

export const AccessGrantSchema = z
  .object({
    policyId: UuidSchema,
    relationshipId: UuidSchema,
    investorOrganisationName: z.string().max(200).nullable(),
    accessLevel: DocumentAccessLevelSchema,
    grantedAt: UtcTimestampSchema,
    /** Null: no end date (an older share). */
    expiresAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type AccessGrant = z.infer<typeof AccessGrantSchema>;

export const AccessHistoryEntrySchema = z
  .object({
    at: UtcTimestampSchema,
    what: z.enum(["SHARED", "REVOKED", "EXPIRED"]),
    investorOrganisationName: z.string().max(200).nullable(),
    accessLevel: DocumentAccessLevelSchema,
  })
  .strict();
export type AccessHistoryEntry = z.infer<typeof AccessHistoryEntrySchema>;

export const AccessCandidateSchema = z
  .object({
    relationshipId: UuidSchema,
    investorOrganisationName: z.string().max(200),
  })
  .strict();
export type AccessCandidate = z.infer<typeof AccessCandidateSchema>;

export const DocumentAccessDtoSchema = z
  .object({
    documentId: UuidSchema,
    title: z.string().max(300),
    folderCode: DataRoomCodeSchema,
    level: DataRoomLevelSchema,
    visibilityScope: z.enum([
      "network_visible",
      "specifically_shared",
      "organisation_private",
    ]),
    /** The settings version, for a safe level change. */
    version: z.number().int().min(1),
    grants: z.array(AccessGrantSchema).max(200),
    history: z.array(AccessHistoryEntrySchema).max(200),
    /** Investors this company has a relationship with, to share with. */
    candidates: z.array(AccessCandidateSchema).max(200),
  })
  .strict();
export type DocumentAccessDto = z.infer<typeof DocumentAccessDtoSchema>;

export const FolderAccessDtoSchema = z
  .object({
    folderCode: DataRoomCodeSchema,
    label: z.string().max(80),
    documents: z
      .array(
        z
          .object({
            documentId: UuidSchema,
            title: z.string().max(300),
            level: DataRoomLevelSchema,
          })
          .strict(),
      )
      .max(200),
    /** Per investor: how many of the folder's documents they can open now. */
    investors: z
      .array(
        z
          .object({
            relationshipId: UuidSchema,
            investorOrganisationName: z.string().max(200).nullable(),
            documents: z.number().int().min(0),
          })
          .strict(),
      )
      .max(200),
    candidates: z.array(AccessCandidateSchema).max(200),
  })
  .strict();
export type FolderAccessDto = z.infer<typeof FolderAccessDtoSchema>;

export const GrantDocumentAccessSchema = z
  .object({
    relationshipId: UuidSchema,
    accessLevel: DocumentAccessLevelSchema,
    days: GrantDaysSchema,
  })
  .strict();
export type GrantDocumentAccess = z.infer<typeof GrantDocumentAccessSchema>;

export const SetFolderLevelSchema = z
  .object({ level: DataRoomLevelSchema })
  .strict();

export const AccessChangeResultSchema = z
  .object({ changed: z.number().int().min(0) })
  .strict();
export type AccessChangeResult = z.infer<typeof AccessChangeResultSchema>;

// --- answering a question ------------------------------------------------------

/** `POST` — the founder answers one question (Idempotency-Key header). */
export const QUESTION_ANSWER_PATH =
  "/v1/diligence-questions/:questionId/answer" as const;

export const QUESTION_ANSWER_MAX_LENGTH = 2000;

export const AnswerQuestionSchema = z
  .object({
    answer: z.string().trim().min(1).max(QUESTION_ANSWER_MAX_LENGTH),
    /** Company documents attached as evidence (each shared with the asker). */
    documentIds: z.array(UuidSchema).max(5).default([]),
  })
  .strict();
export type AnswerQuestion = z.infer<typeof AnswerQuestionSchema>;

export const AnswerQuestionResultSchema = z
  .object({
    answerId: UuidSchema,
    evidenceStatus: z.enum(["SELF_REPORTED", "DOCUMENT_SUPPORTED"]),
    /** False when the knowledge gate held it; the investor still gets the words. */
    recorded: z.boolean(),
  })
  .strict();
export type AnswerQuestionResult = z.infer<typeof AnswerQuestionResultSchema>;

/** `GET /v1/companies/:companyId/questions` — an investor's own questions to a company. */
export const COMPANY_QUESTIONS_SEGMENT = "/questions" as const;

export const InvestorQuestionsDtoSchema = z
  .object({
    companyId: UuidSchema,
    questions: z.array(InvestorQuestionSchema).max(100),
  })
  .strict();
export type InvestorQuestionsDto = z.infer<typeof InvestorQuestionsDtoSchema>;
