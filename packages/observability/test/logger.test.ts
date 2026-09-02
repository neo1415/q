import { describe, expect, it } from "vitest";

import { runWithObservabilityContext } from "../src/context.js";
import { createLogger, REDACTED_PLACEHOLDER } from "../src/logger.js";
import { getActiveTraceContext } from "../src/telemetry.js";
import type { ServiceIdentity } from "../src/types.js";

const IDENTITY: ServiceIdentity = {
  serviceName: "api",
  environment: "local",
};

/** Captures newline-delimited JSON so assertions run against real output. */
function capture(): {
  readonly records: Record<string, unknown>[];
  readonly destination: { write(chunk: string): void };
} {
  const records: Record<string, unknown>[] = [];

  return {
    records,
    destination: {
      write(chunk: string) {
        records.push(JSON.parse(chunk) as Record<string, unknown>);
      },
    },
  };
}

describe("structured logger", () => {
  it("emits parseable JSON with the message", () => {
    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "debug", destination }).info(
      {},
      "service started",
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.["msg"]).toBe("service started");
    expect(typeof records[0]?.["level"]).toBe("number");
  });

  it("carries base service metadata on every record", () => {
    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "debug", destination }).warn({}, "careful");

    expect(records[0]?.["service"]).toBe("api");
    expect(records[0]?.["environment"]).toBe("local");
  });

  it("includes serviceVersion and region only when supplied", () => {
    const withoutVersion = capture();
    createLogger(IDENTITY, {
      level: "debug",
      destination: withoutVersion.destination,
    }).info({}, "no version");

    expect(withoutVersion.records[0]).not.toHaveProperty("serviceVersion");
    expect(withoutVersion.records[0]).not.toHaveProperty("region");

    const withVersion = capture();
    createLogger(
      { ...IDENTITY, serviceVersion: "abc1234", region: "eu-central" },
      { level: "debug", destination: withVersion.destination },
    ).info({}, "with version");

    expect(withVersion.records[0]?.["serviceVersion"]).toBe("abc1234");
    expect(withVersion.records[0]?.["region"]).toBe("eu-central");
  });

  it("attaches the active correlation context without the caller threading it", () => {
    const { records, destination } = capture();
    const logger = createLogger(IDENTITY, { level: "debug", destination });

    runWithObservabilityContext(
      { requestId: "req_1", correlationId: "cor_1" },
      () => {
        logger.info({}, "handled");
      },
    );

    expect(records[0]?.["requestId"]).toBe("req_1");
    expect(records[0]?.["correlationId"]).toBe("cor_1");
  });

  it("lets explicit fields win over ambient context", () => {
    const { records, destination } = capture();
    const logger = createLogger(IDENTITY, { level: "debug", destination });

    runWithObservabilityContext({ requestId: "ambient" }, () => {
      logger.info({ requestId: "explicit" }, "override");
    });

    expect(records[0]?.["requestId"]).toBe("explicit");
  });

  it("supports child loggers with fixed additional fields", () => {
    const { records, destination } = capture();
    const child = createLogger(IDENTITY, {
      level: "debug",
      destination,
    }).child({ component: "health" });

    child.info({}, "ready");

    expect(records[0]?.["component"]).toBe("health");
    expect(records[0]?.["service"]).toBe("api");
  });

  it("respects the configured level", () => {
    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "warn", destination }).debug({}, "noisy");

    expect(records).toHaveLength(0);
  });

  it("serialises errors without spreading arbitrary properties", () => {
    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "debug", destination }).error(
      { err: new Error("boom") },
      "request failed",
    );

    const err = records[0]?.["err"] as Record<string, unknown> | undefined;
    expect(err?.["message"]).toBe("boom");
    expect(err?.["type"]).toBe("Error");
    expect(typeof err?.["stack"]).toBe("string");
  });
});

describe("secret redaction", () => {
  // Synthetic only. No real credential ever appears in a fixture.
  const SYNTHETIC = "super-secret-test-token";

  it("redacts common credential field names", () => {
    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "debug", destination }).info(
      {
        accessToken: SYNTHETIC,
        apiKey: SYNTHETIC,
        password: SYNTHETIC,
        nested: { refreshToken: SYNTHETIC, secret: SYNTHETIC },
      },
      "credential shaped fields",
    );

    expect(JSON.stringify(records[0])).not.toContain(SYNTHETIC);
    expect(records[0]?.["accessToken"]).toBe(REDACTED_PLACEHOLDER);
    expect(records[0]?.["apiKey"]).toBe(REDACTED_PLACEHOLDER);
  });

  it("leaves ordinary operational fields intact", () => {
    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "debug", destination }).info(
      { route: "/health/ready", statusCode: 200, durationMs: 3 },
      "request completed",
    );

    expect(records[0]?.["route"]).toBe("/health/ready");
    expect(records[0]?.["statusCode"]).toBe(200);
  });

  it("does not redact a secret hidden in an unrecognised field name", () => {
    // Documents the limit honestly: key-name redaction is a second line of
    // defence. It cannot recognise a document body, a Q prompt, or a credential
    // placed under an arbitrary key. Not logging sensitive material is the
    // actual control.
    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "debug", destination }).info(
      { somethingUnexpected: SYNTHETIC },
      "unrecognised field",
    );

    expect(records[0]?.["somethingUnexpected"]).toBe(SYNTHETIC);
  });
});

describe("trace correlation", () => {
  it("omits trace identifiers when no SDK is registered", () => {
    // No exporter or SDK exists yet, so there is no valid active span. Trace
    // fields are omitted rather than fabricated.
    expect(getActiveTraceContext()).toBeUndefined();

    const { records, destination } = capture();
    createLogger(IDENTITY, { level: "debug", destination }).info({}, "no span");

    expect(records[0]).not.toHaveProperty("traceId");
    expect(records[0]).not.toHaveProperty("spanId");
  });
});
