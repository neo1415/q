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

const {
  checkLine,
  errorRateLine,
  heartbeatLine,
  lastAlertLine,
  poolLine,
  seconds,
  NOT_REPORTED,
} = await import("../src/features/admin/health-words");
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
        workers={null}
        now={NOW}
      />,
    );
    const rows = [...document.querySelectorAll("[data-health-tone]")];
    expect(rows.map((row) => row.getAttribute("data-health-tone"))).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Q API database poolNot reported",
      "WorkersNot reported",
      "Workers database poolNot reported",
      "Workers last checkNot reported",
      "Last alertNot reported",
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
        workers={null}
        now={NOW}
      />,
    );
    const pool = document.querySelector('[data-health-tone="WARNING"]');
    expect(pool?.textContent).toContain("3 of 10 in use · oldest 0.4 s");
  });
});

describe("the workers' row from their stored heartbeat", () => {
  const workers = {
    beatAt: "2026-11-19T11:59:48.000Z",
    pool: { ...POOL, held: 1, slots: 5, oldestHeldMs: 90 },
    ungatedMaxConnections: null,
    checkedAt: "2026-11-19T11:59:48.000Z",
    findings: [] as string[],
  };

  it("reads fresh, with the pool and a clean check", () => {
    render(
      <HealthPanel
        services={[]}
        outbox={null}
        versions={[]}
        qApiPool={null}
        workers={workers}
        now={NOW}
      />,
    );
    const text = [...document.querySelectorAll("[data-health-tone]")].map(
      (row) =>
        `${row.getAttribute("data-health-tone") ?? ""} ${row.textContent ?? ""}`,
    );
    expect(text).toContain("OK Workersheartbeat 12 s ago");
    expect(text).toContain(
      "OK Workers database pool1 of 5 in use · oldest 0.1 s",
    );
    expect(text).toContain("OK Workers last checkNo findings");
  });

  it("reads as down once the heartbeat is over two minutes old", () => {
    render(
      <HealthPanel
        services={[]}
        outbox={null}
        versions={[]}
        qApiPool={null}
        workers={{ ...workers, beatAt: "2026-11-19T11:55:00.000Z" }}
        now={NOW}
      />,
    );
    const down = document.querySelector('[data-health-tone="DOWN"]');
    expect(down?.textContent).toContain("Down: last heartbeat 5 min ago");
  });

  it("says an ungated pool's size, and that its use is not reported", () => {
    render(
      <HealthPanel
        services={[]}
        outbox={null}
        versions={[]}
        qApiPool={null}
        workers={{ ...workers, pool: null, ungatedMaxConnections: 10 }}
        now={NOW}
      />,
    );
    const rows = [...document.querySelectorAll("[data-health-tone]")].map(
      (row) =>
        `${row.getAttribute("data-health-tone") ?? ""} ${row.textContent ?? ""}`,
    );
    expect(rows).toContain(
      "UNKNOWN Workers database poolNot reported: not gated, up to 10 connections",
    );
  });

  it("says a check's findings, and a check that could not read", () => {
    expect(
      checkLine({ checkedAt: workers.checkedAt, findings: ["DB_TIMEOUTS"] }),
    ).toEqual({
      tone: "WARNING",
      text: "db timeouts",
    });
    expect(
      checkLine({ checkedAt: workers.checkedAt, findings: ["CHECK_FAILED"] })
        .tone,
    ).toBe("DOWN");
    expect(checkLine(null)).toEqual(NOT_REPORTED);
    expect(checkLine({ checkedAt: null, findings: [] })).toEqual(NOT_REPORTED);
  });
});

describe("W1-B: error rate and the last alert", () => {
  it("says each service's server errors over its window, and warns at 5%", () => {
    expect(
      errorRateLine({ windowMinutes: 15, requests: 1240, serverErrors: 5 }),
    ).toEqual({
      tone: "OK",
      text: "0.4% errors of 1,240 requests in 15 min",
    });
    expect(
      errorRateLine({ windowMinutes: 15, requests: 200, serverErrors: 10 })
        .tone,
    ).toBe("WARNING");
    expect(
      errorRateLine({ windowMinutes: 15, requests: 0, serverErrors: 0 }),
    ).toEqual({ tone: "OK", text: "No requests in 15 min" });
    expect(errorRateLine(null)).toEqual(NOT_REPORTED);
  });

  it("says the last alert and its age; a recent one warns", () => {
    expect(
      lastAlertLine(
        { subject: "api is not answering", at: "2026-11-19T11:57:00.000Z" },
        NOW,
      ),
    ).toEqual({ tone: "WARNING", text: "api is not answering · 3 min ago" });
    expect(
      lastAlertLine(
        { subject: "api is not answering", at: "2026-11-17T11:57:00.000Z" },
        NOW,
      ).tone,
    ).toBe("OK");
    expect(lastAlertLine(null, NOW)).toEqual({
      tone: "OK",
      text: "None since the workers started",
    });
  });

  it("the card shows each service's error rate and the last alert", () => {
    render(
      <HealthPanel
        services={[
          {
            service: "API",
            state: "READY",
            database: "CONNECTED",
            millis: 40,
            traffic: { windowMinutes: 15, requests: 100, serverErrors: 9 },
          },
        ]}
        outbox={null}
        versions={[]}
        qApiPool={null}
        workers={{
          beatAt: "2026-11-19T11:59:48.000Z",
          pool: null,
          ungatedMaxConnections: null,
          checkedAt: "2026-11-19T11:59:48.000Z",
          findings: ["ERROR_RATE_SPIKE"],
          lastAlert: {
            subject: "api is returning errors",
            at: "2026-11-19T11:59:00.000Z",
          },
        }}
        now={NOW}
      />,
    );
    const text = [...document.querySelectorAll("[data-health-tone]")].map(
      (row) =>
        `${row.getAttribute("data-health-tone") ?? ""} ${row.textContent ?? ""}`,
    );
    expect(text).toContain(
      "WARNING API error rate9.0% errors of 100 requests in 15 min",
    );
    expect(text).toContain(
      "WARNING Last alertapi is returning errors · 60 s ago",
    );
  });
});
