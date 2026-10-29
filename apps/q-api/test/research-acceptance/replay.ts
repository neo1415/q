import { existsSync, readFileSync } from "node:fs";

import {
  createReplayResearchProvider,
  RecordedResearchFixtureSchema,
  type RecordedResearchFixture,
} from "@capital-q/q-research/providers/recorded";

import { fixturePaths, type AcceptanceCase } from "./case.js";
import { checkCase, type CheckVerdict } from "./expectations.js";
import { runCase } from "./pipeline.js";
import {
  createReplayModelGateway,
  RecordedModelFixtureSchema,
  type RecordedModelFixture,
} from "./recorded-gateway.js";

/** A case's recordings, or null when it has not been recorded yet. */
export function loadFixtures(id: string): {
  readonly web: RecordedResearchFixture;
  readonly models: RecordedModelFixture;
} | null {
  const paths = fixturePaths(id);
  if (!existsSync(paths.web) || !existsSync(paths.models)) return null;
  return {
    web: RecordedResearchFixtureSchema.parse(
      JSON.parse(readFileSync(paths.web, "utf8")),
    ),
    models: RecordedModelFixtureSchema.parse(
      JSON.parse(readFileSync(paths.models, "utf8")),
    ),
  };
}

export type ReplayOutcome = {
  readonly checks: readonly CheckVerdict[];
  /** Requests the recordings do not hold (a code change altered them). */
  readonly misses: readonly string[];
  readonly queries: readonly string[];
};

/** Replays one recorded case through the real code, with no network. */
export async function replayCase(
  one: AcceptanceCase,
  fixtures: NonNullable<ReturnType<typeof loadFixtures>>,
): Promise<ReplayOutcome> {
  const provider = createReplayResearchProvider({ fixture: fixtures.web });
  const gateway = createReplayModelGateway({ fixture: fixtures.models });
  const recordedAt = Date.parse(fixtures.web.recordedAt);
  const started = Date.now();
  const run = await runCase({
    case: one,
    provider,
    gateway,
    now: () => recordedAt + (Date.now() - started),
  });
  const queries = provider.searches.map((search) => search.query);
  return {
    queries,
    misses: [
      ...provider.misses.map((miss) =>
        miss.kind === "SEARCH" ? `search "${miss.key}"` : `page ${miss.url}`,
      ),
      ...gateway.misses.map(
        (miss) =>
          `model ${miss.taskClass} ${miss.schemaName ?? "text"} ${miss.reason} ${miss.hash.slice(0, 12)}`,
      ),
    ],
    checks: checkCase({
      case: one,
      run,
      queries,
      web: fixtures.web,
      modelCalls: gateway.seen,
    }),
  };
}
