import { describe, expect, it } from "vitest";

import { Q_FAILURE_CLASSES } from "@capital-q/contracts";

import {
  classifyVendorFailure,
  createTelemetryRuntime,
  FAILURE_CLASSES,
  logQFailure,
  setFailureSink,
  telemetryExportRequested,
  type FailureRecord,
  type Logger,
} from "../src/index.js";

/** Audit F-D7: a failure-class log line, a sink, and an opt-in exporter. */

function recordingLogger(): { logger: Logger; lines: unknown[][] } {
  const lines: unknown[][] = [];
  const logger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (fields: unknown, message: string) => lines.push([fields, message]),
    fatal: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return { logger, lines };
}

describe("the failure log (F-D7)", () => {
  it("uses exactly the recovery's QFailureClass set", () => {
    expect([...FAILURE_CLASSES]).toEqual([...Q_FAILURE_CLASSES]);
  });

  it("writes one structured line with the class and ids, and feeds the sink", () => {
    const { logger, lines } = recordingLogger();
    const seen: FailureRecord[] = [];
    const previous = setFailureSink((record) => seen.push(record));
    try {
      logQFailure(logger, {
        failureClass: "TIMEOUT",
        where: "q.turn",
        code: "PROVIDER_TIMEOUT",
        turnId: "turn_abcdefgh",
      });
    } finally {
      setFailureSink(previous);
    }
    expect(lines).toEqual([
      [
        {
          where: "q.turn",
          code: "PROVIDER_TIMEOUT",
          turnId: "turn_abcdefgh",
          qFailureClass: "TIMEOUT",
        },
        "failure: TIMEOUT",
      ],
    ]);
    expect(seen.map((r) => r.failureClass)).toEqual(["TIMEOUT"]);
  });

  it("a sink that throws never fails the caller", () => {
    const { logger } = recordingLogger();
    const previous = setFailureSink(() => {
      throw new Error("tracker down");
    });
    try {
      expect(() => {
        logQFailure(logger, { failureClass: "NETWORK", where: "worker" });
      }).not.toThrow();
    } finally {
      setFailureSink(previous);
    }
  });
});

describe("the opt-in OTLP exporter (F-D7)", () => {
  const asked = {
    CQ_TELEMETRY_EXPORT: "otlp",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
  };

  it("is off unless both the switch and an endpoint are set", () => {
    expect(telemetryExportRequested({})).toBe(false);
    expect(telemetryExportRequested({ CQ_TELEMETRY_EXPORT: "otlp" })).toBe(
      false,
    );
    expect(telemetryExportRequested(asked)).toBe(true);
  });

  it("does nothing by default", async () => {
    let loaded = 0;
    const runtime = createTelemetryRuntime({
      env: {},
      load: () => {
        loaded += 1;
        return Promise.reject(new Error("unused"));
      },
    });
    await runtime.start();
    expect(runtime.exportStatus()).toBe("OFF");
    expect(loaded).toBe(0);
  });

  it("starts and flushes the SDK when asked", async () => {
    const calls: string[] = [];
    const runtime = createTelemetryRuntime({
      env: asked,
      load: () =>
        Promise.resolve({
          start: () => {
            calls.push("start");
          },
          shutdown: () => {
            calls.push("shutdown");
            return Promise.resolve();
          },
        }),
    });
    await runtime.start();
    await runtime.shutdown();
    expect(runtime.exportStatus()).toBe("ON");
    expect(calls).toEqual(["start", "shutdown"]);
  });

  it("reports UNAVAILABLE without the SDK, and never stops the service", async () => {
    const reported: string[] = [];
    const runtime = createTelemetryRuntime({
      env: asked,
      report: (line) => reported.push(line),
    });
    await expect(runtime.start()).resolves.toBeUndefined();
    expect(runtime.exportStatus()).toBe("UNAVAILABLE");
    expect(reported).toHaveLength(1);
    expect(reported[0]).not.toContain("127.0.0.1");
    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });
});

describe("classifyVendorFailure (G-D9)", () => {
  const refused = () =>
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    });

  it("a dead socket is UNREACHABLE (NETWORK), even inside an adapter's TRANSIENT wrapper", () => {
    expect(classifyVendorFailure(refused())).toEqual({
      kind: "UNREACHABLE",
      failureClass: "NETWORK",
      retryable: true,
    });
    const wrapped = Object.assign(
      new Error("openai realtime secret request failed", { cause: refused() }),
      { name: "ModelProviderFailure", failureClass: "TRANSIENT" },
    );
    expect(classifyVendorFailure(wrapped)?.kind).toBe("UNREACHABLE");
  });

  it("a vendor's own refusal keeps its status and retryability", () => {
    const refusedKey = Object.assign(new Error("refused"), {
      name: "ModelProviderFailure",
      failureClass: "AUTHENTICATION",
      providerStatus: 401,
    });
    expect(classifyVendorFailure(refusedKey)).toEqual({
      kind: "VENDOR_ERROR",
      failureClass: "TOOL_UNAVAILABLE",
      retryable: false,
      vendorStatus: 401,
    });
  });

  it("leaves our own errors alone", () => {
    expect(classifyVendorFailure(new Error("a bug"))).toBeUndefined();
    expect(
      classifyVendorFailure(new TypeError("x is undefined")),
    ).toBeUndefined();
    expect(classifyVendorFailure("not an error")).toBeUndefined();
  });
});
