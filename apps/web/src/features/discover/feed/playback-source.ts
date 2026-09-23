"use server";

import { z } from "zod";

import { authorisePitchPlayback } from "@capital-q/api-client";
import type { PlaybackAuthorizationDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Authorising one pitch for one viewer (CQ-WEB-022; doc 20).
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

  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "You are signed out. Sign in and try again." };
  }

  try {
    const value = await authorisePitchPlayback(
      session,
      company.data,
      asset.data,
    );
    return { ok: true, value };
  } catch {
    // Refused, not broken. A viewer who may not watch this pitch gets the
    // same calm answer as one whose provider is down, because the
    // difference is not theirs to learn from a status code.
    return { ok: false, message: "This pitch is not available to play." };
  }
}
