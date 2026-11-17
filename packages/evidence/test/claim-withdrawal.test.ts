import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  ClaimNotFoundError,
  ClaimRevisionConflictError,
  createPostgresClaimQueryPort,
  withdrawableFigureClaims,
  withdrawClaim,
  type Claim,
  type ClaimRevision,
  type ClaimWithdrawalEvidence,
  type EvidenceService,
} from "../src/index.js";

/**
 * A founder withdraws one of their company's claims (hygiene audit
 * 2026-11-16 §4.2). The withdrawal goes through the Evidence services
 * only; this in-memory service keeps the revision history the real one
 * keeps, so the rules are asserted on it: a new SUPERSEDED revision with
 * the reason, the earlier revision untouched, nothing written twice, and
 * another tenant's claim is not found.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const stranger = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000009",
  tenantId: "c0000000-0000-4000-8000-000000000009",
  organisationId: "d0000000-0000-4000-8000-000000000009",
  membershipId: "e0000000-0000-4000-8000-000000000009",
  actorType: "HUMAN",
});
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const correlationId = `cor_${randomUUID()}` as const;

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: randomUUID(),
    tenantId: actor.tenantId,
    subjectType: "COMPANY",
    subjectId: COMPANY,
    claimType: "financial",
    claimKey: "financial.mrr",
    statement:
      'The company\'s MRR of USD 42,000 for October 2026, as stated in its own document "deck QA 14 Nov b" and confirmed by the founder.',
    structuredValue: {
      kind: "MONEY",
      amount: "42000",
      currency: "USD",
      asOf: "2026-10-31",
    },
    assertedByType: "USER",
    assertedById: actor.userId,
    assertedAt: "2026-11-14T00:00:00.000Z",
    validFrom: "2026-10-31T00:00:00.000Z",
    validTo: null,
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    lifecycleStatus: "CURRENT",
    visibilityScope: "organisation_private",
    sensitivityClass: "CONFIDENTIAL",
    currentRevisionId: randomUUID(),
    currentRevisionNumber: 1,
    createdAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  } as Claim;
}

function revisionOf(current: Claim, changeReason: string | null) {
  return {
    id: current.currentRevisionId,
    tenantId: current.tenantId,
    claimId: current.id,
    revisionNumber: current.currentRevisionNumber,
    statement: current.statement,
    structuredValue: current.structuredValue,
    truthClass: current.truthClass,
    evidenceStatus: current.evidenceStatus,
    lifecycleStatus: current.lifecycleStatus,
    validFrom: current.validFrom,
    validTo: current.validTo,
    changeReason,
    changedByType: "USER",
    changedById: actor.userId,
    sourceId: null,
    createdAt: "2026-11-14T00:00:00.000Z",
  } as ClaimRevision;
}

/** The real service's rules, in memory: tenant-scoped, revisioned, guarded. */
function service(
  seed: readonly Claim[],
  options: { readonly conflictsFirst?: number } = {},
) {
  const claims = new Map(seed.map((c) => [c.id as string, c]));
  const history = new Map(
    seed.map((c) => [c.id as string, [revisionOf(c, null)]]),
  );
  let conflicts = options.conflictsFirst ?? 0;
  const writes: string[] = [];
  const visible = (who: ActorContext, id: string) => {
    const found = claims.get(id);
    if (found === undefined || found.tenantId !== who.tenantId) {
      throw new ClaimNotFoundError();
    }
    return found;
  };
  const evidence: ClaimWithdrawalEvidence &
    Pick<EvidenceService, "listClaims"> = {
    getClaim: (query) =>
      Promise.resolve().then(() => ({
        claim: visible(query.actor, query.claimId),
        revisions: history.get(query.claimId) ?? [],
        evidence: [],
      })),
    reviseClaim: (command) =>
      Promise.resolve().then(() => {
        const current = visible(command.actor, command.input.claimId);
        if (conflicts > 0) {
          conflicts -= 1;
          throw new ClaimRevisionConflictError();
        }
        if (
          current.currentRevisionNumber !== command.input.expectedRevisionNumber
        ) {
          throw new ClaimRevisionConflictError();
        }
        const next: Claim = {
          ...current,
          lifecycleStatus:
            command.input.lifecycleStatus ?? current.lifecycleStatus,
          currentRevisionId: randomUUID() as Claim["currentRevisionId"],
          currentRevisionNumber: current.currentRevisionNumber + 1,
        };
        claims.set(next.id, next);
        history
          .get(next.id)
          ?.push(revisionOf(next, command.input.changeReason));
        writes.push(next.id);
        return next;
      }),
    listClaims: (query) =>
      Promise.resolve(
        [...claims.values()].filter(
          (c) =>
            c.tenantId === query.actor.tenantId &&
            c.subjectId === query.subject.subjectId &&
            (query.claimKey === undefined || c.claimKey === query.claimKey),
        ),
      ),
  };
  return { evidence, claims, history, writes };
}

describe("withdrawing a company claim", () => {
  it("writes a new SUPERSEDED revision with the reason and keeps the earlier one", async () => {
    const target = claim();
    const { evidence, history } = service([target]);
    const out = await withdrawClaim(evidence, {
      actor,
      claimId: target.id,
      reason: "Only evidence was an archived QA deck.",
      correlationId,
    });
    expect(out).toMatchObject({
      outcome: "WITHDRAWN",
      claimId: target.id,
      lifecycleStatus: "SUPERSEDED",
      revisionNumber: 2,
    });
    const revisions = history.get(target.id) ?? [];
    expect(revisions.map((r) => [r.revisionNumber, r.lifecycleStatus])).toEqual(
      [
        [1, "CURRENT"],
        [2, "SUPERSEDED"],
      ],
    );
    expect(revisions[0]?.statement).toBe(target.statement);
    expect(revisions[1]?.changeReason).toBe(
      "Withdrawn by the company: Only evidence was an archived QA deck.",
    );
  });

  it("is safe to repeat: a withdrawn claim answers ALREADY_WITHDRAWN and writes nothing", async () => {
    const target = claim();
    const { evidence, writes, history } = service([target]);
    const command = {
      actor,
      claimId: target.id,
      reason: "Wrong figure.",
      correlationId,
    };
    await withdrawClaim(evidence, command);
    const again = await withdrawClaim(evidence, command);
    expect(again.outcome).toBe("ALREADY_WITHDRAWN");
    expect(writes).toHaveLength(1);
    expect(history.get(target.id)).toHaveLength(2);
  });

  it("re-reads once when another revision landed between the read and the write", async () => {
    const target = claim();
    const { evidence, writes } = service([target], { conflictsFirst: 1 });
    const out = await withdrawClaim(evidence, {
      actor,
      claimId: target.id,
      reason: "Wrong figure.",
      correlationId,
    });
    expect(out.outcome).toBe("WITHDRAWN");
    expect(writes).toHaveLength(1);
  });

  it("another tenant's actor gets not-found and nothing is written", async () => {
    const target = claim();
    const { evidence, writes, claims } = service([target]);
    await expect(
      withdrawClaim(evidence, {
        actor: stranger,
        claimId: target.id,
        reason: "Not mine.",
        correlationId,
      }),
    ).rejects.toBeInstanceOf(ClaimNotFoundError);
    expect(writes).toEqual([]);
    expect(claims.get(target.id)?.lifecycleStatus).toBe("CURRENT");
  });

  it("refuses an empty reason before reading anything", async () => {
    const target = claim();
    const { evidence, writes } = service([target]);
    await expect(
      withdrawClaim(evidence, {
        actor,
        claimId: target.id,
        reason: "   ",
        correlationId,
      }),
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});

describe("finding the figure Q is asked to withdraw", () => {
  it("names only live claims for that metric, date and value", async () => {
    const october = claim();
    const september = claim({
      structuredValue: {
        kind: "MONEY",
        amount: "37500",
        currency: "USD",
        asOf: "2026-09-30",
      },
    });
    const gone = claim({ lifecycleStatus: "SUPERSEDED" });
    const { evidence } = service([october, september, gone]);
    const found = await withdrawableFigureClaims(evidence, actor, COMPANY, {
      metric: "MRR",
      asOf: "2026-10-31",
      amount: 42000,
    });
    expect(found.map((c) => c.id)).toEqual([october.id]);
    const none = await withdrawableFigureClaims(evidence, actor, COMPANY, {
      metric: "MRR",
      asOf: "2026-10-31",
      amount: 120000,
    });
    expect(none).toEqual([]);
  });
});

describe("investor-facing reads after a withdrawal", () => {
  it("listCurrentClaims (Q Card, read_company_figures, company sections) omits a withdrawn claim", async () => {
    const row = (c: Claim) => ({
      id: c.id,
      tenant_id: c.tenantId,
      subject_type: c.subjectType,
      subject_id: c.subjectId,
      claim_type: c.claimType,
      claim_key: c.claimKey,
      statement: c.statement,
      structured_value: c.structuredValue,
      asserted_by_type: c.assertedByType,
      asserted_by_id: c.assertedById,
      asserted_at: new Date(c.assertedAt),
      valid_from: c.validFrom === null ? null : new Date(c.validFrom),
      valid_to: null,
      truth_class: c.truthClass,
      evidence_status: c.evidenceStatus,
      lifecycle_status: c.lifecycleStatus,
      visibility_scope: "network_visible",
      sensitivity_class: c.sensitivityClass,
      current_revision_id: c.currentRevisionId,
      current_revision_number: c.currentRevisionNumber,
      created_at: new Date(c.createdAt),
    });
    const live = claim();
    const withdrawn = claim({
      lifecycleStatus: "SUPERSEDED",
      currentRevisionNumber: 2,
    });
    // The repository's two statements (the select fragment, then the
    // query) both answer the stored rows; the port filters.
    const sql = (() =>
      Promise.resolve([
        row(live),
        row(withdrawn),
      ])) as unknown as DatabaseExecutor;
    const port = createPostgresClaimQueryPort({ sql });
    const current = await port.listCurrentClaims(
      actor.tenantId,
      { subjectType: "COMPANY", subjectId: COMPANY },
      {},
    );
    expect(current.map((c) => c.id)).toEqual([live.id]);
  });
});
