import { describe, expect, it } from "vitest";

import {
  CAPITAL_Q_ERROR_CODES,
  ErrorCodeSchema,
  isKnownErrorCode,
  KnownErrorCodeSchema,
} from "../src/http/error-codes.js";
import {
  ConsumerProblemDetailsSchema,
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsSchema,
} from "../src/http/problem-details.js";
import {
  createProblemDetails,
  PROBLEM_DEFINITIONS,
  problemFromUnknownError,
} from "../src/http/problem-factory.js";
import { ContractValidationError } from "../src/common/validation.js";

const REQUEST_ID = "req_123e4567-e89b-12d3-a456-426614174000";
const CORRELATION_ID = "cor_123e4567-e89b-12d3-a456-426614174000";

describe("error code registry", () => {
  it("contains the stable vocabulary from the API architecture", () => {
    for (const code of [
      "VALIDATION_FAILED",
      "AUTHENTICATION_REQUIRED",
      "PERMISSION_DENIED",
      "RESOURCE_NOT_FOUND",
      "RESOURCE_CONFLICT",
      "VERSION_CONFLICT",
      "IDEMPOTENCY_CONFLICT",
      "RATE_LIMITED",
      "Q_APPROVAL_REQUIRED",
      "Q_ACTION_EXPIRED",
      "PROVIDER_UNAVAILABLE",
      "UPLOAD_NOT_READY",
    ]) {
      expect(CAPITAL_Q_ERROR_CODES).toContain(code);
    }
  });

  it("adds only the two transport-level codes", () => {
    expect(CAPITAL_Q_ERROR_CODES).toContain("INVALID_REQUEST");
    expect(CAPITAL_Q_ERROR_CODES).toContain("INTERNAL_SERVER_ERROR");
    expect(CAPITAL_Q_ERROR_CODES).toHaveLength(14);
  });

  it("defines every code in the problem registry", () => {
    for (const code of CAPITAL_Q_ERROR_CODES) {
      const definition = PROBLEM_DEFINITIONS[code];
      expect(definition.type).toMatch(/^urn:capitalq:problem:[a-z-]+$/);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.status).toBeGreaterThanOrEqual(400);
      expect(definition.status).toBeLessThanOrEqual(599);
    }
  });
});

describe("producer vs consumer code validation", () => {
  it("restricts producers to codes Capital Q actually defines", () => {
    expect(KnownErrorCodeSchema.safeParse("VALIDATION_FAILED").success).toBe(
      true,
    );
    expect(KnownErrorCodeSchema.safeParse("SOME_FUTURE_CODE").success).toBe(
      false,
    );
  });

  it("lets a consumer accept a well-formed code it does not recognise", () => {
    // An older client must survive a newer server rather than treating an
    // unrecognised code as a broken response.
    expect(ErrorCodeSchema.safeParse("SOME_FUTURE_CODE").success).toBe(true);
    expect(isKnownErrorCode("SOME_FUTURE_CODE")).toBe(false);
    expect(isKnownErrorCode("VALIDATION_FAILED")).toBe(true);
  });

  it.each(["lowercase", "Mixed_Case", "1LEADING_DIGIT", "HAS SPACE", ""])(
    "rejects the malformed code %s even on the consumer side",
    (code) => {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(false);
    },
  );

  it("rejects an absurdly long code", () => {
    expect(ErrorCodeSchema.safeParse("A".repeat(65)).success).toBe(false);
  });
});

describe("ProblemDetails producer schema", () => {
  it("requires type, title, status, code and requestId", () => {
    const problem = createProblemDetails({
      code: "PERMISSION_DENIED",
      requestId: REQUEST_ID,
    });

    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
    expect(problem.status).toBe(403);
  });

  it.each(["type", "title", "status", "code", "requestId"])(
    "rejects a problem missing %s",
    (field) => {
      const problem: Record<string, unknown> = {
        ...createProblemDetails({
          code: "PERMISSION_DENIED",
          requestId: REQUEST_ID,
        }),
      };
      delete problem[field];

      expect(ProblemDetailsSchema.safeParse(problem).success).toBe(false);
    },
  );

  it.each([200, 204, 302, 399, 600, 0, -1])(
    "rejects the non-error status %i",
    (status) => {
      expect(
        ProblemDetailsSchema.safeParse({
          ...createProblemDetails({
            code: "PERMISSION_DENIED",
            requestId: REQUEST_ID,
          }),
          status,
        }).success,
      ).toBe(false);
    },
  );

  it("omits optional members rather than emitting empty values", () => {
    const problem = createProblemDetails({
      code: "RESOURCE_NOT_FOUND",
      requestId: REQUEST_ID,
    });

    // errors: [] on every failure would make its presence meaningless.
    expect(problem).not.toHaveProperty("errors");
    expect(problem).not.toHaveProperty("detail");
    expect(problem).not.toHaveProperty("instance");
    expect(problem).not.toHaveProperty("correlationId");
  });

  it("carries validation issues and correlation id when supplied", () => {
    const problem = createProblemDetails({
      code: "VALIDATION_FAILED",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      errors: [
        {
          path: "targetAmount",
          code: "too_small",
          message: "Enter an amount greater than zero.",
        },
      ],
    });

    expect(problem.status).toBe(422);
    expect(problem.errors).toHaveLength(1);
    expect(problem.correlationId).toBe(CORRELATION_ID);
    expect(ProblemDetailsSchema.safeParse(problem).success).toBe(true);
  });

  it("allows an explicit status override where a code has more than one expression", () => {
    // A version conflict is 409 or 412 depending on the operation.
    expect(
      createProblemDetails({
        code: "VERSION_CONFLICT",
        requestId: REQUEST_ID,
        status: 412,
      }).status,
    ).toBe(412);
  });

  it("has no metadata or debug escape hatch", () => {
    const parsed = ProblemDetailsSchema.parse({
      ...createProblemDetails({
        code: "INTERNAL_SERVER_ERROR",
        requestId: REQUEST_ID,
      }),
      metadata: { sql: "SELECT * FROM private_table" },
      stack: "at handler (/srv/app.js:1:1)",
      debug: { connection: "postgres://user:pw@host/db" },
    });

    // Unknown members are stripped, so an internal detail cannot ride along
    // even if a caller tries to attach one.
    expect(parsed).not.toHaveProperty("metadata");
    expect(parsed).not.toHaveProperty("stack");
    expect(parsed).not.toHaveProperty("debug");
  });
});

describe("consumer schema forward compatibility", () => {
  it("accepts a valid problem carrying an unknown future code", () => {
    const fromNewerServer = {
      ...createProblemDetails({
        code: "RESOURCE_NOT_FOUND",
        requestId: REQUEST_ID,
      }),
      code: "SOME_FUTURE_CODE",
      type: "urn:capitalq:problem:some-future-problem",
    };

    const parsed = ConsumerProblemDetailsSchema.parse(fromNewerServer);
    expect(parsed.code).toBe("SOME_FUTURE_CODE");
  });

  it("still rejects a structurally malformed body", () => {
    expect(
      ConsumerProblemDetailsSchema.safeParse({ error: "not found" }).success,
    ).toBe(false);
    expect(ConsumerProblemDetailsSchema.safeParse("nope").success).toBe(false);
    expect(ConsumerProblemDetailsSchema.safeParse(null).success).toBe(false);
  });
});

describe("problemFromUnknownError", () => {
  it("maps a contract validation error to 422 with its safe issues", () => {
    const error = new ContractValidationError("invalid", [
      { path: "amount", code: "invalid_format", message: "Enter an amount." },
    ]);

    const problem = problemFromUnknownError(error, { requestId: REQUEST_ID });

    expect(problem.status).toBe(422);
    expect(problem.code).toBe("VALIDATION_FAILED");
    expect(problem.errors).toHaveLength(1);
  });

  it("maps anything else to a generic 500 that discloses nothing", () => {
    const leaky = new Error(
      "SELECT * FROM private_table failed: postgres://user:super-secret-test-value@host/db",
    );

    const problem = problemFromUnknownError(leaky, { requestId: REQUEST_ID });
    const serialised = JSON.stringify(problem);

    expect(problem.status).toBe(500);
    expect(problem.code).toBe("INTERNAL_SERVER_ERROR");
    expect(serialised).not.toContain("SELECT");
    expect(serialised).not.toContain("super-secret-test-value");
    expect(serialised).not.toContain("postgres://");
  });

  it("ignores a statusCode an arbitrary thrown object claims", () => {
    // An untrusted object must not be able to choose the public HTTP status.
    const impostor = { statusCode: 403, message: "you may not see this" };

    const problem = problemFromUnknownError(impostor, {
      requestId: REQUEST_ID,
    });

    expect(problem.status).toBe(500);
    expect(JSON.stringify(problem)).not.toContain("you may not see this");
  });
});

describe("media type", () => {
  it("is application/problem+json", () => {
    expect(PROBLEM_CONTENT_TYPE).toBe("application/problem+json");
  });
});
