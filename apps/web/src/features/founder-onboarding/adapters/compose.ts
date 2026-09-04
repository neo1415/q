import type { FounderOnboardingAdapter } from "@capital-q/config/web";

import { API_ADAPTER_NAME, createFounderApiRuntimePort } from "./api-port";
import type { FounderOnboardingClient } from "./client";
import {
  createFixtureRuntimePort,
  FIXTURE_ADAPTER_NAME,
  FIXTURE_SEEDS,
  type FixtureSeed,
} from "./fixture-port";
import { createRuntimeFounderClient } from "./runtime-port";
import { createUnavailableFounderOnboardingClient } from "./unavailable-client";

/**
 * Explicit composition. The server page reads the validated web config and
 * passes the adapter name down; the browser builds exactly that client.
 * There is no fallback path: a missing or failing backend produces the
 * unavailable surface or an honest error, never the fixture.
 */
export function createFounderOnboardingClient(input: {
  readonly adapter: FounderOnboardingAdapter;
  readonly seed?: string | undefined;
}): FounderOnboardingClient {
  switch (input.adapter) {
    case "api":
      return createRuntimeFounderClient(createFounderApiRuntimePort(), {
        adapter: API_ADAPTER_NAME,
        synthetic: false,
      });
    case "fixture":
      return createRuntimeFounderClient(
        createFixtureRuntimePort({
          storage: typeof window === "undefined" ? null : window.sessionStorage,
          seed: parseSeed(input.seed),
        }),
        { adapter: FIXTURE_ADAPTER_NAME, synthetic: true },
      );
    case "none":
      return createUnavailableFounderOnboardingClient();
  }
}

function parseSeed(value: string | undefined): FixtureSeed | undefined {
  return (FIXTURE_SEEDS as readonly string[]).includes(value ?? "")
    ? (value as FixtureSeed)
    : undefined;
}
