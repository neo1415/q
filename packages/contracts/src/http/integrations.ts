import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Integrations HTTP contracts (BIZ-007): a person's own connected Google
 * mailbox, and the email Q prepares on a relationship.
 *
 * Nothing here ever carries a token, a code verifier, a state or a
 * provider credential. The OAuth callback and the Pub/Sub push are
 * vendor-facing and have no JSON contract of their own beyond these paths.
 */

export const GOOGLE_INTEGRATION_PATH = "/v1/integrations/google" as const;
export const GOOGLE_CONNECT_PATH = "/v1/integrations/google/connect" as const;
export const GOOGLE_OAUTH_CALLBACK_PATH =
  "/v1/integrations/google/callback" as const;
export const GOOGLE_GMAIL_PUSH_PATH =
  "/v1/integrations/google/gmail-push" as const;
/** `GET` the person's own mail on one relationship. */
export const GOOGLE_RELATIONSHIP_MAIL_PATH =
  "/v1/integrations/google/relationships/:relationshipId/mail" as const;

/** The FINAL SETUP CONTRACT's scopes. Nothing else is ever requested. */
export const GOOGLE_WORKSPACE_SCOPES = Object.freeze([
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/calendar.events",
] as const);

export const GoogleConnectionStatusSchema = z.enum([
  /** The integration is not configured on this deployment. */
  "UNAVAILABLE",
  "NOT_CONNECTED",
  "CONNECTED",
  /**
   * meetfix-57: Google ended the grant (a revoked or expired refresh
   * token -- testing-mode tokens lapse after 7 days). Not the same as never
   * connected: the person reconnects, and Q says so.
   */
  "REVOKED",
]);
export type GoogleConnectionStatus = z.infer<
  typeof GoogleConnectionStatusSchema
>;

export const GoogleConnectionDtoSchema = z
  .object({
    status: GoogleConnectionStatusSchema,
    email: z.string().max(320).optional(),
    connectedAt: UtcTimestampSchema.optional(),
    /** Whether replies arrive by push; polling runs either way. */
    replyTracking: z.enum(["PUSH_AND_POLL", "POLL"]).optional(),
    /** REVOKED only: when Google ended it. */
    revokedAt: UtcTimestampSchema.optional(),
    /**
     * CONNECTED only: whether Google Calendar access was actually granted
     * (the scope is on the grant and Google accepts it for the calendar).
     * A connected Google account is not a connected calendar.
     */
    calendar: z.enum(["GRANTED", "NOT_GRANTED"]).optional(),
  })
  .strict();
export type GoogleConnectionDto = z.infer<typeof GoogleConnectionDtoSchema>;

/**
 * meetfix-57: the one in-app link that reconnects Google. It opens
 * Settings on Connections and, when Google is not connected, starts the
 * reconnect itself, so a notice or Q's answer is one tap from fixed. A
 * plain path: notification links allow no query or fragment.
 */
export const GOOGLE_RECONNECT_PATH = "/settings/reconnect/google" as const;
/** Where that link lands: Settings, Connections, reconnect requested. */
export const GOOGLE_RECONNECT_TARGET =
  "/settings?reconnect=google#connections" as const;

/**
 * Why a call can't be booked on the organiser's calendar, typed: never a
 * generic "can't". REVOKED is a connection Google ended; NOT_CONNECTED is
 * one that never existed (or lacks calendar access).
 */
export const CALENDAR_BLOCK_REASONS = [
  "CALENDAR_NOT_CONNECTED",
  "CALENDAR_REVOKED",
] as const;
export type CalendarBlockReason = (typeof CALENDAR_BLOCK_REASONS)[number];

export function isCalendarBlock(code: unknown): code is CalendarBlockReason {
  return code === "CALENDAR_NOT_CONNECTED" || code === "CALENDAR_REVOKED";
}

/**
 * What Q says when a call can't be booked for that reason: the reason and
 * the fix in one line, with the reconnect link, then the one alternative
 * that works -- the other side hosts when their calendar is connected,
 * otherwise a pasted Meet link Q sets up and joins. Every surface (Q's
 * answer, the errand and work notices) says these same words.
 */
export function calendarBlockedLine(input: {
  readonly reason: CalendarBlockReason;
  /** The other side's name, when the alternative is theirs to host. */
  readonly counterpartName?: string | undefined;
  readonly counterpartCanHost: boolean;
}): string {
  const fix =
    input.reason === "CALENDAR_REVOKED"
      ? `Your Google Calendar connection expired, so I can't create the Meet link. [Reconnect it in Settings → Connections](${GOOGLE_RECONNECT_PATH}) (one tap) and I'll book it.`
      : `Your Google Calendar isn't connected, so I can't create the Meet link. [Connect it in Settings → Connections](${GOOGLE_RECONNECT_PATH}) (one tap) and I'll book it.`;
  const other =
    input.counterpartCanHost && input.counterpartName !== undefined
      ? `Or ${input.counterpartName} can host: their Google Calendar is connected, so I can ask them to send the invite.`
      : "Or paste a Meet link and I'll set it up and join.";
  return `${fix}\n${other}`;
}

/** `POST /v1/integrations/google/connect` body: where to come back to. */
export const StartGoogleConnectRequestSchema = z
  .object({
    returnTo: z
      .string()
      .regex(/^\/[A-Za-z0-9/_-]{0,200}$/, "a same-origin path")
      .optional(),
  })
  .strict();
export type StartGoogleConnectRequest = z.infer<
  typeof StartGoogleConnectRequestSchema
>;

export const StartGoogleConnectResponseSchema = z
  .object({ authorizationUrl: z.string().url() })
  .strict();
export type StartGoogleConnectResponse = z.infer<
  typeof StartGoogleConnectResponseSchema
>;

export const EMAIL_SUBJECT_MAX_LENGTH = 200;
export const EMAIL_BODY_MAX_LENGTH = 10_000;

/** No CR/LF: a subject is one header line, and never a header injection. */
export const EmailSubjectSchema = z
  .string()
  .trim()
  .min(1)
  .max(EMAIL_SUBJECT_MAX_LENGTH)
  .refine((value) => !/[\r\n]/.test(value), "one line");
export const EmailBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(EMAIL_BODY_MAX_LENGTH);
export const EmailAddressSchema = z.email().max(320);

/** The email draft behind an `email.send` approval, as its approver may read it. */
export const EmailDraftDtoSchema = z
  .object({
    approvalId: UuidSchema,
    relationshipId: UuidSchema,
    to: EmailAddressSchema,
    toName: z.string().max(200),
    counterpartName: z.string().max(200),
    subject: EmailSubjectSchema,
    body: EmailBodySchema,
  })
  .strict();
export type EmailDraftDto = z.infer<typeof EmailDraftDtoSchema>;

/**
 * `POST /v1/q/approvals/:approvalId/email-draft` — the person edited the
 * draft. Only the words change; the recipient and the relationship do not.
 * The old approval is void and a new one, bound to the new payload, is
 * requested.
 */
export const ReviseEmailDraftRequestSchema = z
  .object({ subject: EmailSubjectSchema, body: EmailBodySchema })
  .strict();
export type ReviseEmailDraftRequest = z.infer<
  typeof ReviseEmailDraftRequestSchema
>;
export const Q_APPROVAL_EMAIL_DRAFT_SUFFIX = "/email-draft" as const;

export const RelationshipMailItemSchema = z
  .object({
    id: UuidSchema,
    direction: z.enum(["OUTBOUND", "INBOUND"]),
    status: z.enum(["SENDING", "SENT", "FAILED", "RECEIVED"]),
    from: z.string().max(320),
    to: z.string().max(320),
    subject: z.string().max(998),
    occurredAt: UtcTimestampSchema,
  })
  .strict();
export type RelationshipMailItem = z.infer<typeof RelationshipMailItemSchema>;

export const RelationshipMailListSchema = z
  .object({ items: z.array(RelationshipMailItemSchema).max(100) })
  .strict();
export type RelationshipMailList = z.infer<typeof RelationshipMailListSchema>;

// --- inbound email (Postmark Inbound) ---------------------------------------

/**
 * Postmark's inbound webhook. Vendor-facing: its authority is the basic
 * auth in the hook URL, and its body is Postmark's own JSON, validated at
 * the route. Never a person's action.
 */
export const INBOUND_EMAIL_POSTMARK_PATH =
  "/v1/inbound/email/postmark" as const;
/** `GET` the person's own Q email address (issued on first read). */
export const INBOUND_EMAIL_ADDRESS_PATH = "/v1/me/inbound-email" as const;
/** `POST` a new Q email address: the old one stops receiving at once. */
export const INBOUND_EMAIL_ROTATE_PATH = "/v1/me/inbound-email/rotate" as const;

export const InboundEmailAddressDtoSchema = z.discriminatedUnion("status", [
  /** Inbound email is not configured on this deployment. */
  z.object({ status: z.literal("UNAVAILABLE") }).strict(),
  z
    .object({
      status: z.literal("ACTIVE"),
      address: z.email().max(320),
    })
    .strict(),
]);
export type InboundEmailAddressDto = z.infer<
  typeof InboundEmailAddressDtoSchema
>;

/**
 * Rotation names the address being replaced, so a retried request finds
 * it already replaced and answers with the current one instead of
 * rotating twice.
 */
export const RotateInboundEmailRequestSchema = z
  .object({ currentAddress: z.email().max(320) })
  .strict();
export type RotateInboundEmailRequest = z.infer<
  typeof RotateInboundEmailRequestSchema
>;
