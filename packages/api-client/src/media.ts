import {
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  CompanyMediaListResponseSchema,
  CompanyPitchResponseSchema,
  CreateCompanyPitchResponseSchema,
  type CreateCompanyPitchRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * A company's pitch media record.
 *
 * There is deliberately no `uploadPitch` here. Nothing in this client can
 * upload a video: the provider integration arrives in a later packet, and a
 * method that looked like it uploaded would be a lie a caller could not see
 * through. What these do is create, read and remove the *record* of a pitch.
 */

const pitchPath = (companyId: string) =>
  `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_PITCH_SUFFIX}`;

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
    `${pitchPath(companyId)}/${encodeURIComponent(mediaAssetId)}`,
    CompanyPitchResponseSchema,
  );
}
