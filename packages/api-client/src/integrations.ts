import {
  EmailDraftDtoSchema,
  GOOGLE_CONNECT_PATH,
  GOOGLE_INTEGRATION_PATH,
  GOOGLE_RELATIONSHIP_MAIL_PATH,
  GoogleConnectionDtoSchema,
  INBOUND_EMAIL_ADDRESS_PATH,
  INBOUND_EMAIL_ROTATE_PATH,
  InboundEmailAddressDtoSchema,
  Q_APPROVAL_EMAIL_DRAFT_SUFFIX,
  Q_APPROVALS_PATH,
  QApprovalViewSchema,
  RelationshipMailListSchema,
  StartGoogleConnectResponseSchema,
  type ReviseEmailDraftRequest,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** A person's own connected Gmail (BIZ-007). No call carries a token. */

export function getGoogleConnection(session: ApiSession) {
  return call(
    session,
    "GET",
    GOOGLE_INTEGRATION_PATH,
    GoogleConnectionDtoSchema,
  );
}

export function startGoogleConnect(session: ApiSession, returnTo?: string) {
  return call(
    session,
    "POST",
    GOOGLE_CONNECT_PATH,
    StartGoogleConnectResponseSchema,
    {
      body: returnTo === undefined ? {} : { returnTo },
    },
  );
}

/** `DELETE /v1/integrations/google` — revoke and forget; 204. */
export async function disconnectGoogle(session: ApiSession): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${GOOGLE_INTEGRATION_PATH}`,
    {
      method: "DELETE",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await readProblemResponse(response);
  }
}

export function listRelationshipMail(
  session: ApiSession,
  relationshipId: string,
) {
  return call(
    session,
    "GET",
    GOOGLE_RELATIONSHIP_MAIL_PATH.replace(
      ":relationshipId",
      encodeURIComponent(relationshipId),
    ),
    RelationshipMailListSchema,
  );
}

const draftPath = (approvalId: string) =>
  `${Q_APPROVALS_PATH}/${encodeURIComponent(approvalId)}${Q_APPROVAL_EMAIL_DRAFT_SUFFIX}`;

/** Q API: the email behind an `email.send` approval, for its approver. */
export function getEmailDraft(session: ApiSession, approvalId: string) {
  return call(session, "GET", draftPath(approvalId), EmailDraftDtoSchema);
}

/** Q API: the person's edit; the old approval is void, a new one is returned. */
export function reviseEmailDraft(
  session: ApiSession,
  approvalId: string,
  input: ReviseEmailDraftRequest,
) {
  return call(session, "POST", draftPath(approvalId), QApprovalViewSchema, {
    body: input,
  });
}

/** The person's own Q email address (inbound email), issued on first read. */
export function getInboundEmailAddress(session: ApiSession) {
  return call(
    session,
    "GET",
    INBOUND_EMAIL_ADDRESS_PATH,
    InboundEmailAddressDtoSchema,
  );
}

/**
 * A new Q email address. Names the address being replaced, so a retried
 * request answers with the new one instead of rotating twice.
 */
export function rotateInboundEmailAddress(
  session: ApiSession,
  currentAddress: string,
) {
  return call(
    session,
    "POST",
    INBOUND_EMAIL_ROTATE_PATH,
    InboundEmailAddressDtoSchema,
    { body: { currentAddress } },
  );
}
