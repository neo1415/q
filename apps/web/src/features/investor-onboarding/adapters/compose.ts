import type { FounderOnboardingAdapter } from "@capital-q/config/web";

import { createUnavailableClient } from "../../onboarding-kit/client";
import { API_ADAPTER_NAME, createInvestorApiRuntimePort } from "./api-port";
import type { InvestorOnboardingClient } from "./client";
import {
  createInvestorFixtureRuntimePort,
  FIXTURE_ADAPTER_NAME,
  FIXTURE_SEEDS,
  type FixtureSeed,
} from "./fixture-port";
import { createRuntimeInvestorClient } from "./runtime-port";

/**
 * Explicit composition. The server page reads the validated web config and
 * passes the adapter name down (one setting governs both journeys); the
 * browser builds exactly that client. There is no fallback path: a missing
 * or failing backend produces the unavailable surface or an honest error,
 * never the fixture.
 */
export function createInvestorOnboardingClient(input: {
  readonly adapter: FounderOnboardingAdapter;
  readonly seed?: string | undefined;
}): InvestorOnboardingClient {
  switch (input.adapter) {
    case "api":
      return createRuntimeInvestorClient(createInvestorApiRuntimePort(), {
        adapter: API_ADAPTER_NAME,
        synthetic: false,
      });
    case "fixture":
      return createRuntimeInvestorClient(
        createInvestorFixtureRuntimePort({
          storage: typeof window === "undefined" ? null : window.sessionStorage,
          seed: parseSeed(input.seed),
        }),
        { adapter: FIXTURE_ADAPTER_NAME, synthetic: true },
      );
    case "none":
      return createUnavailableClient(
        "Investor setup isn't available on this build yet.",
      );
  }
}

function parseSeed(value: string | undefined): FixtureSeed | undefined {
  return (FIXTURE_SEEDS as readonly string[]).includes(value ?? "")
    ? (value as FixtureSeed)
    : undefined;
}
