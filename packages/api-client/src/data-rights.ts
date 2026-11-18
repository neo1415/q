import {
  ACCOUNT_DELETION_CANCEL_PATH,
  ACCOUNT_DELETION_PATH,
  AccountDeletionScheduledDtoSchema,
  DATA_EXPORT_LINK_PATH,
  DATA_EXPORTS_PATH,
  DATA_RIGHTS_PATH,
  DataExportLinkDtoSchema,
  DataExportRequestedDtoSchema,
  DataRightsDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  type AccountDeletionRequest,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** "Your data" (decision 107): status of downloads and any deletion. An API session. */
export function getDataRights(session: ApiSession) {
  return call(session, "GET", DATA_RIGHTS_PATH, DataRightsDtoSchema);
}

/** Asks for a download of the caller's data; the same key answers the same request. */
export function requestDataExport(session: ApiSession, idempotencyKey: string) {
  return call(
    session,
    "POST",
    DATA_EXPORTS_PATH,
    DataExportRequestedDtoSchema,
    {
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** A five-minute link to the caller's own ready download. */
export function createDataExportLink(session: ApiSession, exportId: string) {
  return call(
    session,
    "POST",
    DATA_EXPORT_LINK_PATH.replace(":exportId", encodeURIComponent(exportId)),
    DataExportLinkDtoSchema,
  );
}

/** Schedules the caller's account deletion (fresh re-authentication required). */
export function requestAccountDeletion(
  session: ApiSession,
  request: AccountDeletionRequest,
) {
  return call(
    session,
    "POST",
    ACCOUNT_DELETION_PATH,
    AccountDeletionScheduledDtoSchema,
    {
      body: request,
    },
  );
}

/** `204`: cancels a scheduled deletion during its grace period. */
export async function cancelAccountDeletion(
  session: ApiSession,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${ACCOUNT_DELETION_CANCEL_PATH}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) throw await readProblemResponse(response);
}
