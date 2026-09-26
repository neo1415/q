"use server";

import { z } from "zod";

import {
  ApiProblemError,
  updateCompany,
  updateInvestorOrganisation,
  updateMyProfile,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  COMPANY_EDITABLE_FIELDS,
  INVESTOR_EDITABLE_FIELDS,
  PERSON_EDITABLE_FIELDS,
  UpdateCompanyRequestSchema,
  UpdateInvestorOrganisationRequestSchema,
  UpdatePersonProfileRequestSchema,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Profile edits from the page (BIZ-002), server side.
 *
 * One field at a time, with the version the page read. Each goes through
 * the same owning-context command Q's approved actions use: the person's
 * own profile through the person-profile store, the company through the
 * companies service (company.edit), the investor organisation through the
 * investors service (investor.edit). The token never reaches the browser,
 * and nothing here decides who may edit what -- the API does, again, on
 * every call. The ids are input, never proof.
 *
 * A retried save is safe: the write path treats a replay of a change that
 * already landed as success. A save against a version someone else (or Q)
 * has moved on answers CONFLICT, and the page says so instead of
 * overwriting.
 */

export type ProfileSaveResult =
  | {
      readonly ok: true;
      readonly value: string | null;
      readonly version: number;
    }
  | {
      readonly ok: false;
      readonly reason: "CONFLICT" | "INVALID" | "DENIED" | "UNAVAILABLE";
      readonly message: string;
    };

const IdInput = z.string().uuid();
const VersionInput = z.number().int().min(1);
const ValueInput = z.string().max(8000).nullable();

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
}

function translate(error: unknown): ProfileSaveResult {
  if (error instanceof ApiProblemError) {
    if (error.status === 409) {
      return {
        ok: false,
        reason: "CONFLICT",
        message:
          "This profile changed since the page was opened, perhaps through Q. Reload to see the latest, then make your change again.",
      };
    }
    if (error.status === 401) {
      return {
        ok: false,
        reason: "DENIED",
        message: "Please sign in again to continue.",
      };
    }
    if (error.status === 403) {
      return {
        ok: false,
        reason: "DENIED",
        message:
          "Your role doesn't include editing this profile. An administrator of your organisation can.",
      };
    }
    if (error.status === 404) {
      return {
        ok: false,
        reason: "DENIED",
        message: "This profile isn't available to you.",
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        ok: false,
        reason: "INVALID",
        message: "That value doesn't fit this field.",
      };
    }
  }
  return {
    ok: false,
    reason: "UNAVAILABLE",
    message: "Capital Q couldn't save that just now. Please try again.",
  };
}

const INVALID: ProfileSaveResult = {
  ok: false,
  reason: "INVALID",
  message: "That value doesn't fit this field.",
};

const SIGNED_OUT: ProfileSaveResult = {
  ok: false,
  reason: "DENIED",
  message: "Please sign in again to continue.",
};

export async function savePersonFieldAction(
  rawField: string,
  rawValue: string | null,
  rawVersion: number,
): Promise<ProfileSaveResult> {
  const field = z.enum(PERSON_EDITABLE_FIELDS).safeParse(rawField);
  const value = ValueInput.safeParse(rawValue);
  const version = VersionInput.safeParse(rawVersion);
  if (!field.success || !value.success || !version.success) return INVALID;
  const input = UpdatePersonProfileRequestSchema.safeParse({
    expectedVersion: version.data,
    [field.data]: value.data,
  });
  if (!input.success) return INVALID;
  const current = await session();
  if (current === null) return SIGNED_OUT;
  try {
    const updated = await updateMyProfile(current, input.data);
    return {
      ok: true,
      value: updated[field.data],
      version: updated.version,
    };
  } catch (error) {
    return translate(error);
  }
}

export async function saveCompanyFieldAction(
  rawCompanyId: string,
  rawField: string,
  rawValue: string | null,
  rawVersion: number,
): Promise<ProfileSaveResult> {
  const companyId = IdInput.safeParse(rawCompanyId);
  const field = z.enum(COMPANY_EDITABLE_FIELDS).safeParse(rawField);
  const value = ValueInput.safeParse(rawValue);
  const version = VersionInput.safeParse(rawVersion);
  if (
    !companyId.success ||
    !field.success ||
    !value.success ||
    !version.success
  ) {
    return INVALID;
  }
  const input = UpdateCompanyRequestSchema.safeParse({
    expectedVersion: version.data,
    [field.data]: value.data,
  });
  if (!input.success) return INVALID;
  const current = await session();
  if (current === null) return SIGNED_OUT;
  try {
    const updated = await updateCompany(current, companyId.data, input.data);
    return {
      ok: true,
      value: updated[field.data],
      version: updated.version,
    };
  } catch (error) {
    return translate(error);
  }
}

export async function saveInvestorFieldAction(
  rawInvestorOrganisationId: string,
  rawField: string,
  rawValue: string | null,
  rawVersion: number,
): Promise<ProfileSaveResult> {
  const investorOrganisationId = IdInput.safeParse(rawInvestorOrganisationId);
  const field = z.enum(INVESTOR_EDITABLE_FIELDS).safeParse(rawField);
  const value = ValueInput.safeParse(rawValue);
  const version = VersionInput.safeParse(rawVersion);
  if (
    !investorOrganisationId.success ||
    !field.success ||
    !value.success ||
    !version.success
  ) {
    return INVALID;
  }
  const input = UpdateInvestorOrganisationRequestSchema.safeParse({
    expectedVersion: version.data,
    [field.data]: value.data,
  });
  if (!input.success) return INVALID;
  const current = await session();
  if (current === null) return SIGNED_OUT;
  try {
    const updated = await updateInvestorOrganisation(
      current,
      investorOrganisationId.data,
      input.data,
    );
    return {
      ok: true,
      value: updated[field.data],
      version: updated.version,
    };
  } catch (error) {
    return translate(error);
  }
}
