import { describe, expect, it, vi } from "vitest";

import type { TransactionContext } from "@capital-q/database";

import {
  settleFounderLink,
  type ProviderDecisionWriter,
  type RegistryRecord,
  type VerificationClaim,
  type VerificationReviewQueue,
} from "../src/index.js";

/** V1: a clean link is a system decision; a mismatch is an operator case. */

const request: VerificationClaim = {
  id: "00000000-0000-4000-8000-0000000000d1",
  tenantId: "00000000-0000-4000-8000-0000000000f1",
  organisationId: "00000000-0000-4000-8000-0000000000a1",
  claimType: "FOUNDER_IDENTITY",
  subjectType: "PERSON",
  subjectId: "00000000-0000-4000-8000-0000000000c1",
  subjectDomain: null,
  subjectKey: "00000000-0000-4000-8000-0000000000c1",
  status: "PENDING",
  revision: 1,
  decidesClaimId: null,
  method: null,
  provider: null,
  decisionBasis: null,
  decidedByActorType: null,
  decidedByUserId: null,
  decidedAt: null,
  requestedByUserId: "00000000-0000-4000-8000-0000000000c1",
  verifiedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-11-20T00:00:00Z",
};

const registry: RegistryRecord = {
  legalName: "LAGOS EXAMPLE TECHNOLOGIES LIMITED",
  registrationNumber: "RC1234567",
  jurisdictionCode: "NG",
  status: "ACTIVE",
  incorporatedOn: null,
  officers: [{ name: "Ada Example", role: "DIRECTOR", current: true }],
  providerReference: "dojah:NG:RC1234567",
};

const consent = {
  givenAt: "2026-11-20T10:00:00Z",
  textVersion: "biometric-consent-v1",
  explicit: true as const,
};

const tx = {} as TransactionContext;

function ports() {
  const decisions: ProviderDecisionWriter = {
    insertProviderDecision: vi.fn((_tx, decision) =>
      Promise.resolve({
        ...decision.decides,
        status: "VERIFIED" as const,
        revision: 2,
      }),
    ),
  };
  const reviews: VerificationReviewQueue = {
    open: vi.fn(() =>
      Promise.resolve({ reviewId: "00000000-0000-4000-8000-0000000000e1" }),
    ),
  };
  return { decisions, reviews };
}

describe("settling the founder link", () => {
  it("a clean link writes DIRECTOR_MATCH by the register's provider, with the consent", async () => {
    const { decisions, reviews } = ports();
    const settled = await settleFounderLink({ decisions, reviews }, tx, {
      request,
      registry,
      registryProvider: "DOJAH",
      identity: {
        idVerified: true,
        selfieMatched: true,
        nameOnId: "ADA EXAMPLE",
        providerReference: "dojah:bvn:x",
      },
      identityProvider: "DOJAH",
      consent,
      now: new Date("2026-11-20T12:00:00Z"),
    });
    expect(settled.kind).toBe("VERIFIED");
    expect(reviews.open).not.toHaveBeenCalled();
    expect(decisions.insertProviderDecision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        method: "DIRECTOR_MATCH",
        provider: "DOJAH",
        providerReference: "dojah:NG:RC1234567",
        expiresAt: "2028-11-20T12:00:00.000Z",
        decisionBasis: expect.stringContaining(
          "biometric consent biometric-consent-v1",
        ) as unknown,
      }),
    );
  });

  it("a mismatch opens one operator case and leaves the claim pending", async () => {
    const { decisions, reviews } = ports();
    const settled = await settleFounderLink({ decisions, reviews }, tx, {
      request,
      registry,
      registryProvider: "DOJAH",
      identity: {
        idVerified: true,
        selfieMatched: true,
        nameOnId: "Zed Nobody",
        providerReference: "dojah:bvn:x",
      },
      identityProvider: "DOJAH",
      consent,
      now: new Date("2026-11-20T12:00:00Z"),
    });
    expect(settled).toMatchObject({
      kind: "REVIEW",
      reviewId: "00000000-0000-4000-8000-0000000000e1",
    });
    expect(decisions.insertProviderDecision).not.toHaveBeenCalled();
    expect(reviews.open).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        claimId: request.id,
        requesterUserId: request.subjectId,
        idempotencyKey: `founder-link:${request.id}`,
      }),
    );
  });
});
