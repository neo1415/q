import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type {
  DiligenceQuestionRecord,
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

const NEW_DOC = "00000000-0000-4000-8000-0000000003d3";
const DOC_VERSION = "00000000-0000-4000-8000-0000000003e1";

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
  const questionRows: DiligenceQuestionRecord[] = [];
  const audits: unknown[] = [];
  const notices: { title: string; priority: string; actingSide: string }[] = [];
  const viewRows: { relationshipId: string; documentId: string }[] = [];
  const summaryRows = new Map<string, string>();
  const completed: string[] = [];
  const documents: Record<string, DiligenceDocument> = {
    [DOC]: {
      id: DOC,
      tenantId: "00000000-0000-4000-8000-0000000000f2",
      companyId: COMPANY,
      title: "Management accounts",
      documentType: "FINANCIAL",
      currentVersionId: "00000000-0000-4000-8000-0000000003e1",
      // ADR 0042: processed with no scanner yet.
      scanned: false,
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
        requestedByName: "Amara Diallo-Benson",
        title: input.title,
        note: input.note,
        createdAt: new Date().toISOString(),
        fulfilment: null,
        decline: null,
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
    recordView: (
      _sql: unknown,
      input: { relationshipId: string; documentId: string },
    ) => {
      if (
        !viewRows.some(
          (v) =>
            v.relationshipId === input.relationshipId &&
            v.documentId === input.documentId,
        )
      ) {
        viewRows.push(input);
      }
      return Promise.resolve();
    },
    viewsFor: (_sql: unknown, relationshipId: string) =>
      Promise.resolve(
        new Map(
          viewRows
            .filter((v) => v.relationshipId === relationshipId)
            .map((v) => [v.documentId, "2026-10-04T09:00:00.000Z"]),
        ),
      ),
    summariesFor: (_sql: unknown, versions: readonly string[]) =>
      Promise.resolve(
        new Map(
          versions.flatMap((v) => {
            const text = summaryRows.get(v);
            return text === undefined ? [] : [[v, text] as const];
          }),
        ),
      ),
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
      // The documents screen's own completion: a new document of theirs.
      completeUpload: (command) => {
        completed.push(command.uploadSessionId);
        documents[NEW_DOC] = {
          id: NEW_DOC,
          tenantId: "00000000-0000-4000-8000-0000000000f2",
          companyId: COMPANY,
          title: "Pitch deck v3",
          documentType: "PITCH_DECK",
          currentVersionId: "00000000-0000-4000-8000-0000000003e3",
        };
        return Promise.resolve({ documentId: NEW_DOC });
      },
      signedDownload: (document) =>
        Promise.resolve({
          url: `https://storage.example/${document.id}?sig=short`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          scanned: document.scanned !== false,
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
    notify: (input) => {
      notices.push({
        title: input.title,
        priority: input.priority,
        actingSide: input.actingSide,
      });
      return Promise.resolve(1);
    },
    questions: {
      listForRelationship: (_sql, relationshipId) =>
        Promise.resolve(
          questionRows.filter((q) => q.relationshipId === relationshipId),
        ),
    },
    newCorrelationId: (): CorrelationId => "cor_test00000",
  });
  return {
    service,
    questionRows,
    events,
    audits,
    notices,
    completed,
    summaryRows,
    policies: () => policies,
  };
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
    // ADR 0042: an unscanned share says so, to its own investor.
    expect(mine?.shares[0]?.scanned).toBe(false);
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
      scanned: false,
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

describe("diligence: upload and share in one step (2026-10-04)", () => {
  const ask = async (w: ReturnType<typeof world>) => {
    const asked = await w.service.request({
      actor: investorOne,
      relationshipId: R1,
      title: "Pitch deck",
      idempotencyKey: "diligence-key-up1",
    });
    return asked.outcome === "OK" ? asked.value.requestId : "";
  };

  it("finishes the founder's upload and answers the request with it; the investor is told who shared what", async () => {
    const w = world();
    const requestId = await ask(w);
    const out = await w.service.uploadAndFulfil({
      actor: founder,
      relationshipId: R1,
      requestId,
      uploadSessionId: "00000000-0000-4000-8000-0000000003f1",
      idempotencyKey: "diligence-upload-0001",
    });
    expect(out.outcome).toBe("OK");
    expect(w.completed).toEqual(["00000000-0000-4000-8000-0000000003f1"]);
    expect(w.events.at(-1)).toMatchObject({
      eventType: "document_shared",
      payload: { documentId: NEW_DOC, requestId },
    });
    expect(w.notices.at(-1)).toEqual({
      title: "{actor} shared Pitch deck v3 for your request",
      priority: "NEEDS_YOU",
      actingSide: "COMPANY",
    });
    const seen = await w.service.view({
      actor: investorOne,
      relationshipId: R1,
    });
    expect(seen?.requests).toMatchObject([
      {
        status: "FULFILLED",
        requestedByName: "Amara Diallo-Benson",
        fulfilledBy: { documentId: NEW_DOC, title: "Pitch deck v3" },
      },
    ]);
  });

  it("checks the side, the state and the request before finishing any upload", async () => {
    const w = world();
    const requestId = await ask(w);
    const base = {
      requestId,
      uploadSessionId: "00000000-0000-4000-8000-0000000003f2",
      idempotencyKey: "diligence-upload-0002",
    };
    expect(
      await w.service.uploadAndFulfil({
        ...base,
        actor: investorOne,
        relationshipId: R1,
      }),
    ).toEqual({ outcome: "REFUSED", code: "COMPANY_ONLY" });
    expect(
      await w.service.uploadAndFulfil({
        ...base,
        actor: founder,
        relationshipId: R2,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(
      await world({ diligence: false }).service.uploadAndFulfil({
        ...base,
        actor: founder,
        relationshipId: R1,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_OPEN" });
    expect(w.completed).toEqual([]);
    expect(w.policies()).toEqual([]);
  });

  it("the investor's open is 'Viewed'; the founder's own open is not; Q's summary rides only with a share", async () => {
    const w = world();
    w.summaryRows.set(
      DOC_VERSION,
      "Monthly accounts · Jan–Sep 2026 · revenue self-reported",
    );
    expect(
      (await w.service.view({ actor: investorOne, relationshipId: R1 }))
        ?.shares,
    ).toEqual([]);
    await w.service.share({
      actor: founder,
      relationshipId: R1,
      documentId: DOC,
    });
    await w.service.download({
      actor: founder,
      relationshipId: R1,
      documentId: DOC,
    });
    let share = (
      await w.service.view({ actor: investorOne, relationshipId: R1 })
    )?.shares[0];
    expect(share?.viewedAt).toBeNull();
    expect(share?.qSummary).toBe(
      "Monthly accounts · Jan–Sep 2026 · revenue self-reported",
    );
    await w.service.download({
      actor: investorOne,
      relationshipId: R1,
      documentId: DOC,
    });
    share = (await w.service.view({ actor: founder, relationshipId: R1 }))
      ?.shares[0];
    expect(share?.viewedAt).toBe("2026-10-04T09:00:00.000Z");
    // Another relationship's investor never reads it, nor its summary.
    expect(
      (await w.service.view({ actor: investorTwo, relationshipId: R2 }))
        ?.shares,
    ).toEqual([]);
  });
});

describe("diligence: a request that carried questions (2026-10-08)", () => {
  const question = (
    id: string,
    sentRef: string,
    position: number,
    answer: string | null,
  ): DiligenceQuestionRecord => ({
    id,
    tenantId: "00000000-0000-4000-8000-000000000001",
    relationshipId: R1,
    companyId: "00000000-0000-4000-8000-0000000000c1",
    investorOrganisationId: "00000000-0000-4000-8000-0000000000e1",
    investorOrganisationName: null,
    askedByName: null,
    position,
    question: `Question ${String(position)}?`,
    assumptionId: position === 1 ? "TRACTION:1" : null,
    assumptionLabel: position === 1 ? "Paying customers" : null,
    sentRef,
    askedAt: "2026-10-05T10:00:00.000Z",
    answer:
      answer === null
        ? null
        : {
            id: `${id.slice(0, -2)}aa`,
            text: answer,
            documentIds: [],
            evidenceStatus: "SELF_REPORTED",
            answeredAt: "2026-10-06T10:00:00.000Z",
          },
  });

  it("carries its questions with the answers, so its state comes from them; a plain request carries none", async () => {
    const w = world();
    const asked = await w.service.request({
      actor: investorOne,
      relationshipId: R1,
      title: "Questions on traction",
      idempotencyKey: "diligence-key-q1",
    });
    const plain = await w.service.request({
      actor: investorOne,
      relationshipId: R1,
      title: "Cap table",
      idempotencyKey: "diligence-key-q2",
    });
    const vehicle = asked.outcome === "OK" ? asked.value.requestId : "";
    const other = plain.outcome === "OK" ? plain.value.requestId : "";
    w.questionRows.push(
      question("00000000-0000-4000-8000-0000000007b2", vehicle, 2, null),
      question("00000000-0000-4000-8000-0000000007b1", vehicle, 1, "131 paid."),
      // Asked in a chat message: never attached to a request.
      question(
        "00000000-0000-4000-8000-0000000007b3",
        "chat-message-1",
        1,
        null,
      ),
    );
    const view = await w.service.view({
      actor: investorOne,
      relationshipId: R1,
    });
    const carried = view?.requests.find((r) => r.requestId === vehicle);
    expect(carried?.status).toBe("OPEN");
    expect(carried?.questions).toEqual([
      {
        questionId: "00000000-0000-4000-8000-0000000007b1",
        question: "Question 1?",
        assumptionId: "TRACTION:1",
        assumptionLabel: "Paying customers",
        answer: {
          text: "131 paid.",
          answeredAt: "2026-10-06T10:00:00.000Z",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
      },
      {
        questionId: "00000000-0000-4000-8000-0000000007b2",
        question: "Question 2?",
        assumptionId: null,
        assumptionLabel: null,
        answer: null,
      },
    ]);
    expect(
      view?.requests.find((r) => r.requestId === other)?.questions,
    ).toBeNull();
  });
});
