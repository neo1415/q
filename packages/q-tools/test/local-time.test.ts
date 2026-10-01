import { describe, expect, it } from "vitest";

import { LocalWhenSchema, resolveLocalWhen } from "../src/tools/local-time.js";

/**
 * "2 PM tomorrow" resolved by code in the person's zone (live test
 * 2026-09-28 #2), against a fixed clock, across zones and DST.
 */
const at = (iso: string) => new Date(iso);

function ok(result: ReturnType<typeof resolveLocalWhen>): string {
  if (result.kind !== "OK") throw new Error(`expected OK, got ${result.kind}`);
  return result.instant.toISOString();
}

describe("resolveLocalWhen", () => {
  it("resolves tomorrow 14:00 in London summer time", () => {
    expect(
      ok(
        resolveLocalWhen(
          { day: "tomorrow", time: "14:00" },
          "Europe/London",
          at("2026-09-28T10:00:00Z"),
        ),
      ),
    ).toBe("2026-09-29T13:00:00.000Z");
  });

  it("takes 'tomorrow' from the person's own date, not the server's", () => {
    // 22:30 on the 28th in Los Angeles is already the 29th in UTC.
    expect(
      ok(
        resolveLocalWhen(
          { day: "tomorrow", time: "14:00" },
          "America/Los_Angeles",
          at("2026-09-29T05:30:00Z"),
        ),
      ),
    ).toBe("2026-09-29T21:00:00.000Z");
    // 01:00 on the 29th in Tokyo is still the 28th in UTC.
    expect(
      ok(
        resolveLocalWhen(
          { day: "tomorrow", time: "14:00" },
          "Asia/Tokyo",
          at("2026-09-28T16:00:00Z"),
        ),
      ),
    ).toBe("2026-09-30T05:00:00.000Z");
  });

  it("resolves across a clock change on the day named", () => {
    // London leaves summer time on Sunday 25 October 2026.
    expect(
      ok(
        resolveLocalWhen(
          { day: "tomorrow", time: "14:00" },
          "Europe/London",
          at("2026-10-24T12:00:00Z"),
        ),
      ),
    ).toBe("2026-10-25T14:00:00.000Z");
    // New York springs forward on Sunday 14 March 2027.
    expect(
      ok(
        resolveLocalWhen(
          { date: "2027-03-14", time: "09:00" },
          "America/New_York",
          at("2027-03-10T12:00:00Z"),
        ),
      ),
    ).toBe("2027-03-14T13:00:00.000Z");
  });

  it("refuses only times the clocks skip or repeat", () => {
    expect(
      resolveLocalWhen(
        { date: "2027-03-28", time: "01:30" },
        "Europe/London",
        at("2027-03-20T12:00:00Z"),
      ).kind,
    ).toBe("SKIPPED_BY_CLOCK_CHANGE");
    expect(
      resolveLocalWhen(
        { date: "2026-10-25", time: "01:30" },
        "Europe/London",
        at("2026-10-20T12:00:00Z"),
      ).kind,
    ).toBe("REPEATED_BY_CLOCK_CHANGE");
  });

  it("reads a weekday as the next one after today", () => {
    // Monday 28 September 2026.
    const now = at("2026-09-28T08:00:00Z");
    expect(
      ok(resolveLocalWhen({ day: "friday", time: "09:00" }, "UTC", now)),
    ).toBe("2026-10-02T09:00:00.000Z");
    expect(
      ok(resolveLocalWhen({ day: "monday", time: "09:00" }, "UTC", now)),
    ).toBe("2026-10-05T09:00:00.000Z");
    expect(
      ok(resolveLocalWhen({ day: "today", time: "17:00" }, "UTC", now)),
    ).toBe("2026-09-28T17:00:00.000Z");
  });

  it("accepts a weekday that agrees with its date and refuses one that does not", () => {
    const now = at("2026-09-28T08:00:00Z");
    expect(
      ok(
        resolveLocalWhen(
          { day: "wednesday", date: "2026-09-30", time: "10:00" },
          "Europe/Paris",
          now,
        ),
      ),
    ).toBe("2026-09-30T08:00:00.000Z");
    expect(
      resolveLocalWhen(
        { day: "tomorrow", date: "2026-10-03", time: "10:00" },
        "Europe/Paris",
        now,
      ).kind,
    ).toBe("DAY_CONFLICT");
  });

  it("never falls back to UTC, and refuses a past time", () => {
    const now = at("2026-09-28T15:00:00Z");
    expect(
      resolveLocalWhen({ day: "tomorrow", time: "14:00" }, undefined, now).kind,
    ).toBe("NO_TIME_ZONE");
    expect(
      resolveLocalWhen({ day: "tomorrow", time: "14:00" }, "Mars/Olympus", now)
        .kind,
    ).toBe("NO_TIME_ZONE");
    expect(
      resolveLocalWhen({ day: "today", time: "14:00" }, "Europe/London", now)
        .kind,
    ).toBe("PAST");
    expect(resolveLocalWhen({ time: "14:00" }, "Europe/London", now).kind).toBe(
      "NO_DAY",
    );
  });
});

describe('a span from now (live 2026-10-01: "remind me in 2 minutes")', () => {
  const now = new Date("2026-10-01T11:45:00Z");
  it("resolves to now plus the span, with or without a known zone", () => {
    expect(
      resolveLocalWhen({ inMinutes: 2 }, "Africa/Lagos", now),
    ).toMatchObject({
      kind: "OK",
      instant: new Date("2026-10-01T11:47:00Z"),
      timeZone: "Africa/Lagos",
    });
    expect(resolveLocalWhen({ inMinutes: 60 }, undefined, now)).toMatchObject({
      kind: "OK",
      instant: new Date("2026-10-01T12:45:00Z"),
    });
  });

  it("is a span or a clock time, never both and never neither", () => {
    expect(LocalWhenSchema.safeParse({ inMinutes: 2 }).success).toBe(true);
    expect(
      LocalWhenSchema.safeParse({ inMinutes: 2, time: "11:47" }).success,
    ).toBe(false);
    expect(LocalWhenSchema.safeParse({ day: "today" }).success).toBe(false);
    expect(
      LocalWhenSchema.safeParse({ day: "today", time: "11:47" }).success,
    ).toBe(true);
  });
});
