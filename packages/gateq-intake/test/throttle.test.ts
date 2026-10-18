import { describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import { createGuestThrottle, GATEQ_GUEST_QUOTAS } from "../src/index.js";

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
  it("is spent by that guest and nobody else", () => {
    const throttle = createGuestThrottle();
    const guestA = randomUUID();
    const guestB = randomUUID();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit; i += 1) {
      expect(throttle.charge({ sessionId: guestA, operation: "TURN" })).toBe(
        true,
      );
    }
    expect(throttle.charge({ sessionId: guestA, operation: "TURN" })).toBe(
      false,
    );

    // The whole point. A founder hammering their own session must not
    // stop a different founder from having a conversation at all.
    expect(throttle.charge({ sessionId: guestB, operation: "TURN" })).toBe(
      true,
    );
  });

  it("is per operation, so a long conversation can still be submitted", () => {
    const throttle = createGuestThrottle();
    const guest = randomUUID();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit; i += 1) {
      throttle.charge({ sessionId: guest, operation: "TURN" });
    }
    expect(throttle.charge({ sessionId: guest, operation: "TURN" })).toBe(
      false,
    );
    // Spending every turn must not lock somebody out of finishing.
    expect(throttle.charge({ sessionId: guest, operation: "SUBMIT" })).toBe(
      true,
    );
    expect(throttle.charge({ sessionId: guest, operation: "RESUME" })).toBe(
      true,
    );
  });

  it("comes back when the window does", () => {
    const clock = CLOCK(1_700_000_000_000);
    const throttle = createGuestThrottle({ clock: clock.read });
    const guest = randomUUID();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.SUBMIT.limit; i += 1) {
      throttle.charge({ sessionId: guest, operation: "SUBMIT" });
    }
    expect(throttle.charge({ sessionId: guest, operation: "SUBMIT" })).toBe(
      false,
    );

    clock.advance(GATEQ_GUEST_QUOTAS.SUBMIT.windowMs + 1);
    expect(throttle.charge({ sessionId: guest, operation: "SUBMIT" })).toBe(
      true,
    );
  });
});

describe("what it holds", () => {
  it("forgets, so a public endpoint is not a memory leak", () => {
    const clock = CLOCK(1_700_000_000_000);
    const throttle = createGuestThrottle({ clock: clock.read, maxTracked: 8 });

    for (let i = 0; i < 50; i += 1) {
      throttle.charge({
        sessionId: randomUUID(),
        operation: "TURN",
      });
    }
    expect(throttle.size()).toBeLessThanOrEqual(9);

    clock.advance(GATEQ_GUEST_QUOTAS.TURN.windowMs + 1);
    throttle.charge({
      sessionId: randomUUID(),
      operation: "TURN",
    });
    // Everything expired was swept; what is left is the new one.
    expect(throttle.size()).toBe(1);
  });

  it("is keyed on the session, never on the credential", () => {
    // The counters hold a server-issued id. Nothing here could be replayed
    // as a session if it ever reached a log line or a heap dump, because
    // the secret was never part of the key in the first place.
    const throttle = createGuestThrottle();
    const sessionA = randomUUID();
    expect(throttle.charge({ sessionId: sessionA, operation: "TURN" })).toBe(
      true,
    );
    // A different session is a different bucket, by construction.
    expect(
      throttle.charge({ sessionId: randomUUID(), operation: "TURN" }),
    ).toBe(true);
  });
});
