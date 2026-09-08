import "server-only";

import { cache } from "react";

import { loadWebServerConfig } from "@capital-q/config/web";

/**
 * Which social sign-in the Auth server actually offers (CQ-C5-R2A §7, §35).
 *
 * Asked of Supabase rather than declared in Capital Q's own configuration.
 * A second switch would only ever be wrong in one of two ways: a button that
 * cannot work, or a working provider nobody can reach. `/auth/v1/settings`
 * is the provider's own public description of itself, so the button appears
 * exactly when signing in with it would succeed.
 *
 * Failure is treated as "not offered": an Auth server that cannot be reached
 * is not a reason to show a control that will fail, and email and password
 * still work.
 */

type AuthSettings = {
  readonly external?: Readonly<Record<string, unknown>> | undefined;
};

/** Long enough that sign-in does not wait on it; short enough to notice a change. */
const SETTINGS_TIMEOUT_MS = 2_000;
const SETTINGS_REVALIDATE_SECONDS = 300;

/**
 * Memoised per request, and cached across requests by the fetch layer, so a
 * page render costs at most one call and usually none.
 */
export const googleSignInEnabled = cache(async (): Promise<boolean> => {
  const { auth } = loadWebServerConfig();
  try {
    const response = await fetch(`${auth.supabase.url}/auth/v1/settings`, {
      headers: { apikey: auth.supabase.publishableKey },
      signal: AbortSignal.timeout(SETTINGS_TIMEOUT_MS),
      next: { revalidate: SETTINGS_REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      return false;
    }
    const settings = (await response.json()) as AuthSettings;
    return settings.external?.["google"] === true;
  } catch {
    return false;
  }
});
