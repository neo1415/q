import {
  ClaimableCompanyListDtoSchema,
  COMPANY_CLAIMABLE_PATH,
  COMPANY_CLAIM_REQUESTS_PATH,
  CompanyClaimResultDtoSchema,
  FounderApplicationListDtoSchema,
  GATEQ_INBOX_ARCHIVE_PATH,
  GATEQ_INBOX_ASSIGN_PATH,
  GATEQ_INBOX_ITEM_PATH,
  GATEQ_INBOX_LABEL_PATH,
  GATEQ_INBOX_NOTES_PATH,
  GATEQ_INBOX_PACK_PATH,
  GATEQ_INBOX_PASS_PATH,
  GATEQ_INBOX_PATH,
  GATEQ_INBOX_REPLY_PATH,
  GATEQ_INBOX_SETTINGS_PATH,
  GATEQ_INBOX_STAR_PATH,
  GATEQ_MY_APPLICATIONS_PATH,
  GATEQ_STARTUP_ALERTS_PATH,
  GateqInboxChangedDtoSchema,
  GateqInboxDetailDtoSchema,
  GateqInboxDtoSchema,
  gateqInboxPath,
  StartupAlertDtoSchema,
  type CompanyClaimRequest,
  type GateqInboxArchiveRequest,
  type GateqInboxAssignRequest,
  type GateqInboxLabelRequest,
  type GateqInboxNoteRequest,
  type GateqInboxPassRequest,
  type GateqInboxReplyRequest,
  type GateqInboxSettingsRequest,
  type GateqInboxStarRequest,
  type GateqInboxView,
  type StartupAlertRequest,
} from "@capital-q/contracts";

import { ApiProblemError } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** F4: one view of the organisation's GateQ inbox. */
export function getGateqInbox(
  session: ApiSession,
  gatewayId: string,
  view: GateqInboxView,
) {
  return call(
    session,
    "GET",
    `${gateqInboxPath(GATEQ_INBOX_PATH, { gatewayId })}?view=${encodeURIComponent(view)}`,
    GateqInboxDtoSchema,
  );
}

export function getGateqInboxItem(
  session: ApiSession,
  gatewayId: string,
  applicationId: string,
) {
  return call(
    session,
    "GET",
    gateqInboxPath(GATEQ_INBOX_ITEM_PATH, { gatewayId, applicationId }),
    GateqInboxDetailDtoSchema,
  );
}

/** The download pack's bytes and name; the caller streams them to the person. */
export async function downloadGateqPack(
  session: ApiSession,
  gatewayId: string,
  applicationId: string,
): Promise<{ readonly fileName: string; readonly bytes: ArrayBuffer }> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${gateqInboxPath(GATEQ_INBOX_PACK_PATH, { gatewayId, applicationId })}`,
    {
      method: "GET",
      headers: {
        accept: "application/zip",
        authorization: `Bearer ${session.accessToken}`,
        ...(session.organisationId === undefined
          ? {}
          : { "x-organisation-id": session.organisationId }),
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new ApiProblemError(
      "The pack is not available.",
      response.status,
      "NOT_FOUND",
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName =
    /filename="([^"]+)"/.exec(disposition)?.[1] ?? "gateq-pack.zip";
  return { fileName, bytes: await response.arrayBuffer() };
}

const changed = (
  session: ApiSession,
  method: "POST" | "PUT",
  path: string,
  body: unknown,
) => call(session, method, path, GateqInboxChangedDtoSchema, { body });

export const starGateqApplications = (
  session: ApiSession,
  gatewayId: string,
  input: GateqInboxStarRequest,
) =>
  changed(
    session,
    "POST",
    gateqInboxPath(GATEQ_INBOX_STAR_PATH, { gatewayId }),
    input,
  );
export const archiveGateqApplications = (
  session: ApiSession,
  gatewayId: string,
  input: GateqInboxArchiveRequest,
) =>
  changed(
    session,
    "POST",
    gateqInboxPath(GATEQ_INBOX_ARCHIVE_PATH, { gatewayId }),
    input,
  );
export const labelGateqApplications = (
  session: ApiSession,
  gatewayId: string,
  input: GateqInboxLabelRequest,
) =>
  changed(
    session,
    "POST",
    gateqInboxPath(GATEQ_INBOX_LABEL_PATH, { gatewayId }),
    input,
  );
export const assignGateqApplications = (
  session: ApiSession,
  gatewayId: string,
  input: GateqInboxAssignRequest,
) =>
  changed(
    session,
    "POST",
    gateqInboxPath(GATEQ_INBOX_ASSIGN_PATH, { gatewayId }),
    input,
  );
export const noteGateqApplication = (
  session: ApiSession,
  gatewayId: string,
  applicationId: string,
  input: GateqInboxNoteRequest,
) =>
  changed(
    session,
    "POST",
    gateqInboxPath(GATEQ_INBOX_NOTES_PATH, { gatewayId, applicationId }),
    input,
  );
export const passGateqApplication = (
  session: ApiSession,
  gatewayId: string,
  applicationId: string,
  input: GateqInboxPassRequest,
) =>
  changed(
    session,
    "POST",
    gateqInboxPath(GATEQ_INBOX_PASS_PATH, { gatewayId, applicationId }),
    input,
  );
export const replyGateqApplication = (
  session: ApiSession,
  gatewayId: string,
  applicationId: string,
  input: GateqInboxReplyRequest,
) =>
  changed(
    session,
    "POST",
    gateqInboxPath(GATEQ_INBOX_REPLY_PATH, { gatewayId, applicationId }),
    input,
  );
export const setGateqReplyPromise = (
  session: ApiSession,
  gatewayId: string,
  input: GateqInboxSettingsRequest,
) =>
  changed(
    session,
    "PUT",
    gateqInboxPath(GATEQ_INBOX_SETTINGS_PATH, { gatewayId }),
    input,
  );

/** F2: the signed-in founder's own applications. */
export function listMyGateqApplications(session: ApiSession) {
  return call(
    session,
    "GET",
    GATEQ_MY_APPLICATIONS_PATH,
    FounderApplicationListDtoSchema,
  );
}

/** F3: companies a founder may find and claim. */
export function listClaimableCompanies(session: ApiSession, text: string) {
  return call(
    session,
    "GET",
    `${COMPANY_CLAIMABLE_PATH}?q=${encodeURIComponent(text.slice(0, 120))}`,
    ClaimableCompanyListDtoSchema,
  );
}

export function requestCompanyClaim(
  session: ApiSession,
  companyId: string,
  input: CompanyClaimRequest,
) {
  return call(
    session,
    "POST",
    COMPANY_CLAIM_REQUESTS_PATH.replace(
      ":companyId",
      encodeURIComponent(companyId),
    ),
    CompanyClaimResultDtoSchema,
    { body: input },
  );
}

export function saveStartupAlert(
  session: ApiSession,
  input: StartupAlertRequest,
) {
  return call(
    session,
    "POST",
    GATEQ_STARTUP_ALERTS_PATH,
    StartupAlertDtoSchema,
    { body: input },
  );
}
