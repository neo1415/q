import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOperatorAlerts,
  watchWorkersHeartbeat,
  workersHeartbeatAlert,
  WORKERS_HEARTBEAT_ALERT_KEY,
} from "../src/index.js";

/** W1-B: q-api says so when the workers' heartbeat goes stale. */

const NOW = new Date("2026-11-21T09:00:00.000Z");

describe("workers heartbeat alert", () => {
  it("a fresh heartbeat says nothing", () => {
    expect(
      workersHeartbeatAlert({
        beatAt: new Date(NOW.getTime() - 60_000),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      workersHeartbeatAlert({
        beatAt: new Date(NOW.getTime() - 5 * 60_000),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("a stale heartbeat says how old, in plain words", () => {
    const alert = workersHeartbeatAlert({
      beatAt: new Date(NOW.getTime() - 12 * 60_000),
      now: NOW,
    });
    expect(alert?.key).toBe(WORKERS_HEARTBEAT_ALERT_KEY);
    expect(alert?.subject).toBe("The workers have stopped reporting");
    expect(alert?.text).toContain("12 minute(s) ago");
  });

  it("no heartbeat on record is said as such", () => {
    expect(workersHeartbeatAlert({ beatAt: null, now: NOW })?.subject).toBe(
      "The workers have never reported in",
    );
  });
});

describe("watchWorkersHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness(beatAt: () => Date | null, readFails = false) {
    const sent: string[] = [];
    const warnings: string[] = [];
    const logger = {
      error: () => undefined,
      warn: (_fields: Record<string, unknown>, message: string) => {
        warnings.push(message);
      },
    };
    const operator = createOperatorAlerts({
      operatorEmails: () => Promise.resolve(["ops@example.test"]),
      email: {
        available: true,
        send: (message) => {
          sent.push(message.subject);
          return Promise.resolve();
        },
      },
      logger,
    });
    const stop = watchWorkersHeartbeat({
      readBeat: () =>
        readFails
          ? Promise.reject(new Error("db down"))
          : Promise.resolve(beatAt()),
      alert: operator.alert,
      logger,
    });
    return { sent, warnings, stop };
  }

  it("is silent while the workers beat", async () => {
    const { sent, stop } = harness(() => new Date(Date.now() - 30_000));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(sent).toEqual([]);
    stop();
  });

  it("alerts once when stale, is quiet for six hours, then says it again", async () => {
    const stoppedAt = new Date(NOW.getTime() - 10 * 60_000);
    const { sent, stop } = harness(() => stoppedAt);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual(["The workers have stopped reporting"]);
    await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(sent).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(sent).toHaveLength(2);
  });

  it("a read that fails is logged, never an alert", async () => {
    const { sent, warnings, stop } = harness(() => null, true);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(sent).toEqual([]);
    expect(warnings).toEqual([
      "the workers' heartbeat could not be read",
      "the workers' heartbeat could not be read",
      "the workers' heartbeat could not be read",
    ]);
    stop();
  });
});
