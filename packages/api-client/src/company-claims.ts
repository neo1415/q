import {
  ADMIN_COMPANY_CLAIM_DECISION_PATH,
  ADMIN_COMPANY_CLAIMS_PATH,
  ADMIN_COMPANY_PUBLISH_PATH,
  AdminCompanyPublishResultDtoSchema,
  COMPANY_CLAIM_CONFIRM_PATH,
  COMPANY_CLAIM_DECISION_PATH,
  COMPANY_CLAIM_REQUESTS_PATH,
  ClaimDecisionResultDtoSchema,
  ConfirmClaimCodeResultDtoSchema,
  PendingClaimListDtoSchema,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * P14: finishing a company claim. The requester confirms their work-email
 * code; a company's admins (or, for a company nobody holds, a platform
 * admin) decide; a platform admin may make an unclaimed company public.
 */
const fill = (path: string, values: Readonly<Record<string, string>>) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.replace(`:${key}`, encodeURIComponent(value)),
    path,
  );

export const confirmClaimCode = (
  session: ApiSession,
  companyId: string,
  code: string,
) =>
  call(
    session,
    "POST",
    fill(COMPANY_CLAIM_CONFIRM_PATH, { companyId }),
    ConfirmClaimCodeResultDtoSchema,
    { body: { code } },
  );

export const listCompanyClaims = (session: ApiSession, companyId: string) =>
  call(
    session,
    "GET",
    fill(COMPANY_CLAIM_REQUESTS_PATH, { companyId }),
    PendingClaimListDtoSchema,
  );

export const decideCompanyClaim = (
  session: ApiSession,
  companyId: string,
  requestId: string,
  approve: boolean,
) =>
  call(
    session,
    "POST",
    fill(COMPANY_CLAIM_DECISION_PATH, { companyId, requestId }),
    ClaimDecisionResultDtoSchema,
    { body: { approve } },
  );

export const listAdminCompanyClaims = (session: ApiSession) =>
  call(session, "GET", ADMIN_COMPANY_CLAIMS_PATH, PendingClaimListDtoSchema);

export const decideAdminCompanyClaim = (
  session: ApiSession,
  requestId: string,
  input: { readonly approve: boolean; readonly reason: string },
) =>
  call(
    session,
    "POST",
    fill(ADMIN_COMPANY_CLAIM_DECISION_PATH, { requestId }),
    ClaimDecisionResultDtoSchema,
    { body: input },
  );

export const publishCompanyAsAdmin = (
  session: ApiSession,
  companyId: string,
  input: { readonly publicExternal: boolean; readonly reason: string },
) =>
  call(
    session,
    "POST",
    fill(ADMIN_COMPANY_PUBLISH_PATH, { companyId }),
    AdminCompanyPublishResultDtoSchema,
    { body: input },
  );
