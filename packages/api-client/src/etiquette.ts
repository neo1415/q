import {
  ADMIN_ETIQUETTE_GUIDE_ACTIVE_PATH,
  ADMIN_ETIQUETTE_GUIDE_PATH,
  AdminEtiquetteGuideDtoSchema,
  ME_ETIQUETTE_GUIDE_PATH,
  ME_ETIQUETTE_GUIDE_VERSIONS_PATH,
  MyEtiquetteGuideDtoSchema,
  type AdminEtiquetteGuideActiveRequest,
  type AdminEtiquetteGuideRequest,
  type SaveEtiquetteGuideRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** ADR 0050: their own guide to how Q speaks for them, and the house guide. */
export const getMyEtiquetteGuide = (session: ApiSession) =>
  call(session, "GET", ME_ETIQUETTE_GUIDE_PATH, MyEtiquetteGuideDtoSchema);

/** ADR 0050: save a new version of their own guide. */
export const saveMyEtiquetteGuide = (
  session: ApiSession,
  body: SaveEtiquetteGuideRequest,
) =>
  call(session, "PUT", ME_ETIQUETTE_GUIDE_PATH, MyEtiquetteGuideDtoSchema, {
    body,
  });

/** ADR 0050: remove their own guide. */
export const removeMyEtiquetteGuide = (session: ApiSession) =>
  call(
    session,
    "DELETE",
    ME_ETIQUETTE_GUIDE_VERSIONS_PATH,
    MyEtiquetteGuideDtoSchema,
  );

/** ADR 0050, operations console: the house guide and its versions. */
export const getAdminEtiquetteGuide = (session: ApiSession) =>
  call(
    session,
    "GET",
    ADMIN_ETIQUETTE_GUIDE_PATH,
    AdminEtiquetteGuideDtoSchema,
  );

/** ADR 0050, operations console: record a new house guide version, in force. */
export const recordAdminEtiquetteGuide = (
  session: ApiSession,
  body: AdminEtiquetteGuideRequest,
) =>
  call(
    session,
    "POST",
    ADMIN_ETIQUETTE_GUIDE_PATH,
    AdminEtiquetteGuideDtoSchema,
    { body },
  );

/** ADR 0050, operations console: put a version (or the built-in) in force. */
export const activateAdminEtiquetteGuide = (
  session: ApiSession,
  body: AdminEtiquetteGuideActiveRequest,
) =>
  call(
    session,
    "POST",
    ADMIN_ETIQUETTE_GUIDE_ACTIVE_PATH,
    AdminEtiquetteGuideDtoSchema,
    { body },
  );
