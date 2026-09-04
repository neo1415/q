import type { Metadata } from "next";

import { loadWebServerConfig } from "@capital-q/config/web";

import { InvestorOnboardingScreen } from "@/features/investor-onboarding";

export const metadata: Metadata = {
  title: "Investor setup",
  robots: { index: false },
};

// The adapter is runtime server configuration, not a build-time constant.
export const dynamic = "force-dynamic";

/**
 * Server composition point for investor onboarding. One adapter setting
 * governs both onboarding journeys. The `fixture` query seed is honoured only
 * when the fixture adapter is configured; on any other build it is ignored.
 */
export default async function InvestorOnboardingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = loadWebServerConfig();
  const params = await searchParams;
  const rawSeed = params["fixture"];
  const seed =
    config.founderOnboardingAdapter === "fixture" && typeof rawSeed === "string"
      ? rawSeed
      : undefined;

  return (
    <InvestorOnboardingScreen
      adapter={config.founderOnboardingAdapter}
      seed={seed}
    />
  );
}
