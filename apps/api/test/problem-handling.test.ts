import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { ContractValidationError } from "@capital-q/contracts";

import { createApp } from "../src/app.js";

/**
 * HTTP behaviour is exercised through fastify.inject(), so these are real
 * request/response assertions without binding a port.
 *
 * The fixture routes below exist only inside this test file. No test-only route
 * is registered in production composition.
 */
function buildTestApp(): FastifyInstance {
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }));

  app.post("/__fixture/validated", {
    schema: {
      body: {
        type: "object",
        required: ["targetAmount"],
        properties: { targetAmount: { type: "number", minimum: 1 } },
      },
    },
    handler: () => ({ ok: true }),
  });

  app.get("/__fixture/contract-validation", () => {
    throw new ContractValidationError("invalid", [
      {
        path: "targetAmount",
        code: "too_small",
        message: "Enter an amount greater than zero.",
      },
    ]);
  });

  app.get("/__fixture/boom", () => {
    // Synthetic values only -- never a real credential. Each string is
    // something that must never reach a client.
    throw new Error(
      "SELECT * FROM private_table WHERE id=1; conn=postgres://admin:super-secret-test-value@db.internal:5432/capitalq",
    );
  });

  app.get("/__fixture/impostor", () => {
    // An arbitrary object claiming its own HTTP status and public message.
    throw Object.assign(new Error("internal topology: db.internal:5432"), {
      statusCode: 403,
    });
  });

  return app;
}

function contentTypeOf(headers: Record<string, unknown>): string {
  const value = headers["content-type"];
  return typeof value === "string" ? value : "";
}

describe("problem responses", () => {
  it("returns 404 RESOURCE_NOT_FOUND for an unknown route", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/does-not-exist",
    });

    expect(response.statusCode).toBe(404);
    expect(contentTypeOf(response.headers)).toContain(
      "application/problem+json",
    );

    const body = response.json<Record<string, unknown>>();
    expect(body["code"]).toBe("RESOURCE_NOT_FOUND");
    expect(body["status"]).toBe(404);
    expect(body["type"]).toBe("urn:capitalq:problem:resource-not-found");

    // No route internals, no framework HTML.
    expect(JSON.stringify(body)).not.toContain("does-not-exist");
    await app.close();
  });

  it("maps a Fastify schema failure to 422 VALIDATION_FAILED with dotted paths", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/__fixture/validated",
      payload: { targetAmount: 0 },
    });

    expect(response.statusCode).toBe(422);
    expect(contentTypeOf(response.headers)).toContain(
      "application/problem+json",
    );

    const body = response.json<{
      code: string;
      errors: { path: string; code: string; message: string }[];
    }>();

    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.errors.length).toBeGreaterThan(0);
    // Fastify reports "/targetAmount"; Capital Q normalises to a form-friendly
    // dotted path.
    expect(body.errors[0]?.path).toBe("targetAmount");
    await app.close();
  });

  it("maps a ContractValidationError to 422 with its safe issues", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/__fixture/contract-validation",
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{
      code: string;
      errors: { path: string }[];
    }>();

    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.errors[0]?.path).toBe("targetAmount");
    await app.close();
  });

  it("returns 400 INVALID_REQUEST for malformed JSON without echoing the payload", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/__fixture/validated",
      headers: { "content-type": "application/json" },
      payload: '{"targetAmount": ',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<Record<string, unknown>>();

    expect(body["code"]).toBe("INVALID_REQUEST");
    expect(JSON.stringify(body)).not.toContain("targetAmount");
    await app.close();
  });

  it("returns a generic 500 that leaks no internal detail", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/__fixture/boom",
    });

    expect(response.statusCode).toBe(500);

    const raw = response.body;
    expect(raw).not.toContain("SELECT");
    expect(raw).not.toContain("private_table");
    expect(raw).not.toContain("postgres://");
    expect(raw).not.toContain("super-secret-test-value");
    expect(raw).not.toContain("db.internal");
    expect(raw).not.toContain("at Object");

    const body = response.json<Record<string, unknown>>();
    expect(body["code"]).toBe("INTERNAL_SERVER_ERROR");
    expect(body["status"]).toBe(500);
    expect(body).not.toHaveProperty("stack");
    await app.close();
  });

  it("does not let a thrown object choose its own status or message", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/__fixture/impostor",
    });

    // The object claimed 403; an untrusted throw must not control the public
    // status or write its own text into the response.
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("db.internal");
    await app.close();
  });
});

describe("request identifiers", () => {
  it("exposes X-Request-Id and matches it to the problem body", async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/nope" });

    const header = response.headers["x-request-id"];
    const body = response.json<{ requestId: string }>();

    expect(header).toBeDefined();
    expect(body.requestId).toBe(header);
    // The shared observability format, so a log line and a problem body tie
    // together.
    expect(body.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    await app.close();
  });

  it("exposes X-Request-Id on successful responses too", async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(/^req_/);
    await app.close();
  });

  it("ignores a client-supplied X-Request-Id", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/nope",
      headers: { "x-request-id": "forged-by-caller" },
    });

    // An inbound header is untrusted input; accepting it would let a caller
    // forge or collide with another request's identity in the logs.
    expect(response.headers["x-request-id"]).not.toBe("forged-by-caller");
    expect(response.json<{ requestId: string }>().requestId).toMatch(/^req_/);
    await app.close();
  });
});
