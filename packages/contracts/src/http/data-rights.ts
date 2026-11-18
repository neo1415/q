import { z } from "zod";

/**
 * Data rights (owner decision 107; GDPR, UK GDPR, Nigeria NDPA): the
 * person downloads their data and deletes their account. Every route acts
 * on the signed-in person only; no id in a request names whose data.
 *
 * - GET  /v1/me/data-rights                   status: latest download,
 *                                             any scheduled deletion,
 *                                             organisations affected, and
 *                                             what is kept and why.
 * - POST /v1/me/data-exports                  ask for a download (Idempotency-Key
 *                                             header; three a day). 202.
 * - POST /v1/me/data-exports/:exportId/link   a five-minute signed link to
 *                                             a ready download.
 * - POST /v1/me/account-deletion              schedule deletion: a fresh
 *                                             re-authentication's access
 *                                             token, the typed words and the
 *                                             organisations that close.
 * - POST /v1/me/account-deletion/cancel       cancel during the grace period.
 *
 * Q may ask for a download (the same service); it never schedules a
 * deletion, which needs the person's own re-authentication on this page.
 */
export const DATA_RIGHTS_PATH = "/v1/me/data-rights" as const;
export const DATA_EXPORTS_PATH = "/v1/me/data-exports" as const;
export const DATA_EXPORT_LINK_PATH =
  "/v1/me/data-exports/:exportId/link" as const;
export const ACCOUNT_DELETION_PATH = "/v1/me/account-deletion" as const;
export const ACCOUNT_DELETION_CANCEL_PATH =
  "/v1/me/account-deletion/cancel" as const;

/** The settings page for "Your data". */
export const DATA_RIGHTS_PAGE_PATH = "/settings/data" as const;

const Iso = z.string().datetime({ offset: true });

export const DataExportStatusSchema = z.enum([
  "REQUESTED",
  "BUILDING",
  "READY",
  "FAILED",
  "EXPIRED",
]);
export type DataExportStatus = z.infer<typeof DataExportStatusSchema>;

export const DataExportDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: DataExportStatusSchema,
    requestedAt: Iso,
    completedAt: Iso.nullable(),
    expiresAt: Iso.nullable(),
    byteSize: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type DataExportDto = z.infer<typeof DataExportDtoSchema>;

export const AccountDeletionStatusSchema = z.enum([
  "SCHEDULED",
  "CANCELLED",
  "PROCESSING",
  "BLOCKED",
  "COMPLETED",
]);

export const AccountDeletionDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: AccountDeletionStatusSchema,
    requestedAt: Iso,
    scheduledFor: Iso,
    blockedReason: z.string().max(64).nullable(),
  })
  .strict();
export type AccountDeletionDto = z.infer<typeof AccountDeletionDtoSchema>;

export const DeletionOrganisationDtoSchema = z
  .object({
    organisationId: z.string().uuid(),
    name: z.string().max(200),
    isOwner: z.boolean(),
    otherActiveMembers: z.number().int().nonnegative(),
    outcome: z.enum(["CLOSES_WITH_ACCOUNT", "TRANSFER_REQUIRED", "LEAVES"]),
  })
  .strict();
export type DeletionOrganisationDto = z.infer<
  typeof DeletionOrganisationDtoSchema
>;

export const KeptRecordDtoSchema = z
  .object({
    what: z.string().max(200),
    why: z.string().max(400),
    howLong: z.string().max(200),
  })
  .strict();

export const DataRightsDtoSchema = z
  .object({
    latestExport: DataExportDtoSchema.nullable(),
    exportsLeftToday: z.number().int().nonnegative(),
    deletion: AccountDeletionDtoSchema.nullable(),
    organisations: z.array(DeletionOrganisationDtoSchema).max(200),
    kept: z.array(KeptRecordDtoSchema).max(20),
    policy: z
      .object({
        graceDays: z.number().int().positive(),
        exportDays: z.number().int().positive(),
        confirmationWords: z.string().min(1).max(40),
      })
      .strict(),
  })
  .strict();
export type DataRightsDto = z.infer<typeof DataRightsDtoSchema>;

export const DataExportRequestedDtoSchema = z
  .object({ export: DataExportDtoSchema, alreadyRequested: z.boolean() })
  .strict();
export type DataExportRequestedDto = z.infer<
  typeof DataExportRequestedDtoSchema
>;

export const DataExportLinkDtoSchema = z
  .object({ url: z.string().url(), expiresAt: Iso })
  .strict();
export type DataExportLinkDto = z.infer<typeof DataExportLinkDtoSchema>;

export const AccountDeletionRequestSchema = z
  .object({
    /** The access token of a re-authentication made moments ago. */
    accessToken: z.string().min(20).max(8192),
    /** The words the page asks them to type. */
    confirmation: z.string().min(1).max(60),
    /** The organisations the page said close with the account. */
    organisationsToClose: z.array(z.string().uuid()).max(200),
  })
  .strict();
export type AccountDeletionRequest = z.infer<
  typeof AccountDeletionRequestSchema
>;

export const AccountDeletionScheduledDtoSchema = z
  .object({ deletion: AccountDeletionDtoSchema })
  .strict();
export type AccountDeletionScheduledDto = z.infer<
  typeof AccountDeletionScheduledDtoSchema
>;
