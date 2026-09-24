import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";
import { VERIFICATION_EVENTS } from "@capital-q/verification";

import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { withReadinessAfterVerification } from "../src/verification/readiness-handler.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * Readiness follows a verification decision (CQ-VERIFY-002). Proven here:
 * a decision reconciles the organisation the CLAIM belongs to (never the
 * one a message names), once per delivery; a redelivery finds the state
 * already agreeing and writes nothing; a revocation reconciles too; a
 * request or an unknown claim reconciles nothing; a failure retries; and
 * the message always reaches the other consumers.
 */

const registry = createEventRegistry([...VERIFICATION_EVENTS]);
const CLAIM_ORG = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000001",
);
const FORGED_ORG = "d0000000-0000-4000-8000-00000000ffff";
const COMPANY = "aa000000-0000-4000-8000-000000000001";

function decided(
  claimId: string,
  status: "VERIFIED" | "REVOKED" | "EXPIRED" = "VERIFIED",
): QueueMessage {
  return {
    msgId: 9,
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
      // Deliberately not the claim's organisation: the handler must read
      // the owner from the claim, not from here.
      organisationId: FORGED_ORG,
      actor: { type: "SYSTEM" },
      correlationId: `cor_${randomUUID()}`,
      aggregate: { type: "verification_claim", id: claimId, version: 2 },
      data: {
        claimId,
        decidesClaimId: randomUUID(),
        claimType: "ORGANISATION",
        status,
        method: "SYNTHETIC_DEMO_ATTESTATION",
        revision: 2,
      },
    },
  };
}

function harness(options: {
  readonly decidedClaims: ReadonlySet<string>;
  readonly failing?: boolean;
}) {
  const calls: { organisationId: string; trigger: string }[] = [];
  let stored = "requirements_outstanding";
  const passedOn: QueueMessage[] = [];
  const handle = withReadinessAfterVerification(
    (message): Promise<MessageOutcome> => {
      passedOn.push(message);
      return Promise.resolve({ kind: "ARCHIVE" });
    },
    {
      registry,
      ownerOf: (tenantId, claimId) =>
        Promise.resolve(
          options.decidedClaims.has(claimId)
            ? {
                tenantId: TenantIdSchema.parse(tenantId),
                organisationId: CLAIM_ORG,
              }
            : null,
        ),
      reconcile: (command) => {
        if (options.failing === true) {
          return Promise.reject(new Error("database away"));
        }
        calls.push({
          organisationId: command.organisationId,
          trigger: command.trigger,
        });
        // The Companies reconciliation: it writes only when the policy's
        // answer differs from what is stored.
        const changed = stored !== "marketplace_ready";
        stored = "marketplace_ready";
        return Promise.resolve([
          { companyId: COMPANY, state: stored, changed },
        ]);
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, calls, passedOn };
}

describe("verification.claim.decided → readiness", () => {
  it("reconciles the claim's organisation once per delivery, and a replay changes nothing", async () => {
    const claimId = randomUUID();
    const { handle, calls, passedOn } = harness({
      decidedClaims: new Set([claimId]),
    });

    expect(await handle(decided(claimId))).toEqual({ kind: "ARCHIVE" });
    expect(calls).toEqual([
      { organisationId: CLAIM_ORG, trigger: "VERIFICATION_DECIDED" },
    ]);

    expect(await handle(decided(claimId))).toEqual({ kind: "ARCHIVE" });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.organisationId === CLAIM_ORG)).toBe(true);
    expect(passedOn).toHaveLength(2);
  });

  it.each(["REVOKED", "EXPIRED"] as const)(
    "reconciles after a %s decision too: it can only lower readiness",
    async (status) => {
      const claimId = randomUUID();
      const { handle, calls } = harness({ decidedClaims: new Set([claimId]) });
      await handle(decided(claimId, status));
      expect(calls).toHaveLength(1);
    },
  );

  it("reconciles nothing for a claim that is not a decision", async () => {
    const { handle, calls, passedOn } = harness({ decidedClaims: new Set() });
    expect(await handle(decided(randomUUID()))).toEqual({ kind: "ARCHIVE" });
    expect(calls).toHaveLength(0);
    expect(passedOn).toHaveLength(1);
  });

  it("retries when reconciliation fails, and passes other events straight on", async () => {
    const claimId = randomUUID();
    const { handle, passedOn } = harness({
      decidedClaims: new Set([claimId]),
      failing: true,
    });
    expect(await handle(decided(claimId))).toEqual({
      kind: "RETRY",
      errorCode: "READINESS_RECONCILE_FAILED",
    });
    expect(passedOn).toHaveLength(0);
    const other = { ...decided(claimId), message: { type: "other" } };
    expect(await handle(other)).toEqual({ kind: "ARCHIVE" });
    expect(passedOn).toEqual([other]);
  });
});
