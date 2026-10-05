import {
  ADMIN_BRAND_THEME_PATH,
  BRAND_THEME_PATH,
  BrandThemeDtoSchema,
  type AdminBrandThemeRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** P5: the brand colour in effect for the signed-in person. */
export const getBrandTheme = (session: ApiSession) =>
  call(session, "GET", BRAND_THEME_PATH, BrandThemeDtoSchema);

/** P5, operations console: the platform default brand colour. */
export const getAdminBrandTheme = (session: ApiSession) =>
  call(session, "GET", ADMIN_BRAND_THEME_PATH, BrandThemeDtoSchema);

/** P5, operations console: set (or, with null, reset) the brand colour. */
export const setAdminBrandTheme = (
  session: ApiSession,
  body: AdminBrandThemeRequest,
) =>
  call(session, "POST", ADMIN_BRAND_THEME_PATH, BrandThemeDtoSchema, { body });
