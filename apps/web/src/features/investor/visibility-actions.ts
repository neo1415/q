"use server";

import { z } from "zod";

import {
  ApiProblemError,
  getInvestorNetworkPreview,
  getInvestorOrganisation,
  setInvestorVisibility,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type {
  InvestorNetworkPreview,
  InvestorOrganisationDto,
  InvestorVisibilityChoice,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Investor visibility, server side. The mirror of the founder's own
 * actions: reads the investor organisation and the network projection
 * through the API under the person's session, and records the intentional
 * choice of who may see the declared profile. No rule lives here.
 */

export type InvestorVisibilityActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const InvestorIdInput = z.string().uuid();
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

function translate(error: unknown): InvestorVisibilityActionResult<never> {
  if (error instanceof ApiProblemError) {
    if (error.status === 401) {
      return { ok: false, message: "Please sign in again to continue." };
    }
    if (error.status === 403) {
      return {
        ok: false,
        message:
          "Only someone who can edit the investor profile can change who sees it.",
      };
    }
    if (error.status === 409) {
      return {
        ok: false,
        message:
          "The profile changed since this page was opened. Reload and try again.",
      };
    }
    if (error.status === 404) {
      return { ok: false, message: "That investor profile isn't available." };
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

export type InvestorVisibilityOverview = {
  readonly investor: InvestorOrganisationDto;
  readonly preview: InvestorNetworkPreview;
};

export async function loadInvestorVisibilityAction(
  rawInvestorOrganisationId: string,
): Promise<InvestorVisibilityActionResult<InvestorVisibilityOverview>> {
  const investorOrganisationId = InvestorIdInput.safeParse(
    rawInvestorOrganisationId,
  );
  if (!investorOrganisationId.success) {
    return { ok: false, message: "That investor profile isn't available." };
  }
  const current = await session();
  if (current === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const [investor, preview] = await Promise.all([
      getInvestorOrganisation(current, investorOrganisationId.data),
      getInvestorNetworkPreview(current, investorOrganisationId.data),
    ]);
    return { ok: true, value: { investor, preview } };
  } catch (error) {
    return translate(error);
  }
}

export async function setInvestorVisibilityAction(
  rawInvestorOrganisationId: string,
  rawVisibility: string,
  rawExpectedVersion: number,
): Promise<InvestorVisibilityActionResult<InvestorOrganisationDto>> {
  const investorOrganisationId = InvestorIdInput.safeParse(
    rawInvestorOrganisationId,
  );
  const visibility = ChoiceInput.safeParse(rawVisibility);
  const expectedVersion = VersionInput.safeParse(rawExpectedVersion);
  if (
    !investorOrganisationId.success ||
    !visibility.success ||
    !expectedVersion.success
  ) {
    return { ok: false, message: "That request couldn't be made." };
  }
  const current = await session();
  if (current === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const choice: InvestorVisibilityChoice = visibility.data;
    const investor = await setInvestorVisibility(
      current,
      investorOrganisationId.data,
      { visibility: choice, expectedVersion: expectedVersion.data },
    );
    return { ok: true, value: investor };
  } catch (error) {
    return translate(error);
  }
}
