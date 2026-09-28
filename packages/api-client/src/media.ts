import {
  CancelMediaUploadResponseSchema,
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  CompanyMediaListResponseSchema,
  CompanyPitchResponseSchema,
  CreateCompanyPitchResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  MEDIA_DETAILS_SUFFIX,
  MEDIA_PLAYBACK_POLICY_SUFFIX,
  MEDIA_PLAYBACK_SUFFIX,
  MEDIA_SYNC_SUFFIX,
  MEDIA_UPLOAD_CANCEL_SUFFIX,
  MEDIA_UPLOAD_SESSION_SUFFIX,
  MediaUploadSessionDtoSchema,
  PlaybackAuthorizationDtoSchema,
  SetPitchDetailsResponseSchema,
  SetPitchPlaybackPolicyResponseSchema,
  SyncMediaAssetResponseSchema,
  type CreateCompanyPitchRequest,
  type CreateMediaUploadSessionRequest,
  type SetPitchDetailsRequest,
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
 *
 * `idempotencyKey` is required by the server for a replacement and honoured
 * for a creation: the same key again returns the asset it created.
 */
export function createPitchMediaAsset(
  session: ApiSession,
  companyId: string,
  request: CreateCompanyPitchRequest = {},
  idempotencyKey?: string,
) {
  return call(
    session,
    "POST",
    pitchPath(companyId),
    CreateCompanyPitchResponseSchema,
    {
      body: request,
      ...(idempotencyKey === undefined
        ? {}
        : { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } }),
    },
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
 * `POST …/pitch/:mediaAssetId/upload-session` — reserve an upload target
 * for a CREATED pitch. The browser then sends the file to `uploadUrl`
 * directly, in the answer's `uploadMode`; the server's
 * `maxDurationSeconds` is a reservation the client may not exceed.
 *
 * Without `uploadLengthBytes` the target is one-shot and issued once. With
 * it the target may be resumable, and `idempotencyKey` is required: the
 * same key and length again return the same open target, so a lost answer
 * or a reload resumes rather than replaces.
 */
export function createPitchUploadSession(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
  request: CreateMediaUploadSessionRequest,
  idempotencyKey?: string,
) {
  return call(
    session,
    "POST",
    `${assetPath(companyId, mediaAssetId)}${MEDIA_UPLOAD_SESSION_SUFFIX}`,
    MediaUploadSessionDtoSchema,
    {
      body: request,
      ...(idempotencyKey === undefined
        ? {}
        : { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } }),
    },
  );
}

/**
 * `POST …/pitch/:mediaAssetId/upload-session/cancel` — stop an unfinished
 * upload. The pitch ends UPLOAD_FAILED and the provider's target is
 * released; repeating it is harmless.
 */
export function cancelPitchUpload(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
) {
  return call(
    session,
    "POST",
    `${assetPath(companyId, mediaAssetId)}${MEDIA_UPLOAD_CANCEL_SUFFIX}`,
    CancelMediaUploadResponseSchema,
    { body: {} },
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

/** `POST …/pitch/:mediaAssetId/details` — the owner's title and audience (ADR 0021/0022). */
export function setPitchDetails(
  session: ApiSession,
  companyId: string,
  mediaAssetId: string,
  request: SetPitchDetailsRequest,
) {
  return call(
    session,
    "POST",
    `${assetPath(companyId, mediaAssetId)}${MEDIA_DETAILS_SUFFIX}`,
    SetPitchDetailsResponseSchema,
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
