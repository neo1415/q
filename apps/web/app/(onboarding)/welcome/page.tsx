import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { loadWebServerConfig } from "@capital-q/config/web";

import {
  resolveMyOrganisations,
  resolveOnboardingState,
} from "@/features/q/context";
import { WelcomeScreen } from "@/features/welcome/welcome-screen";
import { WorkspaceChoice } from "@/features/welcome/workspace-choice";
import { PendingInvitations } from "@/features/team/pending-invitations";
import { fetchMe, updateMe } from "@capital-q/api-client";
import { accountDetails } from "@/auth/account-details";
import { getSessionAccessToken } from "@/auth/session";
import {
  decideArrival,
  RegistrationJourneySchema,
  WORKSPACE_CHOSEN_COOKIE,
} from "@/auth/registration";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Arrival (CQ-Q-VOICE-001 rework). A person Capital Q has onboarded goes
 * straight to the Q page (Home); anyone else meets Q, which onboards them
 * first.
 * `?again=1` lets anyone come back to it.
 */
export default async function WelcomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = loadWebServerConfig();
  const params = await searchParams;
  if (config.qApiBaseUrl === undefined) {
    redirect("/discover");
  }
  // Founder decision 2026-10-03 (demo audit): whoever is set up lands on
  // the Q page, Home, for both roles. Somebody whose setup is unfinished
  // carries on with it (live re-check 2026-10-31; `decideArrival`).
  //
  // Owner directive 2026-10-16: somebody with more than one workspace picks
  // one on arrival, and somebody who chose a journey at registration is not
  // asked "raising or investing?" again (`decideArrival`).
  const [state, workspaces, signedUpWith, jar] = await Promise.all([
    resolveOnboardingState(),
    resolveMyOrganisations(),
    accountDetails(),
    cookies(),
  ]);
  const arrival = decideArrival({
    state,
    again: params["again"] === "1",
    workspaces,
    workspaceChosen: jar.get(WORKSPACE_CHOSEN_COOKIE)?.value === "1",
    // The account's own choice first; a Google sign-up, which carries no
    // sign-up fields, brings it back on the return path instead.
    intendedJourney:
      signedUpWith.intendedJourney ??
      RegistrationJourneySchema.safeParse(params["journey"]).data ??
      null,
  });
  if (arrival.kind === "HOME") redirect("/home");
  // An unfinished setup carries on where it stopped, in its own journey.
  if (arrival.kind === "RESUME") redirect(`/onboarding/${arrival.journey}`);
  let knownName: string | null = null;
  let knownOrganisation: string | null = null;
  // Back, as opposed to here for the first time: the profile already
  // carried a name before this page load copied one across.
  let returning = false;
  const accessToken = await getSessionAccessToken();
  if (accessToken !== null && config.apiBaseUrl !== undefined) {
    /**
     * What they told us when they signed up, becoming what Capital Q
     * holds.
     *
     * The database trigger that creates a profile reads nothing a person
     * supplied, deliberately, so a name typed into the sign-up form lives
     * on the account and nowhere else until something copies it across.
     * This is that something: first authenticated page load, through the
     * ordinary API, under their own session, and only when the profile
     * does not already have a name — a name they have since changed is
     * theirs and is not overwritten by what they typed once.
     */
    knownOrganisation = signedUpWith.organisationName;
    try {
      const me = await fetchMe({ baseUrl: config.apiBaseUrl, accessToken });
      knownName = me.user.displayName;
      returning = knownName !== null;
      if (knownName === null && signedUpWith.displayName !== null) {
        await updateMe({
          baseUrl: config.apiBaseUrl,
          accessToken,
          body: { displayName: signedUpWith.displayName },
        });
        knownName = signedUpWith.displayName;
      }
    } catch {
      // Not knowing their name is a worse greeting, never a failure.
      knownName = signedUpWith.displayName;
    }
  }
  if (arrival.kind === "CHOOSE_WORKSPACE") {
    return <WorkspaceChoice name={knownName} workspaces={workspaces} />;
  }
  return (
    <WelcomeScreen
      journey={arrival.journey}
      knownName={knownName}
      knownOrganisation={knownOrganisation}
      returning={returning}
      invitations={<PendingInvitations />}
    />
  );
}
