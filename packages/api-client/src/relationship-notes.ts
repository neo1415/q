import {
  CreateRelationshipNoteRequestSchema,
  NETWORK_COMPANY_RELATIONSHIP_NOTE_PATH,
  NETWORK_COMPANY_RELATIONSHIP_NOTES_PATH,
  NETWORK_RELATIONSHIP_NOTE_PATH,
  NETWORK_RELATIONSHIP_NOTES_PATH,
  RelationshipNoteListSchema,
  RelationshipNoteSchema,
  type CreateRelationshipNoteRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * CRM private notes (S3, 2026-10-15). A founder's are their company's (the
 * company id names their side; the server checks it is theirs); an
 * investor's are their investor organisation's.
 */
function path(
  relationshipId: string,
  companyId: string | undefined,
  noteId?: string,
): string {
  const template =
    companyId === undefined
      ? noteId === undefined
        ? NETWORK_RELATIONSHIP_NOTES_PATH
        : NETWORK_RELATIONSHIP_NOTE_PATH
      : noteId === undefined
        ? NETWORK_COMPANY_RELATIONSHIP_NOTES_PATH
        : NETWORK_COMPANY_RELATIONSHIP_NOTE_PATH;
  return template
    .replace(":companyId", encodeURIComponent(companyId ?? ""))
    .replace(":relationshipId", encodeURIComponent(relationshipId))
    .replace(":noteId", encodeURIComponent(noteId ?? ""));
}

export function listRelationshipNotes(
  session: ApiSession,
  relationshipId: string,
  companyId?: string,
) {
  return call(
    session,
    "GET",
    path(relationshipId, companyId),
    RelationshipNoteListSchema,
  );
}

export function addRelationshipNote(
  session: ApiSession,
  relationshipId: string,
  noteId: string,
  input: CreateRelationshipNoteRequest,
  companyId?: string,
) {
  return call(
    session,
    "PUT",
    path(relationshipId, companyId, noteId),
    RelationshipNoteSchema,
    { body: CreateRelationshipNoteRequestSchema.parse(input) },
  );
}
