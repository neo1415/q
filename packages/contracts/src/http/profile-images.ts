import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Profile photos and covers (founder directive 2026-09-28, item 15).
 *
 * A person, a company or an investor organisation may carry one round
 * photo (1:1) and one cover banner (4:1). The bytes travel browser ->
 * storage directly on a single-object signed upload; the API never
 * proxies them, and neither does the web app. On completion the server
 * re-encodes the upload (metadata stripped, orientation applied, fixed
 * dimensions) and only then does it become the current image. Replacing
 * or removing keeps the earlier rows as history.
 *
 * Reads are short-lived signed URLs, never a public bucket: a provider
 * object key is not access control. Who may read follows the subject's
 * profile: a person's own images go to that person; an organisation's to
 * its members, and onto its Q Card only through the card's own field
 * scopes (`photo`, `cover`).
 */

export const PROFILE_IMAGE_SUBJECT_TYPES = [
  "PERSON",
  "COMPANY",
  "INVESTOR_ORGANISATION",
] as const;
export const ProfileImageSubjectTypeSchema = z.enum(
  PROFILE_IMAGE_SUBJECT_TYPES,
);
export type ProfileImageSubjectType = z.infer<
  typeof ProfileImageSubjectTypeSchema
>;

export const PROFILE_IMAGE_KINDS = ["AVATAR", "COVER"] as const;
export const ProfileImageKindSchema = z.enum(PROFILE_IMAGE_KINDS);
export type ProfileImageKind = z.infer<typeof ProfileImageKindSchema>;

/** Raster formats only: never SVG (script), never HEIC (no browser decode). */
export const PROFILE_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const ProfileImageContentTypeSchema = z.enum(
  PROFILE_IMAGE_CONTENT_TYPES,
);

/** The upload ceiling; the browser's cropped export is far below it. */
export const PROFILE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** The stored rendition, fixed per kind: width x height in pixels. */
export const PROFILE_IMAGE_DIMENSIONS = {
  AVATAR: { width: 512, height: 512 },
  COVER: { width: 1584, height: 396 },
} as const satisfies Record<
  ProfileImageKind,
  { readonly width: number; readonly height: number }
>;

export const PROFILE_IMAGES_PATH = "/v1/profile-images" as const;
/** `POST /v1/profile-images/:subjectType/:subjectId/:kind/uploads` */
export const PROFILE_IMAGE_UPLOADS_SEGMENT = "/uploads" as const;
/** `POST /v1/profile-images/uploads/:uploadId/complete` */
export const PROFILE_IMAGE_COMPLETE_SEGMENT = "/complete" as const;

export const CreateProfileImageUploadRequestSchema = z
  .object({
    contentType: ProfileImageContentTypeSchema,
    byteSize: z.number().int().min(1).max(PROFILE_IMAGE_MAX_BYTES),
  })
  .strict();
export type CreateProfileImageUploadRequest = z.infer<
  typeof CreateProfileImageUploadRequestSchema
>;

export const ProfileImageUploadDtoSchema = z
  .object({
    uploadId: UuidSchema,
    /** One object, one method, a short life; the browser sends the bytes here. */
    upload: z
      .object({
        method: z.literal("PUT"),
        url: z.string().url().max(4096),
        headers: z.record(z.string(), z.string()),
      })
      .strict(),
    expiresAt: UtcTimestampSchema,
  })
  .strict();
export type ProfileImageUploadDto = z.infer<typeof ProfileImageUploadDtoSchema>;

export const ProfileImageDtoSchema = z
  .object({
    kind: ProfileImageKindSchema,
    /** A signed, short-lived read URL (never the object key). */
    url: z.string().url().max(4096),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type ProfileImageDto = z.infer<typeof ProfileImageDtoSchema>;

export const ProfileImagesDtoSchema = z
  .object({
    subjectType: ProfileImageSubjectTypeSchema,
    subjectId: UuidSchema,
    /** Null: no image yet (or removed). Unknown is not a placeholder. */
    avatar: ProfileImageDtoSchema.nullable(),
    cover: ProfileImageDtoSchema.nullable(),
  })
  .strict();
export type ProfileImagesDto = z.infer<typeof ProfileImagesDtoSchema>;
