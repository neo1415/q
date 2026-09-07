import { describe, expect, it } from "vitest";

import {
  Q_CAPABILITIES,
  Q_RUN_STATUSES,
  Q_RUN_TERMINAL_STATUSES,
  type QRunStatus,
} from "@capital-q/contracts";

import {
  QRunTransitionError,
  QSubjectUnsupportedError,
} from "../src/domain/errors.js";
import {
  hashAppendQRunMessageRequest,
  hashCreateQRunRequest,
  hashMessageIdempotencyKey,
  hashRunIdempotencyKey,
} from "../src/domain/idempotency.js";
import {
  acceptsMessages,
  allowedTransitionsFrom,
  assertTransition,
  canTransition,
  consequenceClassFor,
  decideCancellation,
  INITIAL_Q_RUN_STATUS,
  Q_RUN_TRANSITIONS,
} from "../src/domain/lifecycle.js";
import { createQSubjectResolverRegistry } from "../src/domain/subjects.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("Q run lifecycle policy", () => {
  it("starts every run as RECEIVED and never as anything that implies work", () => {
    expect(INITIAL_Q_RUN_STATUS).toBe("RECEIVED");
    expect(Q_RUN_TERMINAL_STATUSES).not.toContain(INITIAL_Q_RUN_STATUS);
  });

  it("covers every status exactly once", () => {
    expect(Object.keys(Q_RUN_TRANSITIONS).sort()).toEqual(
      [...Q_RUN_STATUSES].sort(),
    );
  });

  it("gives terminal states no way out", () => {
    for (const status of Q_RUN_TERMINAL_STATUSES) {
      expect(allowedTransitionsFrom(status)).toEqual([]);
      for (const target of Q_RUN_STATUSES) {
        expect(canTransition(status, target)).toBe(false);
      }
    }
  });

  it("only ever moves to a status that exists", () => {
    for (const [from, targets] of Object.entries(Q_RUN_TRANSITIONS)) {
      for (const to of targets) {
        expect(Q_RUN_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it("accepts the moves the runtime makes today", () => {
    expect(canTransition("RECEIVED", "CANCELLED")).toBe(true);
    expect(canTransition("RECEIVED", "PREFLIGHT")).toBe(true);
    expect(canTransition("RECEIVED", "FAILED")).toBe(true);
    expect(canTransition("AWAITING_INPUT", "PLANNING")).toBe(true);
    expect(canTransition("CANCEL_REQUESTED", "CANCELLED")).toBe(true);
  });

  it("refuses moves that would fake progress or resurrect a run", () => {
    // Nothing goes straight from accepted to done: no analysis happened.
    expect(canTransition("RECEIVED", "COMPLETED")).toBe(false);
    expect(canTransition("RECEIVED", "SYNTHESIS")).toBe(false);
    // A cancel request never resumes.
    expect(canTransition("CANCEL_REQUESTED", "PLANNING")).toBe(false);
    expect(canTransition("CANCELLED", "RECEIVED")).toBe(false);
    expect(canTransition("COMPLETED", "RECEIVED")).toBe(false);
    expect(canTransition("FAILED", "PLANNING")).toBe(false);
  });

  it("raises a stable domain error for an invalid move", () => {
    expect(() => assertTransition("COMPLETED", "CANCELLED")).toThrow(
      QRunTransitionError,
    );
    try {
      assertTransition("RECEIVED", "COMPLETED");
    } catch (error) {
      expect(error).toBeInstanceOf(QRunTransitionError);
      const transition = error as QRunTransitionError;
      expect(transition.from).toBe("RECEIVED");
      expect(transition.to).toBe("COMPLETED");
      // The public sentence names no status word.
      expect(transition.message).not.toMatch(/RECEIVED|COMPLETED/);
    }
    expect(() => assertTransition("RECEIVED", "CANCELLED")).not.toThrow();
  });
});

describe("cancellation decision", () => {
  it("cancels immediately when nothing is in flight", () => {
    for (const status of [
      "RECEIVED",
      "AWAITING_INPUT",
      "AWAITING_APPROVAL",
    ] as const) {
      expect(decideCancellation(status)).toEqual({ kind: "CANCEL_NOW" });
    }
  });

  it("requests cancellation when work is in flight", () => {
    for (const status of [
      "PREFLIGHT",
      "CONTEXT_RESOLUTION",
      "POLICY_CHECK",
      "PLANNING",
      "RETRIEVAL",
      "SPECIALIST_EXECUTION",
      "SYNTHESIS",
      "VERIFICATION",
      "ACTION_EXECUTION",
    ] as const) {
      expect(decideCancellation(status)).toEqual({ kind: "REQUEST_CANCEL" });
    }
  });

  it("is idempotent for a run already cancelled or being cancelled", () => {
    expect(decideCancellation("CANCELLED")).toEqual({
      kind: "ALREADY_CANCELLING",
    });
    expect(decideCancellation("CANCEL_REQUESTED")).toEqual({
      kind: "ALREADY_CANCELLING",
    });
  });

  it("refuses to cancel a run that already ended some other way", () => {
    for (const status of ["COMPLETED", "FAILED", "EXPIRED"] as const) {
      expect(decideCancellation(status)).toEqual({ kind: "ALREADY_TERMINAL" });
    }
  });

  it("decides for every status", () => {
    for (const status of Q_RUN_STATUSES) {
      expect(decideCancellation(status).kind).toBeDefined();
    }
  });
});

describe("message acceptance", () => {
  it("accepts a turn only into a live run that is not being cancelled", () => {
    const refused: QRunStatus[] = [
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
      "CANCEL_REQUESTED",
    ];
    for (const status of Q_RUN_STATUSES) {
      expect(acceptsMessages(status), status).toBe(!refused.includes(status));
    }
  });
});

describe("consequence class", () => {
  it("is decided for every capability, never by the client", () => {
    for (const capability of Q_CAPABILITIES) {
      expect(["LOW", "MODERATE", "HIGH"]).toContain(
        consequenceClassFor(capability),
      );
    }
    expect(consequenceClassFor("PREPARE_ACTION")).toBe("HIGH");
    expect(consequenceClassFor("ANSWER")).toBe("LOW");
    expect(consequenceClassFor("COMPARE")).toBe("MODERATE");
  });
});

describe("idempotency hashing", () => {
  const request = {
    capability: "INVESTIGATE" as const,
    message: { text: "How much runway does Apex have?" },
    modality: "TEXT" as const,
    subjects: [{ kind: "COMPANY" as const, companyId: UUID }],
  };

  it("stores hashes only, in separate namespaces per operation", () => {
    const key = "client-key-0001";
    expect(hashRunIdempotencyKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMessageIdempotencyKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRunIdempotencyKey(key)).not.toBe(hashMessageIdempotencyKey(key));
    expect(hashRunIdempotencyKey(key)).not.toContain(key);
  });

  it("hashes the canonical request, independent of key order and undefined", () => {
    const reordered = {
      subjects: request.subjects,
      modality: request.modality,
      message: request.message,
      capability: request.capability,
      objective: undefined,
    };
    expect(hashCreateQRunRequest(reordered)).toBe(
      hashCreateQRunRequest(request),
    );
    expect(
      hashCreateQRunRequest({
        ...request,
        message: { text: "How much runway does Apex have" },
      }),
    ).not.toBe(hashCreateQRunRequest(request));
  });

  it("distinguishes two different follow-up messages", () => {
    expect(hashAppendQRunMessageRequest({ message: { text: "Yes" } })).not.toBe(
      hashAppendQRunMessageRequest({ message: { text: "No" } }),
    );
  });
});

describe("subject resolver registry", () => {
  it("fails closed for a kind nobody registered", async () => {
    const registry = createQSubjectResolverRegistry([]);
    expect(registry.supports("COMPANY")).toBe(false);
    expect(
      await registry.resolve(
        {
          userId: UUID,
          tenantId: UUID,
          actorType: "HUMAN",
        } as never,
        { kind: "COMPANY", companyId: UUID },
      ),
    ).toBeNull();
  });

  it("refuses two resolvers for one kind", () => {
    const resolver = {
      kind: "COMPANY" as const,
      resolve: () => Promise.resolve(null),
    };
    expect(() => createQSubjectResolverRegistry([resolver, resolver])).toThrow(
      /Duplicate/,
    );
  });

  it("names the unsupported kind on its error without a table name", () => {
    const error = new QSubjectUnsupportedError("RELATIONSHIP");
    expect(error.kind).toBe("RELATIONSHIP");
    expect(error.message).not.toMatch(/q_runtime|table|sql/i);
  });
});
