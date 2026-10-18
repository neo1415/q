import { describe, expect, it } from "vitest";

import {
  dollars,
  total,
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
  it("says the month and the total as figures", () => {
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
    expect(total(usage.totalUsd)).toBe("$0.17");
    expect(total("0")).toBe("$0.00");
    expect(monthName("2026-10")).toBe("October 2026");
    expect(taskName("INSTRUCTION")).toBe("Standing instructions");
  });
});
