import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { MaterialActionAuditWriter } from "@capital-q/audit";
import {
  createEventRegistry,
  UtcTimestampSchema,
  type CapitalQEvent,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  createSyntheticVerificationDecider,
  VERIFICATION_EVENTS,
  type VerificationClaim,
  type VerificationClaimRepository,
} from "@capital-q/verification";

import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { withVerificationDecisions } from "../src/verification/decide-handler.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * The worker's verification consumer, composed with the real decision use
 * case over in-memory doubles for the table, the people, the outbox and
 * audit. What is proven: a synthetic request on an attested deployment is
 * VERIFIED once; a real person's stays PENDING; a production posture or a
 * missing attestation decides nothing; a redelivery decides nothing twice;
 * and the message always reaches the other consumers.
 */

const registry = createEventRegistry([...VERIFICATION_EVENTS]);
const PROOF = {
  permitted: true as const,
  attestation: [
    "operator opted in",
    "environment local",
    "database host 127.0.0.1",
  ],
};
const ORG = "d0000000-0000-4000-8000-000000000001";
const SYNTHETIC_USER = "b0000000-0000-4000-8000-000000000001";
const REAL_USER = "b0000000-0000-4000-8000-000000000002";

function memoryWorld(requester: string) {
  const request: VerificationClaim = {
    id: randomUUID(),
    tenantId: TENANT_A,
    organisationId: ORG,
    claimType: "FOUNDER_IDENTITY",
    subjectType: "PERSON",
    subjectId: requester,
    subjectDomain: null,
    subjectKey: requester,
    status: "PENDING",
    revision: 1,
    decidesClaimId: null,
    method: null,
    provider: null,
    decisionBasis: null,
    decidedByActorType: null,
    decidedByUserId: null,
    decidedAt: null,
    requestedByUserId: requester,
    verifiedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: UtcTimestampSchema.parse(new Date().toISOString()),
  };
  const rows: VerificationClaim[] = [request];
  const events: CapitalQEvent<unknown>[] = [];
  const audits: unknown[] = [];
  const tx = { sql: {} } as unknown as Parameters<
    TransactionManager["run"]
  >[0] extends (tx: infer T) => unknown
    ? T
    : never;
  const transactions: TransactionManager = { run: (work) => work(tx) };
  const repository: VerificationClaimRepository = {
    lockOrganisation: () => Promise.resolve(),
    currentForOrganisation: () => Promise.resolve(rows),
    findById: (_executor, tenantId, claimId) =>
      Promise.resolve(
        rows.find((r) => r.tenantId === tenantId && r.id === claimId) ?? null,
      ),
    currentRevision: (_executor, claim) =>
      Promise.resolve(
        Math.max(
          0,
          ...rows
            .filter(
              (r) =>
                r.claimType === claim.claimType &&
                r.subjectKey === claim.subjectKey,
            )
            .map((r) => r.revision),
        ),
      ),
    insertPending: () => Promise.reject(new Error("not under test")),
    insertDecision: (_tx, decision) => {
      const now = UtcTimestampSchema.parse(new Date().toISOString());
      const row: VerificationClaim = {
        ...decision.decides,
        id: randomUUID(),
        status: decision.status,
        revision: rows.length + 1,
        decidesClaimId: decision.decides.id,
        method: decision.method,
        provider: decision.provider,
        decisionBasis: decision.decisionBasis,
        decidedByActorType: "SYSTEM",
        decidedAt: now,
        verifiedAt: now,
        createdAt: now,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
  };
  const outbox: OutboxWriter = {
    enqueue: (_tx, event) => {
      events.push(event);
      return Promise.resolve({ status: "ENQUEUED" });
    },
  };
  const audit: MaterialActionAuditWriter = {
    record: (_tx, input) => {
      audits.push(input);
      return Promise.resolve(input.auditEventId);
    },
  };
  const decider = (attestation: typeof PROOF | null, environment: string) =>
    createSyntheticVerificationDecider({
      sql: {} as DatabaseExecutor,
      transactions,
      outbox,
      audit,
      attestation,
      environment,
      repository,
      principals: {
        isSynthetic: (_executor, userId) =>
          Promise.resolve(userId === SYNTHETIC_USER),
      },
    });
  return { request, rows, events, audits, decider };
}

function recorded(claimId: string): QueueMessage {
  return {
    msgId: 7,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      specVersion: "1.0",
      id: randomUUID(),
      type: "verification.claim.recorded",
      source: "capitalq://api/verification",
      time: new Date().toISOString(),
      subject: `verification_claim/${claimId}`,
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId: TENANT_A,
      organisationId: ORG,
      actor: { type: "HUMAN", id: SYNTHETIC_USER },
      correlationId: `cor_${randomUUID()}`,
      aggregate: { type: "verification_claim", id: claimId, version: 1 },
      data: {
        claimId,
        claimType: "FOUNDER_IDENTITY",
        status: "PENDING",
        revision: 1,
      },
    },
  };
}

function handlerFor(
  decide: ReturnType<ReturnType<typeof memoryWorld>["decider"]>,
) {
  const passedOn: QueueMessage[] = [];
  const handle = withVerificationDecisions(
    (message): Promise<MessageOutcome> => {
      passedOn.push(message);
      return Promise.resolve({ kind: "ARCHIVE" });
    },
    { registry, decide, logger: createRecordingLogger() },
  );
  return { handle, passedOn };
}

describe("verification.claim.recorded consumer", () => {
  it("verifies a synthetic request on an attested deployment, with provenance, once", async () => {
    const world = memoryWorld(SYNTHETIC_USER);
    const { handle, passedOn } = handlerFor(world.decider(PROOF, "local"));

    expect(await handle(recorded(world.request.id))).toEqual({
      kind: "ARCHIVE",
    });
    // Redelivery: the request is no longer current, nothing is written.
    expect(await handle(recorded(world.request.id))).toEqual({
      kind: "ARCHIVE",
    });

    const decisions = world.rows.filter((r) => r.status === "VERIFIED");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decidesClaimId: world.request.id,
      method: "SYNTHETIC_DEMO_ATTESTATION",
      provider: "CAPITAL_Q_SYNTHETIC_DEMO",
      decidedByActorType: "SYSTEM",
      decisionBasis:
        "operator opted in; environment local; database host 127.0.0.1; requesting account marked synthetic",
    });
    expect(world.events.map((e) => e.type)).toEqual([
      "verification.claim.decided",
    ]);
    expect(world.audits).toHaveLength(1);
    expect(world.audits[0]).toMatchObject({
      actorType: "SYSTEM",
      actionType: "verification.claim.decided",
    });
    expect(passedOn).toHaveLength(2);
  });

  it("leaves a real person's request PENDING", async () => {
    const world = memoryWorld(REAL_USER);
    const { handle, passedOn } = handlerFor(world.decider(PROOF, "local"));
    await handle(recorded(world.request.id));
    expect(world.rows).toHaveLength(1);
    expect(world.events).toHaveLength(0);
    expect(passedOn).toHaveLength(1);
  });

  it.each([
    ["production posture", PROOF, "production"],
    ["preview posture", PROOF, "preview"],
    ["no attestation", null, "local"],
  ] as const)("decides nothing on a %s", async (_label, proof, environment) => {
    const world = memoryWorld(SYNTHETIC_USER);
    const { handle } = handlerFor(world.decider(proof, environment));
    expect(await handle(recorded(world.request.id))).toEqual({
      kind: "ARCHIVE",
    });
    expect(world.rows).toHaveLength(1);
    expect(world.audits).toHaveLength(0);
  });

  it("retries when the decision fails, and passes other events straight on", async () => {
    const failing = () => Promise.reject(new Error("database away"));
    const { handle, passedOn } = handlerFor(failing);
    expect(await handle(recorded(randomUUID()))).toEqual({
      kind: "RETRY",
      errorCode: "VERIFICATION_DECISION_FAILED",
    });
    expect(passedOn).toHaveLength(0);
    const other = { ...recorded(randomUUID()), message: { type: "other" } };
    expect(await handle(other)).toEqual({ kind: "ARCHIVE" });
    expect(passedOn).toEqual([other]);
  });
});
