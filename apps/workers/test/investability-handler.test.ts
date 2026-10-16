import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { InvestabilityService } from "@capital-q/readiness";
import { VERIFICATION_EVENTS } from "@capital-q/verification";

import {
  companiesOfEvent,
  withInvestabilityRecompute,
} from "../src/investability/handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * Investability follows the evidence: a verification decision recomputes
 * the companies of the organisation the CLAIM belongs to (read from the
 * database, never from the message); a failure never blocks the other
 * consumers; an unrelated event recomputes nothing.
 */

const registry = createEventRegistry([...VERIFICATION_EVENTS]);
const CLAIM_ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "aa000000-0000-4000-8000-000000000001";

function fakeSql(): DatabaseExecutor {
  const fake = (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("evidence.verification_claims")) {
      return Promise.resolve([{ organisation_id: CLAIM_ORG }]);
    }
    if (text.includes("from core.companies")) {
      return Promise.resolve([{ id: COMPANY }]);
    }
    return Promise.resolve([]);
  };
  return fake as unknown as DatabaseExecutor;
}

function decided(claimId: string): QueueMessage {
  return {
    msgId: 7,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      specVersion: "1.0",
      id: randomUUID(),
      type: "verification.claim.decided",
      source: "capitalq://workers/verification",
      time: new Date().toISOString(),
      subject: `verification_claim/${claimId}`,
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId: TENANT_A,
      organisationId: "d0000000-0000-4000-8000-00000000ffff",
      actor: { type: "SYSTEM" },
      correlationId: `cor_${randomUUID()}`,
      aggregate: { type: "verification_claim", id: claimId, version: 2 },
      data: {
        claimId,
        decidesClaimId: randomUUID(),
        claimType: "ORGANISATION",
        status: "VERIFIED",
        method: "SYNTHETIC_DEMO_ATTESTATION",
        revision: 2,
      },
    },
  };
}

describe("investability recompute on events", () => {
  it("resolves companies from the database, not the message", async () => {
    const ids = await companiesOfEvent(
      fakeSql(),
      "verification.claim.decided",
      {
        claimId: randomUUID(),
        organisationId: undefined,
      },
    );
    expect(ids).toEqual([COMPANY]);
    expect(
      await companiesOfEvent(fakeSql(), "core.company.updated", {
        companyId: COMPANY,
      }),
    ).toEqual([COMPANY]);
    expect(await companiesOfEvent(fakeSql(), "x", "not an object")).toEqual([]);
  });

  it("recomputes, then always passes the message on", async () => {
    const recomputed: string[] = [];
    const service: Pick<InvestabilityService, "recompute"> = {
      recompute: (companyId) => {
        recomputed.push(companyId);
        return Promise.resolve({ kind: "RECORDED", revision: 1 });
      },
    };
    let passed = 0;
    const handle = withInvestabilityRecompute(
      () => {
        passed += 1;
        return Promise.resolve({ kind: "DONE" });
      },
      { registry, sql: fakeSql(), service, logger: createRecordingLogger() },
    );
    const parsed = registry.parse(decided(randomUUID()).message);
    expect(parsed.ok).toBe(true);
    await expect(handle(decided(randomUUID()))).resolves.toEqual({
      kind: "DONE",
    });
    expect(passed).toBe(1);
    expect(recomputed).toEqual([COMPANY]);
  });

  it("a failed recompute never blocks the other consumers", async () => {
    const service: Pick<InvestabilityService, "recompute"> = {
      recompute: () => Promise.reject(new Error("db down")),
    };
    let passed = 0;
    const logger = createRecordingLogger();
    const handle = withInvestabilityRecompute(
      () => {
        passed += 1;
        return Promise.resolve({ kind: "DONE" });
      },
      { registry, sql: fakeSql(), service, logger },
    );
    await expect(handle(decided(randomUUID()))).resolves.toEqual({
      kind: "DONE",
    });
    expect(passed).toBe(1);
  });
});
