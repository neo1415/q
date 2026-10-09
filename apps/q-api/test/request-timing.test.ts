import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { countRoundTrip } from "@capital-q/database";

import { registerRequestTiming } from "../src/http/request-timing.js";

type Line = Record<string, unknown>;

async function appWithLines() {
  const lines: Line[] = [];
  const app = Fastify({
    logger: {
      level: "info",
      stream: { write: (raw: string) => lines.push(JSON.parse(raw) as Line) },
    },
  });
  registerRequestTiming(app);
  app.get("/v1/things/:id", async () => {
    countRoundTrip();
    await Promise.resolve();
    countRoundTrip();
    return { ok: true };
  });
  app.get("/health/ready", () => ({ ok: true }));
  await app.ready();
  const timing = () => lines.filter((l) => l["msg"] === "request timing");
  return { app, timing };
}

describe("request timing", () => {
  it("logs the route template, status and the request's db round trips", async () => {
    const { app, timing } = await appWithLines();
    await app.inject({ method: "GET", url: "/v1/things/abc" });
    const [line] = timing();
    expect(line).toMatchObject({
      route: "/v1/things/:id",
      method: "GET",
      statusCode: 200,
      dbRoundTrips: 2,
    });
    expect(typeof line?.["durationMs"]).toBe("number");
    expect(line).not.toHaveProperty("clientTraceId");
  });

  it("keeps a well-formed trace id and drops a malformed one", async () => {
    const { app, timing } = await appWithLines();
    await app.inject({
      method: "GET",
      url: "/v1/things/a",
      headers: { "x-cq-trace-id": "rTnu3HrFSrmqNaXtpHNmDw" },
    });
    await app.inject({
      method: "GET",
      url: "/v1/things/b",
      headers: { "x-cq-trace-id": "bad trace\nid" },
    });
    const [kept, dropped] = timing();
    expect(kept?.["clientTraceId"]).toBe("rTnu3HrFSrmqNaXtpHNmDw");
    expect(dropped).not.toHaveProperty("clientTraceId");
  });

  it("does not count across requests and skips health probes", async () => {
    const { app, timing } = await appWithLines();
    await Promise.all([
      app.inject({ method: "GET", url: "/v1/things/1" }),
      app.inject({ method: "GET", url: "/v1/things/2" }),
      app.inject({ method: "GET", url: "/health/ready" }),
    ]);
    expect(timing().map((l) => l["dbRoundTrips"])).toEqual([2, 2]);
  });
});
