import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIRST_LINE_BUDGET_MS,
  startFirstLineBudget,
} from "../src/first-line.js";

/**
 * HQ-1 (playbook: the first line within a second): a typed turn shows a
 * holding line by FIRST_LINE_BUDGET_MS unless something else was said or
 * decided first. Fake timers: the budget is a latency contract.
 */
describe("the first-line budget (HQ-1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is one second", () => {
    expect(FIRST_LINE_BUDGET_MS).toBe(1_000);
  });

  it("says the line once, at the budget and not before", () => {
    const said: number[] = [];
    const start = Date.now();
    startFirstLineBudget({ say: () => said.push(Date.now() - start) });
    vi.advanceTimersByTime(999);
    expect(said).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(said).toEqual([1_000]);
    vi.advanceTimersByTime(10_000);
    expect(said).toHaveLength(1);
  });

  it("says nothing when the reading or the answer comes first", () => {
    const said: string[] = [];
    const budget = startFirstLineBudget({ say: () => said.push("line") });
    vi.advanceTimersByTime(600);
    budget.cancel();
    vi.advanceTimersByTime(5_000);
    expect(said).toEqual([]);
  });

  it("a cancel after the line is a no-op", () => {
    const said: string[] = [];
    const budget = startFirstLineBudget({ say: () => said.push("line") });
    vi.advanceTimersByTime(1_000);
    budget.cancel();
    expect(said).toEqual(["line"]);
  });
});
