import {
  qErrandPath,
  QErrandListDtoSchema,
  QErrandStoppedDtoSchema,
  qRelationshipErrandsPath,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** The caller's own errands on one relationship. A Q API session. */
export function listRelationshipErrands(
  session: ApiSession,
  relationshipId: string,
) {
  return call(
    session,
    "GET",
    qRelationshipErrandsPath(relationshipId),
    QErrandListDtoSchema,
  );
}

/** The caller stops their own errand. */
export function stopErrand(session: ApiSession, errandId: string) {
  return call(
    session,
    "DELETE",
    qErrandPath(errandId),
    QErrandStoppedDtoSchema,
  );
}
