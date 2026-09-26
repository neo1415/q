import "server-only";

import {
  getCompany,
  getCompanyVerification,
  getCurrentInvestorOrganisation,
  getMyProfile,
  getProfileFindings,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type {
  CompanyDto,
  InvestorOrganisationDto,
  PersonProfileDto,
  ProfileFindingSubjectType,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";
import type { OwnContext } from "@/features/q/context";

import type { FindingsState, VerificationState } from "./profile-enrichment";

/**
 * Everything the profile page shows, read on the server under the
 * person's own session (BIZ-002). Each read is independent and bounded:
 * one that fails becomes "couldn't be read" for its own section and never
 * holds the page or hides another section. Nothing here decides access --
 * each read is the API's answer for this person.
 */

const READ_BUDGET_MS = 2500;
/**
 * Findings stream in their own Suspense boundary and hold nothing else, so
 * they may take longer: the Q API plans each read through the Context
 * Firewall before it touches a row.
 */
const FINDINGS_BUDGET_MS = 8000;

async function within<T>(
  read: () => Promise<T>,
  budgetMs: number = READ_BUDGET_MS,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), budgetMs);
  });
  try {
    return await Promise.race([read(), late]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export type ProfilePageData = {
  readonly person: PersonProfileDto | null;
  readonly company: CompanyDto | null;
  readonly investor: InvestorOrganisationDto | null;
  readonly verification: VerificationState;
};

/** What Q found about one of the person's own subjects, under their Q API session. */
export async function loadProfileFindings(
  subjectType: ProfileFindingSubjectType,
  subjectId: string,
): Promise<FindingsState> {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) {
    return { status: "UNAVAILABLE" };
  }
  const read = await within(
    () =>
      getProfileFindings(
        { baseUrl: qApiBaseUrl, accessToken },
        { subjectType, subjectId },
      ),
    FINDINGS_BUDGET_MS,
  );
  return read === undefined
    ? { status: "UNAVAILABLE" }
    : { status: "READ", findings: read.findings };
}

export async function loadProfilePage(
  session: ApiSession | null,
  context: OwnContext,
): Promise<ProfilePageData> {
  const [person, company, investor] = await Promise.all([
    session === null
      ? Promise.resolve(undefined)
      : within(() => getMyProfile(session)),
    session !== null && context.kind === "FOUNDER"
      ? within(() => getCompany(session, context.companyId))
      : Promise.resolve(undefined),
    session !== null && context.kind === "INVESTOR"
      ? within(() => getCurrentInvestorOrganisation(session))
      : Promise.resolve(undefined),
  ]);

  const verification = await (async (): Promise<VerificationState> => {
    if (session === null || company === undefined) return { status: "NONE" };
    const read = await within(() =>
      getCompanyVerification(session, company.id),
    );
    return read === undefined
      ? { status: "UNAVAILABLE" }
      : { status: "READ", standings: read.standings };
  })();

  return {
    person: person ?? null,
    company: company ?? null,
    investor: investor ?? null,
    verification,
  };
}
