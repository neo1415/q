import {
  PROFILE_IMAGE_COMPLETE_SEGMENT,
  PROFILE_IMAGE_UPLOADS_SEGMENT,
  PROFILE_IMAGES_PATH,
  ProfileImagesDtoSchema,
  ProfileImageUploadDtoSchema,
  type CreateProfileImageUploadRequest,
  type ProfileImageKind,
  type ProfileImageSubjectType,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Profile photos and covers: signed URLs out, bytes never through here. */

function subjectPath(
  subjectType: ProfileImageSubjectType,
  subjectId: string,
): string {
  return `${PROFILE_IMAGES_PATH}/${subjectType}/${encodeURIComponent(subjectId)}`;
}

export function getProfileImages(
  session: ApiSession,
  subjectType: ProfileImageSubjectType,
  subjectId: string,
) {
  return call(
    session,
    "GET",
    subjectPath(subjectType, subjectId),
    ProfileImagesDtoSchema,
  );
}

/** One signed single-object upload; the browser sends the bytes there. */
export function createProfileImageUpload(
  session: ApiSession,
  subjectType: ProfileImageSubjectType,
  subjectId: string,
  kind: ProfileImageKind,
  input: CreateProfileImageUploadRequest,
) {
  return call(
    session,
    "POST",
    `${subjectPath(subjectType, subjectId)}/${kind}${PROFILE_IMAGE_UPLOADS_SEGMENT}`,
    ProfileImageUploadDtoSchema,
    { body: input },
  );
}

export function completeProfileImageUpload(
  session: ApiSession,
  uploadId: string,
) {
  return call(
    session,
    "POST",
    `${PROFILE_IMAGES_PATH}${PROFILE_IMAGE_UPLOADS_SEGMENT}/${encodeURIComponent(uploadId)}${PROFILE_IMAGE_COMPLETE_SEGMENT}`,
    ProfileImagesDtoSchema,
    { body: {} },
  );
}

export function removeProfileImage(
  session: ApiSession,
  subjectType: ProfileImageSubjectType,
  subjectId: string,
  kind: ProfileImageKind,
) {
  return call(
    session,
    "DELETE",
    `${subjectPath(subjectType, subjectId)}/${kind}`,
    ProfileImagesDtoSchema,
  );
}
