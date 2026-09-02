import { describe, expect, it } from "vitest";

import {
  getObservabilityContext,
  runWithObservabilityContext,
  withObservabilityContext,
} from "../src/context.js";
import { createCorrelationId, createRequestId } from "../src/correlation.js";

describe("observability context", () => {
  it("is empty outside any scope", () => {
    expect(getObservabilityContext()).toEqual({});
  });

  it("is available inside a scope", () => {
    runWithObservabilityContext({ requestId: "req_1" }, () => {
      expect(getObservabilityContext().requestId).toBe("req_1");
    });
  });

  it("does not leak after the scope ends", () => {
    runWithObservabilityContext({ requestId: "req_1" }, () => undefined);
    expect(getObservabilityContext()).toEqual({});
  });

  it("survives an await boundary", async () => {
    await runWithObservabilityContext({ requestId: "req_async" }, async () => {
      await Promise.resolve();
      expect(getObservabilityContext().requestId).toBe("req_async");
    });
  });

  it("nests without corrupting the parent scope", () => {
    runWithObservabilityContext({ requestId: "outer" }, () => {
      withObservabilityContext({ jobId: "job_1" }, () => {
        expect(getObservabilityContext()).toEqual({
          requestId: "outer",
          jobId: "job_1",
        });
      });

      // The parent scope is unchanged by the nested addition.
      expect(getObservabilityContext()).toEqual({ requestId: "outer" });
    });
  });

  it("keeps concurrent scopes isolated from each other", async () => {
    // The reason AsyncLocalStorage is used at all: two requests interleaving
    // must never observe each other's correlation identifiers.
    async function work(requestId: string, delayMs: number): Promise<string> {
      return runWithObservabilityContext({ requestId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return getObservabilityContext().requestId ?? "missing";
      });
    }

    const [first, second, third] = await Promise.all([
      work("req_a", 20),
      work("req_b", 5),
      work("req_c", 12),
    ]);

    expect(first).toBe("req_a");
    expect(second).toBe("req_b");
    expect(third).toBe("req_c");
  });

  it("does not allow a scope object to be mutated in place", () => {
    const context = { requestId: "req_frozen" };

    runWithObservabilityContext(context, () => {
      const active = getObservabilityContext() as { requestId?: string };
      expect(() => {
        active.requestId = "tampered";
      }).toThrow();
    });
  });
});

describe("correlation identifiers", () => {
  it("generates non-empty prefixed opaque identifiers", () => {
    expect(createRequestId()).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(createCorrelationId()).toMatch(/^cor_[0-9a-f-]{36}$/);
  });

  it("does not repeat across a small sample", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createRequestId()));
    expect(ids.size).toBe(200);
  });

  it("keeps request and correlation identifiers distinguishable", () => {
    // They answer different questions: one unit of work vs one workflow.
    expect(createRequestId().startsWith("req_")).toBe(true);
    expect(createCorrelationId().startsWith("cor_")).toBe(true);
  });
});
