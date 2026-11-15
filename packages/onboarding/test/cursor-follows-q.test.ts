import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { askedOrNextStep } from "../src/runtime/path.js";

/**
 * Live founder re-check 2026-11-15 (64637e8c9), D7: the server's step
 * stayed on F1.founded_year while Q asked the one-line pitch. Q's line
 * moved the cursor (pointAt), then the reading's save of an earlier answer
 * sent it back to the first open step. A save made with Q now keeps the
 * cursor on the step Q's newest line asks.
 */
type Path = Parameters<typeof askedOrNextStep>[0];
type States = Parameters<typeof askedOrNextStep>[1];

const step = (stepKey: string) =>
  ({ stepKey }) as unknown as Path["eligible"][number];
const path = {
  eligible: [
    step("F1.stage"),
    step("F1.founded_year"),
    step("F1.description"),
    step("F1.one_line"),
  ],
} as unknown as Path;
const states = (statuses: Record<string, string>): States =>
  new Map(
    Object.entries(statuses).map(([stepKey, status]) => [
      stepKey,
      { stepKey, status },
    ]),
  ) as unknown as States;

describe("D7: the cursor follows the step Q is asking", () => {
  it("the run's case: the description saved while Q asks the one-line pitch", () => {
    const after = states({
      "F1.stage": "COMPLETED",
      // Held for their yes, not yet answered.
      "F1.founded_year": "IN_PROGRESS",
      "F1.description": "COMPLETED",
    });
    expect(askedOrNextStep(path, after, "F1.one_line")?.stepKey).toBe(
      "F1.one_line",
    );
    // Before: the first open step, though Q had moved on.
    expect(askedOrNextStep(path, after, undefined)?.stepKey).toBe(
      "F1.founded_year",
    );
  });

  it("a settled or off-path asked step falls back to the first open step", () => {
    const after = states({
      "F1.stage": "COMPLETED",
      "F1.one_line": "SKIPPED",
    });
    expect(askedOrNextStep(path, after, "F1.one_line")?.stepKey).toBe(
      "F1.founded_year",
    );
    expect(askedOrNextStep(path, after, "F6.raising")?.stepKey).toBe(
      "F1.founded_year",
    );
    expect(askedOrNextStep(path, after, null)?.stepKey).toBe("F1.founded_year");
  });

  it("only a save made with Q follows Q's line; the form keeps its own order", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../src/application/use-cases.ts"),
      "utf8",
    );
    const commit = source.slice(
      source.indexOf("async function commitResponse("),
      source.indexOf("return { session, response, changes };"),
    );
    expect(commit).toMatch(/validated\.channel === "CONVERSATION"/u);
    expect(commit).toMatch(/validated\.channel !== "FORM"/u);
    expect(commit).toMatch(/newest\?\.role === "Q"/u);
    expect(commit).toMatch(/askedOrNextStep\(/u);
  });
});
