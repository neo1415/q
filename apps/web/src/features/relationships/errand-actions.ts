"use server";

import { z } from "zod";

import {
  ApiProblemError,
  listRelationshipErrands,
  stopErrand,
} from "@capital-q/api-client";
import type { QErrandDto } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Errands, server side (founder direction 2026-09-29). Server actions so
 * the session token never reaches the browser; ids are input, and the Q
 * API answers only for the errand's own person.
 */
export type ErrandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();

async function run<T>(
  work: (session: {
    readonly baseUrl: string;
    readonly accessToken: string;
  }) => Promise<T>,
): Promise<ErrandResult<T>> {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    return {
      ok: true,
      value: await work({ baseUrl: qApiBaseUrl, accessToken }),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.problem?.detail !== undefined
          ? error.problem.detail
          : "Couldn't reach Q just now. Please try again.",
    };
  }
}

export async function readErrandsAction(
  relationshipId: string,
): Promise<ErrandResult<readonly QErrandDto[]>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run(
    async (session) =>
      (await listRelationshipErrands(session, id.data)).errands,
  );
}

export async function stopErrandAction(
  errandId: string,
): Promise<ErrandResult<true>> {
  const id = Id.safeParse(errandId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run(async (session) => {
    await stopErrand(session, id.data);
    return true as const;
  });
}
