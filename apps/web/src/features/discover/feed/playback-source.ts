"use server";

import { z } from "zod";

import {
  authorisePitchDownload,
  authorisePitchPlayback,
} from "@capital-q/api-client";
import type {
  PitchDownloadDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";

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
    return {
      ok: false,
      message: "That pitch can't be played. Reload and try again.",
    };
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

const PosterBatchInput = z
  .array(
    z.object({ companyId: z.string().uuid(), mediaAssetId: z.string().uuid() }),
  )
  .max(24);

/**
 * Posters for a batch of tiles, in one round trip (P9).
 *
 * Server actions run one at a time from a page, so a grid that asked for
 * each poster separately waited one network round trip per tile -- tens of
 * seconds on a slow line. This authorises each tile exactly as
 * `authorisePlaybackAction` does (per viewer, per asset, every time), side
 * by side, and returns only the poster URLs that were granted. A refused or
 * failed tile is simply absent: the grid keeps its reserved box.
 */
export async function authorisePostersAction(
  items: readonly {
    readonly companyId: string;
    readonly mediaAssetId: string;
  }[],
): Promise<Readonly<Record<string, string>>> {
  const parsed = PosterBatchInput.safeParse(items);
  if (!parsed.success || parsed.data.length === 0) return {};
  const session = await apiSession();
  if (session === null) return {};
  const settled = await Promise.allSettled(
    parsed.data.map(async ({ companyId, mediaAssetId }) => {
      const grant = await authorisePitchPlayback(
        session,
        companyId,
        mediaAssetId,
      );
      return [mediaAssetId, grant.posterUrl] as const;
    }),
  );
  const posters: Record<string, string> = {};
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value[1] !== null) {
      posters[outcome.value[0]] = outcome.value[1];
    }
  }
  return posters;
}

export type DownloadActionResult =
  | { readonly ok: true; readonly value: PitchDownloadDto }
  | { readonly ok: false; readonly message: string };

/**
 * `GET /v1/companies/:companyId/pitch/:mediaAssetId/download` (ADR 0047).
 * The server decides on every call (the playback rule, then the founder's
 * download permission); the browser gets a short-lived CDN link, opens it,
 * and the file comes from the CDN, never through this app.
 */
export async function authoriseDownloadAction(
  companyId: string,
  mediaAssetId: string,
): Promise<DownloadActionResult> {
  const company = CompanyIdInput.safeParse(companyId);
  const asset = MediaAssetIdInput.safeParse(mediaAssetId);
  if (!company.success || !asset.success) {
    return { ok: false, message: "This pitch can't be downloaded." };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "You are signed out. Sign in and try again." };
  }
  try {
    const value = await authorisePitchDownload(
      session,
      company.data,
      asset.data,
    );
    return { ok: true, value };
  } catch {
    // A watch-only pitch and one this viewer may not see answer the same.
    return { ok: false, message: "This pitch can't be downloaded." };
  }
}
