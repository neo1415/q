import type { Metadata } from "next";

import { loadWebServerConfig } from "@capital-q/config/web";

import { accountDetails } from "@/auth/account-details";
import { RegistrationDefaultsProvider } from "@/features/onboarding-kit/registration-defaults";
import { registrationDefaultsFor } from "@/features/onboarding-kit/registration-defaults-for";

import { FounderOnboardingScreen } from "@/features/founder-onboarding";

export const metadata: Metadata = {
  title: "Founder setup",
  robots: { index: false },
};

// The adapter is runtime server configuration, not a build-time constant.
export const dynamic = "force-dynamic";

/**
 * Server composition point for founder onboarding. Reads the validated web
 * config to decide which client the browser composes. The `fixture` query
 * seed is honoured only when the fixture adapter is configured; on any other
 * build it is ignored entirely.
 */
export default async function FounderOnboardingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = loadWebServerConfig();
  const params = await searchParams;
  const startTalking = params["talk"] === "1";
  // Arriving from Q (Home's welcome, or a spoken "let's finish my setup"):
  // Q has already welcomed them, and the screen does not do it twice.
  const greeted = startTalking || params["from"] === "home";
  const openReview = params["review"] === "1";
  const rawSeed = params["fixture"];
  const seed =
    config.founderOnboardingAdapter === "fixture" && typeof rawSeed === "string"
      ? rawSeed
      : undefined;

  // Registration facts as the form's starting values (owner directive
  // 2026-10-16): the organisation typed at sign-up is not asked again.
  const defaults = registrationDefaultsFor("founder", await accountDetails());

  return (
    <RegistrationDefaultsProvider value={defaults}>
      <FounderOnboardingScreen
        adapter={config.founderOnboardingAdapter}
        seed={seed}
        startTalking={startTalking}
        greeted={greeted}
        openReview={openReview}
      />
    </RegistrationDefaultsProvider>
  );
}
