import "server-only";

import {
  ApiProblemError,
  getCompany,
  getCompanyVerification,
  getCurrentCapitalObjective,
  getCurrentInvestorOrganisation,
  getCurrentOnboardingSession,
  getMyProfile,
  getProfileFindings,
  getProfileImages,
  getTaxonomyNode,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type {
  CompanyDto,
  InvestorOrganisationDto,
  PersonProfileDto,
  ProfileFindingSubjectType,
  ProfileImagesDto,
  ProfileImageSubjectType,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";
import type { OwnContext } from "@/features/q/context";

import {
  answerGroups,
  raiseFromObjective,
  taxonomyIdsIn,
  type AnswerGroup,
  type ProfileJourney,
} from "./profile-answers";
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

export type AnswersState =
  | { readonly status: "READ"; readonly groups: readonly AnswerGroup[] }
  /** No onboarding session for this journey: nothing was ever answered. */
  | { readonly status: "NONE" }
  | { readonly status: "UNAVAILABLE" };

function notFound(error: unknown): boolean {
  return error instanceof ApiProblemError && error.status === 404;
}

/**
 * What the person answered in onboarding (R25), under their own session:
 * their latest onboarding session for the side they act for, taxonomy ids
 * labelled, and -- for a founder -- the canonical capital objective in
 * place of the raise answers once one exists. Each read is bounded; a
 * label that can't be read leaves the answer as "n selected" rather than
 * holding the page.
 */
export async function loadProfileAnswers(
  session: ApiSession | null,
  context: OwnContext,
): Promise<AnswersState> {
  if (session === null) return { status: "UNAVAILABLE" };
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR") {
    return { status: "NONE" };
  }
  const journey: ProfileJourney =
    context.kind === "FOUNDER" ? "founder" : "investor";

  const [view, objective] = await Promise.all([
    within(async () => {
      try {
        return await getCurrentOnboardingSession(session, journey);
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    }),
    context.kind === "FOUNDER"
      ? within(async () => {
          try {
            return await getCurrentCapitalObjective(session, context.companyId);
          } catch (error) {
            if (notFound(error)) return null;
            throw error;
          }
        })
      : Promise.resolve(null),
  ]);

  if (view === undefined) return { status: "UNAVAILABLE" };
  if (view === null) {
    return objective === null || objective === undefined
      ? { status: "NONE" }
      : { status: "READ", groups: [raiseFromObjective(objective)] };
  }

  const ids = taxonomyIdsIn(view);
  const nodes = await Promise.all(
    ids.map((id) => within(() => getTaxonomyNode(session, id))),
  );
  const labels: Record<string, string> = {};
  for (const node of nodes) {
    if (node !== undefined) labels[node.id] = node.displayName;
  }

  const groups = answerGroups(journey, view, labels);
  if (objective === null || objective === undefined) {
    return { status: "READ", groups };
  }
  const raise = raiseFromObjective(objective);
  return {
    status: "READ",
    groups: groups.some((group) => group.id === "raise")
      ? groups.map((group) => (group.id === "raise" ? raise : group))
      : [...groups, raise],
  };
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

/**
 * A subject's current photo and cover, as short-lived signed URLs the
 * browser loads from storage directly. A failed read is "no images": the
 * profile renders with initials and a plain cover.
 */
export async function loadProfileImages(
  session: ApiSession | null,
  subjectType: ProfileImageSubjectType,
  subjectId: string,
): Promise<ProfileImagesDto | null> {
  if (session === null) return null;
  return (
    (await within(() => getProfileImages(session, subjectType, subjectId))) ??
    null
  );
}
