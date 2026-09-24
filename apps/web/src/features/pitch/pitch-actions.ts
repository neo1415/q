"use server";

import { z } from "zod";

import { ApiProblemError, type ApiSession } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  IdempotencyKeyHeaderSchema,
  type CreateCompanyPitchResponse,
  type MediaAssetDto,
  type MediaUploadSessionDto,
  type PlaybackAuthorizationDto,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";
import { apiPitchTransport, type PitchOverview } from "./pitch-transport";

/**
 * The pitch flow, server side (CQ-WEB-023), in the pattern of
 * `visibility-actions.ts`: every call goes to the API under the person's
 * own session token, which is read here and forwarded server to server.
 * The browser sees a one-time upload URL — which is the provider's and
 * expires — and a minted playback URL, and never a token of Capital Q's.
 *
 * Failures become one sentence a founder can act on. The one exception is
 * deliberate: when the video service is not configured the API says so
 * by name, and that reason is passed through, because "preview is not
 * available" without a cause is the kind of blank a person cannot fix.
 */

export type PitchActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly status?: number };

const UuidInput = z.string().uuid();
const VersionInput = z.number().int().min(1);

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) {
    return null;
  }
  return { baseUrl: apiBaseUrl, accessToken };
}

const SIGN_IN = "Please sign in again to continue.";
const NOT_HERE = "That company isn't available here.";

/** The API's own reason, without the machine code in front of it. */
function detailWithoutCode(detail: string): string {
  return detail.replace(/^[A-Z][A-Z0-9_]*:\s*/, "");
}

function translate(error: unknown): PitchActionResult<never> {
  if (error instanceof ApiProblemError) {
    const status = error.status;
    if (status === 401) return { ok: false, message: SIGN_IN, status };
    if (status === 403) {
      return {
        ok: false,
        message:
          "Only someone who can edit the company profile can change its pitch.",
        status,
      };
    }
    if (status === 404) return { ok: false, message: NOT_HERE, status };
    if (status === 409) {
      return {
        ok: false,
        message:
          "The pitch changed since this page was opened. Reload and try again.",
        status,
      };
    }
    if (status === 503 && error.problem?.detail !== undefined) {
      // Not configured, or the provider refused: the server's sentence
      // names what is missing, and that is what a founder needs to hear.
      return {
        ok: false,
        message: detailWithoutCode(error.problem.detail),
        status,
      };
    }
    if (status < 500) {
      return {
        ok: false,
        message: error.problem?.detail ?? "That request couldn't be made.",
        status,
      };
    }
  }
  return {
    ok: false,
    message: "Capital Q couldn't complete that right now. Please try again.",
  };
}

async function run<T>(
  work: (transport: ReturnType<typeof apiPitchTransport>) => Promise<T>,
): Promise<PitchActionResult<T>> {
  const current = await session();
  if (current === null) {
    return { ok: false, message: SIGN_IN, status: 401 };
  }
  try {
    return { ok: true, value: await work(apiPitchTransport(current)) };
  } catch (error) {
    return translate(error);
  }
}

export async function loadPitchOverviewAction(
  rawCompanyId: string,
): Promise<PitchActionResult<PitchOverview>> {
  const companyId = UuidInput.safeParse(rawCompanyId);
  if (!companyId.success) return { ok: false, message: NOT_HERE };
  return run((transport) => transport.load(companyId.data));
}

export async function createPitchAction(
  rawCompanyId: string,
  rawReplacesMediaAssetId: string | null,
): Promise<PitchActionResult<CreateCompanyPitchResponse>> {
  const companyId = UuidInput.safeParse(rawCompanyId);
  const replaces =
    rawReplacesMediaAssetId === null
      ? { success: true as const, data: null }
      : UuidInput.safeParse(rawReplacesMediaAssetId);
  if (!companyId.success || !replaces.success) {
    return { ok: false, message: NOT_HERE };
  }
  return run((transport) => transport.create(companyId.data, replaces.data));
}

const ResumableInput = z
  .object({
    uploadLengthBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    idempotencyKey: IdempotencyKeyHeaderSchema,
  })
  .strict();

/**
 * Reserves the upload target. With `rawResumable` (the file's size and a
 * key the browser made for this reservation) the server may answer with a
 * resumable target, and asking again with the same pair returns the same
 * one — which is how a lost answer or a reload carries on.
 */
export async function createUploadSessionAction(
  rawCompanyId: string,
  rawMediaAssetId: string,
  rawExpectedVersion: number,
  rawResumable?: {
    readonly uploadLengthBytes: number;
    readonly idempotencyKey: string;
  },
): Promise<PitchActionResult<MediaUploadSessionDto>> {
  const companyId = UuidInput.safeParse(rawCompanyId);
  const mediaAssetId = UuidInput.safeParse(rawMediaAssetId);
  const expectedVersion = VersionInput.safeParse(rawExpectedVersion);
  const resumable =
    rawResumable === undefined
      ? { success: true as const, data: undefined }
      : ResumableInput.safeParse(rawResumable);
  if (
    !companyId.success ||
    !mediaAssetId.success ||
    !expectedVersion.success ||
    !resumable.success
  ) {
    return { ok: false, message: "That request couldn't be made." };
  }
  return run((transport) =>
    transport.reserve(
      companyId.data,
      mediaAssetId.data,
      expectedVersion.data,
      resumable.data,
    ),
  );
}

/** Stops an unfinished upload; the record then says UPLOAD_FAILED. */
export async function cancelUploadAction(
  rawCompanyId: string,
  rawMediaAssetId: string,
): Promise<PitchActionResult<MediaAssetDto>> {
  const companyId = UuidInput.safeParse(rawCompanyId);
  const mediaAssetId = UuidInput.safeParse(rawMediaAssetId);
  if (!companyId.success || !mediaAssetId.success) {
    return { ok: false, message: NOT_HERE };
  }
  return run((transport) =>
    transport.cancel(companyId.data, mediaAssetId.data),
  );
}

export async function syncPitchAction(
  rawCompanyId: string,
  rawMediaAssetId: string,
): Promise<PitchActionResult<MediaAssetDto>> {
  const companyId = UuidInput.safeParse(rawCompanyId);
  const mediaAssetId = UuidInput.safeParse(rawMediaAssetId);
  if (!companyId.success || !mediaAssetId.success) {
    return { ok: false, message: NOT_HERE };
  }
  return run((transport) => transport.sync(companyId.data, mediaAssetId.data));
}

const OwnerPolicyInput = z.enum(["AUTHORISED", "PRIVATE"]);

/**
 * The founder's decision: may investors be granted playback (CQ-MEDIA-013).
 *
 * This is the one entry point for that decision from the web. A later
 * packet that lets a founder ask Q to "publish my pitch" prepares this
 * same command through the approval engine and calls the same route; it
 * does not get a second way in, and neither does anything else.
 */
export async function setPitchPlaybackPolicyAction(
  rawCompanyId: string,
  rawMediaAssetId: string,
  rawPlaybackPolicy: string,
  rawExpectedVersion: number,
): Promise<PitchActionResult<MediaAssetDto>> {
  const companyId = UuidInput.safeParse(rawCompanyId);
  const mediaAssetId = UuidInput.safeParse(rawMediaAssetId);
  const playbackPolicy = OwnerPolicyInput.safeParse(rawPlaybackPolicy);
  const expectedVersion = VersionInput.safeParse(rawExpectedVersion);
  if (
    !companyId.success ||
    !mediaAssetId.success ||
    !playbackPolicy.success ||
    !expectedVersion.success
  ) {
    return { ok: false, message: "That request couldn't be made." };
  }
  return run((transport) =>
    transport.setPlaybackPolicy(
      companyId.data,
      mediaAssetId.data,
      playbackPolicy.data,
      expectedVersion.data,
    ),
  );
}

export async function authorisePitchPlaybackAction(
  rawCompanyId: string,
  rawMediaAssetId: string,
): Promise<PitchActionResult<PlaybackAuthorizationDto>> {
  const companyId = UuidInput.safeParse(rawCompanyId);
  const mediaAssetId = UuidInput.safeParse(rawMediaAssetId);
  if (!companyId.success || !mediaAssetId.success) {
    return { ok: false, message: NOT_HERE };
  }
  return run((transport) =>
    transport.authorise(companyId.data, mediaAssetId.data),
  );
}
