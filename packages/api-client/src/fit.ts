import {
  FIT_COMPANIES_PATH,
  FIT_COMPANY_PATH,
  FIT_Q_VIEW_PATH,
  FIT_TOP_PATH,
  FitComparisonDtoSchema,
  FitProfileDtoSchema,
  FitProfileListDtoSchema,
  QViewDtoSchema,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * Fit with the reader's own mandate (ADR 0052), served by the Q API. Ids
 * are input, never proof: the server answers only for companies this
 * reader may see, against their own mandate.
 */

export function getFitProfiles(
  session: ApiSession,
  companyIds: readonly string[],
) {
  const ids = encodeURIComponent(companyIds.join(","));
  return call(
    session,
    "GET",
    `${FIT_COMPANIES_PATH}?ids=${ids}`,
    FitProfileListDtoSchema,
  );
}

export function getFitProfile(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    FIT_COMPANY_PATH.replace(":companyId", encodeURIComponent(companyId)),
    FitProfileDtoSchema,
  );
}

/** Q's view beside the fit; asked after the fit has rendered. */
export function getFitQView(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    FIT_Q_VIEW_PATH.replace(":companyId", encodeURIComponent(companyId)),
    QViewDtoSchema,
  );
}

export function getFitTop(session: ApiSession, limit = 3) {
  return call(
    session,
    "GET",
    `${FIT_TOP_PATH}?limit=${String(limit)}`,
    FitComparisonDtoSchema,
  );
}
