import { describe, expect, it } from "vitest";

import { ModelGatewayRequestSchema } from "@capital-q/contracts";

import type { ModelGateway } from "../src/gateway.js";
import type { ModelUsageEntry } from "../src/ports.js";
import {
  createReaderRouteActivity,
  createReaderWarmup,
  READER_WARMUP_IDLE_MS,
} from "../src/q/reader-warmup.js";
import {
  TURN_READER_REASONING,
  TURN_READER_REASONING_KEY,
} from "../src/q/turn-reader.js";

/**
 * DECISIONS 101: the reader warm-up. Virtual clock throughout; the gateway
 * is a recorder, so nothing here reaches a provider.
 */

const MINUTE = 60_000;
const TENANT = "c0000000-0000-4000-8000-000000000001";

// An arrival as a route would hand it over: the whole actor, plus words and
// a name that must never reach a model. Only the tenant id may be used.
const ARRIVING = {
  tenantId: TENANT,
  userId: "b0000000-0000-4000-8000-0000000000aa",
  organisationId: "d0000000-0000-4000-8000-0000000000bb",
  membershipId: "e0000000-0000-4000-8000-0000000000cc",
  displayName: "Savanna Private-Name",
  lastWords: "what is Halyard's runway?",
};

function usageEntry(taskClass: ModelUsageEntry["taskClass"]): ModelUsageEntry {
  return {
    tenantId: TENANT,
    userId: undefined,
    qRunId: undefined,
    taskClass,
    providerId: "p",
    modelId: "m",
    routingPolicyId: undefined,
    attempt: 1,
    inputTokens: 1,
    cachedInputTokens: 0,
    outputTokens: 1,
    latencyMs: 1,
    costUsd: 0,
    costBasis: "UNPRICED",
    success: true,
    errorCode: undefined,
    correlationId: undefined,
  };
}

function harness(options: { execute?: ModelGateway["execute"] } = {}) {
  let clock = 1_000_000;
  const now = () => clock;
  const calls: unknown[] = [];
  const recorded: ModelUsageEntry[] = [];
  const activity = createReaderRouteActivity(now);
  const ledger = activity.observe({
    record: (entry) => {
      recorded.push(entry);
      return Promise.resolve();
    },
  });
  const gateway: ModelGateway = {
    execute:
      options.execute ??
      ((request) => {
        calls.push(request);
        return Promise.resolve({} as never);
      }),
  };
  const warmup = createReaderWarmup({
    gateway,
    activity,
    dataPosture: "REAL_CUSTOMER",
    now,
  });
  return {
    warmup,
    calls,
    ledger,
    recorded,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Let deferred work run (the warm-up never runs inside onArrival). */
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

describe("reader route activity", () => {
  it("marks the route used on reader-route attempts only, and passes every entry on", async () => {
    let clock = 5_000;
    const activity = createReaderRouteActivity(() => clock);
    const seen: ModelUsageEntry[] = [];
    const ledger = activity.observe({
      record: (entry) => {
        seen.push(entry);
        return Promise.resolve();
      },
    });
    expect(activity.lastUsedAt()).toBeNull();
    await ledger.record(usageEntry("NORMAL_DIALOGUE"));
    expect(activity.lastUsedAt()).toBeNull();
    clock = 9_000;
    await ledger.record(usageEntry("FAST_CLASSIFICATION"));
    expect(activity.lastUsedAt()).toBe(9_000);
    expect(seen).toHaveLength(2);
  });
});

describe("reader warm-up", () => {
  it("fires once when someone arrives after the route has been idle 15 minutes", async () => {
    const h = harness();
    await h.ledger.record(usageEntry("FAST_CLASSIFICATION"));
    h.advance(READER_WARMUP_IDLE_MS);
    h.warmup.onArrival(ARRIVING);
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    expect(h.calls).toHaveLength(1);
  });

  it("does not fire while the route is warm", async () => {
    const h = harness();
    await h.ledger.record(usageEntry("FAST_CLASSIFICATION"));
    h.advance(14 * MINUTE);
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    expect(h.calls).toHaveLength(0);
  });

  it("fires on the first arrival after boot, when the route has never been used", async () => {
    const h = harness();
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    expect(h.calls).toHaveLength(1);
  });

  it("fires at most once per 15 minutes, even when its own call left no ledger row", async () => {
    const h = harness();
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    h.advance(10 * MINUTE);
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    expect(h.calls).toHaveLength(1);
    h.advance(5 * MINUTE);
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    expect(h.calls).toHaveLength(2);
  });

  it("treats its own recorded call as use: the next arrival within 15 minutes finds it warm", async () => {
    const h = harness();
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    // The gateway records the warm-up's attempt like any other.
    await h.ledger.record(usageEntry("FAST_CLASSIFICATION"));
    h.advance(14 * MINUTE);
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    expect(h.calls).toHaveLength(1);
  });

  it("asks on the reader's route, one bounded attempt, tagged WARMUP", async () => {
    const h = harness();
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    const request = ModelGatewayRequestSchema.parse(h.calls[0]);
    expect(request.taskClass).toBe("FAST_CLASSIFICATION");
    expect(request.reasoning).toBe(TURN_READER_REASONING);
    expect(request.reasoningKey).toBe(TURN_READER_REASONING_KEY);
    expect(request.sensitivity).toBe("CONFIDENTIAL");
    expect(request.dataPosture).toBe("REAL_CUSTOMER");
    expect(request.tools).toEqual([]);
    expect(request.budget.maxAttempts).toBe(1);
    expect(request.budget.maxOutputTokens).toBeLessThanOrEqual(32);
    expect(request.budget.maxEstimatedCostUsd).toBeLessThanOrEqual(0.002);
    expect(request.attribution.purpose).toBe("WARMUP");
    expect(request.attribution.correlationId).toMatch(/^cor_warmup_/u);
  });

  it("never carries anything about the person who arrived", async () => {
    const h = harness();
    h.warmup.onArrival(ARRIVING);
    await h.settle();
    const request = ModelGatewayRequestSchema.parse(h.calls[0]);
    // Identifiers only on the ledger side: the tenant, no user, no run.
    expect(request.attribution).toEqual({
      tenantId: TENANT,
      correlationId: request.attribution.correlationId,
      purpose: "WARMUP",
    });
    // And the words sent to the model are fixed text.
    const sent = JSON.stringify(request.messages);
    for (const value of [
      ARRIVING.userId,
      ARRIVING.organisationId,
      ARRIVING.membershipId,
      ARRIVING.displayName,
      ARRIVING.lastWords,
      TENANT,
    ]) {
      expect(sent).not.toContain(value);
    }
    // Two arrivals by different people send identical words.
    h.advance(READER_WARMUP_IDLE_MS);
    const someoneElse = {
      ...ARRIVING,
      displayName: "Someone Else",
      lastWords: "x",
    };
    h.warmup.onArrival(someoneElse);
    await h.settle();
    const second = ModelGatewayRequestSchema.parse(h.calls[1]);
    expect(JSON.stringify(second.messages)).toBe(sent);
  });

  it("never blocks the arrival: returns before the call starts, whatever the gateway does", async () => {
    let started = 0;
    const hanging = harness({
      execute: () => {
        started += 1;
        return new Promise<never>(() => undefined);
      },
    });
    expect(hanging.warmup.onArrival(ARRIVING)).toBeUndefined();
    // Not even begun synchronously: the page's request is not held a tick.
    expect(started).toBe(0);
    await hanging.settle();
    expect(started).toBe(1);

    const throwing = harness({
      execute: () => {
        throw new Error("provider down");
      },
    });
    expect(() => {
      throwing.warmup.onArrival(ARRIVING);
    }).not.toThrow();
    await throwing.settle();

    const rejecting = harness({
      execute: () => Promise.reject(new Error("timeout")),
    });
    rejecting.warmup.onArrival(ARRIVING);
    await rejecting.settle();
  });
});
