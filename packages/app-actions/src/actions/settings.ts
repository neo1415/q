import { z } from "zod";

import type { PushSubscriptionStore } from "@capital-q/communication";
import {
  COMPANIES_PATH,
  COMPANY_VERIFICATION_REQUESTS_SEGMENT,
  CompanyVerificationDtoSchema,
  GOOGLE_CONNECT_PATH,
  GOOGLE_INTEGRATION_PATH,
  HumanReviewDtoSchema,
  HumanReviewRequestSchema,
  INBOUND_EMAIL_ROTATE_PATH,
  InboundEmailAddressDtoSchema,
  KYB_PATH,
  KybDtoSchema,
  KybRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  NOTIFICATION_SETTINGS_PATH,
  NotificationSettingsDtoSchema,
  NotificationSettingsRequestSchema,
  RequestCompanyVerificationRequestSchema,
  REVIEWS_PATH,
  RotateInboundEmailRequestSchema,
  StartGoogleConnectRequestSchema,
  StartGoogleConnectResponseSchema,
  UuidSchema,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type { IntegrationsService } from "@capital-q/integrations";
import type { PlatformAdmin } from "@capital-q/platform-admin";
import type {
  CompanyVerificationService,
  KybService,
} from "@capital-q/verification";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Settings and the rest (ADR 0040 checklist): notification switches,
 * connecting and disconnecting Google, asking for company verification and
 * asking a person to review something, each declared once with its
 * generated route.
 *
 * Q's side is unchanged in this step: the switches and the review request
 * through their tools (`legacyTool`); connecting Google needs the person
 * at Google's own consent screen and verification is their own request,
 * so Q offers those screens (`qCapability`).
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** Each owning service authorises (their own settings, their own company). */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const notifications = (ports: AppActionPorts) =>
  ports.notificationSettings ?? missing("notificationSettings");
const google = (ports: AppActionPorts) => ports.google ?? missing("google");
const inboundEmail = (ports: AppActionPorts) =>
  ports.inboundEmail ?? missing("inboundEmail");

// --- notification settings ----------------------------------------------

const Settings = z
  .object({ input: NotificationSettingsRequestSchema })
  .strict();

type SavedSettings = Awaited<ReturnType<PushSubscriptionStore["settings"]>>;

const NOTIFICATION_SETTINGS = defineAppAction<
  z.infer<typeof Settings>,
  SavedSettings
>({
  name: "settings.notifications.set",
  short: "set notification switches",
  area: "settings",
  classification: "INSTANT",
  does: "Turns their push and email notifications on or off, as Settings does.",
  input: Settings,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) => {
    const store = notifications(ports);
    await store.saveSettings(context.actor, input.input);
    return store.settings(context.actor);
  },
  targets: () => [],
  card: () => ({ summary: "Change notifications", preview: "" }),
  done: () => "Saved.",
  http: {
    method: "PUT",
    path: NOTIFICATION_SETTINGS_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    respond: (out, _input, ports) =>
      NotificationSettingsDtoSchema.parse({
        ...out,
        pushAvailable: ports.notificationSettings?.pushAvailable === true,
      }),
  },
  legacyTool: "set_notification_settings",
});

// --- Google ---------------------------------------------------------------

/** Gmail and Calendar not set up on this deployment: said, never hidden. */
const UNAVAILABLE = {
  code: "PROVIDER_UNAVAILABLE" as KnownErrorCode,
  detail: "Gmail isn't connected on this deployment yet.",
};

type Connected =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly started: Awaited<
        ReturnType<IntegrationsService["startConnect"]>
      >;
    };

const Connect = z.object({ input: StartGoogleConnectRequestSchema }).strict();

const GOOGLE_CONNECT = defineAppAction<z.infer<typeof Connect>, Connected>({
  name: "integrations.google.connect",
  short: "connect Google",
  area: "integrations",
  classification: "CONSEQUENTIAL",
  does: "Starts connecting their Google account (Gmail and Calendar) at Google's own consent screen, as Settings does.",
  input: Connect,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) => {
    const service = google(ports);
    if (!service.available) return { available: false };
    return {
      available: true,
      started: await service.startConnect({
        tenantId: context.actor.tenantId,
        userId: context.actor.userId,
        returnTo: input.input.returnTo,
      }),
    };
  },
  targets: () => [],
  card: () => ({ summary: "Connect Google", preview: "" }),
  done: () => "Continue at Google.",
  http: {
    method: "POST",
    path: GOOGLE_CONNECT_PATH,
    fromRequest: (_params, body) => ({ input: body ?? {} }),
    problem: (out) => (out.available ? null : UNAVAILABLE),
    respond: (out) =>
      out.available
        ? StartGoogleConnectResponseSchema.parse(out.started)
        : null,
  },
  qCapability: "offer.gmail_connect",
});

const Disconnect = z.object({}).strict();

const GOOGLE_DISCONNECT = defineAppAction<
  z.infer<typeof Disconnect>,
  { readonly available: boolean }
>({
  name: "integrations.google.disconnect",
  short: "disconnect Google",
  area: "integrations",
  classification: "CONSEQUENTIAL",
  does: "Disconnects their Google account, as Settings does.",
  input: Disconnect,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context) => {
    const service = google(ports);
    if (!service.available) return { available: false };
    await service.disconnect(context.actor.userId);
    return { available: true };
  },
  targets: () => [],
  card: () => ({ summary: "Disconnect Google", preview: "" }),
  done: () => "Disconnected.",
  http: {
    method: "DELETE",
    path: GOOGLE_INTEGRATION_PATH,
    fromRequest: () => ({}),
    problem: (out) => (out.available ? null : UNAVAILABLE),
    status: 204,
    respond: () => undefined,
  },
  qCapability: "offer.gmail_connect",
});

// --- their Q email address (inbound email) ----------------------------------

const INBOUND_UNAVAILABLE = {
  code: "PROVIDER_UNAVAILABLE" as KnownErrorCode,
  detail: "Receiving email isn't set up on this deployment yet.",
};

const RotateInbound = z
  .object({ input: RotateInboundEmailRequestSchema })
  .strict();

const INBOUND_EMAIL_ROTATE = defineAppAction<
  z.infer<typeof RotateInbound>,
  { readonly address: string | null }
>({
  name: "integrations.inbound_email.rotate",
  short: "new Q email address",
  area: "integrations",
  classification: "CONSEQUENTIAL",
  does: "Gives them a new Q email address; the old one stops receiving at once, as Settings does.",
  input: RotateInbound,
  output: serviceResult(),
  // Their own address only: the service binds every change to the actor.
  authorize: servicesDecide,
  run: async (ports, context, input) => ({
    address: await inboundEmail(ports).rotate(
      context.actor,
      input.input.currentAddress,
    ),
  }),
  targets: () => [],
  card: () => ({ summary: "New Q email address", preview: "" }),
  done: () =>
    "Your new Q email address is ready; the old one no longer receives.",
  http: {
    method: "POST",
    path: INBOUND_EMAIL_ROTATE_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    problem: (out) => (out.address === null ? INBOUND_UNAVAILABLE : null),
    respond: (out) =>
      InboundEmailAddressDtoSchema.parse({
        status: "ACTIVE",
        address: out.address,
      }),
  },
  qCapability: "offer.q_email_address",
});

// --- verification and reviews ---------------------------------------------

const Verify = z
  .object({
    companyId: UuidSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: RequestCompanyVerificationRequestSchema,
  })
  .strict();

const VERIFY = defineAppAction<
  z.infer<typeof Verify>,
  Awaited<ReturnType<CompanyVerificationService["requestCompanyVerification"]>>
>({
  name: "verification.company.request",
  short: "request company verification",
  area: "verification",
  classification: "CONSEQUENTIAL",
  does: "Asks Capital Q to verify their company, as the Verification page does.",
  input: Verify,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    (ports.verification ?? missing("verification")).requestCompanyVerification({
      actor: context.actor,
      companyId: input.companyId,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: () => ({ summary: "Request verification", preview: "" }),
  done: () => "Requested.",
  http: {
    method: "POST",
    path: `${COMPANIES_PATH}/:companyId${COMPANY_VERIFICATION_REQUESTS_SEGMENT}`,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      idempotencyKey: keyOf(headers),
      input: body ?? {},
    }),
    // 202: checks were started; 200: nothing new to ask for.
    status: (out) => (out.requested.length === 0 ? 200 : 202),
    respond: (out) => CompanyVerificationDtoSchema.parse(out.verification),
  },
  qCapability: "offer.verification_request",
});

const Review = z
  .object({
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: HumanReviewRequestSchema,
  })
  .strict();

const REVIEW = defineAppAction<
  z.infer<typeof Review>,
  Awaited<ReturnType<PlatformAdmin["requestReview"]>>
>({
  name: "review.request",
  short: "ask a person to review",
  area: "verification",
  classification: "CONSEQUENTIAL",
  does: "Asks a person at Capital Q to review something of theirs, as the Reviews page does.",
  input: Review,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    (ports.reviews ?? missing("reviews")).requestReview(
      {
        tenantId: context.actor.tenantId,
        userId: context.actor.userId,
        organisationId: context.actor.organisationId,
      },
      {
        subjectType: input.input.subjectType,
        subjectRef: input.input.subjectRef ?? null,
        reason: input.input.reason,
        idempotencyKey: input.idempotencyKey,
      },
    ),
  targets: () => [],
  card: () => ({ summary: "Ask for a review", preview: "" }),
  done: () => "A person will look at it.",
  http: {
    method: "POST",
    path: REVIEWS_PATH,
    fromRequest: (_params, body, headers) => ({
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    problem: (out) =>
      out.kind === "TOO_MANY_OPEN"
        ? {
            code: "RESOURCE_CONFLICT",
            detail:
              "You have 5 reviews waiting already. A person will answer those first.",
          }
        : out.kind === "INVALID"
          ? {
              code: "VALIDATION_FAILED",
              detail: "Say what you want reviewed and why.",
            }
          : null,
    status: (out) => (out.kind === "CREATED" ? 201 : 200),
    respond: (out) =>
      "review" in out ? HumanReviewDtoSchema.parse(out.review) : undefined,
  },
  legacyTool: "propose_human_review",
});

const Kyb = z
  .object({
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: KybRequestSchema,
  })
  .strict();

const KYB_PROBLEMS: Readonly<
  Record<string, { readonly code: KnownErrorCode; readonly detail: string }>
> = {
  "ALREADY_OPEN:ORGANISATION": {
    code: "RESOURCE_CONFLICT",
    detail: "Your business details are already with Capital Q.",
  },
  "ALREADY_OPEN:PERSON": {
    code: "RESOURCE_CONFLICT",
    detail: "Your identity details are already with Capital Q.",
  },
  "ALREADY_VERIFIED:ORGANISATION": {
    code: "RESOURCE_CONFLICT",
    detail: "Your organisation is already verified.",
  },
  "ALREADY_VERIFIED:PERSON": {
    code: "RESOURCE_CONFLICT",
    detail: "You're already verified.",
  },
  "DOCUMENT_NOT_FOUND:ORGANISATION": {
    code: "VALIDATION_FAILED",
    detail: "That document isn't one of your organisation's uploads.",
  },
  "DOCUMENT_NOT_FOUND:PERSON": {
    code: "VALIDATION_FAILED",
    detail: "That ID document isn't one of your uploads.",
  },
  NO_ORGANISATION: {
    code: "PERMISSION_DENIED",
    detail: "Choose your organisation first.",
  },
};

/**
 * The organisation's business details and the person's identity, with
 * the documents they uploaded (KYB). Their own submission: Q offers the
 * Verification page and never submits it (lead 2026-10-02).
 */
const KYB = defineAppAction<
  z.infer<typeof Kyb>,
  Awaited<ReturnType<KybService["submit"]>>
>({
  name: "verification.kyb.submit",
  consequence: "COMMITMENT",
  short: "submit business verification",
  area: "verification",
  classification: "CONSEQUENTIAL",
  does: "Submits their business and identity details for verification, as the Verification page does.",
  input: Kyb,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) => {
    const organisation = input.input.organisation;
    const person = input.input.person;
    return (ports.kyb ?? missing("kyb")).submit({
      actor: context.actor,
      organisation:
        organisation === null
          ? null
          : {
              legalName: organisation.legalName,
              registrationNumber: organisation.registrationNumber,
              jurisdictionCode: organisation.jurisdictionCode,
              registeredAddress: organisation.registeredAddress ?? null,
              websiteUrl: organisation.websiteUrl ?? null,
              documentId: organisation.documentId ?? null,
            },
      person:
        person === null
          ? null
          : {
              nameOnId: person.nameOnId,
              role: person.role,
              documentId: person.documentId ?? null,
            },
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    });
  },
  targets: () => [],
  card: () => ({ summary: "Submit business verification", preview: "" }),
  done: () => "Submitted.",
  http: {
    method: "POST",
    path: KYB_PATH,
    fromRequest: (_params, body, headers) => ({
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    problem: (out) =>
      out.kind === "SUBMITTED" || out.kind === "REPLAYED"
        ? null
        : (KYB_PROBLEMS["part" in out ? `${out.kind}:${out.part}` : out.kind] ??
          null),
    status: (out) => (out.kind === "SUBMITTED" ? 201 : 200),
    respond: (out) =>
      "view" in out ? KybDtoSchema.parse(out.view) : undefined,
  },
  qCapability: "offer.kyb_submission",
});

export const SETTINGS_ACTIONS: readonly AnyAppAction[] = [
  NOTIFICATION_SETTINGS,
  GOOGLE_CONNECT,
  GOOGLE_DISCONNECT,
  INBOUND_EMAIL_ROTATE,
  VERIFY,
  REVIEW,
  KYB,
];
