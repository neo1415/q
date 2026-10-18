import { describe, expect, it } from "vitest";

import {
  insideWindows,
  slotLabel,
  wallClock,
  workingHourSlots,
} from "../src/composition/slots.js";

/**
 * Times offered without a calendar (2026-10-02): working hours in the
 * owner's own zone, wherever that zone's offset falls -- whole, half or
 * quarter hours, either side of UTC, across a DST change.
 */

const offer = (timeZone: string, from: string, count = 3) =>
  workingHourSlots({
    from: new Date(from),
    until: new Date(new Date(from).getTime() + 14 * 24 * 3_600_000),
    timeZone,
    durationMinutes: 30,
    count,
  });

describe("workingHourSlots", () => {
  it.each([
    "Africa/Lagos",
    "Asia/Kolkata",
    "Asia/Kathmandu",
    "America/New_York",
    "Pacific/Auckland",
    "America/St_Johns",
  ])(
    "offers weekday 10:00 starts in %s, one per day, never before `from`",
    (zone) => {
      const from = "2026-10-02T15:00:00Z"; // a Friday
      const slots = offer(zone, from);
      expect(slots).toHaveLength(3);
      const days = new Set<string>();
      for (const slot of slots) {
        expect(slot.getTime()).toBeGreaterThanOrEqual(Date.parse(from));
        const local = wallClock(slot, zone);
        expect([10, 14]).toContain(local.hour);
        expect(local.minute).toBe(0);
        expect(local.day).toBeGreaterThanOrEqual(1);
        expect(local.day).toBeLessThanOrEqual(5);
        days.add(
          new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(slot),
        );
      }
      expect(days.size).toBe(3);
    },
  );

  it("keeps 10:00 local across the US end of daylight time", () => {
    // DST ends Sunday 1 Nov 2026 in New York: 10:00 is 14:00Z before, 15:00Z after.
    const slots = offer("America/New_York", "2026-10-29T12:00:00Z", 3);
    expect(slots.map((slot) => slot.toISOString())).toEqual([
      "2026-10-29T14:00:00.000Z",
      "2026-10-30T14:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
    ]);
  });

  it("falls back to UTC for a zone it doesn't know", () => {
    const slots = offer("Mars/Olympus_Mons", "2026-10-02T15:00:00Z", 1);
    expect(slots[0]?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
    expect(slotLabel(slots[0] ?? new Date(), "Mars/Olympus_Mons")).toContain(
      "UTC",
    );
  });
});

describe("insideWindows", () => {
  const weekdays = [{ days: [1, 2, 3, 4, 5], startHour: 10, endHour: 16 }];
  it("needs the whole call inside the hours, on one local day", () => {
    // 15:45 Lagos (14:45Z) for 30 minutes runs past 16:00.
    expect(
      insideWindows(
        new Date("2026-10-05T14:45:00Z"),
        30,
        weekdays,
        "Africa/Lagos",
      ),
    ).toBe(false);
    expect(
      insideWindows(
        new Date("2026-10-05T14:00:00Z"),
        30,
        weekdays,
        "Africa/Lagos",
      ),
    ).toBe(true);
    // Saturday is not a working day.
    expect(
      insideWindows(
        new Date("2026-10-03T10:00:00Z"),
        30,
        weekdays,
        "Africa/Lagos",
      ),
    ).toBe(false);
  });
});
