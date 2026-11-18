import "server-only";

import { getPublicSiteLanding, getPublicSitePage } from "@capital-q/api-client";
import type {
  PublicSiteLandingDto,
  PublicSitePageDto,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

/**
 * Published site content (decision 107), read server-to-server with no
 * credential. Cached for a minute (incremental regeneration), and a
 * publish in the console revalidates the page at once. Null means nothing
 * is published or the API could not be reached: the caller shows its own
 * fallback, never an error page with internals.
 */
export const SITE_REVALIDATE_SECONDS = 60;

const revalidating: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: "force-cache",
    next: { revalidate: SITE_REVALIDATE_SECONDS, tags: ["site-content"] },
  });

/** The API's address, or undefined -- a page never fails over its config. */
function apiBase(): string | undefined {
  try {
    return loadWebServerConfig().apiBaseUrl;
  } catch {
    return undefined;
  }
}

export async function publishedSitePage(
  slug: string,
): Promise<PublicSitePageDto | null> {
  const apiBaseUrl = apiBase();
  if (apiBaseUrl === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    return null;
  }
  return getPublicSitePage(apiBaseUrl, slug, revalidating).catch(() => null);
}

export async function publishedLanding(): Promise<PublicSiteLandingDto | null> {
  const apiBaseUrl = apiBase();
  if (apiBaseUrl === undefined) return null;
  return getPublicSiteLanding(apiBaseUrl, revalidating).catch(() => null);
}
