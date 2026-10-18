// pnpm exec vitest run --config scripts/seed/flagship/scenario/vitest.config.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { json, outDir } from "./run.mjs";
import { METADATA, runScenario, SCENARIOS } from "./scenario.mjs";

const done = Object.keys(SCENARIOS).filter((slug) =>
  existsSync(join(outDir(slug), "result.json")),
);

describe("illustrative high-growth scenarios", () => {
  it("has at least one committed scenario", () => {
    expect(done.length).toBeGreaterThan(0);
  });

  for (const slug of done) {
    it(`${slug}: reproduces inputs.json and result.json byte for byte`, async () => {
      const { inputs, result } = runScenario(slug);
      for (const [name, value] of [
        ["result.json", result],
        ["inputs.json", inputs],
      ]) {
        const file = join(outDir(slug), name);
        expect(await json(file, value)).toBe(readFileSync(file, "utf8"));
      }
    });

    it(`${slug}: every source is synthetic and never verified or corroborated`, () => {
      const { inputs } = runScenario(slug);
      const all = [...inputs.inputs.claims, ...inputs.inputs.founders];
      for (const s of all) {
        expect(s.metadata).toMatchObject(METADATA);
        if ("evidenceStatus" in s)
          expect(s.evidenceStatus).toBe("SELF_REPORTED");
        else expect(s.documentSupported).toBe(false);
      }
      expect(inputs.inputs.verification.organisation).toBe(false);
      expect(inputs.inputs.verification.domain).toBe(false);
    });
  }
});
