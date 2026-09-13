"use server";

import { z } from "zod";

import {
  ApiProblemError,
  getCompany,
  getCompanyNetworkPreview,
  setCompanyVisibility,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type {
  CompanyDto,
  CompanyNetworkPreview,
  CompanyVisibilityChoice,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Visibility & Discovery (CQ-PRE-REC-001 §31-§35), server side.
 *
 * Reads the company and the network projection through the API under the
 * person's own session, and records the founder's intentional choice of
 * who may see the declared profile. The browser never sees a token, and no
 * rule about visibility lives here: the companies service decides who may
 * change it and what the projection contains.
 */

export type VisibilityActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const CompanyIdInput = z.string().uuid();
const ChoiceInput = z.enum(["organisation_private", "network_visible"]);
const VersionInput = z.number().int().min(1);

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) {
    return null;
  }
  return { baseUrl: apiBaseUrl, accessToken };
}

function translate(error: unknown): VisibilityActionResult<never> {
  if (error instanceof ApiProblemError) {
    if (error.status === 401) {
      return { ok: false, message: "Please sign in again to continue." };
    }
    if (error.status === 403) {
      return {
        ok: false,
        message:
          "Only someone who can edit the company profile can change who sees it.",
      };
    }
    if (error.status === 409) {
      return {
        ok: false,
        message:
          "The company changed since this page was opened. Reload and try again.",
      };
    }
    if (error.status === 404) {
      return { ok: false, message: "That company isn't available here." };
    }
    if (error.status < 500) {
      return {
        ok: false,
        message: error.problem?.detail ?? "That request couldn't be made.",
      };
    }
  }
  return {
    ok: false,
    message: "Capital Q couldn't complete that right now. Please try again.",
  };
}

export type VisibilityOverview = {
  readonly company: CompanyDto;
  readonly preview: CompanyNetworkPreview;
};

export async function loadVisibilityOverviewAction(
  rawCompanyId: string,
): Promise<VisibilityActionResult<VisibilityOverview>> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  if (!companyId.success) {
    return { ok: false, message: "That company isn't available here." };
  }
  const current = await session();
  if (current === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const [company, preview] = await Promise.all([
      getCompany(current, companyId.data),
      getCompanyNetworkPreview(current, companyId.data),
    ]);
    return { ok: true, value: { company, preview } };
  } catch (error) {
    return translate(error);
  }
}

export async function setCompanyVisibilityAction(
  rawCompanyId: string,
  rawVisibility: string,
  rawExpectedVersion: number,
): Promise<VisibilityActionResult<CompanyDto>> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  const visibility = ChoiceInput.safeParse(rawVisibility);
  const expectedVersion = VersionInput.safeParse(rawExpectedVersion);
  if (!companyId.success || !visibility.success || !expectedVersion.success) {
    return { ok: false, message: "That request couldn't be made." };
  }
  const current = await session();
  if (current === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const choice: CompanyVisibilityChoice = visibility.data;
    const company = await setCompanyVisibility(current, companyId.data, {
      visibility: choice,
      expectedVersion: expectedVersion.data,
    });
    return { ok: true, value: company };
  } catch (error) {
    return translate(error);
  }
}
