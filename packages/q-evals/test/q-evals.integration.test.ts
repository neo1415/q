import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  Q_EVAL_HARD_INVARIANTS,
  Q_EVAL_MARKERS,
  QEvalRunResultSchema,
} from "../src/contracts/index.js";
import { datasetsForProfile } from "../src/profiles/index.js";
import { runQEvals } from "../src/runner/index.js";

/**
 * The CI_CORE profile as CI runs it (CQ-Q-010 §28, §83, §106): the
 * scripted model, the local database, every dataset. What CI asserts is
 * the release gate — every hard invariant PASS, no deterministic failure —
 * and that the machine-readable result is the typed contract with nothing
 * private in it.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("Q eval harness — CI_CORE against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "8",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("passes the release gate with the scripted model and spends nothing", async () => {
    const result = await runQEvals(datasetsForProfile("CI_CORE"), {
      db,
      profile: "CI_CORE",
      providerMode: "FAKE",
    });
    expect(QEvalRunResultSchema.safeParse(result).success).toBe(true);
    for (const invariant of Q_EVAL_HARD_INVARIANTS) {
      expect(result.hardInvariants[invariant], invariant).toBe("PASS");
    }
    expect(result.status).not.toBe("FAIL");
    expect(result.exitCode).toBe(0);
    expect(result.cases.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(result.environment.providers.every((p) => p.mode === "FAKE")).toBe(
      true,
    );
    // Every case ran in its own Q run; nothing shared state.
    const runIds = result.cases
      .map((c) => c.execution?.runId)
      .filter((id): id is string => typeof id === "string");
    expect(new Set(runIds).size).toBe(runIds.length);
    // The result carries ids, versions, counts and codes; never a marker.
    const text = JSON.stringify(result);
    for (const marker of Object.values(Q_EVAL_MARKERS)) {
      expect(text).not.toContain(marker);
    }
    expect(text).not.toMatch(/API_KEY|apiKey|Bearer /);
    expect(result.environment.orchestrationVersion).toBe("q-orchestrator-v5");
    expect(result.environment.toolVersions.length).toBeGreaterThan(0);
    expect(result.quality.humanReviewNeeded.length).toBeGreaterThan(0);
  }, 180_000);
});
