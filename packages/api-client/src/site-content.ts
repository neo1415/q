import {
  ADMIN_SITE_PAGE_DRAFT_PATH,
  ADMIN_SITE_PAGE_PATH,
  ADMIN_SITE_PAGE_PUBLISH_PATH,
  ADMIN_SITE_PAGE_RESTORE_PATH,
  ADMIN_SITE_PAGE_UNPUBLISH_PATH,
  ADMIN_SITE_PAGE_VERSION_PATH,
  ADMIN_SITE_PAGES_PATH,
  ADMIN_SITE_SETTINGS_PATH,
  AdminSitePageDetailDtoSchema,
  AdminSitePageListDtoSchema,
  AdminSiteVersionDtoSchema,
  PublicSiteImageDtoSchema,
  PublicSiteLandingDtoSchema,
  PublicSitePageDtoSchema,
  PublishSitePageResultDtoSchema,
  SaveSiteDraftResultDtoSchema,
  SITE_IMAGE_PATH,
  SITE_LANDING_PATH,
  SITE_PAGE_PATH,
  SiteChangedDtoSchema,
  type PublishSitePageRequest,
  type RestoreSiteVersionRequest,
  type SaveSiteDraftRequest,
  type UnpublishSitePageRequest,
  type UpdateSiteSettingsRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Decision 107: the site content editor and its public reads. */

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/:([A-Za-z]+)/gu, (_, key: string) =>
    encodeURIComponent(values[key] ?? ""),
  );

const anonymous = (baseUrl: string, fetcher?: typeof fetch): ApiSession => ({
  baseUrl,
  accessToken: "",
  ...(fetcher === undefined ? {} : { fetch: fetcher }),
});

/** Anonymous: the published version of one page. */
export const getPublicSitePage = (
  baseUrl: string,
  slug: string,
  fetcher?: typeof fetch,
) =>
  call(
    anonymous(baseUrl, fetcher),
    "GET",
    fill(SITE_PAGE_PATH, { slug }),
    PublicSitePageDtoSchema,
  );

/** Anonymous: every published landing section. */
export const getPublicSiteLanding = (baseUrl: string, fetcher?: typeof fetch) =>
  call(
    anonymous(baseUrl, fetcher),
    "GET",
    SITE_LANDING_PATH,
    PublicSiteLandingDtoSchema,
  );

/** Anonymous: a one-minute link to an image a published page shows. */
export const getPublicSiteImage = (baseUrl: string, documentId: string) =>
  call(
    anonymous(baseUrl),
    "GET",
    fill(SITE_IMAGE_PATH, { documentId }),
    PublicSiteImageDtoSchema,
  );

export const listAdminSitePages = (session: ApiSession) =>
  call(session, "GET", ADMIN_SITE_PAGES_PATH, AdminSitePageListDtoSchema);

export const getAdminSitePage = (session: ApiSession, slug: string) =>
  call(
    session,
    "GET",
    fill(ADMIN_SITE_PAGE_PATH, { slug }),
    AdminSitePageDetailDtoSchema,
  );

export const getAdminSiteVersion = (
  session: ApiSession,
  slug: string,
  versionNumber: number,
) =>
  call(
    session,
    "GET",
    fill(ADMIN_SITE_PAGE_VERSION_PATH, {
      slug,
      versionNumber: String(versionNumber),
    }),
    AdminSiteVersionDtoSchema,
  );

export const saveAdminSiteDraft = (
  session: ApiSession,
  slug: string,
  body: SaveSiteDraftRequest,
) =>
  call(
    session,
    "PUT",
    fill(ADMIN_SITE_PAGE_DRAFT_PATH, { slug }),
    SaveSiteDraftResultDtoSchema,
    { body },
  );

export const publishAdminSitePage = (
  session: ApiSession,
  slug: string,
  body: PublishSitePageRequest,
) =>
  call(
    session,
    "POST",
    fill(ADMIN_SITE_PAGE_PUBLISH_PATH, { slug }),
    PublishSitePageResultDtoSchema,
    { body },
  );

export const unpublishAdminSitePage = (
  session: ApiSession,
  slug: string,
  body: UnpublishSitePageRequest,
) =>
  call(
    session,
    "POST",
    fill(ADMIN_SITE_PAGE_UNPUBLISH_PATH, { slug }),
    SiteChangedDtoSchema,
    { body },
  );

export const restoreAdminSiteVersion = (
  session: ApiSession,
  slug: string,
  body: RestoreSiteVersionRequest,
) =>
  call(
    session,
    "POST",
    fill(ADMIN_SITE_PAGE_RESTORE_PATH, { slug }),
    SiteChangedDtoSchema,
    { body },
  );

export const updateAdminSiteSettings = (
  session: ApiSession,
  body: UpdateSiteSettingsRequest,
) =>
  call(session, "POST", ADMIN_SITE_SETTINGS_PATH, SiteChangedDtoSchema, {
    body,
  });
