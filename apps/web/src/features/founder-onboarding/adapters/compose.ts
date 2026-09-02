import type { FounderOnboardingAdapter } from "@capital-q/config/web";

import type { FounderOnboardingClient } from "./client";
import {
  createFounderOnboardingFixtureClient,
  FIXTURE_SEEDS,
  type FixtureSeed,
} from "./fixture-client";
import { createUnavailableFounderOnboardingClient } from "./unavailable-client";

/**
 * Explicit composition. The server page reads the validated web config and
 * passes the adapter name down; the browser builds exactly that client.
 * There is no fallback path: a missing or failing backend produces the
 * unavailable surface, never the fixture.
 */
export function createFounderOnboardingClient(input: {
  readonly adapter: FounderOnboardingAdapter;
  readonly seed?: string | undefined;
}): FounderOnboardingClient {
  switch (input.adapter) {
    case "fixture":
      return createFounderOnboardingFixtureClient({
        storage: typeof window === "undefined" ? null : window.sessionStorage,
        seed: parseSeed(input.seed),
      });
    case "none":
      return createUnavailableFounderOnboardingClient();
  }
}

function parseSeed(value: string | undefined): FixtureSeed | undefined {
  return (FIXTURE_SEEDS as readonly string[]).includes(value ?? "")
    ? (value as FixtureSeed)
    : undefined;
}
