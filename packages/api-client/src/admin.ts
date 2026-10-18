import {
  ADMIN_ATTRIBUTION_PATH,
  ADMIN_DISPUTES_PATH,
  ADMIN_OVERVIEW_PATH,
  ADMIN_PAUSED_PATH,
  adminReinstatePath,
  AdminOverviewDtoSchema,
  AttributionListDtoSchema,
  DisputeListDtoSchema,
  PausedListDtoSchema,
  ReinstatedDtoSchema,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Capital Q's admin console; a 404 for anyone but a platform admin. */
export function getAdminOverview(session: ApiSession) {
  return call(session, "GET", ADMIN_OVERVIEW_PATH, AdminOverviewDtoSchema);
}

export function getAdminAttribution(session: ApiSession) {
  return call(session, "GET", ADMIN_ATTRIBUTION_PATH, AttributionListDtoSchema);
}

export function getAdminDisputes(session: ApiSession) {
  return call(session, "GET", ADMIN_DISPUTES_PATH, DisputeListDtoSchema);
}

/** Accounts Q paused (founder direction 2026-09-30). */
export function getAdminPaused(session: ApiSession) {
  return call(session, "GET", ADMIN_PAUSED_PATH, PausedListDtoSchema);
}

/** An operator reinstates one paused account. */
export function reinstatePausedAccount(session: ApiSession, userId: string) {
  return call(session, "POST", adminReinstatePath(userId), ReinstatedDtoSchema);
}
