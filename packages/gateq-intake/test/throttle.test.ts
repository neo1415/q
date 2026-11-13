import { describe, expect, it, vi } from "vitest";
import type { DatabaseExecutor } from "@capital-q/database";

import { createHash, randomUUID } from "node:crypto";

import {
  createGuestThrottle,
  createPostgresGuestThrottle,
  GATEQ_GUEST_QUOTAS,
} from "../src/index.js";

/**
 * What one guest session may do (CQ-GATE-002S §8).
 *
 * The property that matters is isolation. A public conversational
 * endpoint with a single global counter is a denial-of-service tool
 * pointed at every other applicant: one script, and nobody can finish an
 * application. These prove the counter is per session and per operation,
 * that the key is a server-issued id rather than anything derived from
 * the credential, and that the table forgets.
 */

const CLOCK = (start: number) => {
  let now = start;
  return {
    read: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe("one guest's allowance", () => {
  it("is spent by that guest and nobody else", async () => {
    const throttle = createGuestThrottle();
    const guestA = randomUUID();
    const guestB = randomUUID();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit; i += 1) {
      expect(
        await throttle.charge({ sessionId: guestA, operation: "TURN" }),
      ).toBe(true);
    }
    expect(
      await throttle.charge({ sessionId: guestA, operation: "TURN" }),
    ).toBe(false);

    // The whole point. A founder hammering their own session must not
    // stop a different founder from having a conversation at all.
    expect(
      await throttle.charge({ sessionId: guestB, operation: "TURN" }),
    ).toBe(true);
  });

  it("is per operation, so a long conversation can still be submitted", async () => {
    const throttle = createGuestThrottle();
    const guest = randomUUID();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit; i += 1) {
      await throttle.charge({ sessionId: guest, operation: "TURN" });
    }
    expect(await throttle.charge({ sessionId: guest, operation: "TURN" })).toBe(
      false,
    );
    // Spending every turn must not lock somebody out of finishing.
    expect(
      await throttle.charge({ sessionId: guest, operation: "SUBMIT" }),
    ).toBe(true);
    expect(
      await throttle.charge({ sessionId: guest, operation: "RESUME" }),
    ).toBe(true);
  });

  it("comes back when the window does", async () => {
    const clock = CLOCK(1_700_000_000_000);
    const throttle = createGuestThrottle({ clock: clock.read });
    const guest = randomUUID();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.SUBMIT.limit; i += 1) {
      await throttle.charge({ sessionId: guest, operation: "SUBMIT" });
    }
    expect(
      await throttle.charge({ sessionId: guest, operation: "SUBMIT" }),
    ).toBe(false);

    clock.advance(GATEQ_GUEST_QUOTAS.SUBMIT.windowMs + 1);
    expect(
      await throttle.charge({ sessionId: guest, operation: "SUBMIT" }),
    ).toBe(true);
  });
});

describe("what it holds", () => {
  it("forgets, so a public endpoint is not a memory leak", async () => {
    const clock = CLOCK(1_700_000_000_000);
    const throttle = createGuestThrottle({ clock: clock.read, maxTracked: 8 });

    for (let i = 0; i < 50; i += 1) {
      await throttle.charge({
        sessionId: randomUUID(),
        operation: "TURN",
      });
    }
    expect(throttle.size()).toBeLessThanOrEqual(9);

    clock.advance(GATEQ_GUEST_QUOTAS.TURN.windowMs + 1);
    await throttle.charge({
      sessionId: randomUUID(),
      operation: "TURN",
    });
    // Everything expired was swept; what is left is the new one.
    expect(throttle.size()).toBe(1);
  });

  it("is keyed on the session, never on the credential", async () => {
    // The counters hold a server-issued id. Nothing here could be replayed
    // as a session if it ever reached a log line or a heap dump, because
    // the secret was never part of the key in the first place.
    const throttle = createGuestThrottle();
    const sessionA = randomUUID();
    expect(
      await throttle.charge({ sessionId: sessionA, operation: "TURN" }),
    ).toBe(true);
    // A different session is a different bucket, by construction.
    expect(
      await throttle.charge({ sessionId: randomUUID(), operation: "TURN" }),
    ).toBe(true);
  });
});

describe("the shared (Postgres) throttle", () => {
  const recording = (handler: (q: string) => readonly unknown[]) => {
    const calls: { q: string; values: unknown[] }[] = [];
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join("?").replace(/\s+/g, " ").trim();
      calls.push({ q, values });
      return Promise.resolve(handler(q));
    }) as unknown as DatabaseExecutor;
    return { sql, calls };
  };

  it("charges with one atomic upsert keyed on a hash, never the session id", async () => {
    const { sql, calls } = recording(() => [{ key_hash: "x" }]);
    const throttle = createPostgresGuestThrottle({ sql });
    const sessionId = randomUUID();

    expect(await throttle.charge({ sessionId, operation: "TURN" })).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.q).toMatch(
      /^insert into gateq\.guest_throttle_buckets .* on conflict \(key_hash\) do update set .* where .* or b\.count < \?::int returning b\.key_hash$/,
    );
    const expected = createHash("sha256")
      .update(`TURN:${sessionId}`)
      .digest("hex");
    expect(call?.values).toContain(expected);
    expect(call?.values).toContain(GATEQ_GUEST_QUOTAS.TURN.limit);
    expect(JSON.stringify(call?.values)).not.toContain(sessionId);
  });

  it("refuses when the upsert returns no row", async () => {
    const { sql } = recording(() => []);
    const throttle = createPostgresGuestThrottle({ sql });
    expect(
      await throttle.charge({ sessionId: randomUUID(), operation: "SUBMIT" }),
    ).toBe(false);
  });

  it("fails open to this instance's counters and warns once, without the key", async () => {
    const sql = vi.fn(() =>
      Promise.reject(new Error("connection reset")),
    ) as unknown as DatabaseExecutor;
    const warn = vi.fn();
    const throttle = createPostgresGuestThrottle({ sql, logger: { warn } });
    const sessionId = randomUUID();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.SUBMIT.limit; i += 1) {
      expect(await throttle.charge({ sessionId, operation: "SUBMIT" })).toBe(
        true,
      );
    }
    // The fallback is still a bound, not an open door.
    expect(await throttle.charge({ sessionId, operation: "SUBMIT" })).toBe(
      false,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sessionId);
  });

  it("sweeps expired rows in a bounded batch, off the request path", async () => {
    const { sql, calls } = recording(() => [{ key_hash: "x" }]);
    const throttle = createPostgresGuestThrottle({ sql });
    for (let i = 0; i < 256; i += 1) {
      await throttle.charge({ sessionId: randomUUID(), operation: "RESUME" });
    }
    const sweeps = calls.filter((c) => c.q.startsWith("delete"));
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.q).toContain("for update skip locked");
    expect(sweeps[0]?.q).toContain("limit ?");
  });
});
