import { describe, expect, it } from "vitest";

import {
  Rfc3339TimestampSchema,
  UtcTimestampSchema,
} from "../src/common/time.js";

// Literal timestamps only. Nothing here reads the clock, so the suite cannot
// drift or fail at a particular time of day.
const UTC = "2026-09-02T08:30:00Z";
const OFFSET = "2026-09-02T10:30:00+01:00";
const NO_ZONE = "2026-09-02T08:30:00";

describe("Rfc3339TimestampSchema", () => {
  it("accepts UTC and a non-UTC offset", () => {
    expect(Rfc3339TimestampSchema.parse(UTC)).toBe(UTC);
    expect(Rfc3339TimestampSchema.parse(OFFSET)).toBe(OFFSET);
  });

  it("rejects a timestamp with no timezone", () => {
    // Without a zone this is not a point in time.
    expect(Rfc3339TimestampSchema.safeParse(NO_ZONE).success).toBe(false);
  });

  it.each(["2026-13-02T08:30:00Z", "2026-09-02", "not-a-date", ""])(
    "rejects the invalid timestamp %s",
    (value) => {
      expect(Rfc3339TimestampSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("UtcTimestampSchema", () => {
  it("accepts UTC", () => {
    expect(UtcTimestampSchema.parse(UTC)).toBe(UTC);
  });

  it("rejects a non-UTC offset", () => {
    // Capital Q-owned timestamps are stored and compared in UTC.
    expect(UtcTimestampSchema.safeParse(OFFSET).success).toBe(false);
  });

  it("rejects a timestamp with no timezone", () => {
    expect(UtcTimestampSchema.safeParse(NO_ZONE).success).toBe(false);
  });
});

describe("wire representation", () => {
  it("is a string, never a Date", () => {
    const parsed: unknown = UtcTimestampSchema.parse(UTC);
    expect(typeof parsed).toBe("string");
    expect(parsed).not.toBeInstanceOf(Date);
  });

  it("rejects a Date object outright", () => {
    // A Date is not JSON and carries the reader's local zone implicitly.
    expect(UtcTimestampSchema.safeParse(new Date(UTC)).success).toBe(false);
  });
});
