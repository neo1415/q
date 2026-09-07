import { describe, expect, it } from "vitest";

import {
  Q_FAILURE_DIAGNOSTIC_CODES,
  Q_PUBLIC_FAILURE_CODES,
  Q_PUBLIC_FAILURE_MESSAGES,
  QPublicFailureSchema,
  QRunFailureSchema,
  toPublicQFailure,
} from "../src/q/failure.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const REQUEST_ID = `req_${UUID}`;
const NOW = "2026-09-05T10:00:00Z";

/**
 * The marker the packet requires: any private diagnostic carrying it must
 * never appear in a serialised public failure. Alongside it, the classes of
 * text that leak in real systems.
 */
const MARKER = "PRIVATE-Q-DIAGNOSTIC-DO-NOT-EMIT";
const PRIVATE_DETAILS = [
  MARKER,
  `${MARKER} Error: connect ETIMEDOUT 10.0.0.12:443\n    at TCPConnectWrap.afterConnect (node:net:1595:16)`,
  `${MARKER} error: relation "q_runtime.q_runs" does not exist (SQLSTATE 42P01)`,
  `${MARKER} {"error":{"type":"overloaded_error","message":"Overloaded"}}`,
  `${MARKER} ZodError: [{"code":"invalid_type","path":["tenantId"]}]`,
  `${MARKER} LangGraph node retrieve_evidence raised after 3 attempts`,
  `${MARKER} postgresql://postgres:secret@127.0.0.1:54322/postgres`,
  `${MARKER} document 'Cash Crisis.xlsx' exists but actor lacks document.view`,
];

describe("toPublicQFailure", () => {
  it.each(Q_FAILURE_DIAGNOSTIC_CODES)(
    "projects %s to a public failure",
    (diagnosticCode) => {
      const failure = QRunFailureSchema.parse({
        diagnosticCode,
        detail: MARKER,
        occurredAt: NOW,
      });

      const publicFailure = toPublicQFailure(failure, {
        runId: UUID,
        requestId: REQUEST_ID,
      });

      expect(Q_PUBLIC_FAILURE_CODES).toContain(publicFailure.code);
      expect(publicFailure.message).toBe(
        Q_PUBLIC_FAILURE_MESSAGES[publicFailure.code],
      );
      expect(typeof publicFailure.retryable).toBe("boolean");
      expect(publicFailure.runId).toBe(UUID);
      expect(publicFailure.requestId).toBe(REQUEST_ID);
    },
  );

  it.each(PRIVATE_DETAILS)("never emits private detail: %s", (detail) => {
    for (const diagnosticCode of Q_FAILURE_DIAGNOSTIC_CODES) {
      const serialised = JSON.stringify(
        toPublicQFailure(
          {
            diagnosticCode,
            detail,
            providerErrorKind: "UNAVAILABLE",
            occurredAt: NOW,
          },
          { runId: UUID },
        ),
      );

      expect(serialised).not.toContain(MARKER);
      expect(serialised).not.toContain("SQLSTATE");
      expect(serialised).not.toContain("at TCPConnectWrap");
      expect(serialised).not.toContain("overloaded_error");
      expect(serialised).not.toContain("ZodError");
      expect(serialised).not.toContain("LangGraph");
      expect(serialised).not.toContain("postgresql://");
      expect(serialised).not.toContain("Cash Crisis");
      // Nor the internal enum itself, in any casing.
      expect(serialised).not.toContain(diagnosticCode);
      expect(serialised.toLowerCase()).not.toContain("provider");
    }
  });

  it("reads nothing but the diagnostic code", () => {
    // A failure object that would throw if any other property were touched.
    const trap = new Proxy(
      { diagnosticCode: "INTERNAL_ERROR" as const },
      {
        get(target, property) {
          if (property !== "diagnosticCode") {
            throw new Error(`public projection read ${String(property)}`);
          }
          return target.diagnosticCode;
        },
      },
    );

    expect(toPublicQFailure(trap).code).toBe("Q_FAILED");
  });

  it("does not reveal whether a restricted object exists", () => {
    const denied = toPublicQFailure({ diagnosticCode: "POLICY_DENIED" });
    const unresolved = toPublicQFailure({
      diagnosticCode: "SUBJECT_NOT_RESOLVED",
    });
    const unresolvable = toPublicQFailure({
      diagnosticCode: "CONTEXT_RESOLUTION_FAILED",
    });

    // A person who lacks access and a person asking about nothing get the
    // same words, so the words cannot be used to enumerate.
    expect(denied).toEqual(unresolved);
    expect(denied).toEqual(unresolvable);
    expect(denied.code).toBe("NOT_AVAILABLE_IN_CONTEXT");
    expect(denied.message).toBe(
      "I don't have information I can use to answer that in your current access context.",
    );
  });

  it("uses the approved wording for provider and evidence problems", () => {
    expect(
      toPublicQFailure({ diagnosticCode: "MODEL_PROVIDER_TIMEOUT" }).message,
    ).toBe("Q is taking longer than expected right now. Please try again.");
    expect(
      toPublicQFailure({ diagnosticCode: "EVIDENCE_PROCESSING_UNAVAILABLE" })
        .message,
    ).toBe(
      "I couldn't review the supporting information right now. Please try again shortly.",
    );
    expect(
      toPublicQFailure({ diagnosticCode: "MODEL_PROVIDER_TIMEOUT" }).retryable,
    ).toBe(true);
    expect(
      toPublicQFailure({ diagnosticCode: "POLICY_DENIED" }).retryable,
    ).toBe(false);
  });

  it("omits references it was not given rather than inventing them", () => {
    const failure = toPublicQFailure({ diagnosticCode: "RUN_CANCELLED" });
    expect("runId" in failure).toBe(false);
    expect("requestId" in failure).toBe(false);
  });
});

describe("public failure wording", () => {
  it.each(Q_PUBLIC_FAILURE_CODES)("%s reads as plain English", (code) => {
    const message = Q_PUBLIC_FAILURE_MESSAGES[code];
    expect(message.length).toBeGreaterThan(10);
    expect(message.length).toBeLessThanOrEqual(300);
    expect(message).not.toContain(code);
    expect(message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    expect(message).not.toMatch(
      /provider|sql|postgres|langgraph|zod|stack|exception|timeout|null|undefined/i,
    );
    expect(message).toMatch(/[.!]$/);
  });
});

describe("QPublicFailure schema", () => {
  const publicFailure = {
    code: "Q_FAILED",
    message: Q_PUBLIC_FAILURE_MESSAGES.Q_FAILED,
    retryable: true,
  };

  it("parses the public shape", () => {
    expect(QPublicFailureSchema.safeParse(publicFailure).success).toBe(true);
  });

  it("has no field for a stack, cause, detail, diagnostic code or provider payload", () => {
    for (const leak of [
      { stack: "Error: at ..." },
      { cause: {} },
      { detail: MARKER },
      { diagnosticCode: "INTERNAL_ERROR" },
      { providerErrorKind: "UNAVAILABLE" },
      { providerResponse: {} },
      { error: "..." },
      { issues: [] },
    ]) {
      expect(
        QPublicFailureSchema.safeParse({ ...publicFailure, ...leak }).success,
      ).toBe(false);
    }
  });

  it("accepts only the public vocabulary as a code", () => {
    for (const code of Q_FAILURE_DIAGNOSTIC_CODES) {
      if (!(Q_PUBLIC_FAILURE_CODES as readonly string[]).includes(code)) {
        expect(
          QPublicFailureSchema.safeParse({ ...publicFailure, code }).success,
        ).toBe(false);
      }
    }
    expect(
      QPublicFailureSchema.safeParse({
        ...publicFailure,
        code: "PROVIDER_UNAVAILABLE",
      }).success,
    ).toBe(false);
  });
});
