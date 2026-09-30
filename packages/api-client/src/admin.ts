import {
  ADMIN_ATTRIBUTION_PATH,
  ADMIN_DISPUTES_PATH,
  ADMIN_OVERVIEW_PATH,
  AdminOverviewDtoSchema,
  AttributionListDtoSchema,
  DisputeListDtoSchema,
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
