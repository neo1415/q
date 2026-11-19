import { describe, expect, it } from "vitest";

import type { OperatorAlert } from "@capital-q/platform-admin";

import { heartbeatRow } from "../src/reliability/heartbeat.js";

import {
  assessOps,
  checkOps,
  DEFAULT_OPS_THRESHOLDS,
  parseOpsThresholds,
  runOpsWatch,
  type OpsReading,
} from "../src/reliability/ops-check.js";

/** Launch readiness item 7: the workers' operational check. */

const quietReading: OpsReading = {
  stuckRuns: [],
  recentRuns: { total: 40, failed: 2 },
  providers: [
    { providerCode: "openai", attempts: 120, failed: 6 },
    // Few attempts: a rate on 5 calls means nothing.
    { providerCode: "anthropic", attempts: 5, failed: 5 },
  ],
  spendToday: [
    { providerCode: "openai", usd: 3.2 },
    { providerCode: "anthropic", usd: 1.1 },
  ],
};

function recorder() {
  const lines: { level: string; fields: Record<string, unknown> }[] = [];
  const log =
    (level: string) => (fields: Record<string, unknown>, _message: string) => {
      lines.push({ level, fields });
    };
  return {
    lines,
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
  };
}

describe("assessOps", () => {
  it("finds nothing on an ordinary minute", () => {
    expect(
      assessOps({
        reading: quietReading,
        dbTimeoutsSinceLastCheck: 1,
        thresholds: DEFAULT_OPS_THRESHOLDS,
        dailyCapUsd: 50,
      }),
    ).toEqual([]);
  });

  it("names every crossed threshold, with ids and counts only", () => {
    const findings = assessOps({
      reading: {
        stuckRuns: [
          { runId: "run-a", status: "SYNTHESIS", idleMs: 600_000 },
          { runId: "run-b", status: "RECEIVED", idleMs: 180_000 },
        ],
        recentRuns: { total: 10, failed: 4 },
        providers: [{ providerCode: "anthropic", attempts: 30, failed: 20 }],
        spendToday: [
          { providerCode: "openai", usd: 30 },
          { providerCode: "anthropic", usd: 12 },
        ],
      },
      dbTimeoutsSinceLastCheck: 7,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: 50,
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      "Q_RUN_STUCK",
      "Q_RUN_FAILURE_RATE",
      "DB_TIMEOUTS",
      "MODEL_PROVIDER_FAILURE_RATE",
      "MODEL_SPEND_NEAR_CAP",
    ]);
    const stuck = findings[0];
    expect(stuck?.fields).toMatchObject({
      stuckRuns: 2,
      stuckRunIds: ["run-a", "run-b"],
    });
    const spend = findings[4];
    expect(spend?.fields).toMatchObject({
      spentTodayUsd: 42,
      dailyCapUsd: 50,
      spendByProvider: { openai: 30, anthropic: 12 },
    });
    expect(spend?.key).toBe("ops:spend-near-cap:near");
  });

  it("says nothing about spend when no cap is in force", () => {
    expect(
      assessOps({
        reading: {
          ...quietReading,
          spendToday: [{ providerCode: "openai", usd: 999 }],
        },
        dbTimeoutsSinceLastCheck: 0,
        thresholds: DEFAULT_OPS_THRESHOLDS,
        dailyCapUsd: undefined,
      }),
    ).toEqual([]);
  });
});

describe("checkOps", () => {
  it("emits one alert line and one operator alert per finding", async () => {
    const { lines, logger } = recorder();
    const alerts: OperatorAlert[] = [];
    await checkOps({
      read: () =>
        Promise.resolve({
          ...quietReading,
          stuckRuns: [{ runId: "run-a", status: "PLANNING", idleMs: 200_000 }],
        }),
      dbTimeoutsSinceLastCheck: 5,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: 50,
      alert: (alert) => {
        alerts.push(alert);
        return Promise.resolve(true);
      },
      now: new Date("2026-11-17T12:00:00Z"),
      logger,
    });
    const alertLines = lines.filter((line) => line.fields["alert"]);
    expect(alertLines).toHaveLength(1);
    expect(alertLines[0]).toMatchObject({
      level: "error",
      fields: { alert: "OPS_CHECK", findings: ["Q_RUN_STUCK", "DB_TIMEOUTS"] },
    });
    expect(alerts.map((alert) => alert.key)).toEqual([
      "ops:q-run-stuck",
      "ops:db-timeouts",
    ]);
  });

  it("is silent when all is well", async () => {
    const { lines, logger } = recorder();
    await checkOps({
      read: () => Promise.resolve(quietReading),
      dbTimeoutsSinceLastCheck: 0,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: 50,
      alert: () => Promise.reject(new Error("not expected")),
      now: new Date(),
      logger,
    });
    expect(lines).toEqual([]);
  });
});

describe("runOpsWatch", () => {
  it("counts database timeouts between checks, and an unreadable database is an alert line", async () => {
    const { lines, logger } = recorder();
    const controller = new AbortController();
    let timeouts = 10;
    let reads = 0;
    await runOpsWatch({
      read: () => {
        reads += 1;
        if (reads === 2) return Promise.reject(new Error("db down"));
        return Promise.resolve(quietReading);
      },
      dbTimeouts: () => timeouts,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: undefined,
      alert: () => Promise.resolve(true),
      signal: controller.signal,
      logger,
      sleep: () => {
        timeouts += 4;
        if (reads >= 3) controller.abort();
        return Promise.resolve();
      },
    });
    const alertLines = lines.filter((line) => line.fields["alert"]);
    expect(alertLines.map((line) => line.fields["findings"])).toEqual([
      ["CHECK_FAILED"],
      // The failed check's timeouts are carried to the next one: 8, not 4.
      ["DB_TIMEOUTS"],
    ]);
    expect(alertLines[1]?.fields["dbTimeouts"]).toBe(8);
  });
});

describe("pool exhaustion (incident 19 Nov 2026)", () => {
  it("any exhaustion since the last check is a finding; none is silence", () => {
    const base = {
      reading: quietReading,
      dbTimeoutsSinceLastCheck: 0,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: undefined,
    };
    expect(assessOps({ ...base, dbPoolExhaustionsSinceLastCheck: 0 })).toEqual(
      [],
    );
    const [finding] = assessOps({
      ...base,
      dbPoolExhaustionsSinceLastCheck: 1,
    });
    expect(finding).toMatchObject({
      code: "DB_POOL_EXHAUSTED",
      key: "ops:db-pool-exhausted",
      fields: { dbPoolExhaustions: 1 },
    });
  });

  it("is reported between checks, and still counted on the line when the database cannot be read", async () => {
    const { lines, logger } = recorder();
    const controller = new AbortController();
    let exhaustions = 3;
    let reads = 0;
    await runOpsWatch({
      read: () => {
        reads += 1;
        if (reads === 2) return Promise.reject(new Error("db down"));
        return Promise.resolve(quietReading);
      },
      dbTimeouts: () => 0,
      dbPoolExhaustions: () => exhaustions,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: undefined,
      alert: () => Promise.resolve(true),
      signal: controller.signal,
      logger,
      sleep: () => {
        exhaustions += 1;
        if (reads >= 3) controller.abort();
        return Promise.resolve();
      },
    });
    const alertLines = lines.filter((line) => line.fields["alert"]);
    expect(alertLines.map((line) => line.fields["findings"])).toEqual([
      ["CHECK_FAILED"],
      ["DB_POOL_EXHAUSTED"],
    ]);
    expect(alertLines[0]?.fields["dbPoolExhaustions"]).toBe(1);
    expect(alertLines[1]?.fields["dbPoolExhaustions"]).toBe(2);
  });
});

describe("the heartbeat (console System health)", () => {
  it("beats after every check with its finding codes, CHECK_FAILED when unreadable", async () => {
    const { logger } = recorder();
    const controller = new AbortController();
    const beats: { at: Date; findings: readonly string[] }[] = [];
    let reads = 0;
    await runOpsWatch({
      read: () => {
        reads += 1;
        if (reads === 2) return Promise.reject(new Error("db down"));
        return Promise.resolve(quietReading);
      },
      dbTimeouts: () => 0,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: undefined,
      alert: () => Promise.resolve(true),
      signal: controller.signal,
      logger,
      now: () => new Date("2026-11-19T12:00:00.000Z"),
      sleep: () => {
        if (reads >= 2) controller.abort();
        return Promise.resolve();
      },
      heartbeat: (beat) => {
        beats.push(beat);
        return Promise.resolve();
      },
    });
    expect(beats.map((beat) => beat.findings)).toEqual([[], ["CHECK_FAILED"]]);
    expect(beats[0]?.at.toISOString()).toBe("2026-11-19T12:00:00.000Z");
  });

  it("logs a heartbeat that cannot be written, and keeps checking", async () => {
    const { lines, logger } = recorder();
    const controller = new AbortController();
    let reads = 0;
    await runOpsWatch({
      read: () => {
        reads += 1;
        return Promise.resolve(quietReading);
      },
      dbTimeouts: () => 0,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: undefined,
      alert: () => Promise.resolve(true),
      signal: controller.signal,
      logger,
      sleep: () => {
        if (reads >= 2) controller.abort();
        return Promise.resolve();
      },
      heartbeat: () => Promise.reject(new Error("no table")),
    });
    expect(reads).toBe(2);
    expect(
      lines.filter(
        (line) => line.level === "warn" && line.fields["err"] instanceof Error,
      ),
    ).toHaveLength(2);
  });

  it("stores the pool's counts and the check's codes, nothing else", () => {
    const row = heartbeatRow(
      { at: new Date("2026-11-19T12:00:00.000Z"), findings: ["DB_TIMEOUTS"] },
      {
        slots: 10,
        held: 2,
        waiting: 0,
        oldestHeldMs: 120,
        recycles: 0,
        lastRecycledAt: null,
      },
    );
    expect(row).toEqual({
      beatAt: "2026-11-19T12:00:00.000Z",
      pool: {
        slots: 10,
        held: 2,
        waiting: 0,
        oldestHeldMs: 120,
        recycles: 0,
        lastRecycledAt: null,
      },
      opsCheck: {
        checkedAt: "2026-11-19T12:00:00.000Z",
        findings: ["DB_TIMEOUTS"],
      },
    });
    expect(
      heartbeatRow({ at: new Date(0), findings: [] }, undefined).pool,
    ).toEqual({});
  });
});

describe("parseOpsThresholds", () => {
  it("reads bounded values and keeps the default for a typo", () => {
    const parsed = parseOpsThresholds({
      CQ_OPS_STUCK_RUN_MS: "300000",
      CQ_OPS_FAILED_RUN_RATE: "0.4",
      CQ_OPS_PROVIDER_FAILURE_RATE: "lots",
      CQ_OPS_CHECK_INTERVAL_MS: "10",
    });
    expect(parsed.thresholds.stuckRunMs).toBe(300_000);
    expect(parsed.thresholds.failedRunRate).toBe(0.4);
    expect(parsed.thresholds.providerFailureRate).toBe(
      DEFAULT_OPS_THRESHOLDS.providerFailureRate,
    );
    expect(parsed.thresholds.intervalMs).toBe(
      DEFAULT_OPS_THRESHOLDS.intervalMs,
    );
    expect(parsed.invalid).toEqual([
      "CQ_OPS_CHECK_INTERVAL_MS",
      "CQ_OPS_PROVIDER_FAILURE_RATE",
    ]);
  });
});
