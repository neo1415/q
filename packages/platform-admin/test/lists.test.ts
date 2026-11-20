import { describe, expect, it } from "vitest";

import {
  decodeListCursor,
  encodeListCursor,
  heartbeatOf,
  lastDays,
} from "../src/index.js";

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

describe("the workers' heartbeat as the console reads it", () => {
  it("passes counts, instants and finding codes, and nothing else", () => {
    expect(
      heartbeatOf({
        beat_at: new Date("2026-11-19T12:00:00.000Z"),
        pool: {
          slots: 10,
          held: 2,
          waiting: 0,
          oldestHeldMs: 120,
          recycles: 0,
          lastRecycledAt: null,
          statement: "select secret",
        },
        ops_check: {
          checkedAt: "2026-11-19T12:00:00.000Z",
          findings: ["DB_TIMEOUTS", "not a code", 7],
        },
      }),
    ).toEqual({
      beatAt: "2026-11-19T12:00:00.000Z",
      ungatedMaxConnections: null,
      pool: {
        slots: 10,
        held: 2,
        waiting: 0,
        oldestHeldMs: 120,
        recycles: 0,
        lastRecycledAt: null,
      },
      checkedAt: "2026-11-19T12:00:00.000Z",
      findings: ["DB_TIMEOUTS"],
    });
  });

  it("says an ungated pool's size and leaves its use unreported", () => {
    const beat = heartbeatOf({
      beat_at: "2026-11-20T12:00:00.000Z",
      pool: { gated: false, maxConnections: 10 },
      ops_check: { checkedAt: "2026-11-20T12:00:00.000Z", findings: [] },
    });
    expect(beat.pool).toBeNull();
    expect(beat.ungatedMaxConnections).toBe(10);
    // The rows written before 20 Nov ({}): nothing measured, nothing said.
    expect(
      heartbeatOf({
        beat_at: "2026-11-20T12:00:00.000Z",
        pool: {},
        ops_check: {},
      }).ungatedMaxConnections,
    ).toBeNull();
  });

  it("reads a malformed pool as not reported, not as healthy", () => {
    const beat = heartbeatOf({
      beat_at: "2026-11-19T12:00:00.000Z",
      pool: { slots: "ten" },
      ops_check: [],
    });
    expect(beat.pool).toBeNull();
    expect(beat.checkedAt).toBeNull();
    expect(beat.findings).toEqual([]);
  });
});
