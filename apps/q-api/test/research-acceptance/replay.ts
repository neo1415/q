import { existsSync, readFileSync } from "node:fs";

import {
  createReplayResearchProvider,
  createReplayTime,
  RecordedResearchFixtureSchema,
  type RecordedResearchFixture,
} from "@capital-q/q-research/providers/recorded";

import { fixturePaths, type AcceptanceCase } from "./case.js";
import { checkCase, type CheckVerdict } from "./expectations.js";
import { runCase, type CaseRun } from "./pipeline.js";
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
  /** The replayed run; null when it diverged before finishing. */
  readonly run: CaseRun | null;
};

/**
 * Replays one recorded case through the real code, with no network, on
 * its recorded schedule: the same clock readings, deadlines and order of
 * answers as the live run (q-research providers/recorded.ts).
 */
export async function replayCase(
  one: AcceptanceCase,
  fixtures: NonNullable<ReturnType<typeof loadFixtures>>,
): Promise<ReplayOutcome> {
  const schedule = fixtures.web.schedule;
  if (schedule === null)
    return {
      checks: [],
      misses: ["the recording has no schedule; re-record the case"],
      queries: [],
      run: null,
    };
  const time = createReplayTime(schedule);
  const provider = createReplayResearchProvider({
    fixture: fixtures.web,
    time,
  });
  const gateway = createReplayModelGateway({ fixture: fixtures.models, time });
  let thrown: string | null = null;
  const run = await time
    .drive(() => runCase({ case: one, provider, gateway, time }))
    .catch((error: unknown) => {
      thrown = error instanceof Error ? error.message : String(error);
      return null;
    });
  const queries = provider.searches.map((search) => search.query);
  return {
    queries,
    run,
    misses: [
      ...(thrown === null ? [] : [`the run failed: ${String(thrown)}`]),
      ...time.misses.map((miss) => `schedule: ${miss}`),
      ...provider.misses.map((miss) =>
        miss.kind === "SEARCH"
          ? `search "${miss.key}"`
          : miss.kind === "PAGE"
            ? `page ${miss.url}`
            : `read of ${miss.urls.join(", ")}`,
      ),
      ...gateway.misses.map(
        (miss) =>
          `model ${miss.taskClass} ${miss.schemaName ?? "text"} ${miss.reason} ${miss.hash.slice(0, 12)}`,
      ),
    ],
    checks:
      run === null
        ? []
        : checkCase({
            case: one,
            run,
            queries,
            web: fixtures.web,
            modelCalls: gateway.seen,
          }),
  };
}
