import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { LocalDateSchema, UtcTimestampSchema } from "../common/time.js";

/**
 * A company's data room (overnight plan A3, 2026-10-06; research
 * docs/research/2026-10-06/data-room.md).
 *
 * The founder chooses, per document, one of four levels. Each is stored as
 * the level AND its ADR-001 visibility scope; the scope is derived, never
 * chosen separately:
 *
 *   PUBLIC       network_visible       investors who can find the company
 *                                      open it (never public_external: no
 *                                      document is ever at an external URL)
 *   ON_REQUEST   specifically_shared   its title is listed to investors who
 *                                      can find the company; the file opens
 *                                      only after the founder approves a
 *                                      request, with an expiry
 *   SHARED_ONLY  specifically_shared   neither title nor file is shown to
 *                                      anyone the founder did not share it
 *                                      with
 *   PRIVATE      organisation_private  the company's own organisation only
 *
 * A grant to one investor is the existing disclosure policy
 * (relationship_shared, the relationship as recipient, `view`, an expiry),
 * the same rule diligence shares use; it is a relationship event plus an
 * audit row. The level is a column of its own and never widens anything
 * derived from the document (ADR 0041 §3): Q Knowledge ≠ Data Room
 * disclosure.
 */

export const DATA_ROOM_LEVELS = [
  "PUBLIC",
  "ON_REQUEST",
  "SHARED_ONLY",
  "PRIVATE",
] as const;
export const DataRoomLevelSchema = z.enum(DATA_ROOM_LEVELS);
export type DataRoomLevel = z.infer<typeof DataRoomLevelSchema>;

/** The ADR-001 scope each level is stored as (the database derives it too). */
export const DATA_ROOM_LEVEL_SCOPE = {
  PUBLIC: "network_visible",
  ON_REQUEST: "specifically_shared",
  SHARED_ONLY: "specifically_shared",
  PRIVATE: "organisation_private",
} as const satisfies Record<DataRoomLevel, string>;

/** Levels whose TITLE an investor who can find the company may see. */
export const DATA_ROOM_LISTED_LEVELS: readonly DataRoomLevel[] = [
  "PUBLIC",
  "ON_REQUEST",
];

/** Folder and checklist codes are reference data (evidence.data_room_*). */
export const DataRoomCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,63}$/);

/** Approval lengths the founder picks from; the default is 30 days. */
export const DATA_ROOM_GRANT_DAYS = [7, 14, 30, 90] as const;
export const DATA_ROOM_GRANT_DEFAULT_DAYS = 30;

export const COMPANY_DATA_ROOM_SEGMENT = "/data-room" as const;
/** `GET` — a short-lived signed, inline (view-only) read of one document. */
export const COMPANY_DATA_ROOM_OPEN_SEGMENT =
  "/data-room/documents/:documentId/open" as const;
/** `POST` — the investor asks for one on-request document, or all of them. */
export const COMPANY_DATA_ROOM_REQUESTS_PATH =
  "/v1/companies/:companyId/data-room/requests" as const;
/** `POST` — the founder sets one document's level. */
export const DATA_ROOM_DOCUMENT_LEVEL_PATH =
  "/v1/data-room/documents/:documentId/level" as const;
/** `POST` — the founder approves (with an expiry) or declines a request. */
export const DATA_ROOM_REQUEST_DECISION_PATH =
  "/v1/data-room/requests/:requestId/decision" as const;

// --- the investor's side -----------------------------------------------------

/**
 * One document an investor may know exists. `access`:
 *   OPEN         they may open it now (public, or shared with them)
 *   REQUESTABLE  on request; they have not asked (or were declined)
 *   REQUESTED    on request; their request waits for the founder
 */
export const DataRoomInvestorDocumentSchema = z
  .object({
    documentId: UuidSchema,
    title: z.string().min(1).max(200),
    folderCode: DataRoomCodeSchema,
    /** SHARED: shared with this investor (on request approved, or shared only). */
    shownAs: z.enum(["PUBLIC", "ON_REQUEST", "SHARED"]),
    access: z.enum(["OPEN", "REQUESTABLE", "REQUESTED"]),
    /** "PDF", "Sheet"...; null: unknown. */
    kind: z.string().max(20).nullable(),
    pageCount: z.number().int().min(1).max(10_000).nullable(),
    updatedAt: UtcTimestampSchema,
    validUntil: LocalDateSchema.nullable(),
    /** When someone at their organisation first opened it; null: not yet. */
    openedAt: UtcTimestampSchema.nullable(),
    /** When their access ends (a grant's expiry); null: no expiry. */
    accessEndsAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type DataRoomInvestorDocument = z.infer<
  typeof DataRoomInvestorDocumentSchema
>;

export const DataRoomFolderSchema = z
  .object({ code: DataRoomCodeSchema, label: z.string().min(1).max(80) })
  .strict();
export type DataRoomFolder = z.infer<typeof DataRoomFolderSchema>;

export const DataRoomInvestorViewSchema = z
  .object({
    viewer: z.literal("INVESTOR"),
    companyId: UuidSchema,
    folders: z.array(DataRoomFolderSchema).max(40),
    documents: z.array(DataRoomInvestorDocumentSchema).max(500),
  })
  .strict();
export type DataRoomInvestorView = z.infer<typeof DataRoomInvestorViewSchema>;

// --- the founder's side ------------------------------------------------------

export const DataRoomOwnerDocumentSchema = z
  .object({
    documentId: UuidSchema,
    title: z.string().min(1).max(200),
    folderCode: DataRoomCodeSchema,
    checklistItemCode: DataRoomCodeSchema.nullable(),
    level: DataRoomLevelSchema,
    /** The ADR-001 scope the level is stored as. */
    visibilityScope: z.enum([
      "network_visible",
      "specifically_shared",
      "organisation_private",
    ]),
    kind: z.string().max(20).nullable(),
    pageCount: z.number().int().min(1).max(10_000).nullable(),
    updatedAt: UtcTimestampSchema,
    validUntil: LocalDateSchema.nullable(),
    /** Investor organisations it is shared with now (unexpired grants). */
    sharedWith: z.number().int().min(0),
    /** Investor organisations that opened it at least once. */
    openedBy: z.number().int().min(0),
    /** The settings version the screen saw, for a safe change. */
    version: z.number().int().min(1),
  })
  .strict();
export type DataRoomOwnerDocument = z.infer<typeof DataRoomOwnerDocumentSchema>;

export const DataRoomChecklistItemSchema = z
  .object({
    code: DataRoomCodeSchema,
    folderCode: DataRoomCodeSchema,
    label: z.string().min(1).max(160),
    /** The level this kind of document usually gets (research §3). */
    defaultLevel: DataRoomLevelSchema,
    /** A document is filed against it. */
    present: z.boolean(),
  })
  .strict();
export type DataRoomChecklistItem = z.infer<typeof DataRoomChecklistItemSchema>;

export const DataRoomRequestSchema = z
  .object({
    requestId: UuidSchema,
    /** Null: everything on request. */
    documentId: UuidSchema.nullable(),
    documentTitle: z.string().max(200).nullable(),
    requesterName: z.string().max(200).nullable(),
    requesterOrganisationName: z.string().max(200).nullable(),
    note: z.string().max(1000).nullable(),
    requestedAt: UtcTimestampSchema,
    status: z.enum(["OPEN", "APPROVED", "DECLINED"]),
    accessEndsAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type DataRoomRequest = z.infer<typeof DataRoomRequestSchema>;

export const DataRoomOwnerViewSchema = z
  .object({
    viewer: z.literal("OWNER"),
    companyId: UuidSchema,
    /** The stage the checklist is for (the company's declared stage). */
    stageCode: z.string().max(40),
    countryCode: z.string().max(2).nullable(),
    folders: z.array(DataRoomFolderSchema).max(40),
    documents: z.array(DataRoomOwnerDocumentSchema).max(500),
    checklist: z.array(DataRoomChecklistItemSchema).max(100),
    requests: z.array(DataRoomRequestSchema).max(200),
  })
  .strict();
export type DataRoomOwnerView = z.infer<typeof DataRoomOwnerViewSchema>;

export const DataRoomViewSchema = z.discriminatedUnion("viewer", [
  DataRoomInvestorViewSchema,
  DataRoomOwnerViewSchema,
]);
export type DataRoomView = z.infer<typeof DataRoomViewSchema>;

// --- commands ----------------------------------------------------------------

export const SetDataRoomLevelRequestSchema = z
  .object({
    level: DataRoomLevelSchema,
    folderCode: DataRoomCodeSchema.optional(),
    checklistItemCode: DataRoomCodeSchema.nullable().optional(),
    /** The settings version the screen saw; absent on a first filing. */
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type SetDataRoomLevelRequest = z.infer<
  typeof SetDataRoomLevelRequestSchema
>;

export const RequestDataRoomAccessRequestSchema = z
  .object({
    /** Null: every on-request document ("Request all on request"). */
    documentId: UuidSchema.nullable(),
    note: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();
export type RequestDataRoomAccessRequest = z.infer<
  typeof RequestDataRoomAccessRequestSchema
>;

export const DecideDataRoomRequestSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("APPROVE"),
      /** How long the investor keeps access. */
      days: z
        .number()
        .int()
        .refine((days) => (DATA_ROOM_GRANT_DAYS as readonly number[]).includes(days), {
          message: "Choose 7, 14, 30 or 90 days.",
        }),
    })
    .strict(),
  z.object({ decision: z.literal("DECLINE") }).strict(),
]);
export type DecideDataRoomRequest = z.infer<typeof DecideDataRoomRequestSchema>;

export const DataRoomLevelResultSchema = z
  .object({
    documentId: UuidSchema,
    level: DataRoomLevelSchema,
    visibilityScope: z.string(),
    version: z.number().int().min(1),
  })
  .strict();
export type DataRoomLevelResult = z.infer<typeof DataRoomLevelResultSchema>;

export const DataRoomRequestResultSchema = z
  .object({ requestId: UuidSchema, status: z.enum(["OPEN", "APPROVED", "DECLINED"]) })
  .strict();
export type DataRoomRequestResult = z.infer<typeof DataRoomRequestResultSchema>;

export const DataRoomOpenDtoSchema = z
  .object({
    url: z.string().url(),
    expiresAt: UtcTimestampSchema,
    /** False: shown with the viewer's name over every page, no download. */
    downloadable: z.boolean(),
    /** The words of the watermark, when it is view-only. */
    watermark: z.string().max(200).nullable(),
  })
  .strict();
export type DataRoomOpenDto = z.infer<typeof DataRoomOpenDtoSchema>;
