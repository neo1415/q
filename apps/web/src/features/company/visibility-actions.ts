"use server";

import { z } from "zod";

import {
  ApiProblemError,
  assessMarketplaceReadiness,
  getCompany,
  getCompanyNetworkPreview,
  getAudiencePreview,
  getMarketplaceReadiness,
  getVisibilityState,
  revokeVisibilityShare,
  setCompanyVisibility,
  shareWithRelationship,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  VisibilityAudienceSchema,
  type AudiencePreviewDto,
  type CompanyDto,
  type CompanyNetworkPreview,
  type CompanyVisibilityChoice,
  type MarketplaceReadinessAssessment,
  type VisibilityRevokeResultDto,
  type VisibilityShareResultDto,
  type VisibilityStateDto,
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
      return {
        ok: false,
        message: "Your session ended. Sign in again to continue.",
      };
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
        message:
          error.problem?.detail ??
          "That didn't go through. Reload and try again.",
      };
    }
  }
  return {
    ok: false,
    message: "Capital Q couldn't complete that right now. Try again.",
  };
}

export type VisibilityOverview = {
  readonly company: CompanyDto;
  readonly preview: CompanyNetworkPreview;
  /** The readiness policy's answer now; null when it could not be read. */
  readonly readiness: MarketplaceReadinessAssessment | null;
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
    return {
      ok: false,
      message: "Your session ended. Sign in again to continue.",
    };
  }
  try {
    const [company, preview, readiness] = await Promise.all([
      getCompany(current, companyId.data),
      getCompanyNetworkPreview(current, companyId.data),
      // A read of the assessment never writes; a failure here must not
      // take the visibility choice down with it.
      getMarketplaceReadiness(current, companyId.data).catch(() => null),
    ]);
    return { ok: true, value: { company, preview, readiness } };
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
    return {
      ok: false,
      message: "That didn't go through. Reload and try again.",
    };
  }
  const current = await session();
  if (current === null) {
    return {
      ok: false,
      message: "Your session ended. Sign in again to continue.",
    };
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

/**
 * Ask the companies service to reconcile marketplace readiness
 * (CQ-MKT-001). No state travels: the policy decides, and the founder
 * only asks. The returned assessment is what the screen shows.
 */
export async function assessMarketplaceReadinessAction(
  rawCompanyId: string,
): Promise<VisibilityActionResult<MarketplaceReadinessAssessment>> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  if (!companyId.success) {
    return { ok: false, message: "That company isn't available here." };
  }
  const current = await session();
  if (current === null) {
    return {
      ok: false,
      message: "Your session ended. Sign in again to continue.",
    };
  }
  try {
    return {
      ok: true,
      value: await assessMarketplaceReadiness(current, companyId.data),
    };
  } catch (error) {
    return translate(error);
  }
}

// ---------------------------------------------------------------------------
// The visibility control centre (CQ-BIZ-003)
// ---------------------------------------------------------------------------

const UuidInput = z.string().uuid();

async function withSession<T>(
  work: (current: ApiSession) => Promise<T>,
): Promise<VisibilityActionResult<T>> {
  const current = await session();
  if (current === null) {
    return {
      ok: false,
      message: "Your session ended. Sign in again to continue.",
    };
  }
  try {
    return { ok: true, value: await work(current) };
  } catch (error) {
    return translate(error);
  }
}

/** Objects, scopes, active shares and the relationships a share can go to. */
export async function loadVisibilityStateAction(
  rawCompanyId: string,
): Promise<VisibilityActionResult<VisibilityStateDto>> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  if (!companyId.success) {
    return { ok: false, message: "That company isn't available here." };
  }
  return withSession((current) => getVisibilityState(current, companyId.data));
}

/** The company as one audience sees it, decided by the server. */
export async function loadAudiencePreviewAction(
  rawCompanyId: string,
  rawAudience: string,
  rawRelationshipId?: string,
): Promise<VisibilityActionResult<AudiencePreviewDto>> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  const audience = VisibilityAudienceSchema.safeParse(rawAudience);
  const relationshipId =
    rawRelationshipId === undefined
      ? undefined
      : UuidInput.safeParse(rawRelationshipId);
  if (
    !companyId.success ||
    !audience.success ||
    (relationshipId !== undefined && !relationshipId.success)
  ) {
    return { ok: false, message: "That preview couldn't be made." };
  }
  return withSession((current) =>
    getAudiencePreview(
      current,
      companyId.data,
      audience.data,
      relationshipId?.data,
    ),
  );
}

/** Share the current raise with one relationship's investor organisation. */
export async function shareRaiseAction(
  rawCompanyId: string,
  rawRelationshipId: string,
  rawIdempotencyKey: string,
): Promise<VisibilityActionResult<VisibilityShareResultDto>> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  const relationshipId = UuidInput.safeParse(rawRelationshipId);
  const key = z.string().min(8).max(255).safeParse(rawIdempotencyKey);
  if (!companyId.success || !relationshipId.success || !key.success) {
    return {
      ok: false,
      message: "That didn't go through. Reload and try again.",
    };
  }
  return withSession((current) =>
    shareWithRelationship(
      current,
      companyId.data,
      relationshipId.data,
      key.data,
    ),
  );
}

/** Revoke one share: future access removed. */
export async function revokeShareAction(
  rawCompanyId: string,
  rawPolicyId: string,
): Promise<VisibilityActionResult<VisibilityRevokeResultDto>> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  const policyId = UuidInput.safeParse(rawPolicyId);
  if (!companyId.success || !policyId.success) {
    return {
      ok: false,
      message: "That didn't go through. Reload and try again.",
    };
  }
  return withSession((current) =>
    revokeVisibilityShare(current, companyId.data, policyId.data),
  );
}
