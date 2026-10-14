import {
  NETWORK_RELATIONSHIP_VIEWS_PATH,
  NETWORK_RELATIONSHIP_VIEW_PATH,
  NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH,
  NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH,
  SavedRelationshipViewListSchema,
  SavedRelationshipViewSchema,
  SaveRelationshipViewRequestSchema,
  DeleteRelationshipViewRequestSchema,
  DeleteRelationshipViewResponseSchema,
} from "@capital-q/contracts";
import { call, type ApiSession } from "./request.js";
function path(companyId: string | undefined, id?: string) {
  return (
    companyId === undefined
      ? id === undefined
        ? NETWORK_RELATIONSHIP_VIEWS_PATH
        : NETWORK_RELATIONSHIP_VIEW_PATH
      : (id === undefined
          ? NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH
          : NETWORK_COMPANY_RELATIONSHIP_VIEW_PATH
        ).replace(":companyId", encodeURIComponent(companyId))
  ).replace(":viewId", encodeURIComponent(id ?? ""));
}
export function listRelationshipViews(session: ApiSession, companyId?: string) {
  return call(session, "GET", path(companyId), SavedRelationshipViewListSchema);
}
export function saveRelationshipView(
  session: ApiSession,
  id: string,
  input: unknown,
  companyId?: string,
) {
  return call(
    session,
    "PUT",
    path(companyId, id),
    SavedRelationshipViewSchema,
    { body: SaveRelationshipViewRequestSchema.parse(input) },
  );
}
export function deleteRelationshipView(
  session: ApiSession,
  id: string,
  expectedVersion: number,
  companyId?: string,
) {
  return call(
    session,
    "DELETE",
    path(companyId, id),
    DeleteRelationshipViewResponseSchema,
    { body: DeleteRelationshipViewRequestSchema.parse({ expectedVersion }) },
  );
}
