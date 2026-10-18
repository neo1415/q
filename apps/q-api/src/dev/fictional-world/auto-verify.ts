import {
  CorrelationIdSchema,
  createEventRegistry,
  type CorrelationId,
} from "@capital-q/contracts";
import type { RequestDatabase } from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  createSyntheticDemoRoutingAllowance,
  type SyntheticDemoRoutingOptions,
} from "@capital-q/model-gateway";
import {
  createPostgresVerificationClaimRepository,
  createSyntheticVerificationDecider,
  VERIFICATION_EVENTS,
  type DecideSyntheticCommand,
  type DecideSyntheticOutcome,
  type SyntheticDemoAttestation,
  type VerificationClaim,
} from "@capital-q/verification";
import { randomUUID } from "node:crypto";

/**
 * R43 — seeded fictional companies end up VERIFIED without the workers.
 *
 * TEMPORARY until BIZ-006 (/ops) ships and the founder decides verification
 * by hand. TODO(BIZ-006): delete this module and its call in seed.ts.
 *
 * Why here: hosted workers cannot hold the synthetic-demo attestation
 * (setting it there crashes them by design), so their decider refuses
 * every request and it stays PENDING. The seed runner is the one process
 * that is run against the attested synthetic project by an operator, so it
 * builds the SAME allowance the gateway and the workers build, from the
 * same variables, and hands it to the SAME decider
 * (`createSyntheticVerificationDecider`). Nothing is bypassed:
 *
 *   - no attestation (not the attested project, production, preview) →
 *     no decision at all; every request stays PENDING, which is the truth;
 *   - the decider still refuses unless the requester and the founder a
 *     FOUNDER_IDENTITY claim is about carry `app_metadata.synthetic`, so a
 *     real account is never auto-verified even on the attested project;
 *   - a decision is the ordinary append-only row, SYSTEM audit and
 *     `verification.claim.decided` event; the workers' readiness handler
 *     (which needs no attestation) reconciles readiness from it;
 *   - a rerun finds no PENDING current claim (or the decider finds the
 *     request no longer current) and writes nothing.
 */

export type SeedAutoVerifyOutcome = {
  readonly verified: number;
  readonly refused: readonly string[];
  /** Why nothing was attempted, when nothing was. */
  readonly skipped: string | null;
};

export type SeedAutoVerifier = (owner: {
  readonly tenantId: string;
  readonly organisationId: string;
}) => Promise<SeedAutoVerifyOutcome>;

export type SeedAutoVerifyDependencies = {
  readonly attestation: SyntheticDemoAttestation | null;
  /** The organisation's current claims (the decider re-checks each one). */
  readonly currentClaims: (
    tenantId: string,
    organisationId: string,
  ) => Promise<readonly Pick<VerificationClaim, "id" | "status">[]>;
  readonly decide: (
    command: DecideSyntheticCommand,
  ) => Promise<DecideSyntheticOutcome>;
  readonly correlation?: (() => CorrelationId) | undefined;
};

export function createSeedAutoVerifier(
  dependencies: SeedAutoVerifyDependencies,
): SeedAutoVerifier {
  const correlation =
    dependencies.correlation ??
    (() => CorrelationIdSchema.parse(`cor_${randomUUID()}`));
  return async ({ tenantId, organisationId }) => {
    // Without the deployment's attestation nothing is even attempted: the
    // decider would refuse by name, and the seed must not look as if it tried.
    if (dependencies.attestation === null) {
      return { verified: 0, refused: [], skipped: "NO_ATTESTATION" };
    }
    const pending = (
      await dependencies.currentClaims(tenantId, organisationId)
    ).filter((claim) => claim.status === "PENDING");
    let verified = 0;
    const refused: string[] = [];
    for (const claim of pending) {
      const outcome = await dependencies.decide({
        tenantId,
        claimId: claim.id,
        correlationId: correlation(),
      });
      if (outcome.kind === "VERIFIED") verified += 1;
      if (outcome.kind === "REFUSED") refused.push(outcome.reason);
    }
    return { verified, refused, skipped: null };
  };
}

/**
 * The seed's attestation: `createSyntheticDemoRoutingAllowance`, exactly as
 * q-api and workers call it. Hosted needs CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED
 * and CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF naming the project both
 * seed URLs point at; local needs CAPITAL_Q_ENV local/test and a loopback
 * database. Anything the factory refuses is null (reported, not fatal:
 * the rest of the world still seeds and verification stays PENDING).
 */
export function seedSyntheticAttestation(
  options: Omit<SyntheticDemoRoutingOptions, "operatorEnabled"> & {
    readonly hosted: boolean;
  },
): { attestation: SyntheticDemoAttestation | null; reason: string | null } {
  try {
    const allowance = createSyntheticDemoRoutingAllowance({
      ...options,
      // Hosted: the operator's opt-in IS the attestation variable; local:
      // the factory's own loopback check is the proof.
      operatorEnabled: options.hosted ? options.hostedAttested === true : true,
    });
    return allowance === null
      ? { attestation: null, reason: "deployment not attested synthetic" }
      : { attestation: allowance, reason: null };
  } catch (error) {
    return {
      attestation: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The real composition: Postgres claims, the product's own decider. */
export function createPostgresSeedAutoVerifier(
  database: RequestDatabase,
  attestation: SyntheticDemoAttestation | null,
  environment: string | undefined,
): SeedAutoVerifier {
  const repository = createPostgresVerificationClaimRepository();
  const decide = createSyntheticVerificationDecider({
    sql: database.sql,
    transactions: database.transactions,
    outbox: createOutboxWriter({
      registry: createEventRegistry([...VERIFICATION_EVENTS]),
    }),
    attestation,
    environment,
    repository,
  });
  return createSeedAutoVerifier({
    attestation,
    currentClaims: (tenantId, organisationId) =>
      repository.currentForOrganisation(database.sql, tenantId, organisationId),
    decide,
  });
}
