import { z } from "zod";

import {
  CancelMediaUploadRequestSchema,
  CancelMediaUploadResponseSchema,
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  CreateCompanyPitchRequestSchema,
  CreateMediaUploadSessionRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MEDIA_PLAYBACK_POLICY_SUFFIX,
  MEDIA_UPLOAD_CANCEL_SUFFIX,
  MEDIA_UPLOAD_SESSION_SUFFIX,
  MediaUploadSessionDtoSchema,
  SetPitchPlaybackPolicyResponseSchema,
  SetPitchPlaybackPolicyRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import {
  DEFAULT_PITCH_DURATION_POLICY,
  MediaAssetIdSchema,
  PREFERRED_PITCH_ASPECT_RATIO,
  toMediaAssetDto,
  type MediaAsset,
  type MediaService,
} from "@capital-q/media";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Pitch media (ADR 0040 checklist, media and documents). Making a pitch
 * record, reserving and cancelling its upload, removing it, and its
 * playback policy: each declared once with its generated route.
 *
 * Every step but the policy needs the person's own file, so Q offers the
 * pitch screen for them (`qCapability: offer.pitch_video_upload`) and
 * never takes them itself. The playback policy is the same decision as
 * pitch.details.set, so Q does it with that generated tool (`viaTool`).
 * The video provider's failures answer as before: the app's composition
 * maps them (mediaProviderProblem) for these routes too.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The media service authorises (media.manage on their own company). */
const servicesDecide = () => Promise.resolve({ ok: true as const });

type Uploads = Pick<
  MediaService,
  | "createCompanyPitch"
  | "deleteCompanyPitch"
  | "createUploadSession"
  | "cancelUpload"
  | "setPitchPlaybackPolicy"
>;

const media = (ports: AppActionPorts): Uploads =>
  ports.pitchUploads ?? missing("pitchUploads");

const pitch = `${COMPANIES_PATH}/:companyId${COMPANY_PITCH_SUFFIX}`;
const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

/** Product guidance, served from one place so no client hardcodes it. */
const GUIDANCE = {
  targetMinSeconds: DEFAULT_PITCH_DURATION_POLICY.targetMinSeconds,
  targetMaxSeconds: DEFAULT_PITCH_DURATION_POLICY.targetMaxSeconds,
  hardMaxSeconds: DEFAULT_PITCH_DURATION_POLICY.hardMaxSeconds,
  preferredAspectRatio: PREFERRED_PITCH_ASPECT_RATIO,
} as const;

const OFFER = "offer.pitch_video_upload" as const;

const Asset = {
  companyId: UuidSchema,
  mediaAssetId: MediaAssetIdSchema,
};

const Create = z
  .object({
    companyId: UuidSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema.optional(),
    input: CreateCompanyPitchRequestSchema,
  })
  .strict()
  // Replacing supersedes the current pitch, so it must name the intended
  // change: a retry whose answer was lost gets the same new asset back.
  .refine(
    (value) =>
      value.input.replacesMediaAssetId === undefined ||
      value.idempotencyKey !== undefined,
    {
      message: "An Idempotency-Key header is required to replace a pitch.",
      path: ["idempotencyKey"],
    },
  );

const CREATE = defineAppAction<
  z.infer<typeof Create>,
  Awaited<ReturnType<MediaService["createCompanyPitch"]>>
>({
  name: "pitch.create",
  short: "start a pitch video",
  area: "media",
  classification: "CONSEQUENTIAL",
  does: "Starts a new pitch video (or its replacement) for their company, before its file is uploaded, as the pitch screen does.",
  input: Create,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    media(ports).createCompanyPitch({
      actor: context.actor,
      companyId: input.companyId,
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
      input:
        input.input.replacesMediaAssetId === undefined
          ? {}
          : {
              replacesMediaAssetId: MediaAssetIdSchema.parse(
                input.input.replacesMediaAssetId,
              ),
            },
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: () => ({ summary: "Start a pitch video", preview: "" }),
  done: () => "Done.",
  http: {
    method: "POST",
    path: pitch,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      ...(keyOf(headers) === undefined
        ? {}
        : { idempotencyKey: keyOf(headers) }),
      input: body ?? {},
    }),
    status: (out) => (out.replayed ? 200 : 201),
    location: (out) =>
      `${COMPANIES_PATH}/${out.asset.ownerId}${COMPANY_PITCH_SUFFIX}`,
    respond: (out) => ({
      pitch: toMediaAssetDto(out.asset),
      replacedMediaAssetId: out.replaced?.id ?? null,
      guidance: GUIDANCE,
    }),
  },
  qCapability: OFFER,
});

const Delete = z.object(Asset).strict();

const DELETE = defineAppAction<z.infer<typeof Delete>, MediaAsset>({
  name: "pitch.delete",
  short: "remove a pitch video",
  area: "media",
  classification: "CONSEQUENTIAL",
  does: "Removes one of their company's pitch videos, as the pitch screen does; its history is kept.",
  input: Delete,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    media(ports).deleteCompanyPitch({
      actor: context.actor,
      companyId: input.companyId,
      mediaAssetId: input.mediaAssetId,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: () => ({ summary: "Remove this pitch video", preview: "" }),
  done: () => "Removed.",
  http: {
    method: "DELETE",
    path: `${pitch}/:mediaAssetId`,
    fromRequest: (params) => ({
      companyId: params["companyId"],
      mediaAssetId: params["mediaAssetId"],
    }),
    respond: (out) => ({ pitch: toMediaAssetDto(out) }),
  },
  qCapability: OFFER,
});

const Upload = z
  .object({
    ...Asset,
    idempotencyKey: IdempotencyKeyHeaderSchema.optional(),
    input: CreateMediaUploadSessionRequestSchema,
  })
  .strict()
  // A client that can resume says how many bytes and must name the
  // request, so a retry can be recognised; a one-shot target needs none.
  .refine(
    (value) =>
      value.input.uploadLengthBytes === undefined ||
      value.idempotencyKey !== undefined,
    {
      message: "An Idempotency-Key header is required for a resumable upload.",
      path: ["idempotencyKey"],
    },
  );

const UPLOAD = defineAppAction<
  z.infer<typeof Upload>,
  Awaited<ReturnType<MediaService["createUploadSession"]>>
>({
  name: "pitch.upload.start",
  short: "upload a pitch file",
  area: "media",
  classification: "CONSEQUENTIAL",
  does: "Reserves a direct upload for a pitch video's file, as the pitch screen does; the bytes go straight to the video provider.",
  input: Upload,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    media(ports).createUploadSession({
      actor: context.actor,
      companyId: input.companyId,
      mediaAssetId: input.mediaAssetId,
      expectedVersion: input.input.expectedVersion,
      ...(input.input.uploadLengthBytes === undefined
        ? {}
        : {
            uploadLengthBytes: input.input.uploadLengthBytes,
            idempotencyKey: input.idempotencyKey,
          }),
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: () => ({ summary: "Upload a pitch file", preview: "" }),
  done: () => "Ready for the file.",
  http: {
    method: "POST",
    path: `${pitch}/:mediaAssetId${MEDIA_UPLOAD_SESSION_SUFFIX}`,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      mediaAssetId: params["mediaAssetId"],
      ...(keyOf(headers) === undefined
        ? {}
        : { idempotencyKey: keyOf(headers) }),
      input: body ?? {},
    }),
    status: (out) => (out.replayed ? 200 : 201),
    respond: (out) =>
      MediaUploadSessionDtoSchema.parse({
        mediaAssetId: out.asset.id,
        uploadMode: out.session.uploadMode,
        uploadUrl: out.session.uploadUrl,
        expiresAt: out.session.expiresAt,
        maxDurationSeconds: out.maxDurationSeconds,
        ...(out.session.chunkSizeBytes === undefined
          ? {}
          : { chunkSizeBytes: out.session.chunkSizeBytes }),
        pitch: toMediaAssetDto(out.asset),
      }),
  },
  qCapability: OFFER,
});

const Cancel = z
  .object({ ...Asset, input: CancelMediaUploadRequestSchema })
  .strict();

const CANCEL = defineAppAction<
  z.infer<typeof Cancel>,
  Awaited<ReturnType<MediaService["cancelUpload"]>>
>({
  name: "pitch.upload.cancel",
  short: "cancel a pitch upload",
  area: "media",
  classification: "CONSEQUENTIAL",
  does: "Stops an unfinished pitch upload, as the pitch screen does.",
  input: Cancel,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    media(ports).cancelUpload({
      actor: context.actor,
      companyId: input.companyId,
      mediaAssetId: input.mediaAssetId,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: () => ({ summary: "Cancel the upload", preview: "" }),
  done: () => "Cancelled.",
  http: {
    method: "POST",
    path: `${pitch}/:mediaAssetId${MEDIA_UPLOAD_CANCEL_SUFFIX}`,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      mediaAssetId: params["mediaAssetId"],
      input: body ?? {},
    }),
    respond: (out) =>
      CancelMediaUploadResponseSchema.parse({
        pitch: toMediaAssetDto(out.asset),
      }),
  },
  qCapability: OFFER,
});

const Policy = z
  .object({ ...Asset, input: SetPitchPlaybackPolicyRequestSchema })
  .strict();

const POLICY = defineAppAction<z.infer<typeof Policy>, MediaAsset>({
  name: "pitch.playback_policy.set",
  short: "set pitch playback",
  area: "media",
  classification: "CONSEQUENTIAL",
  does: "Sets whether a pitch video may be played beyond their organisation, as the pitch screen's older control does; the same decision as who can watch it.",
  input: Policy,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    media(ports).setPitchPlaybackPolicy({
      actor: context.actor,
      companyId: input.companyId,
      mediaAssetId: input.mediaAssetId,
      playbackPolicy: input.input.playbackPolicy,
      expectedVersion: input.input.expectedVersion,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: () => ({ summary: "Set who can play this pitch", preview: "" }),
  done: () => "Done.",
  http: {
    method: "POST",
    path: `${pitch}/:mediaAssetId${MEDIA_PLAYBACK_POLICY_SUFFIX}`,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      mediaAssetId: params["mediaAssetId"],
      input: body ?? {},
    }),
    respond: (out) =>
      SetPitchPlaybackPolicyResponseSchema.parse({
        pitch: toMediaAssetDto(out),
      }),
  },
  viaTool: "set_pitch_sharing",
});

export const MEDIA_ACTIONS: readonly AnyAppAction[] = [
  CREATE,
  DELETE,
  UPLOAD,
  CANCEL,
  POLICY,
];
