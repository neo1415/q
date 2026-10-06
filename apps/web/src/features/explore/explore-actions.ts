"use server";

import { z } from "zod";

import { exploreRelated, exploreSlate } from "@capital-q/api-client";
import {
  ExploreModeSchema,
  type ExplorePageDto,
  type ExploreRelatedDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Explore's reads from the browser, through the server so the access token
 * never leaves it. Every argument arrives from the client and is input:
 * validated here, and again by the API.
 */

export type ExploreActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const CursorInput = z.string().min(1).max(400);
const MediaAssetIdInput = z.string().uuid();
const NO_SESSION = "You are signed out. Sign in and try again.";

export async function loadExplorePageAction(
  rawMode: unknown,
  rawCursor: unknown,
): Promise<ExploreActionResult<ExplorePageDto>> {
  const mode = ExploreModeSchema.safeParse(rawMode);
  const cursor = rawCursor === null ? null : CursorInput.safeParse(rawCursor);
  if (!mode.success || (cursor !== null && !cursor.success)) {
    return { ok: false, message: "That page could not be loaded." };
  }
  const session = await apiSession();
  if (session === null) return { ok: false, message: NO_SESSION };
  try {
    return {
      ok: true,
      value: await exploreSlate(session, {
        mode: mode.data,
        cursor: cursor === null ? null : cursor.data,
      }),
    };
  } catch {
    return {
      ok: false,
      message:
        "The connection dropped before it finished. Nothing you did was lost.",
    };
  }
}

export async function loadExploreRelatedAction(
  rawMediaAssetId: unknown,
): Promise<ExploreActionResult<ExploreRelatedDto>> {
  const id = MediaAssetIdInput.safeParse(rawMediaAssetId);
  if (!id.success) return { ok: false, message: "That pitch isn't available." };
  const session = await apiSession();
  if (session === null) return { ok: false, message: NO_SESSION };
  try {
    return { ok: true, value: await exploreRelated(session, id.data) };
  } catch {
    return { ok: false, message: "That pitch isn't available any more." };
  }
}
