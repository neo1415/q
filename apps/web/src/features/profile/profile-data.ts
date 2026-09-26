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

async function within<T>(read: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READ_BUDGET_MS);
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
  readonly personFindings: FindingsState;
  readonly company: CompanyDto | null;
  readonly investor: InvestorOrganisationDto | null;
  readonly organisationFindings: FindingsState;
  readonly verification: VerificationState;
};

async function findings(
  qSession: ApiSession | null,
  subjectType: ProfileFindingSubjectType,
  subjectId: string,
): Promise<FindingsState> {
  if (qSession === null) return { status: "UNAVAILABLE" };
  const read = await within(() =>
    getProfileFindings(qSession, { subjectType, subjectId }),
  );
  return read === undefined
    ? { status: "UNAVAILABLE" }
    : { status: "READ", findings: read.findings };
}

export async function loadProfilePage(
  session: ApiSession | null,
  context: OwnContext,
): Promise<ProfilePageData> {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const qSession: ApiSession | null =
    qApiBaseUrl === undefined || accessToken === null
      ? null
      : { baseUrl: qApiBaseUrl, accessToken };

  const person =
    session === null ? undefined : await within(() => getMyProfile(session));

  const [personFindings, company, investor] = await Promise.all([
    person === undefined
      ? Promise.resolve<FindingsState>({ status: "UNAVAILABLE" })
      : findings(qSession, "PERSON", person.userId),
    session !== null && context.kind === "FOUNDER"
      ? within(() => getCompany(session, context.companyId))
      : Promise.resolve(undefined),
    session !== null && context.kind === "INVESTOR"
      ? within(() => getCurrentInvestorOrganisation(session))
      : Promise.resolve(undefined),
  ]);

  const [organisationFindings, verification] = await Promise.all([
    company !== undefined
      ? findings(qSession, "COMPANY", company.id)
      : investor !== undefined
        ? findings(qSession, "INVESTOR_ORGANISATION", investor.id)
        : Promise.resolve<FindingsState>({ status: "READ", findings: [] }),
    (async (): Promise<VerificationState> => {
      if (session === null || company === undefined) return { status: "NONE" };
      const read = await within(() =>
        getCompanyVerification(session, company.id),
      );
      return read === undefined
        ? { status: "UNAVAILABLE" }
        : { status: "READ", standings: read.standings };
    })(),
  ]);

  return {
    person: person ?? null,
    personFindings,
    company: company ?? null,
    investor: investor ?? null,
    organisationFindings,
    verification,
  };
}
