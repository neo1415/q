import { describe, expect, it } from "vitest";

import type { VerificationMethod } from "@capital-q/contracts";

import {
  foundersLine,
  verificationTier,
  type VerificationClaim,
} from "../src/index.js";

/** V1: the badges, computed by code from the claim history. */

const ORG = "00000000-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-11-20T12:00:00Z");
let next = 0;

function claim(
  claimType: VerificationClaim["claimType"],
  subject: string,
  revision: number,
  status: VerificationClaim["status"],
  method: VerificationMethod | null,
  at = "2026-11-01T00:00:00Z",
  expiresAt: string | null = null,
): VerificationClaim {
  next += 1;
  const domain = claimType === "DOMAIN_CONTROL";
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    tenantId: "00000000-0000-4000-8000-0000000000f1",
    organisationId: ORG,
    claimType,
    subjectType: domain
      ? "DOMAIN"
      : claimType === "ORGANISATION"
        ? "ORGANISATION"
        : "PERSON",
    subjectId: domain ? null : subject,
    subjectDomain: domain ? subject : null,
    subjectKey: subject,
    status,
    revision,
    decidesClaimId: null,
    method,
    provider: null,
    decisionBasis: null,
    decidedByActorType: method === null ? null : "SYSTEM",
    decidedByUserId: null,
    decidedAt: status === "PENDING" ? null : at,
    requestedByUserId: "00000000-0000-4000-8000-0000000000b1",
    verifiedAt: status === "VERIFIED" ? at : null,
    expiresAt,
    revokedAt: status === "REVOKED" ? at : null,
    createdAt: at,
  };
}

const founder = (
  id: string,
  ...rest: [
    number,
    VerificationClaim["status"],
    VerificationMethod | null,
    string?,
  ]
) => claim("FOUNDER_IDENTITY", id, ...rest);
const org = (
  ...rest: [
    number,
    VerificationClaim["status"],
    VerificationMethod | null,
    string?,
  ]
) => claim("ORGANISATION", ORG, ...rest);
const domain = (
  ...rest: [
    number,
    VerificationClaim["status"],
    VerificationMethod | null,
    string?,
  ]
) => claim("DOMAIN_CONTROL", "example.com", ...rest);

const F1 = "00000000-0000-4000-8000-0000000000c1";
const F2 = "00000000-0000-4000-8000-0000000000c2";

const tier = (history: VerificationClaim[], foundersTotal?: number) =>
  verificationTier({ history, organisationId: ORG, now: NOW, foundersTotal });

describe("verification tiers", () => {
  it("nothing yet is unknown, never suspicious", () => {
    const none = tier([org(1, "PENDING", null)]);
    expect(none.tier).toBe("UNKNOWN");
    expect(none.badges).toEqual([]);
    expect(none.description).toBe("Verification not yet established.");
    expect(none.description.toLowerCase()).not.toMatch(
      /suspicious|unverified|fail/u,
    );
  });

  it("email, then registry, then founder ID", () => {
    expect(
      tier([domain(1, "PENDING", null), domain(2, "VERIFIED", "DOMAIN_EMAIL")])
        .tier,
    ).toBe("EMAIL_VERIFIED");
    expect(
      tier([org(1, "PENDING", null), org(2, "VERIFIED", "REGISTRY_LOOKUP")])
        .tier,
    ).toBe("REGISTRY_MATCHED");
    const linked = tier([
      org(1, "PENDING", null),
      org(2, "VERIFIED", "REGISTRY_LOOKUP"),
      founder(F1, 1, "PENDING", null),
      founder(F1, 2, "VERIFIED", "DIRECTOR_MATCH"),
    ]);
    expect(linked.tier).toBe("FOUNDER_ID_VERIFIED");
    expect(linked.badges.map((b) => b.badge)).toEqual([
      "REGISTRY_MATCHED",
      "FOUNDER_ID_VERIFIED",
    ]);
  });

  it("an ID and selfie alone, without the register link, is not Founder ID verified", () => {
    const result = tier([
      org(1, "VERIFIED", "REGISTRY_LOOKUP"),
      founder(F1, 1, "VERIFIED", "ID_SELFIE"),
    ]);
    expect(result.tier).toBe("REGISTRY_MATCHED");
  });

  it("no register, no founder badge, whatever the founder claim says", () => {
    expect(tier([founder(F1, 1, "VERIFIED", "DIRECTOR_MATCH")]).tier).toBe(
      "UNKNOWN",
    );
  });

  it("a revocation removes the badge; a later decision restores it", () => {
    expect(
      tier([
        org(1, "VERIFIED", "REGISTRY_LOOKUP"),
        org(2, "REVOKED", "OPERATOR_DECISION"),
      ]).tier,
    ).toBe("UNKNOWN");
    expect(
      tier([
        org(1, "VERIFIED", "REGISTRY_LOOKUP"),
        org(2, "REVOKED", "OPERATOR_DECISION"),
        org(3, "VERIFIED", "REGISTRY_LOOKUP"),
      ]).tier,
    ).toBe("REGISTRY_MATCHED");
  });

  it("an expired founder ID drops the founder badge", () => {
    const expired = claim(
      "FOUNDER_IDENTITY",
      F1,
      1,
      "VERIFIED",
      "DIRECTOR_MATCH",
      "2024-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    expect(tier([org(1, "VERIFIED", "REGISTRY_LOOKUP"), expired]).tier).toBe(
      "REGISTRY_MATCHED",
    );
  });

  it("fully verified needs all three in 12 months, the bank name and an operator's sign-off last", () => {
    const base = [
      domain(1, "VERIFIED", "DOMAIN_EMAIL", "2026-10-01T00:00:00Z"),
      org(1, "VERIFIED", "REGISTRY_LOOKUP", "2026-10-02T00:00:00Z"),
      founder(F1, 1, "VERIFIED", "DIRECTOR_MATCH", "2026-10-03T00:00:00Z"),
      org(2, "VERIFIED", "BANK_NAME_MATCH", "2026-10-04T00:00:00Z"),
    ];
    expect(tier(base).tier).toBe("FOUNDER_ID_VERIFIED");
    const full = tier([
      ...base,
      org(3, "VERIFIED", "OPERATOR_DECISION", "2026-10-05T00:00:00Z"),
    ]);
    expect(full.tier).toBe("FULLY_VERIFIED");
    expect(full.badges.at(-1)).toEqual({
      badge: "FULLY_VERIFIED",
      label: "Fully verified",
      verifiedAt: "2026-10-05T00:00:00Z",
      method: "OPERATOR_DECISION",
    });
    // Older than 12 months: not fully verified.
    const stale = [
      domain(1, "VERIFIED", "DOMAIN_EMAIL", "2025-06-01T00:00:00Z"),
      ...base.slice(1),
      org(3, "VERIFIED", "OPERATOR_DECISION", "2026-10-05T00:00:00Z"),
    ];
    expect(tier(stale).tier).toBe("FOUNDER_ID_VERIFIED");
  });

  it("investors see badge, date and method only", () => {
    const result = tier([org(1, "VERIFIED", "REGISTRY_LOOKUP")]);
    for (const badge of result.badges) {
      expect(Object.keys(badge).sort()).toEqual([
        "badge",
        "label",
        "method",
        "verifiedAt",
      ]);
    }
  });

  it("each founder counts separately, never rounded up", () => {
    const result = tier(
      [
        org(1, "VERIFIED", "REGISTRY_LOOKUP"),
        founder(F1, 1, "VERIFIED", "DIRECTOR_MATCH"),
        founder(F2, 1, "PENDING", null),
      ],
      3,
    );
    expect(result.founders).toEqual({ verified: 1, total: 3 });
    expect(foundersLine(result.founders)).toBe("1 of 3 founders verified");
    expect(foundersLine({ verified: 0, total: null })).toBeNull();
  });
});
