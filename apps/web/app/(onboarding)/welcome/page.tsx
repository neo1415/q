import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { loadWebServerConfig } from "@capital-q/config/web";

import { resolveOnboardingState } from "@/features/q/context";
import { WelcomeScreen } from "@/features/welcome/welcome-screen";
import { fetchMe, updateMe } from "@capital-q/api-client";
import { accountDetails } from "@/auth/account-details";
import { getSessionAccessToken } from "@/auth/session";

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
  // Founder direction 2026-09-30: whoever has not finished onboarding goes
  // straight back into it, with Q. Founder decision 2026-10-03 (demo
  // audit): whoever has lands on the Q page, Home, for both roles.
  const state = await resolveOnboardingState();
  if (params["again"] !== "1") {
    if (state.kind === "UNFINISHED") {
      // F15: back to the screen they were on, not live voice.
      redirect(`/onboarding/${state.journey}?from=home`);
    }
    if (state.kind === "DONE") redirect("/home");
  }
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
    const signedUpWith = await accountDetails();
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
  return (
    <WelcomeScreen
      knownName={knownName}
      knownOrganisation={knownOrganisation}
      returning={returning}
    />
  );
}
