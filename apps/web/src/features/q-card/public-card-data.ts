import "server-only";

import { connection } from "next/server";
import { cache } from "react";

import { ApiProblemError, getPublicHandle } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { PublicHandleResponse } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/** Every anonymous card read; expired whole when a handle changes. */
export const PUBLIC_CARD_TAG = "q-card-public";

/** One handle's anonymous read; expired when its owner edits the card. */
export function publicCardTag(handle: string): string {
  return `q-card:${handle.toLowerCase()}`;
}

/**
 * How long an anonymous projection may be served from the data cache.
 * Short, because a card also changes when its profile does (a description,
 * a mandate, a photo) without passing the card's own actions; well inside
 * the signed image URLs' one-hour life.
 */
const PUBLIC_CARD_REVALIDATE_SECONDS = 30;

/**
 * An anonymous visitor's read is the same for every anonymous visitor (the
 * public_external projection), so it is cached briefly and shared. A
 * signed-in read never is: it is that participant's own wider projection.
 */
function cachedPublicFetch(handle: string): typeof fetch {
  return (input, init) => {
    // The client asks for no-store on every read; this one may be cached.
    const shared: RequestInit = { ...init };
    delete shared.cache;
    return fetch(input, {
      ...shared,
      next: {
        revalidate: PUBLIC_CARD_REVALIDATE_SECONDS,
        tags: [PUBLIC_CARD_TAG, publicCardTag(handle)],
      },
    });
  };
}

/**
 * The public read behind `/@handle` (BIZ-004), once per request. A signed-
 * in visitor's session travels so the API can widen the projection to a
 * participant's; the API decides, and a visitor without a session gets
 * exactly the public_external fields. Absence is `null`: an unknown
 * handle, a malformed one and one without a live card are one answer.
 */
export const loadPublicCard = cache(
  async (handle: string): Promise<PublicHandleResponse | null> => {
    // Always rendered per request -- whose session it is decides the
    // projection -- while the anonymous fetch below may still be cached.
    // (`force-dynamic` would force no-store on that fetch too.)
    await connection();
    const { apiBaseUrl } = loadWebServerConfig();
    if (apiBaseUrl === undefined) return null;
    const accessToken = await getSessionAccessToken().catch(() => null);
    try {
      return await getPublicHandle(
        {
          baseUrl: apiBaseUrl,
          ...(accessToken === null
            ? { fetch: cachedPublicFetch(handle) }
            : { accessToken }),
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
