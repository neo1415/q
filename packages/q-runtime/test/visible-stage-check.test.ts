import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Q_VISIBLE_STAGES } from "@capital-q/contracts";

/**
 * Every stage the contract lets Q show is one the run-event table accepts.
 *
 * Twice now a stage was added to QVisibleStage and not to run_events'
 * CHECK (document stages, live 2026-10-09; planning stages, live
 * 2026-10-30): the insert failed, showStage only logged it, and the person
 * never saw the stage ("Gathering your situation" was never shown). This
 * reads the migration that last defines the constraint and compares.
 */

const migrations = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

function latestStageCheck(): readonly string[] {
  const files = readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  let latest: string | null = null;
  for (const name of files) {
    const sql = readFileSync(join(migrations, name), "utf8");
    if (/add constraint run_events_visible_stage_check/iu.test(sql)) {
      latest = sql;
    }
  }
  if (latest === null)
    throw new Error("run_events_visible_stage_check not found");
  const body = latest.slice(
    latest.search(/add constraint run_events_visible_stage_check/iu),
  );
  return [...body.matchAll(/'([A-Z_]+)'/gu)].map((match) => match[1] ?? "");
}

describe("run_events_visible_stage_check", () => {
  it("accepts every stage in the QVisibleStage contract, and nothing else", () => {
    const allowed = latestStageCheck();
    expect([...allowed].sort()).toEqual([...Q_VISIBLE_STAGES].sort());
  });
});
