"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  ApiProblemError,
  getCompanyVerification,
  requestCompanyVerification,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { CompanyVerificationDto } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Verification (CQ-VERIFY-001), server side. The founder reads where
 * verification stands and asks Capital Q to verify, through the API under
 * their own session; the token never reaches the browser. Nothing here
 * decides or names a standing: the request is body-less, and what comes
 * back is Capital Q's answer.
 */

const CompanyIdInput = z.string().uuid();
const KeyInput = z.string().uuid();

/** Coded outcomes for the page to word; never a problem body. */
export type VerificationNotice =
  | "requested"
  | "nothing-to-request"
  | "sign-in"
  | "not-allowed"
  | "unavailable";

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
}

function noticeFor(error: unknown): VerificationNotice {
  if (error instanceof ApiProblemError) {
    if (error.status === 401) return "sign-in";
    if (error.status === 403 || error.status === 404) return "not-allowed";
  }
  return "unavailable";
}

export type VerificationLoad =
  | { readonly ok: true; readonly value: CompanyVerificationDto }
  | { readonly ok: false; readonly notice: VerificationNotice };

export async function loadCompanyVerification(
  rawCompanyId: string,
): Promise<VerificationLoad> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  if (!companyId.success) return { ok: false, notice: "not-allowed" };
  const current = await session();
  if (current === null) return { ok: false, notice: "sign-in" };
  try {
    return {
      ok: true,
      value: await getCompanyVerification(current, companyId.data),
    };
  } catch (error) {
    return { ok: false, notice: noticeFor(error) };
  }
}

/**
 * The form's action. The idempotency key is minted when the page renders
 * and travels in the form, so a double submit or a retry of the same
 * render is the same request.
 */
export async function requestVerificationAction(
  formData: FormData,
): Promise<never> {
  const companyId = CompanyIdInput.safeParse(formData.get("companyId"));
  const key = KeyInput.safeParse(formData.get("requestKey"));
  if (!companyId.success || !key.success) {
    redirect("/verification?notice=not-allowed");
  }
  const current = await session();
  if (current === null) redirect("/verification?notice=sign-in");
  let notice: VerificationNotice;
  try {
    const before = await getCompanyVerification(current, companyId.data);
    await requestCompanyVerification(current, companyId.data, key.data);
    notice = before.requestable ? "requested" : "nothing-to-request";
  } catch (error) {
    notice = noticeFor(error);
  }
  redirect(`/verification?notice=${notice}`);
}
