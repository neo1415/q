"use server";

import { z } from "zod";

import {
  ApiProblemError,
  completeProfileImageUpload,
  createProfileImageUpload,
  removeProfileImage,
} from "@capital-q/api-client";
import {
  CreateProfileImageUploadRequestSchema,
  ProfileImageKindSchema,
  ProfileImageSubjectTypeSchema,
  type ProfileImagesDto,
  type ProfileImageUploadDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Profile photos and covers from the page, server side. These actions only
 * exchange small JSON with the API: a signed upload is minted here and the
 * browser then PUTs the cropped image straight to storage -- the bytes never
 * pass through Next.js. The API decides who may change which image; the ids
 * are input, never proof.
 */

export type ImageActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Subject = z.object({
  subjectType: ProfileImageSubjectTypeSchema,
  subjectId: z.string().uuid(),
});

function translate(error: unknown): { ok: false; message: string } {
  if (error instanceof ApiProblemError) {
    if (error.status === 401) {
      return { ok: false, message: "Your session ended. Sign in again." };
    }
    if (error.status === 403) {
      return {
        ok: false,
        message:
          "Only someone who can edit this profile can change its photos.",
      };
    }
    if (error.status === 404) {
      return { ok: false, message: "This profile isn't available to you." };
    }
    if (error.status === 422 || error.status === 400 || error.status === 429) {
      return {
        ok: false,
        message: error.problem?.detail ?? "That image couldn't be used.",
      };
    }
    if (error.status === 503 || error.status === 502) {
      return {
        ok: false,
        message: "Photo storage isn't available just now. Try again shortly.",
      };
    }
  }
  return {
    ok: false,
    message: "Capital Q couldn't save that photo just now. Try again.",
  };
}

export async function requestProfileImageUploadAction(
  rawSubject: unknown,
  rawKind: unknown,
  rawRequest: unknown,
): Promise<ImageActionResult<ProfileImageUploadDto>> {
  const subject = Subject.safeParse(rawSubject);
  const kind = ProfileImageKindSchema.safeParse(rawKind);
  const request = CreateProfileImageUploadRequestSchema.safeParse(rawRequest);
  if (!subject.success || !kind.success) {
    return { ok: false, message: "That photo can't be changed here." };
  }
  if (!request.success) {
    return {
      ok: false,
      message: "Choose a JPEG, PNG or WebP image under 8 MB.",
    };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Your session ended. Sign in again." };
  }
  try {
    return {
      ok: true,
      value: await createProfileImageUpload(
        session,
        subject.data.subjectType,
        subject.data.subjectId,
        kind.data,
        request.data,
      ),
    };
  } catch (error) {
    return translate(error);
  }
}

export async function completeProfileImageUploadAction(
  rawUploadId: unknown,
): Promise<ImageActionResult<ProfileImagesDto>> {
  const uploadId = z.string().uuid().safeParse(rawUploadId);
  if (!uploadId.success) {
    return { ok: false, message: "That upload isn't available." };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Your session ended. Sign in again." };
  }
  try {
    return {
      ok: true,
      value: await completeProfileImageUpload(session, uploadId.data),
    };
  } catch (error) {
    return translate(error);
  }
}

export async function removeProfileImageAction(
  rawSubject: unknown,
  rawKind: unknown,
): Promise<ImageActionResult<ProfileImagesDto>> {
  const subject = Subject.safeParse(rawSubject);
  const kind = ProfileImageKindSchema.safeParse(rawKind);
  if (!subject.success || !kind.success) {
    return { ok: false, message: "That photo can't be changed here." };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Your session ended. Sign in again." };
  }
  try {
    return {
      ok: true,
      value: await removeProfileImage(
        session,
        subject.data.subjectType,
        subject.data.subjectId,
        kind.data,
      ),
    };
  } catch (error) {
    return translate(error);
  }
}
