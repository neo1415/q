import { describe, expect, it } from "vitest";

import { decodeListCursor, encodeListCursor, lastDays } from "../src/index.js";

const ID = "8f6f0c1e-2c3b-4f7a-9d1e-0a1b2c3d4e5f";

/** T2 browse lists: keyset cursors, never an offset. */
describe("list cursors", () => {
  it("round-trip for the sort they were made for", () => {
    const at = "2026-11-19T10:00:00.000Z";
    expect(
      decodeListCursor(encodeListCursor("newest", at, ID), "newest"),
    ).toEqual({
      key: at,
      id: ID,
    });
    expect(
      decodeListCursor(encodeListCursor("name_asc", "ada", ID), "name_asc"),
    ).toEqual({ key: "ada", id: ID });
  });

  it("are refused for another sort, or when tampered with", () => {
    const at = "2026-11-19T10:00:00.000Z";
    expect(
      decodeListCursor(encodeListCursor("newest", at, ID), "oldest"),
    ).toBeNull();
    expect(decodeListCursor("not-a-cursor", "newest")).toBeNull();
    expect(
      decodeListCursor(encodeListCursor("newest", "yesterday", ID), "newest"),
    ).toBeNull();
    expect(
      decodeListCursor(
        encodeListCursor("name_asc", "ada", "1 or 1=1"),
        "name_asc",
      ),
    ).toBeNull();
    expect(decodeListCursor("x".repeat(401), "newest")).toBeNull();
    expect(decodeListCursor(undefined, "newest")).toBeNull();
  });
});

describe("the overview's 14 days", () => {
  it("are every UTC day up to today, oldest first", () => {
    const days = lastDays(new Date("2026-11-19T23:30:00.000Z"), 14);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-11-06");
    expect(days[13]).toBe("2026-11-19");
    expect(lastDays(new Date("2026-03-02T01:00:00.000Z"), 3)).toEqual([
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });
});
