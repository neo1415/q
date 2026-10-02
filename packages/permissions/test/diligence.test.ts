import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type {
  DiligenceRequestRecord,
  DiligenceRequestRepository,
  RelationshipPartyView,
} from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import {
  createDiligenceService,
  type DiligenceDocument,
  type DisclosurePolicy,
} from "../src/index.js";

/**
 * Diligence (2026-10-02): the founder shares, the investor requests; a share
 * is a relationship_shared disclosure policy for THIS relationship, so one
 * investor never sees another's shares; revoking removes access at once.
 */

const R1 = "00000000-0000-4000-8000-000000000301";
const R2 = "00000000-0000-4000-8000-000000000302";
const COMPANY = "00000000-0000-4000-8000-0000000003c1";
const OTHER_COMPANY = "00000000-0000-4000-8000-0000000003c2";
const DOC = "00000000-0000-4000-8000-0000000003d1";
const FOREIGN_DOC = "00000000-0000-4000-8000-0000000003d2";

const actor = (userId: string): ActorContext => ({
  userId: userId as ActorContext["userId"],
  tenantId: "00000000-0000-4000-8000-0000000000f1" as ActorContext["tenantId"],
  actorType: "HUMAN",
});
const founder = actor("00000000-0000-4000-8000-0000000003a1");
const investorOne = actor("00000000-0000-4000-8000-0000000003b1");
const investorTwo = actor("00000000-0000-4000-8000-0000000003b2");

function world(options: { readonly diligence?: boolean } = {}) {
  const inDiligence = options.diligence ?? true;
  // investorOne is a party to R1 only; investorTwo to R2 only; the founder to both.
  const sideOf = (who: ActorContext, relationshipId: string) =>
    who.userId === founder.userId
      ? "COMPANY"
      : who.userId === investorOne.userId && relationshipId === R1
        ? "INVESTOR"
        : who.userId === investorTwo.userId && relationshipId === R2
          ? "INVESTOR"
          : null;
  const view = (side: "INVESTOR" | "COMPANY", relationshipId: string) =>
    ({
      side,
      counterpart: { kind: "COMPANY", id: COMPANY },
      status: {
        relationship: {
          id: relationshipId,
          tenantId: "00000000-0000-4000-8000-0000000000f2",
          companyId: COMPANY,
        },
        projection: {
          state: inDiligence ? "IN_DILIGENCE" : "CONNECTED",
          milestones: inDiligence ? [{ state: "IN_DILIGENCE" }] : [],
        },
      },
    }) as unknown as RelationshipPartyView;

  let policies: DisclosurePolicy[] = [];
  const events: { eventType: string; payload: unknown }[] = [];
  const requestRows: DiligenceRequestRecord[] = [];
  const audits: unknown[] = [];
  const documents: Record<string, DiligenceDocument> = {
    [DOC]: {
      id: DOC,
      tenantId: "00000000-0000-4000-8000-0000000000f2",
      companyId: COMPANY,
      title: "Management accounts",
      documentType: "FINANCIAL",
      currentVersionId: "00000000-0000-4000-8000-0000000003e1",
    },
    [FOREIGN_DOC]: {
      id: FOREIGN_DOC,
      tenantId: "00000000-0000-4000-8000-0000000000f3",
      companyId: OTHER_COMPANY,
      title: "Someone else's deck",
      documentType: "PITCH_DECK",
      currentVersionId: "00000000-0000-4000-8000-0000000003e2",
    },
  };
  const tx = { sql: {} } as unknown as TransactionContext;
  const transactions: TransactionManager = { run: (work) => work(tx) };
  const requests = {
    insert: (
      _tx: unknown,
      input: {
        relationshipId: string;
        title: string;
        note: string | null;
        userId: string;
      },
    ) => {
      const id = `00000000-0000-4000-8000-00000000040${String(requestRows.length)}`;
      requestRows.push({
        id,
        relationshipId: input.relationshipId,
        requestedByUserId: input.userId,
        title: input.title,
        note: input.note,
        createdAt: new Date().toISOString(),
        fulfilment: null,
      });
      return Promise.resolve({ id, created: true });
    },
    listForRelationship: (_sql: unknown, relationshipId: string) =>
      Promise.resolve(
        requestRows.filter((r) => r.relationshipId === relationshipId),
      ),
    find: (_sql: unknown, id: string) =>
      Promise.resolve(requestRows.find((r) => r.id === id) ?? null),
    fulfil: (
      _tx: unknown,
      input: {
        requestId: string;
        documentId: string;
        disclosurePolicyId: string;
      },
    ) => {
      const index = requestRows.findIndex((r) => r.id === input.requestId);
      const row = requestRows[index];
      if (row === undefined || row.fulfilment !== null)
        return Promise.resolve(false);
      requestRows[index] = {
        ...row,
        fulfilment: {
          documentId: input.documentId,
          disclosurePolicyId: input.disclosurePolicyId,
          at: new Date().toISOString(),
        },
      };
      return Promise.resolve(true);
    },
  } as unknown as DiligenceRequestRepository;

  const service = createDiligenceService({
    sql: {} as DatabaseExecutor,
    transactions,
    relationships: {
      relationshipById: ({ actor: who, relationshipId }) => {
        const side = sideOf(who, relationshipId);
        return Promise.resolve(
          side === null ? null : view(side, relationshipId),
        );
      },
    },
    policies: {
      grant: (command) => {
        const policy = {
          id: `00000000-0000-4000-8000-00000000050${String(policies.length)}`,
          resource: command.resource,
          scopeType: command.scopeType,
          recipient: command.recipient ?? null,
          createdAt: new Date().toISOString(),
        } as unknown as DisclosurePolicy;
        policies.push(policy);
        return Promise.resolve({ outcome: "CREATED", policy });
      },
      revoke: (command) => {
        const policy = policies.find(
          (p) => p.id === command.disclosurePolicyId,
        );
        policies = policies.filter((p) => p.id !== command.disclosurePolicyId);
        return Promise.resolve({
          outcome: "REVOKED",
          policy: policy as DisclosurePolicy,
        });
      },
    },
    policyRepository: {
      findUnrevokedForRecipient: (_sql, query) =>
        Promise.resolve(
          policies.filter(
            (p) =>
              p.resource.type === query.resourceType &&
              p.recipient?.id === query.recipient.id,
          ),
        ),
    },
    // The disclosure layer: allowed only through a policy for a relationship
    // the asker is a party to.
    access: {
      canDisclose: (request) => {
        const who =
          request.principal.kind === "ACTOR"
            ? request.principal.actor
            : investorTwo;
        const allowed = policies.some(
          (p) =>
            p.resource.id === request.resource.id &&
            p.recipient !== null &&
            sideOf(who, p.recipient.id) !== null,
        );
        return Promise.resolve(
          (allowed ? { outcome: "ALLOW" } : { outcome: "DENY" }) as never,
        );
      },
    },
    documents: {
      ownDocument: (who, id) =>
        Promise.resolve(
          who.userId === founder.userId ? (documents[id] ?? null) : null,
        ),
      canonical: (id) => Promise.resolve(documents[id] ?? null),
      signedDownload: (document) =>
        Promise.resolve({
          url: `https://storage.example/${document.id}?sig=short`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
    },
    requests,
    appender: {
      append: (_tx, input) => {
        events.push({ eventType: input.eventType, payload: input.payload });
        return Promise.resolve({} as never);
      },
    },
    audit: {
      record: (_tx, input) => {
        audits.push(input);
        return Promise.resolve("a" as never);
      },
    },
    newCorrelationId: (): CorrelationId => "cor_test00000",
  });
  return { service, events, audits, policies: () => policies };
}

describe("diligence: who does what", () => {
  it("only the founder shares; only the investor requests", async () => {
    const w = world();
    expect(
      await w.service.share({
        actor: investorOne,
        relationshipId: R1,
        documentId: DOC,
      }),
    ).toEqual({ outcome: "REFUSED", code: "COMPANY_ONLY" });
    expect(
      await w.service.request({
        actor: founder,
        relationshipId: R1,
        title: "Cap table",
        idempotencyKey: "diligence-key-1",
      }),
    ).toEqual({ outcome: "REFUSED", code: "INVESTOR_ONLY" });
    expect(w.events).toEqual([]);
  });

  it("nothing opens before diligence starts", async () => {
    const w = world({ diligence: false });
    expect(
      await w.service.share({
        actor: founder,
        relationshipId: R1,
        documentId: DOC,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_OPEN" });
    expect(
      await w.service.request({
        actor: investorOne,
        relationshipId: R1,
        title: "Cap table",
        idempotencyKey: "diligence-key-2",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_OPEN" });
  });

  it("a share is a relationship_shared policy for this relationship; a document of another company is refused", async () => {
    const w = world();
    const shared = await w.service.share({
      actor: founder,
      relationshipId: R1,
      documentId: DOC,
    });
    expect(shared.outcome).toBe("OK");
    expect(w.policies()).toMatchObject([
      {
        resource: { type: "document", id: DOC },
        scopeType: "relationship_shared",
        recipient: { type: "RELATIONSHIP", id: R1 },
      },
    ]);
    expect(w.events.map((e) => e.eventType)).toEqual(["document_shared"]);
    expect(
      await w.service.share({
        actor: founder,
        relationshipId: R1,
        documentId: FOREIGN_DOC,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_SHAREABLE" });
  });
});

describe("diligence: access", () => {
  it("one investor never sees another relationship's shares, nor downloads them", async () => {
    const w = world();
    await w.service.share({
      actor: founder,
      relationshipId: R1,
      documentId: DOC,
    });
    const mine = await w.service.view({
      actor: investorOne,
      relationshipId: R1,
    });
    expect(mine?.shares.map((s) => s.title)).toEqual(["Management accounts"]);
    // investorTwo is not a party to R1 at all, and R2 holds no share.
    expect(
      await w.service.view({ actor: investorTwo, relationshipId: R1 }),
    ).toBeNull();
    expect(
      (await w.service.view({ actor: investorTwo, relationshipId: R2 }))
        ?.shares,
    ).toEqual([]);
    expect(
      await w.service.download({
        actor: investorTwo,
        relationshipId: R2,
        documentId: DOC,
      }),
    ).toBeNull();
    expect(
      await w.service.download({
        actor: investorOne,
        relationshipId: R1,
        documentId: DOC,
      }),
    ).toMatchObject({
      url: "https://storage.example/" + DOC + "?sig=short",
    });
  });

  it("revoking removes access at once, and only this relationship's share is revocable here", async () => {
    const w = world();
    const shared = await w.service.share({
      actor: founder,
      relationshipId: R1,
      documentId: DOC,
    });
    const policyId = shared.outcome === "OK" ? shared.value.policyId : "";
    expect(
      await w.service.revoke({ actor: founder, relationshipId: R2, policyId }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(
      await w.service.revoke({
        actor: investorOne,
        relationshipId: R1,
        policyId,
      }),
    ).toEqual({ outcome: "REFUSED", code: "COMPANY_ONLY" });
    expect(
      await w.service.revoke({ actor: founder, relationshipId: R1, policyId }),
    ).toEqual({ outcome: "OK", value: { revoked: true } });
    expect(
      await w.service.download({
        actor: investorOne,
        relationshipId: R1,
        documentId: DOC,
      }),
    ).toBeNull();
    expect(
      (await w.service.view({ actor: investorOne, relationshipId: R1 }))
        ?.shares,
    ).toEqual([]);
  });
});

describe("diligence: requests", () => {
  it("the investor asks; the founder answers with a share; both see it fulfilled", async () => {
    const w = world();
    const asked = await w.service.request({
      actor: investorOne,
      relationshipId: R1,
      title: "Last 12 months of management accounts",
      note: "Monthly, please",
      idempotencyKey: "diligence-key-3",
    });
    const requestId = asked.outcome === "OK" ? asked.value.requestId : "";
    expect(w.events.map((e) => e.eventType)).toEqual(["document_requested"]);
    expect(w.audits).toHaveLength(1);
    const founderView = await w.service.view({
      actor: founder,
      relationshipId: R1,
    });
    expect(founderView?.requests).toMatchObject([
      { title: "Last 12 months of management accounts", status: "OPEN" },
    ]);
    await w.service.share({
      actor: founder,
      relationshipId: R1,
      documentId: DOC,
      requestId,
    });
    expect(w.events.at(-1)).toMatchObject({
      eventType: "document_shared",
      payload: { documentId: DOC, requestId },
    });
    for (const who of [founder, investorOne]) {
      const view = await w.service.view({ actor: who, relationshipId: R1 });
      expect(view?.requests).toMatchObject([
        { status: "FULFILLED", fulfilledBy: { title: "Management accounts" } },
      ]);
    }
  });
});
