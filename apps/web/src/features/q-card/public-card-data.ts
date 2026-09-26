import "server-only";

import { cache } from "react";

import { ApiProblemError, getPublicHandle } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { PublicHandleResponse } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The public read behind `/@handle` (BIZ-004), once per request. A signed-
 * in visitor's session travels so the API can widen the projection to a
 * participant's; the API decides, and a visitor without a session gets
 * exactly the public_external fields. Absence is `null`: an unknown
 * handle, a malformed one and one without a live card are one answer.
 */
export const loadPublicCard = cache(
  async (handle: string): Promise<PublicHandleResponse | null> => {
    const { apiBaseUrl } = loadWebServerConfig();
    if (apiBaseUrl === undefined) return null;
    const accessToken = await getSessionAccessToken().catch(() => null);
    try {
      return await getPublicHandle(
        {
          baseUrl: apiBaseUrl,
          ...(accessToken === null ? {} : { accessToken }),
        },
        handle,
      );
    } catch (error) {
      if (error instanceof ApiProblemError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },
);

/** Where this deployment lives, for absolute links, the QR and the vCard. */
export function appOrigin(): string {
  return loadWebServerConfig().auth.appOrigin;
}

/** "capitalq.app/@kivu" -- the origin without its scheme, for display. */
export function displayUrlFor(handle: string): string {
  return `${appOrigin().replace(/^https?:\/\//, "")}/@${handle}`;
}
