import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  recordStatedFigure,
  saidByThem,
  StatedFigureSchema,
  statedFigureWords,
  type Claim,
  type StatedFigure,
  type StatedFigureEvidence,
} from "../src/index.js";

/**
 * A8: a figure a founder told Q, recorded on their approval. The writes go
 * through the Evidence services only; this fake records what was asked of
 * them so the rules are asserted, not a database.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const COMPANY = "a0000000-0000-4000-8000-000000000001";

function claim(overrides: Partial<Claim>): Claim {
  return {
    id: randomUUID(),
    tenantId: actor.tenantId,
    subjectType: "COMPANY",
    subjectId: COMPANY,
    claimType: "financial",
    claimKey: "financial.mrr",
    statement: "earlier",
    structuredValue: null,
    assertedByType: "USER",
    assertedById: actor.userId,
    assertedAt: "2026-11-01T00:00:00.000Z",
    validFrom: null,
    validTo: null,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    lifecycleStatus: "CURRENT",
    visibilityScope: "organisation_private",
    sensitivityClass: "CONFIDENTIAL",
    currentRevisionId: randomUUID(),
    currentRevisionNumber: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  } as Claim;
}

function fake(existing: readonly Claim[] = []) {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const evidence: StatedFigureEvidence = {
    listClaims: (query) =>
      Promise.resolve(
        existing.filter(
          (c) => query.claimKey === undefined || c.claimKey === query.claimKey,
        ),
      ),
    registerEvidenceSource: (command) => {
      calls.push({ method: "source", input: command.input });
      return Promise.resolve({ id: randomUUID() } as never);
    },
    createClaim: (command) => {
      calls.push({ method: "claim", input: command.input });
      return Promise.resolve({ id: randomUUID() } as never);
    },
    createEvidenceItem: (command) => {
      calls.push({ method: "item", input: command.input });
      return Promise.resolve({ id: randomUUID() } as never);
    },
    linkClaimEvidence: (command) => {
      calls.push({ method: "link", input: command.input });
      return Promise.resolve({} as never);
    },
  };
  return { evidence, calls };
}

const october: StatedFigure = StatedFigureSchema.parse({
  metric: "MRR",
  value: { kind: "MONEY", amount: "120000", currency: "USD" },
  asOf: "2026-10-31",
  said: "we hit $120k MRR in October",
});

const record = (evidence: StatedFigureEvidence, figure = october) =>
  recordStatedFigure(evidence, {
    actor,
    companyId: COMPANY,
    figure,
    idempotencyKey: "q-key",
    correlationId: "cor_test",
  });

describe("a figure a founder told Q, recorded on their approval", () => {
  it("is their dated, self-reported claim, private by default, with their words as its evidence", async () => {
    const { evidence, calls } = fake();
    const out = await record(evidence);
    expect(out.outcome).toBe("RECORDED");
    expect(out.conflicts).toBe(0);
    const created = calls.find((c) => c.method === "claim")?.input;
    expect(created).toMatchObject({
      claimKey: "financial.mrr",
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      validFrom: "2026-10-31T00:00:00.000Z",
      structuredValue: {
        kind: "MONEY",
        amount: "120000",
        currency: "USD",
        asOf: "2026-10-31",
      },
    });
    // No scope is asked for: Evidence keeps it organisation_private, and
    // refuses anything broader. Never VERIFIED.
    expect(created).not.toHaveProperty("visibilityScope");
    expect(calls.find((c) => c.method === "source")?.input).toMatchObject({
      sourceType: "CONVERSATION",
    });
    expect(calls.find((c) => c.method === "item")?.input).toMatchObject({
      summary: "we hit $120k MRR in October",
      evidenceStatus: "SELF_REPORTED",
    });
    expect(
      calls.filter((c) => c.method === "link").map((c) => c.input),
    ).toEqual([expect.objectContaining({ relationship: "SUPPORTS" })]);
  });

  it("a different value already recorded for that date stays beside it, linked as a contradiction, never revised", async () => {
    const earlier = claim({
      structuredValue: {
        kind: "MONEY",
        amount: "110000",
        currency: "USD",
        asOf: "2026-10-31",
      },
      validFrom: "2026-10-31T00:00:00.000Z",
    });
    const { evidence, calls } = fake([earlier]);
    const out = await record(evidence);
    expect(out).toMatchObject({ outcome: "RECORDED", conflicts: 1 });
    expect(calls.filter((c) => c.method === "claim")).toHaveLength(1);
    expect(
      calls.filter((c) => c.method === "link").map((c) => c.input),
    ).toEqual([
      expect.objectContaining({ relationship: "SUPPORTS" }),
      expect.objectContaining({
        claimId: earlier.id,
        relationship: "CONTRADICTS",
      }),
    ]);
    // There is no revise or supersede on this path at all.
    expect(Object.keys(evidence)).not.toContain("reviseClaim");
  });

  it("another month of the same metric is history, not a contradiction", async () => {
    const september = claim({
      structuredValue: {
        kind: "MONEY",
        amount: "98000",
        currency: "USD",
        asOf: "2026-09-30",
      },
    });
    const { evidence, calls } = fake([september]);
    const out = await record(evidence);
    expect(out.conflicts).toBe(0);
    expect(calls.filter((c) => c.method === "link")).toHaveLength(1);
  });

  it("the same value for the same date is recorded once", async () => {
    const same = claim({
      structuredValue: {
        kind: "MONEY",
        amount: 120000,
        currency: "USD",
        asOf: "2026-10-31",
      },
    });
    const { evidence, calls } = fake([same]);
    const out = await record(evidence);
    expect(out).toEqual({
      outcome: "ALREADY_RECORDED",
      claimId: same.id,
      conflicts: 0,
    });
    expect(calls).toEqual([]);
  });

  it("a withdrawn or superseded reading is not today's and does not block a new one", async () => {
    const superseded = claim({
      lifecycleStatus: "SUPERSEDED",
      structuredValue: {
        kind: "MONEY",
        amount: "120000",
        currency: "USD",
        asOf: "2026-10-31",
      },
    });
    const { evidence } = fake([superseded]);
    expect((await record(evidence)).outcome).toBe("RECORDED");
  });

  it("the value's kind must fit the metric: customers are a count, never money", () => {
    expect(
      StatedFigureSchema.safeParse({
        metric: "CUSTOMERS",
        value: { kind: "MONEY", amount: "42", currency: "USD" },
        asOf: null,
        said: "42 customers",
      }).success,
    ).toBe(false);
  });

  it("says the figure plainly, with its month", () => {
    expect(statedFigureWords(october)).toBe(
      "MRR of USD 120,000 for October 2026",
    );
  });
});

describe("their own words, compared, never read", () => {
  const theirs = [
    "Quick update: we hit $120k MRR in October!",
    "Ya tenemos 42 clientes de pago.",
  ];
  it("a quote from their message, in any language, is theirs", () => {
    expect(saidByThem("we hit $120k MRR in October", theirs)).toBe(true);
    expect(saidByThem("ya tenemos 42 clientes  de pago", theirs)).toBe(true);
  });
  it("a paraphrase, a translation or a figure they never gave is not", () => {
    expect(saidByThem("MRR reached $120,000 in October", theirs)).toBe(false);
    expect(saidByThem("we have 42 paying customers", theirs)).toBe(false);
    expect(saidByThem("we hit $150k MRR in October", theirs)).toBe(false);
    expect(saidByThem("anything", [])).toBe(false);
  });
});
