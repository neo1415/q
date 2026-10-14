import {
  RelationshipQuerySchema,
  RelationshipQueryResponseSchema,
  RelationshipExportRequestSchema,
  RelationshipExportResponseSchema,
  SavedRelationshipViewListSchema,
  SavedRelationshipViewSchema,
  SaveRelationshipViewRequestSchema,
  DeleteRelationshipViewResponseSchema,
  NETWORK_RELATIONSHIP_QUERY_PATH,
  NETWORK_RELATIONSHIP_VIEWS_PATH,
  NETWORK_RELATIONSHIP_VIEW_PATH,
  NETWORK_RELATIONSHIP_EXPORT_PATH,
  type RelationshipQuery,
} from "@capital-q/contracts";
import { call, type ApiSession } from "./request.js";
export const queryOwnRelationships = (
  session: ApiSession,
  input: RelationshipQuery,
) =>
  call(
    session,
    "POST",
    NETWORK_RELATIONSHIP_QUERY_PATH,
    RelationshipQueryResponseSchema,
    { body: RelationshipQuerySchema.parse(input) },
  );
export const listRelationshipViews = (session: ApiSession) =>
  call(
    session,
    "GET",
    NETWORK_RELATIONSHIP_VIEWS_PATH,
    SavedRelationshipViewListSchema,
  );
export const saveRelationshipView = (
  session: ApiSession,
  id: string,
  input: unknown,
) =>
  call(
    session,
    "PUT",
    NETWORK_RELATIONSHIP_VIEW_PATH.replace(":viewId", encodeURIComponent(id)),
    SavedRelationshipViewSchema,
    { body: SaveRelationshipViewRequestSchema.parse(input) },
  );
export const deleteRelationshipView = (
  session: ApiSession,
  id: string,
  expectedVersion: number,
) =>
  call(
    session,
    "DELETE",
    NETWORK_RELATIONSHIP_VIEW_PATH.replace(":viewId", encodeURIComponent(id)),
    DeleteRelationshipViewResponseSchema,
    { body: { expectedVersion } },
  );
export const exportRelationshipView = (session: ApiSession, input: unknown) =>
  call(
    session,
    "POST",
    NETWORK_RELATIONSHIP_EXPORT_PATH,
    RelationshipExportResponseSchema,
    { body: RelationshipExportRequestSchema.parse(input) },
  );
