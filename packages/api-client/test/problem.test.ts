import { describe, expect, it } from "vitest";

import {
  ApiProblemError,
  parseProblemDetails,
  readProblemResponse,
  UNEXPECTED_API_RESPONSE,
} from "../src/problem.js";

const REQUEST_ID = "req_123e4567-e89b-12d3-a456-426614174000";

const VALID_PROBLEM = {
  type: "urn:capitalq:problem:permission-denied",
  title: "You do not have permission to perform this action.",
  status: 403,
  code: "PERMISSION_DENIED",
  requestId: REQUEST_ID,
};

function problemResponse(body: unknown, status = 403): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/problem+json; charset=utf-8",
      "x-request-id": REQUEST_ID,
    },
  });
}

describe("parseProblemDetails", () => {
  it("accepts a valid Capital Q problem", () => {
    expect(parseProblemDetails(VALID_PROBLEM)?.code).toBe("PERMISSION_DENIED");
  });

  it("preserves validation issues", () => {
    const parsed = parseProblemDetails({
      ...VALID_PROBLEM,
      status: 422,
      code: "VALIDATION_FAILED",
      errors: [
        {
          path: "targetAmount",
          code: "too_small",
          message: "Enter an amount greater than zero.",
        },
      ],
    });

    expect(parsed?.errors).toHaveLength(1);
    expect(parsed?.errors?.[0]?.path).toBe("targetAmount");
  });

  it("accepts a future code an older client does not recognise", () => {
    const parsed = parseProblemDetails({
      ...VALID_PROBLEM,
      code: "SOME_FUTURE_CODE",
    });

    // Not crashing here is the point: a newer server must not break an older
    // client.
    expect(parsed?.code).toBe("SOME_FUTURE_CODE");
  });

  it.each([
    { error: "not found" },
    { message: "invalid" },
    { success: false, errors: [] },
    { code: 403, reason: "nope" },
    "plain string",
    null,
    undefined,
    42,
  ])("returns undefined for the non-problem body %s", (body) => {
    expect(parseProblemDetails(body)).toBeUndefined();
  });

  it("rejects a malformed error code rather than trusting it", () => {
    expect(
      parseProblemDetails({ ...VALID_PROBLEM, code: "not upper snake" }),
    ).toBeUndefined();
  });

  it("rejects a problem claiming a non-error status", () => {
    expect(
      parseProblemDetails({ ...VALID_PROBLEM, status: 200 }),
    ).toBeUndefined();
  });
});

describe("readProblemResponse", () => {
  it("builds an ApiProblemError from a valid problem", async () => {
    const error = await readProblemResponse(problemResponse(VALID_PROBLEM));

    expect(error).toBeInstanceOf(ApiProblemError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.requestId).toBe(REQUEST_ID);
    expect(error.isKnownCode).toBe(true);
    expect(error.knownCode).toBe("PERMISSION_DENIED");
  });

  it("keeps a future code usable without pretending to know it", async () => {
    const error = await readProblemResponse(
      problemResponse({ ...VALID_PROBLEM, code: "SOME_FUTURE_CODE" }),
    );

    expect(error.code).toBe("SOME_FUTURE_CODE");
    expect(error.isKnownCode).toBe(false);
    expect(error.knownCode).toBeUndefined();
    // Still renderable: the title is safe server-authored text.
    expect(error.message).toBe(VALID_PROBLEM.title);
  });

  it("exposes validation issues for form handling", async () => {
    const error = await readProblemResponse(
      problemResponse(
        {
          ...VALID_PROBLEM,
          status: 422,
          code: "VALIDATION_FAILED",
          errors: [
            { path: "targetAmount", code: "too_small", message: "Too small." },
          ],
        },
        422,
      ),
    );

    expect(error.validationIssues?.[0]?.path).toBe("targetAmount");
  });

  it("falls back safely for an HTML error page from a proxy", async () => {
    const html =
      "<html><body>502 Bad Gateway - upstream 10.0.0.7:5432</body></html>";
    const response = new Response(html, {
      status: 502,
      headers: { "content-type": "text/html" },
    });

    const error = await readProblemResponse(response);

    expect(error.code).toBe(UNEXPECTED_API_RESPONSE);
    expect(error.status).toBe(502);
    expect(error.problem).toBeUndefined();
    // The upstream body is not retained or surfaced.
    expect(error.message).not.toContain("10.0.0.7");
    expect(JSON.stringify(error)).not.toContain("10.0.0.7");
  });

  it("falls back safely for invalid JSON", async () => {
    const response = new Response('{"type":', {
      status: 500,
      headers: { "content-type": "application/problem+json" },
    });

    const error = await readProblemResponse(response);
    expect(error.code).toBe(UNEXPECTED_API_RESPONSE);
    expect(error.problem).toBeUndefined();
  });

  it("falls back safely for JSON that is not a Capital Q problem", async () => {
    const response = new Response(
      JSON.stringify({ error: "something", stack: "at handler (/srv/a.js)" }),
      {
        status: 500,
        headers: { "content-type": "application/problem+json" },
      },
    );

    const error = await readProblemResponse(response);

    expect(error.code).toBe(UNEXPECTED_API_RESPONSE);
    expect(JSON.stringify(error)).not.toContain("at handler");
  });

  it("keeps the header request id even when the body is unusable", async () => {
    const response = new Response("nope", {
      status: 500,
      headers: { "content-type": "text/plain", "x-request-id": REQUEST_ID },
    });

    expect((await readProblemResponse(response)).requestId).toBe(REQUEST_ID);
  });

  it("keeps the client-internal code distinct from the server vocabulary", () => {
    // A server must never be able to claim this code, so application code can
    // tell "Capital Q rejected this" from "something in between broke".
    expect(UNEXPECTED_API_RESPONSE).toBe("UNEXPECTED_API_RESPONSE");
    expect(parseProblemDetails({ ...VALID_PROBLEM, code: "" })).toBeUndefined();
  });
});
