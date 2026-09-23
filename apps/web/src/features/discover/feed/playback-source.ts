"use server";

import { z } from "zod";

import { loadWebServerConfig } from "@capital-q/config/web";
import {
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  MEDIA_PLAYBACK_SUFFIX,
  PlaybackAuthorizationDtoSchema,
  type PlaybackAuthorizationDto,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Authorising one pitch for one viewer (CQ-WEB-022; doc 20).
 *
 * This file is the whole seam to CQ-MEDIA-011. When
 * `authorisePitchPlayback(session, companyId, mediaAssetId)` lands in
 * `@capital-q/api-client`, the body of `authorisePlaybackAction` becomes a
 * call to it and nothing else in the feed changes — which is why the
 * adapter is here rather than spread across the player.
 *
 * It is a server action because the authorisation is the point. A playback
 * URL is per-viewer and short-lived, and the token that obtains it must
 * never be in the browser; the client receives the URL it is allowed to
 * have and nothing that would let it mint another. A provider UID is not
 * access control, so the server decides, every time, per asset.
 */

const CompanyIdInput = z.string().uuid();
const MediaAssetIdInput = z.string().uuid();

export type PlaybackActionResult =
  | { readonly ok: true; readonly value: PlaybackAuthorizationDto }
  | { readonly ok: false; readonly message: string };

/** `POST /v1/companies/:companyId/pitch/:mediaAssetId/playback`. */
export async function authorisePlaybackAction(
  companyId: string,
  mediaAssetId: string,
): Promise<PlaybackActionResult> {
  const company = CompanyIdInput.safeParse(companyId);
  const asset = MediaAssetIdInput.safeParse(mediaAssetId);
  if (!company.success || !asset.success) {
    return { ok: false, message: "That pitch reference is not valid." };
  }

  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (apiBaseUrl === undefined || accessToken === null) {
    return { ok: false, message: "You are signed out. Sign in and try again." };
  }

  const path =
    `${COMPANIES_PATH}/${encodeURIComponent(company.data)}` +
    `${COMPANY_PITCH_SUFFIX}/${encodeURIComponent(asset.data)}` +
    `${MEDIA_PLAYBACK_SUFFIX}`;

  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });

    if (!response.ok) {
      // Refused, not broken. A viewer who may not watch this pitch gets the
      // same calm answer as one whose provider is down, because the
      // difference is not theirs to learn from a status code.
      return { ok: false, message: "This pitch is not available to play." };
    }

    const parsed = PlaybackAuthorizationDtoSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      return { ok: false, message: "This pitch is not available to play." };
    }
    return { ok: true, value: parsed.data };
  } catch {
    return { ok: false, message: "This pitch is not available to play." };
  }
}
