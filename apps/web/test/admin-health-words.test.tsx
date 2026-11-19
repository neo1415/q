// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * System health's pool and heartbeat lines (19 Nov 2026 pool wedge):
 * counts and ages in words, a recycle in the last day warns, a heartbeat
 * older than two minutes is down, and anything not reported says so and
 * is never drawn as healthy.
 */

vi.mock("@/features/i18n/server-now", () => ({
  serverTNow: () => (text: string) => text,
}));

const { heartbeatLine, poolLine, seconds, NOT_REPORTED } =
  await import("../src/features/admin/health-words");
const { HealthPanel } = await import("../src/features/admin/console-overview");

afterEach(cleanup);

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const POOL = {
  slots: 10,
  held: 3,
  waiting: 0,
  oldestHeldMs: 400,
  recycles: 0,
  lastRecycledAt: null,
};

describe("the database pool line", () => {
  it("says use and the oldest hold, in words", () => {
    expect(poolLine(POOL, NOW)).toEqual({
      tone: "OK",
      text: "3 of 10 in use · oldest 0.4 s",
    });
    expect(poolLine({ ...POOL, held: 0, oldestHeldMs: null }, NOW).text).toBe(
      "0 of 10 in use",
    );
  });

  it("warns for a recycle in the last day, and not for an older one", () => {
    const recent = poolLine(
      { ...POOL, recycles: 1, lastRecycledAt: "2026-11-19T09:12:00.000Z" },
      NOW,
    );
    expect(recent.tone).toBe("WARNING");
    expect(recent.text).toContain("recycled at 09:12 UTC");
    const old = poolLine(
      { ...POOL, recycles: 1, lastRecycledAt: "2026-11-17T09:12:00.000Z" },
      NOW,
    );
    expect(old.tone).toBe("OK");
  });

  it("warns when every slot is held and statements wait", () => {
    expect(poolLine({ ...POOL, held: 10, waiting: 4 }, NOW)).toMatchObject({
      tone: "WARNING",
      text: "10 of 10 in use · oldest 0.4 s · 4 waiting",
    });
  });

  it("is not reported when q-api gave no reading", () => {
    expect(poolLine(null, NOW)).toEqual(NOT_REPORTED);
    expect(poolLine(undefined, NOW).tone).toBe("UNKNOWN");
  });
});

describe("the workers' heartbeat", () => {
  it("is fresh within two minutes and down after", () => {
    expect(heartbeatLine("2026-11-19T11:59:48.000Z", NOW)).toEqual({
      tone: "OK",
      text: "heartbeat 12 s ago",
    });
    expect(heartbeatLine("2026-11-19T11:58:00.000Z", NOW).tone).toBe("OK");
    expect(heartbeatLine("2026-11-19T11:57:59.000Z", NOW)).toEqual({
      tone: "DOWN",
      text: "Down: last heartbeat 2 min ago",
    });
  });

  it("is not reported when there is none, or it can't be read", () => {
    expect(heartbeatLine(null, NOW)).toEqual(NOT_REPORTED);
    expect(heartbeatLine("not a time", NOW)).toEqual(NOT_REPORTED);
  });

  it("words ages briefly", () => {
    expect(seconds(400)).toBe("0.4 s");
    expect(seconds(12_000)).toBe("12 s");
    expect(seconds(180_000)).toBe("3 min");
  });
});

describe("the health card", () => {
  it("never draws an unreported reading as healthy", () => {
    render(
      <HealthPanel
        services={[]}
        outbox={null}
        versions={[]}
        qApiPool={null}
        workersHeartbeatAt={null}
        now={NOW}
      />,
    );
    const rows = [...document.querySelectorAll("[data-health-tone]")];
    expect(rows.map((row) => row.getAttribute("data-health-tone"))).toEqual([
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Q API database poolNot reported",
      "WorkersNot reported",
    ]);
  });

  it("says the pool's use and warns on a recent recycle", () => {
    render(
      <HealthPanel
        services={[]}
        outbox={null}
        versions={[]}
        qApiPool={{
          ...POOL,
          recycles: 1,
          lastRecycledAt: "2026-11-19T11:00:00.000Z",
        }}
        workersHeartbeatAt={null}
        now={NOW}
      />,
    );
    const pool = document.querySelector('[data-health-tone="WARNING"]');
    expect(pool?.textContent).toContain("3 of 10 in use · oldest 0.4 s");
  });
});
