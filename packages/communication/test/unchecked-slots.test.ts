import { describe, expect, it } from "vitest";

import {
  localParts,
  suggestSlotsWithoutCalendar,
} from "../src/schedule/slots.js";

/**
 * Q room R5: with no calendar connected, Q still suggests three times,
 * from working hours in the person's zone (and the other side's when
 * known), on different working days from tomorrow.
 */
describe("times suggested without a calendar", () => {
  // Friday 9 October 2026, 16:00 in London.
  const now = new Date("2026-10-09T15:00:00Z");

  it("offers three working days from tomorrow, at sociable hours, never the weekend", () => {
    const slots = suggestSlotsWithoutCalendar({
      now,
      durationMinutes: 30,
      timeZone: "Europe/London",
    });
    expect(slots).toHaveLength(3);
    const days = slots.map((slot) => localParts(slot.start, "Europe/London"));
    expect(days.map((day) => day.weekday)).toEqual([1, 2, 3]);
    expect(days.map((day) => `${day.hour}:${day.minute}`)).toEqual([
      "10:0",
      "14:0",
      "11:0",
    ]);
  });

  it("stays inside the other side's working hours too", () => {
    const slots = suggestSlotsWithoutCalendar({
      now,
      durationMinutes: 30,
      timeZone: "Europe/London",
      otherTimeZone: "America/New_York",
    });
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      const there = localParts(slot.start, "America/New_York");
      expect(there.hour).toBeGreaterThanOrEqual(9);
      const here = localParts(slot.start, "Europe/London");
      expect(here.hour * 60 + here.minute + 30).toBeLessThanOrEqual(
        17 * 60 + 30,
      );
    }
  });
});
