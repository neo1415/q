import {
  AudiencePreviewDtoSchema,
  COMPANY_AUDIENCE_PREVIEW_PATH,
  COMPANY_SHARE_REVOKE_PATH,
  COMPANY_SHARES_PATH,
  COMPANY_VISIBILITY_STATE_PATH,
  IDEMPOTENCY_KEY_HEADER,
  VisibilityRevokeResultDtoSchema,
  VisibilityShareResultDtoSchema,
  VisibilityStateDtoSchema,
  type VisibilityAudience,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** The visibility control centre (CQ-BIZ-003), keyed by the person's own company. */

function companyPath(template: string, companyId: string): string {
  return template.replace(":companyId", encodeURIComponent(companyId));
}

/** `GET …/visibility/state` — objects, scopes, active shares, shareable relationships. */
export function getVisibilityState(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    companyPath(COMPANY_VISIBILITY_STATE_PATH, companyId),
    VisibilityStateDtoSchema,
  );
}

/** `GET …/visibility/preview` — the company as one audience sees it. */
export function getAudiencePreview(
  session: ApiSession,
  companyId: string,
  audience: VisibilityAudience,
  relationshipId?: string,
) {
  const query = new URLSearchParams({ audience });
  if (relationshipId !== undefined) query.set("relationshipId", relationshipId);
  return call(
    session,
    "GET",
    `${companyPath(COMPANY_AUDIENCE_PREVIEW_PATH, companyId)}?${query.toString()}`,
    AudiencePreviewDtoSchema,
  );
}

/** `POST …/visibility/shares` — share the current raise with one relationship. */
export function shareWithRelationship(
  session: ApiSession,
  companyId: string,
  relationshipId: string,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    companyPath(COMPANY_SHARES_PATH, companyId),
    VisibilityShareResultDtoSchema,
    {
      body: { object: "CAPITAL_OBJECTIVE", relationshipId },
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** `POST …/visibility/shares/:policyId/revoke` — future access removed. */
export function revokeVisibilityShare(
  session: ApiSession,
  companyId: string,
  policyId: string,
) {
  return call(
    session,
    "POST",
    companyPath(COMPANY_SHARE_REVOKE_PATH, companyId).replace(
      ":policyId",
      encodeURIComponent(policyId),
    ),
    VisibilityRevokeResultDtoSchema,
    { body: {} },
  );
}
