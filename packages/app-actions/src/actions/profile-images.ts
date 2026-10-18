import { z } from "zod";

import {
  CreateProfileImageUploadRequestSchema,
  PROFILE_IMAGE_COMPLETE_SEGMENT,
  PROFILE_IMAGE_UPLOADS_SEGMENT,
  PROFILE_IMAGES_PATH,
  ProfileImageKindSchema,
  ProfileImagesDtoSchema,
  ProfileImageSubjectTypeSchema,
  ProfileImageUploadDtoSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { ProfileImageService } from "@capital-q/public-identity";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Profile photos and covers (ADR 0040 checklist, media and documents):
 * requesting a direct upload, completing it and removing an image, each
 * declared once with its generated route. A photo is the person's own
 * file, so Q offers the screen (`offer.profile_photo_upload`) and never
 * takes these itself.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The service authorises the subject's own editors. */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const images = (ports: AppActionPorts) =>
  ports.profileImages ?? missing("profileImages");

const subjectPath = `${PROFILE_IMAGES_PATH}/:subjectType/:subjectId`;
const OFFER = "offer.profile_photo_upload" as const;

const Subject = z
  .object({ subjectType: ProfileImageSubjectTypeSchema, subjectId: UuidSchema })
  .strict();

const subjectFrom = (params: Record<string, string>) => ({
  subjectType: params["subjectType"],
  subjectId: params["subjectId"],
});

const Request = z
  .object({
    subject: Subject,
    kind: ProfileImageKindSchema,
    input: CreateProfileImageUploadRequestSchema,
  })
  .strict();

const REQUEST = defineAppAction<
  z.infer<typeof Request>,
  Awaited<ReturnType<ProfileImageService["requestUpload"]>>
>({
  name: "profile_image.upload.start",
  short: "upload a profile photo",
  area: "profile-images",
  classification: "CONSEQUENTIAL",
  does: "Starts a direct upload of a profile photo or cover, as the profile screen does.",
  input: Request,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    images(ports).requestUpload({
      actor: context.actor,
      subject: input.subject,
      kind: input.kind,
      request: input.input,
    }),
  targets: () => [],
  card: () => ({ summary: "Upload a photo", preview: "" }),
  done: () => "Ready for the photo.",
  http: {
    method: "POST",
    path: `${subjectPath}/:kind${PROFILE_IMAGE_UPLOADS_SEGMENT}`,
    fromRequest: (params, body) => ({
      subject: subjectFrom(params),
      kind: params["kind"],
      input: body,
    }),
    status: 201,
    respond: (out) => ProfileImageUploadDtoSchema.parse(out),
  },
  qCapability: OFFER,
});

const Complete = z.object({ uploadId: UuidSchema }).strict();

const COMPLETE = defineAppAction<
  z.infer<typeof Complete>,
  Awaited<ReturnType<ProfileImageService["completeUpload"]>>
>({
  name: "profile_image.upload.complete",
  short: "finish a photo upload",
  area: "profile-images",
  classification: "CONSEQUENTIAL",
  does: "Finishes a profile photo or cover upload; a repeat answers with the current images.",
  input: Complete,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    images(ports).completeUpload({
      actor: context.actor,
      uploadId: input.uploadId,
      correlationId: context.correlationId,
    }),
  targets: () => [],
  card: () => ({ summary: "Finish the photo", preview: "" }),
  done: () => "Done.",
  http: {
    method: "POST",
    path: `${PROFILE_IMAGES_PATH}${PROFILE_IMAGE_UPLOADS_SEGMENT}/:uploadId${PROFILE_IMAGE_COMPLETE_SEGMENT}`,
    fromRequest: (params) => ({ uploadId: params["uploadId"] }),
    respond: (out) => ProfileImagesDtoSchema.parse(out),
  },
  qCapability: OFFER,
});

const Remove = z
  .object({ subject: Subject, kind: ProfileImageKindSchema })
  .strict();

const REMOVE = defineAppAction<
  z.infer<typeof Remove>,
  Awaited<ReturnType<ProfileImageService["remove"]>>
>({
  name: "profile_image.remove",
  short: "remove a profile photo",
  area: "profile-images",
  classification: "CONSEQUENTIAL",
  does: "Removes a profile photo or cover, as the profile screen does.",
  input: Remove,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    images(ports).remove({
      actor: context.actor,
      subject: input.subject,
      kind: input.kind,
      correlationId: context.correlationId,
    }),
  targets: () => [],
  card: () => ({ summary: "Remove this photo", preview: "" }),
  done: () => "Removed.",
  http: {
    method: "DELETE",
    path: `${subjectPath}/:kind`,
    fromRequest: (params) => ({
      subject: subjectFrom(params),
      kind: params["kind"],
    }),
    respond: (out) => ProfileImagesDtoSchema.parse(out),
  },
  qCapability: OFFER,
});

export const PROFILE_IMAGE_ACTIONS: readonly AnyAppAction[] = [
  REQUEST,
  COMPLETE,
  REMOVE,
];
