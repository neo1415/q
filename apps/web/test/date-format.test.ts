import { describe, expect, it } from "vitest";

import {
  formatDay,
  formatDayTime,
  formatLongDay,
} from "../src/components/date-format";

/** R30 #20: one way to write a date, and never a raw ISO string. */
describe("date formatting", () => {
  it("writes a calendar date in British order, without a time-zone shift", () => {
    expect(formatDay("2022-09-05")).toBe("5 Sept 2022");
    expect(formatLongDay("2022-09-05")).toBe("5 September 2022");
  });

  it("writes an instant with its day first, never the US order", () => {
    expect(formatDayTime("2026-09-27T06:54:00Z")).toMatch(
      /^\d{1,2} Sept 2026, \d{2}:\d{2}$/,
    );
  });

  it("returns what is not a date as it came", () => {
    expect(formatDay("not a date")).toBe("not a date");
  });
});
