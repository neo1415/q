import { createOperatorAlerts } from "@capital-q/platform-admin";
import { describe, expect, it } from "vitest";

import {
  createHealthWatch,
  DEFAULT_HEALTH_WATCH,
  parseHealthTargets,
  probeHealth,
  type ProbeResult,
} from "../src/reliability/health-watch.js";
import type { OpsBeat } from "../src/reliability/heartbeat.js";
import {
  DEFAULT_OPS_THRESHOLDS,
  runOpsWatch,
  type OpsReading,
} from "../src/reliability/ops-check.js";

/**
 * W1-B (enterprise audit finding 5): service health and error-rate alerts
 * through the operator channel, de-duplicated and quiet for the cooldown.
 */

const quiet: OpsReading = {
  stuckRuns: [],
  recentRuns: { total: 10, failed: 0 },
  providers: [],
  spendToday: [],
};

const healthy = (service: string): ProbeResult => ({
  service,
  ready: true,
  traffic: { windowMinutes: 15, requests: 400, serverErrors: 2 },
});

function recorder() {
  const lines: { level: string; fields: Record<string, unknown> }[] = [];
  const log = (level: string) => (fields: Record<string, unknown>) => {
    lines.push({ level, fields });
  };
  return {
    lines,
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
  };
}

describe("health targets", () => {
  it("reads service=url pairs and points each at its readiness check", () => {
    expect(
      parseHealthTargets({
        CQ_HEALTH_PROBE_TARGETS:
          " api=https://api.example.test , q-api=https://q.example.test/x,Bad=ftp://x,nourl",
      }),
    ).toEqual({
      targets: [
        { service: "api", url: "https://api.example.test/health/ready" },
        { service: "q-api", url: "https://q.example.test/health/ready" },
      ],
      invalid: ["Bad", "nourl"],
    });
    expect(parseHealthTargets({})).toEqual({ targets: [], invalid: [] });
  });

  it("a throw, a non-2xx or a missing count is read as it is", async () => {
    const results = await probeHealth(
      [
        { service: "api", url: "https://a/health/ready" },
        { service: "q-api", url: "https://q/health/ready" },
        { service: "web", url: "https://w/health/ready" },
      ],
      (url) => {
        if (url.startsWith("https://a")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                traffic: { windowMinutes: 15, requests: 9, serverErrors: 1 },
              }),
          });
        }
        if (url.startsWith("https://q")) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.reject(new Error("html")),
          });
        }
        return Promise.reject(new Error("connection refused"));
      },
      1_000,
    );
    expect(results).toEqual([
      {
        service: "api",
        ready: true,
        traffic: { windowMinutes: 15, requests: 9, serverErrors: 1 },
      },
      { service: "q-api", ready: false, traffic: null },
      { service: "web", ready: false, traffic: null },
    ]);
  });
});

describe("health watch", () => {
  it("says nothing while every service is healthy", () => {
    const watch = createHealthWatch();
    for (let i = 0; i < 10; i += 1) {
      expect(watch.assess([healthy("api"), healthy("q-api")])).toEqual([]);
    }
  });

  it("a service is unhealthy only after three failed checks in a row", () => {
    const watch = createHealthWatch();
    const down: ProbeResult = { service: "api", ready: false, traffic: null };
    expect(watch.assess([down])).toEqual([]);
    expect(watch.assess([down])).toEqual([]);
    // A recovery resets the count.
    expect(watch.assess([healthy("api")])).toEqual([]);
    expect(watch.assess([down])).toEqual([]);
    expect(watch.assess([down])).toEqual([]);
    const findings = watch.assess([down]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "SERVICE_UNHEALTHY",
      key: "ops:service-unhealthy:api",
      subject: "api is not answering",
    });
    expect(findings[0]?.text).toContain("3 times in a row");
    expect(watch.summary()).toEqual([
      {
        service: "api",
        ready: false,
        failuresInARow: 3,
        requests: null,
        serverErrors: null,
        windowMinutes: null,
      },
    ]);
  });

  it("an error-rate spike needs both the share and enough requests", () => {
    const watch = createHealthWatch();
    const at = (requests: number, serverErrors: number): ProbeResult => ({
      service: "q-api",
      ready: true,
      traffic: { windowMinutes: 15, requests, serverErrors },
    });
    // 4.9%: below the line.
    expect(watch.assess([at(1000, 49)])).toEqual([]);
    // 100% of 10 requests: too few to be a rate.
    expect(watch.assess([at(10, 10)])).toEqual([]);
    const findings = watch.assess([at(200, 20)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERROR_RATE_SPIKE",
      key: "ops:error-rate:q-api",
      subject: "q-api is returning errors",
    });
    expect(findings[0]?.text).toBe(
      "q-api answered 20 of 200 requests in the last 15 minutes with a server error (10%).",
    );
  });
});

describe("runOpsWatch with the services' health", () => {
  it("alerts once per key, stays quiet for the cooldown, then says it again", async () => {
    const clock = { value: Date.parse("2026-11-21T09:00:00.000Z") };
    const { lines, logger } = recorder();
    const sent: string[] = [];
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
      now: () => new Date(clock.value),
    });
    const beats: OpsBeat[] = [];
    const controller = new AbortController();
    let checks = 0;
    await runOpsWatch({
      read: () => Promise.resolve(quiet),
      dbTimeouts: () => 0,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: undefined,
      alert: operator.alert,
      signal: controller.signal,
      logger,
      now: () => new Date(clock.value),
      health: {
        probe: () =>
          Promise.resolve([
            { service: "api", ready: false, traffic: null },
            healthy("q-api"),
          ]),
        watch: createHealthWatch(DEFAULT_HEALTH_WATCH),
      },
      heartbeat: (beat) => {
        beats.push(beat);
        return Promise.resolve();
      },
      // A fake sleep: each check advances the clock a minute; before the
      // seventh, six hours pass so the cooldown is over.
      sleep: () => {
        checks += 1;
        clock.value += 60_000;
        if (checks === 6) clock.value += 6 * 60 * 60_000;
        if (checks >= 7) controller.abort();
        return Promise.resolve();
      },
    });
    // Checks 3 to 7 find it; the first is sent, then the one after six hours.
    expect(sent).toEqual(["api is not answering", "api is not answering"]);
    expect(beats.map((beat) => beat.findings)).toEqual([
      [],
      [],
      ["SERVICE_UNHEALTHY"],
      ["SERVICE_UNHEALTHY"],
      ["SERVICE_UNHEALTHY"],
      ["SERVICE_UNHEALTHY"],
      ["SERVICE_UNHEALTHY"],
    ]);
    expect(beats[1]?.lastAlert).toBeNull();
    expect(beats[2]?.lastAlert).toEqual({
      subject: "api is not answering",
      at: "2026-11-21T09:02:00.000Z",
    });
    // De-duplicated checks leave the last alert as it was.
    expect(beats[4]?.lastAlert?.at).toBe("2026-11-21T09:02:00.000Z");
    expect(beats[6]?.lastAlert?.at).toBe("2026-11-21T15:06:00.000Z");
    expect(beats[6]?.services?.map((s) => s.service)).toEqual(["api", "q-api"]);
    expect(
      lines.filter((line) => line.fields["qAlert"] === "OPERATOR"),
    ).toHaveLength(2);
  });

  it("a healthy minute sends nothing and records no alert", async () => {
    const sent: string[] = [];
    const beats: OpsBeat[] = [];
    const controller = new AbortController();
    const { logger } = recorder();
    await runOpsWatch({
      read: () => Promise.resolve(quiet),
      dbTimeouts: () => 0,
      thresholds: DEFAULT_OPS_THRESHOLDS,
      dailyCapUsd: undefined,
      alert: (alert) => {
        sent.push(alert.subject);
        return Promise.resolve(true);
      },
      signal: controller.signal,
      logger,
      health: {
        probe: () => Promise.resolve([healthy("api"), healthy("q-api")]),
        watch: createHealthWatch(),
      },
      heartbeat: (beat) => {
        beats.push(beat);
        return Promise.resolve();
      },
      sleep: () => {
        if (beats.length >= 3) controller.abort();
        return Promise.resolve();
      },
    });
    expect(sent).toEqual([]);
    expect(beats).toHaveLength(3);
    expect(beats.every((beat) => beat.findings.length === 0)).toBe(true);
    expect(beats.every((beat) => beat.lastAlert === null)).toBe(true);
  });
});
