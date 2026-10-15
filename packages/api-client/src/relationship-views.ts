import {
  DeleteRelationshipViewResponseSchema,
  NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH,
  NETWORK_COMPANY_RELATIONSHIP_VIEW_VERSION_PATH,
  NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH,
  NETWORK_RELATIONSHIP_VIEW_PATH,
  NETWORK_RELATIONSHIP_VIEW_VERSION_PATH,
  NETWORK_RELATIONSHIP_VIEWS_PATH,
  SaveRelationshipViewRequestSchema,
  SavedRelationshipViewListSchema,
  SavedRelationshipViewSchema,
  type SaveRelationshipViewRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * CRM saved views (2026-10-15). A founder's are their company's (the
 * company id names the party; the server checks it is theirs); an
 * investor's are their investor organisation's.
 */
function path(companyId: string | undefined, viewId?: string): string {
  const template =
    companyId === undefined
      ? viewId === undefined
        ? NETWORK_RELATIONSHIP_VIEWS_PATH
        : NETWORK_RELATIONSHIP_VIEW_PATH
      : viewId === undefined
        ? NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH
        : NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH;
  return template
    .replace(":companyId", encodeURIComponent(companyId ?? ""))
    .replace(":viewId", encodeURIComponent(viewId ?? ""));
}

export function listRelationshipViews(session: ApiSession, companyId?: string) {
  return call(session, "GET", path(companyId), SavedRelationshipViewListSchema);
}

export function saveRelationshipView(
  session: ApiSession,
  viewId: string,
  input: SaveRelationshipViewRequest,
  companyId?: string,
) {
  return call(
    session,
    "PUT",
    path(companyId, viewId),
    SavedRelationshipViewSchema,
    { body: SaveRelationshipViewRequestSchema.parse(input) },
  );
}

export function deleteRelationshipView(
  session: ApiSession,
  viewId: string,
  expectedVersion: number,
  companyId?: string,
) {
  return call(
    session,
    "DELETE",
    (companyId === undefined
      ? NETWORK_RELATIONSHIP_VIEW_VERSION_PATH
      : NETWORK_COMPANY_RELATIONSHIP_VIEW_VERSION_PATH
    )
      .replace(":companyId", encodeURIComponent(companyId ?? ""))
      .replace(":viewId", encodeURIComponent(viewId))
      .replace(":version", String(expectedVersion)),
    DeleteRelationshipViewResponseSchema,
  );
}
