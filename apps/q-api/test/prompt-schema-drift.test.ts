import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as core from "@capital-q/q-core";

/**
 * Live 2026-10-30 (0050ac002): PLAN_REVIEW v5 told the model to answer in
 * its own schema (with refs on every defect), while the call validated
 * against the v2 schema, so every review was refused and plans went out
 * unreviewed. A call that names a task must validate against that task's
 * ACTIVE output schema; this reads every such call in q-api's source.
 */

const SRC = join(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** `task: "X"` with the `schema: Name` passed in the same call object. */
function pairs(source: string): { task: string; schema: string }[] {
  const found: { task: string; schema: string }[] = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    const task = /^\s*task:\s*"([A-Z0-9_]+)",?\s*$/u.exec(line)?.[1];
    if (task === undefined) return;
    for (const next of lines.slice(index + 1, index + 20)) {
      if (/^\s*task:/u.test(next)) return;
      const schema = /^\s*schema:\s*([A-Za-z0-9_]+),?\s*$/u.exec(next)?.[1];
      if (schema !== undefined) {
        found.push({ task, schema });
        return;
      }
    }
  });
  return found;
}

const registry = core.createDefaultPromptRegistry();
const exported = core as unknown as Record<string, unknown>;

describe("every model call validates against its prompt's own schema", () => {
  const calls = files(SRC).flatMap((file) =>
    pairs(readFileSync(file, "utf8")).map((pair) => ({
      ...pair,
      file: file.slice(SRC.length + 1),
    })),
  );

  it("finds the calls it checks", () => {
    expect(calls.some((call) => call.task === "PLAN_REVIEW")).toBe(true);
  });

  it("uses the ACTIVE version's output schema", () => {
    const drift = calls.flatMap((call) => {
      const schema = exported[call.schema];
      // A schema local to the caller is not a q-core prompt schema.
      if (schema === undefined) return [];
      let output;
      try {
        output = registry.getActive(call.task as core.PromptId).definition
          .output;
      } catch {
        return [];
      }
      if (output.kind !== "STRUCTURED") return [];
      return output.schema === schema
        ? []
        : [
            `${call.file}: ${call.task} validates with ${call.schema}, but its active version answers in ${output.schemaName} v${String(output.schemaVersion)}`,
          ];
    });
    expect(drift).toEqual([]);
  });
});
