import {
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  CompanyMediaListResponseSchema,
  CompanyPitchResponseSchema,
  CreateCompanyPitchResponseSchema,
  MEDIA_PLAYBACK_POLICY_SUFFIX,
  MEDIA_PLAYBACK_SUFFIX,
  MEDIA_SYNC_SUFFIX,
  MEDIA_UPLOAD_SESSION_SUFFIX,
  MediaUploadSessionDtoSchema,
  PlaybackAuthorizationDtoSchema,
  SetPitchPlaybackPolicyResponseSchema,
  SyncMediaAssetResponseSchema,
  type CreateCompanyPitchRequest,
  type CreateMediaUploadSessionRequest,
  type SetPitchPlaybackPolicyRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * A company's pitch media record, and the direct upload flow around it
 * (CQ-MEDIA-011).
 *
 * There is still no `uploadPitch` here, and there never will be: the bytes
 * go from the browser to the provider's one-time target, never through the
 * API and never through this client. What this client does is reserve that
 * target, ask the server to look at where the bytes stand, and ask for a
 * viewer's short-lived permission to play. Each answer is a contract DTO
 * that carries no provider identifier.
 */

const pitchPath = (companyId: string) =>
  `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_PITCH_SUFFIX}`;

const assetPath = (companyId: string, mediaAssetId: string) =>
  `${pitchPath(companyId)}/${encodeURIComponent(mediaAssetId)}`;

/**
 * `POST /v1/companies/:companyId/pitch` — create the company's pitch media
 * asset, or replace the current one by naming it. The asset comes back in
 * state CREATED: it is a record, not a video.
 */
export function createPitchMediaAsset(
  session: ApiSession,
  companyId: string,
  request: CreateCompanyPitchRequest = {},
) {
  return call(
    session,
    "POST",
    pitchPath(companyId),
    CreateCompanyPitchResponseSchema,
    { body: request },
  );
}

/** `GET /v1/companies/:companyId/pitch` — the current pitch, or null. */
export function getCompanyPitch(session: ApiSession, companyId: string) {
  return call(session, "GET", pitchPath(companyId), CompanyPitchResponseSchema);
}

/** `GET /v1/companies/:companyId/media` — the company's media history. */
export function listCompanyMedia(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}/media`,
    CompanyMediaListResponseSchema,
  );
}

/**
 * `DELETE /v1/companies/:companyId/pitch/:mediaAssetId` — remove the pitch
 * from the product. The record is kept and marked deleted; history is not
 * erased.
 */
export function deletePitchMediaAsset(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
) {
  return call(
    session,
    "DELETE",
    assetPath(companyId, mediaAssetId),
    CompanyPitchResponseSchema,
  );
}

/**
 * `POST …/pitch/:mediaAssetId/upload-session` — reserve a one-time upload
 * target for a CREATED pitch. The browser then PUTs the file to
 * `uploadUrl` directly; the server's `maxDurationSeconds` is a reservation
 * the client may not exceed. The target is issued once: a lost URL means
 * replacing the pitch, not asking again.
 */
export function createPitchUploadSession(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
  request: CreateMediaUploadSessionRequest,
) {
  return call(
    session,
    "POST",
    `${assetPath(companyId, mediaAssetId)}${MEDIA_UPLOAD_SESSION_SUFFIX}`,
    MediaUploadSessionDtoSchema,
    { body: request },
  );
}

/**
 * `POST …/pitch/:mediaAssetId/sync` — ask the server to look at the
 * provider and move the lifecycle to match. Idempotent; poll it after the
 * upload finishes until the pitch is READY or has failed.
 */
export function syncPitch(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
) {
  return call(
    session,
    "POST",
    `${assetPath(companyId, mediaAssetId)}${MEDIA_SYNC_SUFFIX}`,
    SyncMediaAssetResponseSchema,
    { body: {} },
  );
}

/**
 * `POST …/pitch/:mediaAssetId/playback-policy` — the founder's decision on
 * whether investors may be granted playback (CQ-MEDIA-013). Reversible,
 * and versioned so a stale screen never decides.
 */
export function setPitchPlaybackPolicy(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
  request: SetPitchPlaybackPolicyRequest,
) {
  return call(
    session,
    "POST",
    `${assetPath(companyId, mediaAssetId)}${MEDIA_PLAYBACK_POLICY_SUFFIX}`,
    SetPitchPlaybackPolicyResponseSchema,
    { body: request },
  );
}

/**
 * `POST …/pitch/:mediaAssetId/playback` — a short-lived, per-viewer
 * permission to play. Refused as not-found for anyone the server does not
 * admit; the URL it mints is the only playback material a client holds.
 */
export function authorisePitchPlayback(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
) {
  return call(
    session,
    "POST",
    `${assetPath(companyId, mediaAssetId)}${MEDIA_PLAYBACK_SUFFIX}`,
    PlaybackAuthorizationDtoSchema,
    { body: {} },
  );
}
