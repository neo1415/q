import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolProposal,
} from "@capital-q/q-runtime";

import {
  asksForFresh,
  createReadCache,
  READ_CACHE_TTL_MS,
} from "../src/q/read-cache.js";

/**
 * "What Q knows, Q knows" (owner 2026-10-21), inside the Context
 * Firewall: a read is reused only for the same person under the same
 * authority, while fresh.
 */
const TENANT = randomUUID();
const USER = randomUUID();

function context(
  over: {
    user?: string;
    membership?: string;
    ceiling?: string;
    scopes?: readonly unknown[];
    said?: string;
  } = {},
): QToolExecutionContext {
  return {
    actor: {
      userId: over.user ?? USER,
      tenantId: TENANT,
      organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
      membershipId: over.membership ?? "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
      actorType: "HUMAN",
    },
    runId: randomUUID(),
    correlationId: `cor_${randomUUID()}`,
    capability: "ANSWER",
    plan: {
      policyVersion: 1,
      tenantId: TENANT,
      actor: { userId: over.user ?? USER },
      maxSensitivity: over.ceiling ?? "CONFIDENTIAL",
      scopes: over.scopes ?? [{ kind: "COMPANY_PROFILE", subject: "x" }],
      combinationConstraints: [],
      // Volatile per turn, never part of the key.
      screen: { route: "COMPANY", manifest: { seq: Math.random() } },
      planId: randomUUID(),
    },
    conversation: { latestUserText: over.said ?? "what's their runway?" },
  } as unknown as QToolExecutionContext;
}

const proposal = (name = "get_company"): QToolProposal => ({
  callId: randomUUID(),
  name,
  arguments: { companyId: "1ab2cc02-160f-4812-a6b1-8be7e43afd3e" },
});

const outcome = (
  data: unknown = { canonicalName: "Northwind", relationToYou: "SHARED" },
): QToolCallOutcome => ({
  callId: "c",
  toolName: "company.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "PUBLIC",
  result: { ok: true, data },
  latencyMs: 40,
});

describe("the read cache", () => {
  it("answers the same read by the same person under the same authority, across turns", () => {
    const cache = createReadCache();
    cache.keep(proposal(), context(), outcome());
    const again = proposal();
    const hit = cache.get(again, context());
    expect(hit?.result).toEqual(outcome().result);
    // Under the new call's own id, and no read time.
    expect(hit?.callId).toBe(again.callId);
    expect(hit?.latencyMs).toBe(0);
  });

  it.each([
    ["another person", { user: randomUUID() }],
    ["another role (membership)", { membership: randomUUID() }],
    ["another sensitivity ceiling", { ceiling: "PUBLIC" }],
    ["another scope set (a grant revoked)", { scopes: [] }],
  ])("never crosses the Context Firewall: %s misses", (_name, over) => {
    const cache = createReadCache();
    cache.keep(proposal(), context(), outcome());
    expect(cache.get(proposal(), context(over))).toBeNull();
  });

  it("reads anew when they ask for the latest, and after the freshness window", () => {
    let now = 0;
    const cache = createReadCache(() => now);
    cache.keep(proposal(), context(), outcome());
    expect(
      cache.get(proposal(), context({ said: "check again please" })),
    ).toBeNull();
    expect(
      cache.get(proposal(), context({ said: "what's the latest on them?" })),
    ).toBeNull();
    now = READ_CACHE_TTL_MS + 1;
    expect(cache.get(proposal(), context())).toBeNull();
  });

  it("forgets what it read for a person once something of theirs changes", () => {
    const cache = createReadCache();
    cache.keep(proposal(), context(), outcome());
    cache.forget(context());
    expect(cache.get(proposal(), context())).toBeNull();
  });

  it("forgets by the person alone: an approved action executed off any run (live 2026-10-28, the mandate re-read)", () => {
    const cache = createReadCache();
    const mandate = proposal("get_investor_mandate");
    cache.keep(mandate, context(), outcome({ mandates: [{ min: "250000" }] }));
    cache.keep(proposal(), context(), outcome());
    // The card's Approve executed the mandate change: no run, no tool seam.
    cache.forgetPerson({ tenantId: TENANT, userId: USER });
    expect(cache.get(mandate, context())).toBeNull();
    expect(cache.get(proposal(), context())).toBeNull();
    // Another person's reads are theirs still.
    const other = randomUUID();
    cache.keep(proposal(), context({ user: other }), outcome());
    cache.forgetPerson({ tenantId: TENANT, userId: USER });
    expect(cache.get(proposal(), context({ user: other }))).not.toBeNull();
  });

  it("keeps only slow-changing entity reads, never their own records", () => {
    const cache = createReadCache();
    cache.keep(proposal("list_pending_approvals"), context(), outcome());
    expect(cache.get(proposal("list_pending_approvals"), context())).toBeNull();
    cache.keep(proposal(), context(), outcome({ relationToYou: "OWN" }));
    expect(cache.get(proposal(), context())).toBeNull();
  });

  it("knows a request for something newer", () => {
    expect(asksForFresh("any updates on Northwind?")).toBe(true);
    expect(asksForFresh("tell me again what they do")).toBe(false);
  });
});
