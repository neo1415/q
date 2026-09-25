"use server";

import { z } from "zod";

import {
  ApiProblemError,
  expressInterest,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { ExpressInterestResultDto } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Express Interest, server side (CQ-NET-010).
 *
 * A server action so the access token never reaches the browser. It is the
 * one feed command that is not optimistic: the browser shows "sent" only
 * when this returns the server's answer, because an interest the server
 * refused would otherwise show a founder-facing act that never happened.
 *
 * The idempotency key is the caller's, generated once per intended
 * expression, so a retry after a lost response returns the same interest.
 * The company id is input; whether this person may act on it is the API's.
 */

export type InterestActionResult =
  | { readonly ok: true; readonly value: ExpressInterestResultDto }
  | {
      readonly ok: false;
      readonly message: string;
      /** A refusal will not change on retry; a failure might. */
      readonly retryable: boolean;
    };

const CompanyIdInput = z.string().uuid();
const SurfaceInput = z.enum(["RECOMMENDATION_FEED", "COMPANY_PROFILE"]);
const IdempotencyKeyInput = z.string().regex(/^[A-Za-z0-9_:-]{8,128}$/);

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
}

function refusal(error: unknown): InterestActionResult {
  if (error instanceof ApiProblemError) {
    if (error.status === 401) {
      return {
        ok: false,
        message: "You are signed out. Sign in and try again.",
        retryable: false,
      };
    }
    if (error.status === 403) {
      return {
        ok: false,
        message:
          "Only a member of an investor organisation can express interest.",
        retryable: false,
      };
    }
    if (error.status === 404) {
      return {
        ok: false,
        message: "This company isn't available to you any more.",
        retryable: false,
      };
    }
  }
  return {
    ok: false,
    message: "Your interest was not sent. Try again.",
    retryable: true,
  };
}

export async function expressInterestAction(input: {
  readonly companyId: string;
  readonly surface: "RECOMMENDATION_FEED" | "COMPANY_PROFILE";
  readonly idempotencyKey: string;
}): Promise<InterestActionResult> {
  const active = await session();
  if (active === null) {
    return {
      ok: false,
      message: "You are signed out. Sign in and try again.",
      retryable: false,
    };
  }

  const companyId = CompanyIdInput.safeParse(input.companyId);
  const surface = SurfaceInput.safeParse(input.surface);
  const key = IdempotencyKeyInput.safeParse(input.idempotencyKey);
  if (!companyId.success || !surface.success || !key.success) {
    return {
      ok: false,
      message: "That request was not understood.",
      retryable: false,
    };
  }

  try {
    const value = await expressInterest(
      active,
      companyId.data,
      { surface: surface.data },
      key.data,
    );
    return { ok: true, value };
  } catch (error) {
    return refusal(error);
  }
}
