import { describe, expect, it } from "vitest";

import { UtcTimestampSchema } from "@capital-q/contracts";

import {
  decisionBasisOf,
  deploymentRefusal,
  describeStanding,
  founderIdentityOf,
  isRequestable,
  organisationIdentityOf,
  standingOf,
  toCompanyVerification,
  type VerificationClaim,
} from "../src/index.js";

const ts = (value: string) => UtcTimestampSchema.parse(value);
const NOW = new Date("2026-09-24T10:00:00.000Z");
const ORG = "d0000000-0000-4000-8000-000000000001";
const ALICE = "b0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const PROOF = {
  permitted: true as const,
  attestation: [
    "operator opted in",
    "environment local",
    "database host 127.0.0.1",
  ],
};

function claim(overrides: Partial<VerificationClaim>): VerificationClaim {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    tenantId: "c0000000-0000-4000-8000-000000000001",
    organisationId: ORG,
    claimType: "FOUNDER_IDENTITY",
    subjectType: "PERSON",
    subjectId: ALICE,
    subjectDomain: null,
    subjectKey: ALICE,
    status: "PENDING",
    revision: 1,
    decidesClaimId: null,
    method: null,
    provider: null,
    decisionBasis: null,
    decidedByActorType: null,
    decidedByUserId: null,
    decidedAt: null,
    requestedByUserId: ALICE,
    verifiedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: ts("2026-09-24T09:00:00.000Z"),
    ...overrides,
  };
}

const verified = (overrides: Partial<VerificationClaim> = {}) =>
  claim({
    status: "VERIFIED",
    revision: 2,
    method: "SYNTHETIC_DEMO_ATTESTATION",
    provider: "CAPITAL_Q_SYNTHETIC_DEMO",
    decisionBasis: "operator opted in",
    decidedByActorType: "SYSTEM",
    decidedAt: ts("2026-09-24T09:01:00.000Z"),
    verifiedAt: ts("2026-09-24T09:01:00.000Z"),
    ...overrides,
  });

describe("standings", () => {
  it("says NOT_REQUESTED when no row exists, never 'not verified'", () => {
    expect(standingOf(null, NOW)).toBe("NOT_REQUESTED");
  });

  it("reads a VERIFIED row past its expiry as EXPIRED without any write", () => {
    const expired = verified({
      expiresAt: ts("2026-09-24T09:30:00.000Z"),
    });
    expect(standingOf(expired, NOW)).toBe("EXPIRED");
    expect(standingOf(verified(), NOW)).toBe("VERIFIED");
  });

  it("lets a founder ask only when nothing stands and nothing waits", () => {
    expect(isRequestable("NOT_REQUESTED")).toBe(true);
    expect(isRequestable("EXPIRED")).toBe(true);
    expect(isRequestable("REVOKED")).toBe(true);
    expect(isRequestable("PENDING")).toBe(false);
    expect(isRequestable("VERIFIED")).toBe(false);
  });

  it("counts one verified member as a verified founder, else the asker's own claim", () => {
    const bobVerified = verified({ subjectId: BOB, subjectKey: BOB });
    expect(founderIdentityOf([claim({}), bobVerified], ALICE, NOW)).toBe(
      bobVerified,
    );
    const alicePending = claim({});
    expect(founderIdentityOf([alicePending], ALICE, NOW)).toBe(alicePending);
    expect(founderIdentityOf([alicePending], BOB, NOW)).toBeNull();
  });

  it("finds the organisation claim only for that organisation", () => {
    const org = claim({
      claimType: "ORGANISATION",
      subjectType: "ORGANISATION",
      subjectId: ORG,
      subjectKey: ORG,
    });
    expect(organisationIdentityOf([org], ORG)).toBe(org);
    expect(
      organisationIdentityOf([org], "d0000000-0000-4000-8000-000000000009"),
    ).toBeNull();
  });
});

describe("wording", () => {
  it("names the synthetic method whenever it verified", () => {
    expect(
      describeStanding(
        "ORGANISATION",
        "VERIFIED",
        "SYNTHETIC_DEMO_ATTESTATION",
      ),
    ).toContain("Verified (synthetic demo attestation)");
    expect(describeStanding("FOUNDER_IDENTITY", "PENDING", null)).toBe(
      "Requested; Capital Q has not decided yet.",
    );
  });

  it("builds the company view in a fixed order with requestable derived", () => {
    const view = toCompanyVerification(
      "aa000000-0000-4000-8000-000000000001",
      ORG,
      ALICE,
      [claim({})],
      NOW,
    );
    expect(view.standings.map((s) => s.claimType)).toEqual([
      "FOUNDER_IDENTITY",
      "ORGANISATION",
    ]);
    expect(view.standings.map((s) => s.status)).toEqual([
      "PENDING",
      "NOT_REQUESTED",
    ]);
    expect(view.requestable).toBe(true);
  });
});

describe("the synthetic attestation gate", () => {
  it("refuses production and preview even with a proof", () => {
    expect(deploymentRefusal(PROOF, "production")).toBe("PRODUCTION_POSTURE");
    expect(deploymentRefusal(PROOF, "preview")).toBe("PRODUCTION_POSTURE");
    expect(deploymentRefusal(PROOF, undefined)).toBe("PRODUCTION_POSTURE");
  });

  it("refuses without the deployment's attestation", () => {
    expect(deploymentRefusal(null, "local")).toBe("NO_ATTESTATION");
  });

  it("admits local with a proof and records what was checked", () => {
    expect(deploymentRefusal(PROOF, "local")).toBeNull();
    expect(decisionBasisOf(PROOF)).toBe(
      "operator opted in; environment local; database host 127.0.0.1; requesting account marked synthetic",
    );
  });
});
