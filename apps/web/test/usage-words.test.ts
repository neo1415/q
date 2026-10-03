import { describe, expect, it } from "vitest";

import {
  callsLine,
  dollars,
  headline,
  monthName,
  taskName,
} from "../src/features/billing/usage-words";

describe("Settings → Usage words", () => {
  it("rounds for a person and never shows a float", () => {
    expect(dollars("0")).toBe("$0");
    expect(dollars("0.003000")).toBe("less than $0.01");
    expect(dollars("0.173000")).toBe("$0.17");
    expect(dollars("12.5")).toBe("$12.50");
  });
  it("says the month in a sentence", () => {
    const usage = {
      month: "2026-10",
      totalUsd: "0.173000",
      calls: 5,
      unpricedCalls: 0,
      failedCalls: 0,
      byTask: [],
      instructions: [],
      plan: null,
    };
    expect(headline(usage)).toBe("This month: Q used about $0.17 for you.");
    expect(headline({ ...usage, totalUsd: "0" })).toBe(
      "This month, Q hasn't used anything for you yet.",
    );
    expect(monthName("2026-10")).toBe("October 2026");
    expect(taskName("INSTRUCTION")).toBe("Standing instructions");
  });

  it("says failed calls are not charged, never 'without a price'", () => {
    const base = { month: "2026-10", calls: 620, unpricedCalls: 0 };
    expect(callsLine({ ...base, failedCalls: 130 })).toBe(
      "October 2026, 620 model calls, 130 failed calls, not charged.",
    );
    expect(callsLine({ ...base, failedCalls: 1, unpricedCalls: 2 })).toBe(
      "October 2026, 620 model calls, 1 failed call, not charged, 2 without a price yet (counted at no cost).",
    );
    expect(callsLine({ ...base, calls: 1 })).toBe(
      "October 2026, 1 model call.",
    );
  });
});
