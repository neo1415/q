import { z } from "zod";

/**
 * F4 (2026-10-06): an investor organisation's GateQ inbox, modelled on a
 * mail client. Every founder who applied through its gate, what the engine
 * made of them against the gate's rules, and what the organisation does
 * next. All under `/v1/gateq/gateways/:gatewayId/inbox`; GateQ's own
 * gateway authority decides who may read (investor.gateway.view) and who
 * may act for the firm (investor.gateway.edit). A gateway that is not the
 * caller's is the same 404 as none.
 */

export const GATEQ_INBOX_PATH = "/v1/gateq/gateways/:gatewayId/inbox" as const;
export const GATEQ_INBOX_ITEM_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/:applicationId" as const;
export const GATEQ_INBOX_PACK_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/:applicationId/pack" as const;
export const GATEQ_INBOX_STAR_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/star" as const;
export const GATEQ_INBOX_ARCHIVE_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/archive" as const;
export const GATEQ_INBOX_LABEL_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/label" as const;
export const GATEQ_INBOX_ASSIGN_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/assign" as const;
export const GATEQ_INBOX_NOTES_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/:applicationId/notes" as const;
export const GATEQ_INBOX_PASS_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/:applicationId/pass" as const;
export const GATEQ_INBOX_REPLY_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/:applicationId/reply" as const;
export const GATEQ_INBOX_SETTINGS_PATH =
  "/v1/gateq/gateways/:gatewayId/inbox/settings" as const;

export function gateqInboxPath(
  template: string,
  params: { readonly gatewayId: string; readonly applicationId?: string },
): string {
  return template
    .replace(":gatewayId", encodeURIComponent(params.gatewayId))
    .replace(":applicationId", encodeURIComponent(params.applicationId ?? ""));
}

/** The mail-client views (F4). Fit bands come from the engine, never a model. */
export const GATEQ_INBOX_VIEWS = [
  "INBOX",
  "STARRED",
  "ASSIGNED_TO_ME",
  "FITS",
  "PARTIAL",
  "NOT_A_FIT",
  "PASSED",
  "ARCHIVED",
] as const;
export const GateqInboxViewSchema = z.enum(GATEQ_INBOX_VIEWS);
export type GateqInboxView = z.infer<typeof GateqInboxViewSchema>;

/**
 * QUALIFIED → FITS, INSUFFICIENT_INFORMATION → PARTIAL, NOT_QUALIFIED →
 * NOT_A_FIT: the deterministic outcome recorded at submission, in words.
 */
export const GateqFitBandSchema = z.enum(["FITS", "PARTIAL", "NOT_A_FIT"]);
export type GateqFitBand = z.infer<typeof GateqFitBandSchema>;

export const GateqReplyStateSchema = z.enum([
  /** No promise published: no clock. */
  "NONE",
  "ON_TRACK",
  /** Three quarters of the promised time has gone. */
  "DUE_SOON",
  "OVERDUE",
  /** Replied to or passed: the promise is kept. */
  "ANSWERED",
]);
export type GateqReplyState = z.infer<typeof GateqReplyStateSchema>;

export const GATEQ_PASS_REASONS = [
  "OUTSIDE_STAGE",
  "OUTSIDE_SECTOR",
  "CHEQUE_DOES_NOT_FIT",
  "TIMING",
  "OTHER",
] as const;
export const GateqPassReasonSchema = z.enum(GATEQ_PASS_REASONS);
export type GateqPassReason = z.infer<typeof GateqPassReasonSchema>;

export const GateqMemberDtoSchema = z
  .object({
    userId: z.string().uuid(),
    name: z.string().max(200),
    initials: z.string().max(3),
  })
  .strict();
export type GateqMemberDto = z.infer<typeof GateqMemberDtoSchema>;

const Money = z
  .object({ amount: z.string().max(24), currency: z.string().length(3) })
  .strict();

export const GateqInboxItemDtoSchema = z
  .object({
    applicationId: z.string().uuid(),
    reference: z.string().max(64),
    companyName: z.string().max(200),
    oneLiner: z.string().max(280).nullable(),
    /** The founder's own answers, as words. Applicant claims, never verified. */
    stage: z.string().max(60).nullable(),
    sector: z.string().max(200).nullable(),
    country: z.string().max(60).nullable(),
    raise: Money.nullable(),
    fit: GateqFitBandSchema,
    rules: z
      .object({
        met: z.number().int().min(0),
        total: z.number().int().min(0),
        unknown: z.number().int().min(0),
      })
      .strict(),
    starred: z.boolean(),
    unread: z.boolean(),
    labels: z.array(z.string().max(40)).max(20),
    assignee: GateqMemberDtoSchema.nullable(),
    folder: z.enum(["INBOX", "ARCHIVED", "PASSED"]),
    replyBy: z.string().nullable(),
    replyState: GateqReplyStateSchema,
    /** Working days to the promised reply; negative when overdue. */
    daysLeft: z.number().int().nullable(),
    submittedAt: z.string(),
  })
  .strict();
export type GateqInboxItemDto = z.infer<typeof GateqInboxItemDtoSchema>;

export const GateqInboxDtoSchema = z
  .object({
    gateway: z
      .object({
        id: z.string().uuid(),
        name: z.string().max(200),
        publicId: z.string().max(64),
        replyWithinDays: z.number().int().nullable(),
      })
      .strict(),
    viewer: z
      .object({
        userId: z.string().uuid(),
        /** May reply, pass, assign and change the gate (investor.gateway.edit). */
        canDecide: z.boolean(),
        /** One person alone: no Assign, no team notes to share. */
        solo: z.boolean(),
      })
      .strict(),
    view: GateqInboxViewSchema,
    counts: z.record(GateqInboxViewSchema, z.number().int().min(0)),
    items: z.array(GateqInboxItemDtoSchema).max(200),
    labels: z.array(z.string().max(40)).max(100),
    members: z.array(GateqMemberDtoSchema).max(200),
  })
  .strict();
export type GateqInboxDto = z.infer<typeof GateqInboxDtoSchema>;

export const GateqRuleStandingSchema = z.enum([
  "MEETS",
  "DOES_NOT_MEET",
  "NOT_ANSWERED",
]);

export const GateqInboxDetailDtoSchema = z
  .object({
    item: GateqInboxItemDtoSchema,
    rules: z
      .array(
        z
          .object({
            label: z.string().max(120),
            dimension: z.string().max(40),
            required: z.boolean(),
            standing: GateqRuleStandingSchema,
          })
          .strict(),
      )
      .max(64),
    /** Everything the founder answered, labelled; their words, not facts. */
    answers: z
      .array(
        z
          .object({ label: z.string().max(60), value: z.string().max(2000) })
          .strict(),
      )
      .max(40),
    note: z.string().max(2000).nullable(),
    contact: z
      .object({
        name: z.string().max(200).nullable(),
        email: z.string().max(254).nullable(),
      })
      .strict(),
    /** Only what the founder ticked and sent. */
    shared: z
      .array(
        z
          .object({ documentId: z.string().uuid(), title: z.string().max(200) })
          .strict(),
      )
      .max(20),
    notes: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            author: GateqMemberDtoSchema,
            body: z.string().max(2000),
            createdAt: z.string(),
          })
          .strict(),
      )
      .max(200),
    activity: z
      .array(z.object({ at: z.string(), text: z.string().max(300) }).strict())
      .max(200),
    messages: z
      .array(
        z
          .object({
            kind: z.enum(["PASS", "REPLY"]),
            reasonCode: GateqPassReasonSchema.nullable(),
            body: z.string().max(2000),
            at: z.string(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type GateqInboxDetailDto = z.infer<typeof GateqInboxDetailDtoSchema>;

const ApplicationIds = z.array(z.string().uuid()).min(1).max(100);

export const GateqInboxStarRequestSchema = z
  .object({ applicationIds: ApplicationIds, starred: z.boolean() })
  .strict();
export const GateqInboxArchiveRequestSchema = z
  .object({ applicationIds: ApplicationIds, archived: z.boolean() })
  .strict();
export const GateqInboxLabelRequestSchema = z
  .object({
    applicationIds: ApplicationIds,
    label: z.string().trim().min(1).max(40),
    on: z.boolean(),
  })
  .strict();
export const GateqInboxAssignRequestSchema = z
  .object({
    applicationIds: ApplicationIds,
    /** Null unassigns. Must be a member of the gateway's organisation. */
    assigneeUserId: z.string().uuid().nullable(),
  })
  .strict();
export const GateqInboxNoteRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(2000),
    clientRequestId: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  })
  .strict();
export const GateqInboxPassRequestSchema = z
  .object({
    /** A pass always gives the founder a reason. */
    reasonCode: GateqPassReasonSchema,
    /** Exactly the words approved; a changed word is a new approval. */
    message: z.string().trim().min(1).max(2000),
    clientRequestId: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  })
  .strict();
export const GateqInboxReplyRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    clientRequestId: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  })
  .strict();
export const GateqInboxSettingsRequestSchema = z
  .object({ replyWithinDays: z.number().int().min(1).max(60).nullable() })
  .strict();

export type GateqInboxStarRequest = z.infer<typeof GateqInboxStarRequestSchema>;
export type GateqInboxArchiveRequest = z.infer<
  typeof GateqInboxArchiveRequestSchema
>;
export type GateqInboxLabelRequest = z.infer<
  typeof GateqInboxLabelRequestSchema
>;
export type GateqInboxAssignRequest = z.infer<
  typeof GateqInboxAssignRequestSchema
>;
export type GateqInboxNoteRequest = z.infer<typeof GateqInboxNoteRequestSchema>;
export type GateqInboxPassRequest = z.infer<typeof GateqInboxPassRequestSchema>;
export type GateqInboxReplyRequest = z.infer<
  typeof GateqInboxReplyRequestSchema
>;
export type GateqInboxSettingsRequest = z.infer<
  typeof GateqInboxSettingsRequestSchema
>;

/** How many rows a bulk action changed; the same shape for every one. */
export const GateqInboxChangedDtoSchema = z
  .object({ changed: z.number().int().min(0), deduplicated: z.boolean() })
  .strict();
export type GateqInboxChangedDto = z.infer<typeof GateqInboxChangedDtoSchema>;

/** F2: a signed-in founder's own GateQ applications. */
export const GATEQ_MY_APPLICATIONS_PATH = "/v1/gateq/my-applications" as const;

export const FounderApplicationDtoSchema = z
  .object({
    applicationId: z.string().uuid(),
    fund: z.string().max(200),
    sentAt: z.string(),
    /** Only what the investor sent back; never whether they opened it. */
    status: z.enum(["SENT", "REPLIED", "PASSED"]),
    reasonCode: GateqPassReasonSchema.nullable(),
    message: z.string().max(2000).nullable(),
  })
  .strict();
export type FounderApplicationDto = z.infer<typeof FounderApplicationDtoSchema>;

export const FounderApplicationListDtoSchema = z
  .object({ applications: z.array(FounderApplicationDtoSchema).max(100) })
  .strict();
export type FounderApplicationListDto = z.infer<
  typeof FounderApplicationListDtoSchema
>;
