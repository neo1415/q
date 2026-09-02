import type { Metadata } from "next";

import { loadWebServerConfig } from "@capital-q/config/web";

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
  const rawSeed = params["fixture"];
  const seed =
    config.founderOnboardingAdapter === "fixture" && typeof rawSeed === "string"
      ? rawSeed
      : undefined;

  return (
    <FounderOnboardingScreen
      adapter={config.founderOnboardingAdapter}
      seed={seed}
    />
  );
}
