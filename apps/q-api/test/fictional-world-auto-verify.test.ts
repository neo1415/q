import { describe, expect, it } from "vitest";

import { UtcTimestampSchema } from "@capital-q/contracts";
import {
  createSyntheticVerificationDecider,
  type SyntheticPrincipalPort,
  type VerificationClaim,
  type VerificationClaimRepository,
} from "@capital-q/verification";

import {
  createSeedAutoVerifier,
  seedSyntheticAttestation,
} from "../src/dev/fictional-world/auto-verify.js";

/**
 * R43 (temporary until BIZ-006): the seed decides its own synthetic
 * founders' verification through the product's real synthetic decider.
 * In-memory claims and principals; the decider, its gates and its
 * idempotency are the production code.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const SYNTHETIC_FOUNDER = "30000000-0000-4000-8000-000000000001";
const REAL_FOUNDER = "30000000-0000-4000-8000-000000000002";
const REF = "abcdefghijklmnopqrst";
const HOSTED_DB = `postgresql://postgres.${REF}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
const HOSTED_SUPABASE = `https://${REF}.supabase.co`;
const NOW = UtcTimestampSchema.parse("2026-09-27T00:00:00.000Z");

function pending(
  id: string,
  claimType: "FOUNDER_IDENTITY" | "ORGANISATION",
  founder: string,
): VerificationClaim {
  const subjectId = claimType === "FOUNDER_IDENTITY" ? founder : ORG;
  return {
    id,
    tenantId: TENANT,
    organisationId: ORG,
    claimType,
    subjectType: claimType === "FOUNDER_IDENTITY" ? "PERSON" : "ORGANISATION",
    subjectId,
    subjectDomain: null,
    subjectKey: `${claimType}:${subjectId}`,
    status: "PENDING",
    revision: 1,
    decidesClaimId: null,
    method: null,
    provider: null,
    decisionBasis: null,
    decidedByActorType: null,
    decidedByUserId: null,
    decidedAt: null,
    requestedByUserId: founder,
    verifiedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: NOW,
  };
}

function world(founder: string) {
  const rows: VerificationClaim[] = [
    pending(
      "40000000-0000-4000-8000-000000000001",
      "FOUNDER_IDENTITY",
      founder,
    ),
    pending("40000000-0000-4000-8000-000000000002", "ORGANISATION", founder),
  ];
  let next = 100;
  const highest = (
    claim: Pick<VerificationClaim, "claimType" | "subjectKey">,
  ) =>
    Math.max(
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
    currentForOrganisation: (_sql, tenantId, organisationId) =>
      Promise.resolve(
        rows.filter(
          (r) =>
            r.tenantId === tenantId &&
            r.organisationId === organisationId &&
            r.revision === highest(r),
        ),
      ),
    findById: (_sql, tenantId, claimId) =>
      Promise.resolve(
        rows.find((r) => r.id === claimId && r.tenantId === tenantId) ?? null,
      ),
    currentRevision: (_sql, claim) => Promise.resolve(highest(claim)),
    insertPending: () => Promise.reject(new Error("not used")),
    insertDecision: (_tx, decision) => {
      next += 1;
      const row: VerificationClaim = {
        ...decision.decides,
        id: `40000000-0000-4000-8000-000000000${String(next)}`,
        status: "VERIFIED",
        revision: decision.decides.revision + 1,
        decidesClaimId: decision.decides.id,
        method: decision.method,
        provider: decision.provider,
        decisionBasis: decision.decisionBasis,
        decidedByActorType: "SYSTEM",
        decidedAt: NOW,
        verifiedAt: NOW,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
  };
  const principals: SyntheticPrincipalPort = {
    isSynthetic: (_sql, userId) =>
      Promise.resolve(userId === SYNTHETIC_FOUNDER),
  };
  const events: unknown[] = [];
  const audits: unknown[] = [];
  const verifierWith = (
    attestation: ReturnType<typeof seedSyntheticAttestation>["attestation"],
    environment: string,
  ) => {
    const decide = createSyntheticVerificationDecider({
      sql: null as never,
      transactions: { run: (work) => work({ sql: null as never }) },
      outbox: {
        enqueue: (_tx, event) => {
          events.push(event);
          return Promise.resolve({ inserted: true } as never);
        },
      },
      audit: {
        record: (_tx, input) => {
          audits.push(input);
          return Promise.resolve(input.auditEventId);
        },
      },
      attestation,
      environment,
      repository,
      principals,
    });
    return createSeedAutoVerifier({
      attestation,
      currentClaims: (tenantId, organisationId) =>
        repository.currentForOrganisation(
          null as never,
          tenantId,
          organisationId,
        ),
      decide,
    });
  };
  const current = () =>
    rows.filter((r) => r.revision === highest(r)).map((r) => r.status);
  return { rows, events, audits, verifierWith, current };
}

const OWNER = { tenantId: TENANT, organisationId: ORG };

describe("seed auto-verify (R43, until BIZ-006)", () => {
  it("attests only the named synthetic project, and never without the flag", () => {
    const attested = seedSyntheticAttestation({
      hosted: true,
      environment: "staging",
      databaseUrl: HOSTED_DB,
      supabaseUrl: HOSTED_SUPABASE,
      hostedAttested: true,
      syntheticProjectRef: REF,
    });
    expect(attested.attestation?.permitted).toBe(true);

    expect(
      seedSyntheticAttestation({
        hosted: true,
        environment: "staging",
        databaseUrl: HOSTED_DB,
        supabaseUrl: HOSTED_SUPABASE,
        hostedAttested: false,
        syntheticProjectRef: REF,
      }).attestation,
    ).toBeNull();
    expect(
      seedSyntheticAttestation({
        hosted: true,
        environment: "staging",
        databaseUrl: HOSTED_DB,
        supabaseUrl: "https://zyxwvutsrqponmlkjihg.supabase.co",
        hostedAttested: true,
        syntheticProjectRef: REF,
      }).attestation,
    ).toBeNull();
    expect(
      seedSyntheticAttestation({
        hosted: true,
        environment: "production",
        databaseUrl: HOSTED_DB,
        supabaseUrl: HOSTED_SUPABASE,
        hostedAttested: true,
        syntheticProjectRef: REF,
      }).attestation,
    ).toBeNull();
  });

  it("(a) verifies a synthetic founder's company on the attested project, once", async () => {
    const w = world(SYNTHETIC_FOUNDER);
    const { attestation } = seedSyntheticAttestation({
      hosted: true,
      environment: "staging",
      databaseUrl: HOSTED_DB,
      supabaseUrl: HOSTED_SUPABASE,
      hostedAttested: true,
      syntheticProjectRef: REF,
    });
    const verify = w.verifierWith(attestation, "staging");

    const first = await verify(OWNER);
    expect(first).toEqual({ verified: 2, refused: [], skipped: null });
    expect(w.current()).toEqual(["VERIFIED", "VERIFIED"]);
    expect(w.events).toHaveLength(2);
    expect(w.audits).toHaveLength(2);

    // Rerun: nothing pending, no duplicate decision, no event, no audit.
    const again = await verify(OWNER);
    expect(again).toEqual({ verified: 0, refused: [], skipped: null });
    expect(w.rows).toHaveLength(4);
    expect(w.events).toHaveLength(2);
    expect(w.audits).toHaveLength(2);
  });

  it("(b) leaves the same synthetic founder PENDING without attestation", async () => {
    const w = world(SYNTHETIC_FOUNDER);
    const { attestation } = seedSyntheticAttestation({
      hosted: true,
      environment: "staging",
      databaseUrl: HOSTED_DB,
      supabaseUrl: HOSTED_SUPABASE,
      hostedAttested: false,
      syntheticProjectRef: REF,
    });
    expect(attestation).toBeNull();
    const outcome = await w.verifierWith(attestation, "staging")(OWNER);
    expect(outcome).toEqual({
      verified: 0,
      refused: [],
      skipped: "NO_ATTESTATION",
    });
    expect(w.current()).toEqual(["PENDING", "PENDING"]);
    expect(w.events).toHaveLength(0);
  });

  it("(c) never verifies a non-synthetic founder, even on the attested project", async () => {
    const w = world(REAL_FOUNDER);
    const { attestation } = seedSyntheticAttestation({
      hosted: true,
      environment: "staging",
      databaseUrl: HOSTED_DB,
      supabaseUrl: HOSTED_SUPABASE,
      hostedAttested: true,
      syntheticProjectRef: REF,
    });
    expect(attestation).not.toBeNull();
    const outcome = await w.verifierWith(attestation, "staging")(OWNER);
    expect(outcome.verified).toBe(0);
    expect(outcome.refused).toEqual([
      "PRINCIPAL_NOT_SYNTHETIC",
      "PRINCIPAL_NOT_SYNTHETIC",
    ]);
    expect(w.current()).toEqual(["PENDING", "PENDING"]);
    expect(w.events).toHaveLength(0);
    expect(w.audits).toHaveLength(0);
  });
});
