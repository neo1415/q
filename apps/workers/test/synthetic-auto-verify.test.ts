import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AuditEventIdSchema } from "@capital-q/audit";
import { parseWorkerConfig } from "@capital-q/config/workers";
import {
  CorrelationIdSchema,
  createEventRegistry,
  UtcTimestampSchema,
  type CapitalQEvent,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import { createSyntheticDemoRoutingAllowance } from "@capital-q/model-gateway";
import {
  createSyntheticAutoVerifySweep,
  createSyntheticVerificationDecider,
  SYNTHETIC_AUTO_VERIFY_POLICY,
  syntheticAutoVerifyAttestation,
  VERIFICATION_EVENTS,
  type SyntheticDemoAttestation,
  type VerificationClaim,
  type VerificationClaimRepository,
} from "@capital-q/verification";

import type { QueueMessage } from "../src/queue/pgmq.js";
import {
  runSyntheticAutoVerifySweeps,
  verificationAttestationFor,
} from "../src/verification/auto-verify.js";
import { withVerificationDecisions } from "../src/verification/decide-handler.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * R43 on the hosted workers (temporary until BIZ-006 /ops): with no
 * synthetic variable at all, CAPITAL_Q_ENV=staging lets the ordinary
 * decider verify requests whose requester and founder are marked
 * synthetic — through the sweep and through the event path — once.
 * Production, and any real person, stays PENDING.
 */

type MaterialActionAuditWriter = NonNullable<
  Parameters<typeof createSyntheticVerificationDecider>[0]["audit"]
>;

const registry = createEventRegistry([...VERIFICATION_EVENTS]);
const ORG = "d0000000-0000-4000-8000-000000000001";
const SYNTHETIC_FOUNDER = "b0000000-0000-4000-8000-000000000001";
const SYNTHETIC_ADMIN = "b0000000-0000-4000-8000-000000000003";
const REAL_USER = "b0000000-0000-4000-8000-000000000002";
const SYNTHETIC = new Set([SYNTHETIC_FOUNDER, SYNTHETIC_ADMIN]);
const correlation = () => CorrelationIdSchema.parse(`cor_${randomUUID()}`);

function pending(requester: string, founder: string): VerificationClaim {
  return {
    id: randomUUID(),
    tenantId: TENANT_A,
    organisationId: ORG,
    claimType: "FOUNDER_IDENTITY",
    subjectType: "PERSON",
    subjectId: founder,
    subjectDomain: null,
    subjectKey: founder,
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
}

function world(
  requests: readonly VerificationClaim[],
  environment: string,
  attestation: SyntheticDemoAttestation | null,
) {
  const rows: VerificationClaim[] = [...requests];
  const events: CapitalQEvent<unknown>[] = [];
  const audits: unknown[] = [];
  const tx = { sql: {} } as unknown as Parameters<
    TransactionManager["run"]
  >[0] extends (tx: infer T) => unknown
    ? T
    : never;
  const transactions: TransactionManager = { run: (work) => work(tx) };
  const currentRevision = (
    claim: Pick<VerificationClaim, "claimType" | "subjectKey">,
  ) =>
    Math.max(
      0,
      ...rows
        .filter(
          (r) =>
            r.claimType === claim.claimType &&
            r.subjectKey === claim.subjectKey,
        )
        .map((r) => r.revision),
    );
  const repository: VerificationClaimRepository = {
    lockOrganisation: () => Promise.resolve(),
    currentForOrganisation: () => Promise.resolve(rows),
    findById: (_executor, tenantId, claimId) =>
      Promise.resolve(
        rows.find((r) => r.tenantId === tenantId && r.id === claimId) ?? null,
      ),
    currentRevision: (_executor, claim) =>
      Promise.resolve(currentRevision(claim)),
    insertPending: () => Promise.reject(new Error("not under test")),
    insertOperatorDecision: () =>
      Promise.reject(new Error("not used by the synthetic decider")),
    insertDecision: (_tx, decision) => {
      const now = UtcTimestampSchema.parse(new Date().toISOString());
      const row: VerificationClaim = {
        ...decision.decides,
        id: randomUUID(),
        status: decision.status,
        revision: currentRevision(decision.decides) + 1,
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
      return Promise.resolve(AuditEventIdSchema.parse(input.auditEventId));
    },
  };
  const decide = createSyntheticVerificationDecider({
    sql: {} as DatabaseExecutor,
    transactions,
    outbox,
    audit,
    attestation,
    environment,
    repository,
    principals: {
      isSynthetic: (_executor, userId) =>
        Promise.resolve(SYNTHETIC.has(userId)),
    },
  });
  // Deliberately NOT filtered by the marker: the decider must refuse by
  // itself even if the source offered it a real person's request.
  const sweep = createSyntheticAutoVerifySweep({
    source: {
      pendingSyntheticClaims: (limit) =>
        Promise.resolve(
          rows
            .filter((r) => r.status === "PENDING")
            .slice(0, limit)
            .map((r) => ({ tenantId: r.tenantId, claimId: r.id })),
        ),
    },
    decide,
    correlation,
    limit: 50,
  });
  return { rows, events, audits, decide, sweep };
}

const verifiedRows = (rows: readonly VerificationClaim[]) =>
  rows.filter((r) => r.status === "VERIFIED");

describe("SYNTHETIC_AUTO_VERIFY_POLICY on the workers", () => {
  it("answers only on staging, and the routing allowance wins where present", () => {
    expect(
      verificationAttestationFor({
        syntheticDemo: null,
        environment: "staging",
      }).source,
    ).toBe(SYNTHETIC_AUTO_VERIFY_POLICY.id);
    for (const environment of [
      "production",
      "preview",
      "local",
      "test",
      undefined,
    ]) {
      expect(
        verificationAttestationFor({ syntheticDemo: null, environment }),
      ).toEqual({ attestation: null, source: "NONE" });
    }
    const allowance = { permitted: true as const, attestation: ["x"] };
    expect(
      verificationAttestationFor({
        syntheticDemo: allowance,
        environment: "staging",
      }),
    ).toEqual({ attestation: allowance, source: "SYNTHETIC_DEMO_ALLOWANCE" });
  });

  it("staging + synthetic requester and founder: VERIFIED once, with events and audit; a rerun writes nothing", async () => {
    const request = pending(SYNTHETIC_ADMIN, SYNTHETIC_FOUNDER);
    const w = world(
      [request],
      "staging",
      verificationAttestationFor({
        syntheticDemo: null,
        environment: "staging",
      }).attestation,
    );

    expect(await w.sweep()).toEqual({
      considered: 1,
      verified: 1,
      nothingToDecide: 0,
      refused: {},
      failed: 0,
    });
    // The fake source still offers the decided request (the Postgres one
    // filters on the current revision); the decider finds it not current.
    expect(await w.sweep()).toMatchObject({ verified: 0, nothingToDecide: 1 });
    // The event path after the sweep finds nothing current to decide.
    expect(
      await w.decide({
        tenantId: TENANT_A,
        claimId: request.id,
        correlationId: correlation(),
      }),
    ).toEqual({ kind: "NOTHING_TO_DECIDE" });

    const decisions = verifiedRows(w.rows);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decidesClaimId: request.id,
      method: "SYNTHETIC_DEMO_ATTESTATION",
      provider: "CAPITAL_Q_SYNTHETIC_DEMO",
      decidedByActorType: "SYSTEM",
    });
    expect(decisions[0]?.decisionBasis).toBe(
      "SYNTHETIC_AUTO_VERIFY_POLICY v1 (temporary until BIZ-006 /ops); environment staging; requesting account marked synthetic",
    );
    expect(w.events.map((e) => e.type)).toEqual(["verification.claim.decided"]);
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({
      actorType: "SYSTEM",
      actionType: "verification.claim.decided",
    });
  });

  it("verifies through the verification.claim.recorded consumer too, once", async () => {
    const request = pending(SYNTHETIC_FOUNDER, SYNTHETIC_FOUNDER);
    const w = world(
      [request],
      "staging",
      syntheticAutoVerifyAttestation("staging"),
    );
    const handle = withVerificationDecisions(
      () => Promise.resolve({ kind: "ARCHIVE" }),
      { registry, decide: w.decide, logger: createRecordingLogger() },
    );
    const message = (): QueueMessage => ({
      msgId: 1,
      readCount: 1,
      enqueuedAt: new Date().toISOString(),
      message: {
        specVersion: "1.0",
        id: randomUUID(),
        type: "verification.claim.recorded",
        source: "capitalq://api/verification",
        time: new Date().toISOString(),
        subject: `verification_claim/${request.id}`,
        dataContentType: "application/json",
        eventVersion: 1,
        tenantId: TENANT_A,
        organisationId: ORG,
        actor: { type: "HUMAN", id: SYNTHETIC_FOUNDER },
        correlationId: `cor_${randomUUID()}`,
        aggregate: { type: "verification_claim", id: request.id, version: 1 },
        data: {
          claimId: request.id,
          claimType: "FOUNDER_IDENTITY",
          status: "PENDING",
          revision: 1,
        },
      },
    });
    await handle(message());
    await handle(message());
    expect(verifiedRows(w.rows)).toHaveLength(1);
    expect(w.events).toHaveLength(1);
    expect(w.audits).toHaveLength(1);
  });

  it("production stays PENDING, even if handed the staging policy's proof", async () => {
    for (const attestation of [
      verificationAttestationFor({
        syntheticDemo: null,
        environment: "production",
      }).attestation,
      syntheticAutoVerifyAttestation("staging"),
    ]) {
      const w = world(
        [pending(SYNTHETIC_ADMIN, SYNTHETIC_FOUNDER)],
        "production",
        attestation,
      );
      const result = await w.sweep();
      expect(result.verified).toBe(0);
      expect(Object.keys(result.refused)).toHaveLength(1);
      expect(verifiedRows(w.rows)).toHaveLength(0);
      expect(w.events).toHaveLength(0);
      expect(w.audits).toHaveLength(0);
    }
  });

  it.each([
    ["requester", REAL_USER, SYNTHETIC_FOUNDER],
    ["founder", SYNTHETIC_ADMIN, REAL_USER],
  ])(
    "a non-synthetic %s stays PENDING on staging",
    async (_label, requester, founder) => {
      const w = world(
        [pending(requester, founder)],
        "staging",
        syntheticAutoVerifyAttestation("staging"),
      );
      expect(await w.sweep()).toMatchObject({
        verified: 0,
        refused: { PRINCIPAL_NOT_SYNTHETIC: 1 },
      });
      expect(await w.sweep()).toMatchObject({ verified: 0 });
      expect(verifiedRows(w.rows)).toHaveLength(0);
      expect(w.events).toHaveLength(0);
      expect(w.audits).toHaveLength(0);
    },
  );

  it("counts a failed decision and carries on with the rest", async () => {
    const failures: string[] = [];
    const sweep = createSyntheticAutoVerifySweep({
      source: {
        pendingSyntheticClaims: () =>
          Promise.resolve([
            { tenantId: TENANT_A, claimId: "a" },
            { tenantId: TENANT_A, claimId: "b" },
          ]),
      },
      decide: ({ claimId }) =>
        claimId === "a"
          ? Promise.reject(new Error("database away"))
          : Promise.resolve({ kind: "NOTHING_TO_DECIDE" }),
      correlation,
      limit: 10,
      onFailure: (claimId) => failures.push(claimId),
    });
    expect(await sweep()).toMatchObject({ failed: 1, nothingToDecide: 1 });
    expect(failures).toEqual(["a"]);
  });

  it("the sweep loop logs each run, survives a failing run and stops on abort", async () => {
    const logger = createRecordingLogger();
    const controller = new AbortController();
    let runs = 0;
    await runSyntheticAutoVerifySweeps({
      sweep: () => {
        runs += 1;
        if (runs === 1) return Promise.reject(new Error("database away"));
        if (runs === 3) controller.abort();
        return Promise.resolve({
          considered: 0,
          verified: 0,
          nothingToDecide: 0,
          refused: {},
          failed: 0,
        });
      },
      intervalMs: 1,
      signal: controller.signal,
      logger,
      sleep: () => Promise.resolve(),
    });
    expect(runs).toBe(3);
    expect(logger.lines.map((l) => l.message)).toEqual([
      "synthetic auto-verify sweep failed; retrying next interval",
      "synthetic auto-verify sweep",
      "synthetic auto-verify sweep",
    ]);
  });

  it("boots on Railway-shaped staging with no synthetic variables and still gets the policy", () => {
    // Exactly the worker's own composition (main.ts), minus the process.
    const env = {
      CAPITAL_Q_ENV: "staging",
      SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    };
    const config = parseWorkerConfig(env);
    const providerSecrets = config.secrets.modelProviders;
    expect(providerSecrets.syntheticDemoAttested).toBe(false);
    expect(providerSecrets.syntheticDemoProjectRef).toBeUndefined();
    const syntheticDemo = createSyntheticDemoRoutingAllowance({
      operatorEnabled: providerSecrets.syntheticDemoRouting,
      environment: config.runtime.deploymentEnvironment,
      databaseUrl:
        "postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
      hostedAttested: providerSecrets.syntheticDemoAttested,
      supabaseUrl: config.public.supabaseUrl,
    });
    expect(syntheticDemo).toBeNull();
    const verification = verificationAttestationFor({
      syntheticDemo,
      environment: config.runtime.deploymentEnvironment,
    });
    expect(verification.source).toBe(SYNTHETIC_AUTO_VERIFY_POLICY.id);
    expect(verification.attestation?.permitted).toBe(true);
  });
});
