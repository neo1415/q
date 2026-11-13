import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AuditEventIdSchema,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import { UtcTimestampSchema, type CapitalQEvent } from "@capital-q/contracts";
import type { TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";

import {
  createDecideByOperator,
  SYNTHETIC_REVIEWER_BASIS_PREFIX,
  type NewOperatorDecision,
  type SyntheticReviewerScopePort,
  type VerificationClaim,
  type VerificationClaimRepository,
} from "../src/index.js";

/**
 * Owner 13 Nov (S4): the synthetic release-test reviewer guard in the
 * operator decision, over in-memory doubles. A synthetic reviewer decides
 * fictional applicants only and writes a synthetic decision; anything else
 * is SYNTHETIC_REVIEWER_SCOPE with nothing written; an ordinary operator,
 * and any operator when the port is not composed, is unchanged.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const APPLICANT = "b0000000-0000-4000-8000-000000000001";
const REVIEWER = "b0000000-0000-4000-8000-000000000002";
const CORRELATION = "cor_00000000-0000-4000-8000-000000000001";

function world(options: {
  readonly reviewerSynthetic: boolean;
  readonly applicantSynthetic: boolean;
  readonly composed?: boolean;
}) {
  const request: VerificationClaim = {
    id: randomUUID(),
    tenantId: TENANT,
    organisationId: ORG,
    claimType: "FOUNDER_IDENTITY",
    subjectType: "PERSON",
    subjectId: APPLICANT,
    subjectDomain: null,
    subjectKey: APPLICANT,
    status: "PENDING",
    revision: 1,
    decidesClaimId: null,
    method: null,
    provider: null,
    decisionBasis: null,
    decidedByActorType: null,
    decidedByUserId: null,
    decidedAt: null,
    requestedByUserId: APPLICANT,
    verifiedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: UtcTimestampSchema.parse(new Date().toISOString()),
  };
  const written: NewOperatorDecision[] = [];
  const events: CapitalQEvent<unknown>[] = [];
  const audits: Parameters<MaterialActionAuditWriter["record"]>[1][] = [];
  const asked: string[] = [];
  const transactions: TransactionManager = {
    run: (work) => work({ sql: {} } as Parameters<typeof work>[0]),
  };
  const repository: VerificationClaimRepository = {
    lockOrganisation: () => Promise.resolve(),
    currentForOrganisation: () => Promise.resolve([request]),
    findById: (_executor, tenantId, claimId) =>
      Promise.resolve(
        tenantId === request.tenantId && claimId === request.id
          ? request
          : null,
      ),
    currentRevision: () => Promise.resolve(1),
    insertPending: () => Promise.reject(new Error("not under test")),
    insertDecision: () => Promise.reject(new Error("not under test")),
    insertOperatorDecision: (_tx, decision) => {
      written.push(decision);
      const synthetic = decision.syntheticReviewer === true;
      return Promise.resolve({
        ...request,
        id: randomUUID(),
        status: decision.status,
        revision: 2,
        decidesClaimId: request.id,
        method: synthetic ? "SYNTHETIC_DEMO_ATTESTATION" : "OPERATOR_DECISION",
        provider: synthetic ? "CAPITAL_Q_SYNTHETIC_DEMO" : "CAPITAL_Q_OPERATOR",
        decisionBasis: decision.decisionBasis,
      });
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
  const syntheticReviewers: SyntheticReviewerScopePort = {
    isSyntheticReviewer: (_executor, userId) => {
      asked.push(`reviewer:${userId}`);
      return Promise.resolve(options.reviewerSynthetic);
    },
    isSyntheticApplicant: (_executor, claim) => {
      asked.push(`applicant:${claim.id}`);
      return Promise.resolve(options.applicantSynthetic);
    },
  };
  const decide = createDecideByOperator({
    transactions,
    repository,
    outbox,
    audit,
    ...(options.composed === false ? {} : { syntheticReviewers }),
  });
  const run = (operatorUserId = REVIEWER) =>
    decide({
      tenantId: TENANT,
      claimId: request.id,
      operatorUserId,
      status: "VERIFIED",
      decisionBasis: "Passport checked",
      revocationReason: null,
      correlationId: CORRELATION,
    });
  return { request, written, events, audits, asked, run };
}

describe("operator decisions by a synthetic release-test reviewer (S4)", () => {
  it("writes a synthetic reviewer's decision on a fictional applicant as synthetic", async () => {
    const w = world({ reviewerSynthetic: true, applicantSynthetic: true });
    expect(await w.run()).toMatchObject({
      kind: "DECIDED",
      status: "VERIFIED",
    });
    expect(w.written).toHaveLength(1);
    expect(w.written[0]?.syntheticReviewer).toBe(true);
    expect(w.written[0]?.decisionBasis).toBe(
      `${SYNTHETIC_REVIEWER_BASIS_PREFIX}Passport checked`,
    );
    expect(w.audits[0]).toMatchObject({
      actorType: "HUMAN",
      actorId: REVIEWER,
      metadata: { method: "OPERATOR_DECISION_BY_SYNTHETIC_REVIEWER" },
    });
    expect(w.events[0]?.data).toMatchObject({
      method: "SYNTHETIC_DEMO_ATTESTATION",
    });
  });

  it("refuses a synthetic reviewer an applicant that is not wholly fictional, writing nothing", async () => {
    const w = world({ reviewerSynthetic: true, applicantSynthetic: false });
    expect(await w.run()).toEqual({ kind: "SYNTHETIC_REVIEWER_SCOPE" });
    expect(w.written).toEqual([]);
    expect(w.audits).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("still refuses a synthetic reviewer their own request as SELF_DECISION", async () => {
    const w = world({ reviewerSynthetic: true, applicantSynthetic: true });
    expect(await w.run(APPLICANT)).toEqual({ kind: "SELF_DECISION" });
    expect(w.written).toEqual([]);
  });

  it.each([
    ["an ordinary operator", { composed: true }],
    ["any operator when the port is not composed", { composed: false }],
  ] as const)(
    "leaves %s's decision an OPERATOR_DECISION, unchanged",
    async (_label, { composed }) => {
      const w = world({
        reviewerSynthetic: !composed,
        applicantSynthetic: false,
        composed,
      });
      expect(await w.run()).toMatchObject({ kind: "DECIDED" });
      expect(w.written[0]).toEqual({
        decides: w.request,
        status: "VERIFIED",
        decisionBasis: "Passport checked",
        revocationReason: null,
        operatorUserId: REVIEWER,
      });
      expect(w.audits[0]?.metadata).toMatchObject({
        method: "OPERATOR_DECISION",
      });
      expect(w.events[0]?.data).toMatchObject({ method: "OPERATOR_DECISION" });
      // The applicant is only examined for a synthetic reviewer.
      expect(w.asked.some((a) => a.startsWith("applicant:"))).toBe(false);
    },
  );
});
