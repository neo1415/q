import { describe, expect, it } from "vitest";

import type {
  CorrelationId,
  DataRoomLevel,
  UtcTimestamp,
} from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type {
  DiligenceQuestionRecord,
  DiligenceRequestRecord,
} from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import {
  createFounderRequestsService,
  inboxCounts,
  sortInbox,
  type DataRoomDocument,
  type DisclosurePolicy,
  type FounderRequestsNotice,
} from "../src/index.js";

/**
 * Founder documents (2026-10-08): the company's own team answers what
 * investors ask for; every share is an expiring relationship_shared
 * disclosure policy at the level the founder chose; an answer is the
 * founder's claim through the Write Gate; nobody else reads or answers
 * anything (cross-company and revoked-role negatives), and a revoked share
 * no longer counts.
 */

const COMPANY = "00000000-0000-4000-8000-0000000009c1";
const OTHER_COMPANY = "00000000-0000-4000-8000-0000000009c2";
const TENANT = "00000000-0000-4000-8000-0000000009f1";
const ORG = "00000000-0000-4000-8000-0000000009a0";
const OTHER_ORG = "00000000-0000-4000-8000-0000000009a9";
const INV_ORG = "00000000-0000-4000-8000-0000000009e1";
const R1 = "00000000-0000-4000-8000-000000000901";
const R_OTHER = "00000000-0000-4000-8000-000000000902";
/** An investor who expressed interest; the founder has not accepted it yet. */
const R_PENDING = "00000000-0000-4000-8000-000000000903";
const INV_ORG_PENDING = "00000000-0000-4000-8000-0000000009e3";
const NOW = "2026-10-08T09:00:00.000Z" as UtcTimestamp;
const COR = "cor_test" as CorrelationId;

const actor = (userId: string, organisationId: string): ActorContext =>
  ({
    userId,
    tenantId: TENANT,
    organisationId,
    actorType: "HUMAN",
  }) as unknown as ActorContext;
const founder = actor("00000000-0000-4000-8000-0000000009a1", ORG);
const teammateWithoutRole = actor("00000000-0000-4000-8000-0000000009a2", ORG);
const otherFounder = actor("00000000-0000-4000-8000-0000000009a3", OTHER_ORG);
const investor = actor(
  "00000000-0000-4000-8000-0000000009b1",
  "00000000-0000-4000-8000-0000000009d1",
);
const stranger = actor(
  "00000000-0000-4000-8000-0000000009b2",
  "00000000-0000-4000-8000-0000000009d2",
);

const doc = (
  n: number,
  title: string,
  options: Partial<DataRoomDocument> = {},
): DataRoomDocument => ({
  documentId: `00000000-0000-4000-8000-00000000091${String(n)}`,
  tenantId: TENANT,
  companyId: COMPANY,
  title,
  documentType: "OTHER",
  level: "PRIVATE",
  folderCode: "other",
  checklistItemCode: null,
  validUntil: null,
  pageCount: 2,
  mimeType: "application/pdf",
  currentVersionId: `00000000-0000-4000-8000-00000000092${String(n)}`,
  updatedAt: "2026-09-01T00:00:00.000Z",
  version: 0,
  ...options,
});

const UPLOAD = doc(1, "Management accounts");
const FILED = doc(2, "Cap table summary", {
  level: "ON_REQUEST",
  folderCode: "cap_table",
  version: 3,
});
const FOREIGN = doc(3, "Other company's file", { companyId: OTHER_COMPANY });

function world() {
  const documents = [UPLOAD, FILED, FOREIGN];
  const policies: DisclosurePolicy[] = [];
  const notices: FounderRequestsNotice[] = [];
  const audits: string[] = [];
  const events: string[] = [];
  const levels: { documentId: string; level: DataRoomLevel; folder: string }[] =
    [];
  const recorded: { about: string | null; answer: string }[] = [];
  const named: DiligenceRequestRecord[] = [
    {
      id: "00000000-0000-4000-8000-0000000009d7",
      relationshipId: R1,
      requestedByUserId: investor.userId,
      requestedByName: "Ada Nwosu",
      title: "Management accounts, last 12 months",
      note: "Before our IC on the 14th.",
      createdAt: "2026-10-05T10:00:00.000Z",
      fulfilment: null,
      decline: null,
    },
    {
      id: "00000000-0000-4000-8000-0000000009d8",
      relationshipId: R1,
      requestedByUserId: investor.userId,
      requestedByName: "Ada Nwosu",
      title: "Customer contracts",
      note: null,
      createdAt: "2026-10-03T10:00:00.000Z",
      fulfilment: null,
      decline: null,
    },
  ];
  const questions: DiligenceQuestionRecord[] = [];
  const tx = { sql: {} } as unknown as TransactionContext;
  const transactions: TransactionManager = { run: (work) => work(tx) };
  const relationships: Record<
    string,
    { companyId: string; tenantId: string; investorOrganisationId: string }
  > = {
    [R1]: {
      companyId: COMPANY,
      tenantId: TENANT,
      investorOrganisationId: INV_ORG,
    },
    [R_OTHER]: {
      companyId: OTHER_COMPANY,
      tenantId: TENANT,
      investorOrganisationId: INV_ORG,
    },
    [R_PENDING]: {
      companyId: COMPANY,
      tenantId: TENANT,
      investorOrganisationId: INV_ORG_PENDING,
    },
  };

  const service = createFounderRequestsService({
    sql: {} as DatabaseExecutor,
    transactions,
    store: {
      folders: () =>
        Promise.resolve([
          { code: "financials", label: "Financials" },
          { code: "cap_table", label: "Cap table and equity" },
          { code: "other", label: "Other documents" },
        ]),
      documentsOf: (_e, companyId) =>
        Promise.resolve(documents.filter((d) => d.companyId === companyId)),
      document: (_e, id) =>
        Promise.resolve(documents.find((d) => d.documentId === id) ?? null),
      requests: () => Promise.resolve([]),
      requestCompany: () => Promise.resolve(null),
      insertDecision: () => Promise.resolve(true),
    },
    dataRoom: {
      setLevel: (command) => {
        const index = documents.findIndex(
          (d) => d.documentId === command.documentId,
        );
        const current = documents[index];
        if (current === undefined)
          return Promise.resolve({ outcome: "REFUSED", code: "NOT_FOUND" });
        documents[index] = {
          ...current,
          level: command.level,
          folderCode: command.folderCode ?? current.folderCode,
          version: current.version + 1,
        };
        levels.push({
          documentId: command.documentId,
          level: command.level,
          folder: command.folderCode ?? current.folderCode,
        });
        return Promise.resolve({
          outcome: "OK",
          value: {
            documentId: command.documentId,
            level: command.level,
            version: current.version + 1,
          },
        });
      },
      decide: () =>
        Promise.resolve({ outcome: "REFUSED", code: "NOT_FOUND" } as const),
    },
    diligenceRequests: {
      listForCompany: () => Promise.resolve(named),
      find: (_e, id) => Promise.resolve(named.find((r) => r.id === id) ?? null),
      fulfil: (_tx, input) => {
        const index = named.findIndex((r) => r.id === input.requestId);
        const request = named[index];
        if (request === undefined || request.fulfilment !== null)
          return Promise.resolve(false);
        named[index] = {
          ...request,
          fulfilment: {
            documentId: input.documentId,
            disclosurePolicyId: input.disclosurePolicyId,
            at: NOW,
          },
        };
        return Promise.resolve(true);
      },
      decline: (_tx, input) => {
        const index = named.findIndex((r) => r.id === input.requestId);
        const request = named[index];
        if (request === undefined || request.decline !== null)
          return Promise.resolve(false);
        named[index] = { ...request, decline: { note: input.note, at: NOW } };
        return Promise.resolve(true);
      },
    },
    questions: {
      insertMany: (_tx, input) => {
        const existing = questions.filter((q) => q.sentRef === input.sentRef);
        if (existing.length > 0)
          return Promise.resolve({
            ids: existing.map((q) => q.id),
            created: false,
          });
        const ids = input.questions.map((question, index) => {
          const id = `00000000-0000-4000-8000-0000000009${String(50 + questions.length)}`;
          questions.push({
            id,
            tenantId: input.tenantId,
            relationshipId: input.relationshipId,
            companyId: input.companyId,
            investorOrganisationId: INV_ORG,
            investorOrganisationName: "Zino Capital",
            askedByName: "Ada Nwosu",
            position: index + 1,
            question: question.question,
            assumptionId: question.assumptionId,
            assumptionLabel: question.assumptionLabel,
            sentRef: input.sentRef,
            askedAt: NOW,
            answer: null,
          });
          return id;
        });
        return Promise.resolve({ ids, created: true });
      },
      find: (_e, id) =>
        Promise.resolve(questions.find((q) => q.id === id) ?? null),
      listForCompany: (_e, companyId) =>
        Promise.resolve(questions.filter((q) => q.companyId === companyId)),
      listForRelationship: (_e, relationshipId) =>
        Promise.resolve(
          questions.filter((q) => q.relationshipId === relationshipId),
        ),
      insertAnswer: (_tx, input) => {
        const index = questions.findIndex((q) => q.id === input.questionId);
        const question = questions[index];
        if (question === undefined) throw new Error("no question");
        const id = `00000000-0000-4000-8000-0000000009${String(80 + index)}`;
        questions[index] = {
          ...question,
          answer: {
            id,
            text: input.answer,
            documentIds: input.documentIds,
            evidenceStatus:
              input.documentIds.length > 0
                ? "DOCUMENT_SUPPORTED"
                : "SELF_REPORTED",
            answeredAt: NOW,
          },
        };
        return Promise.resolve({ id, created: true });
      },
    },
    company: (id) =>
      Promise.resolve(
        id === COMPANY || id === OTHER_COMPANY
          ? {
              id,
              tenantId: TENANT,
              organisationId: id === COMPANY ? ORG : OTHER_ORG,
              name: id === COMPANY ? "Ledgerline" : "Elsewhere",
              stageCode: "seed",
              countryCode: "NG",
            }
          : null,
      ),
    // A member whose role lost disclosure.manage manages nothing.
    ownerMayManage: (who) => Promise.resolve(who !== teammateWithoutRole),
    relationship: (id) => Promise.resolve(relationships[id] ?? null),
    relationshipsOf: (companyId) =>
      Promise.resolve(
        companyId === COMPANY
          ? [
              {
                relationshipId: R1,
                investorOrganisationName: "Zino Capital",
                connection: "CONNECTED" as const,
              },
              {
                relationshipId: R_PENDING,
                investorOrganisationName: "Pending Partners",
                connection: "INTEREST_PENDING" as const,
              },
            ]
          : [],
      ),
    connectionOf: (id) =>
      Promise.resolve(
        id === R1 || id === R_OTHER ? "CONNECTED" : "INTEREST_PENDING",
      ),
    investorOf: (who) =>
      Promise.resolve(
        who === investor
          ? { investorOrganisationId: INV_ORG }
          : who === stranger
            ? { investorOrganisationId: "00000000-0000-4000-8000-0000000009e9" }
            : null,
      ),
    relationshipOf: (companyId, investorOrganisationId) =>
      Promise.resolve(
        companyId === COMPANY && investorOrganisationId === INV_ORG ? R1 : null,
      ),
    policies: {
      grant: (command) => {
        const policy = {
          id: `00000000-0000-4000-8000-0000000009${String(20 + policies.length)}`,
          resource: command.resource,
          recipient: command.recipient ?? null,
          scopeType: command.scopeType,
          accessLevel: command.accessLevel,
          expiresAt: command.expiresAt ?? null,
          revokedAt: null,
          createdAt: NOW,
        } as unknown as DisclosurePolicy;
        policies.push(policy);
        return Promise.resolve({ outcome: "CREATED", policy } as never);
      },
      revoke: (command) => {
        const index = policies.findIndex(
          (p) => p.id === command.disclosurePolicyId,
        );
        const policy = policies[index];
        if (policy === undefined) throw new Error("no policy");
        policies[index] = { ...policy, revokedAt: NOW };
        return Promise.resolve({
          outcome: "REVOKED",
          policy: policies[index],
        } as never);
      },
    },
    policyRepository: {
      findAllForResource: (_e, resource) =>
        Promise.resolve(policies.filter((p) => p.resource.id === resource.id)),
      findById: (_e, id) =>
        Promise.resolve(policies.find((p) => p.id === id) ?? null),
      findUnrevokedForRecipient: (_e, query) =>
        Promise.resolve(
          policies.filter(
            (p) =>
              p.revokedAt === null &&
              p.recipient?.id === query.recipient.id &&
              p.resource.type === query.resourceType,
          ),
        ),
    },
    appender: {
      append: (_tx: unknown, event: { eventType: string }) => {
        events.push(event.eventType);
        return Promise.resolve({} as never);
      },
    },
    audit: {
      record: (_tx: unknown, row: { actionType: string }) => {
        audits.push(row.actionType);
        return Promise.resolve();
      },
    } as never,
    answers: {
      record: (command) => {
        recorded.push({ about: command.about, answer: command.answer });
        return Promise.resolve({
          evidenceItemId: "00000000-0000-4000-8000-0000000009ee",
          knowledgeObjectId: "00000000-0000-4000-8000-0000000009ef",
        });
      },
    },
    notify: (notice) => {
      notices.push(notice);
      return Promise.resolve();
    },
    newCorrelationId: () => COR,
    now: () => NOW,
  });
  return {
    service,
    documents,
    policies,
    notices,
    audits,
    events,
    levels,
    recorded,
    named,
  };
}

describe("founder requests: the inbox", () => {
  it("shows the company's own team every request, open first", async () => {
    const { service } = world();
    const inbox = await service.inbox(founder, COMPANY);
    expect(inbox?.items.map((item) => item.itemId)).toEqual([
      "00000000-0000-4000-8000-0000000009d7",
      "00000000-0000-4000-8000-0000000009d8",
    ]);
    expect(inbox?.counts).toEqual({ open: 2, answered: 0, declined: 0 });
    expect(inbox?.items[0]).toMatchObject({
      investorOrganisationName: "Zino Capital",
      requesterName: "Ada Nwosu",
      note: "Before our IC on the 14th.",
    });
  });

  it("is one not-found for another company, an investor, and a member without the role", async () => {
    const { service } = world();
    expect(await service.inbox(otherFounder, COMPANY)).toBeNull();
    expect(await service.inbox(investor, COMPANY)).toBeNull();
    expect(await service.inbox(teammateWithoutRole, COMPANY)).toBeNull();
  });
});

describe("founder requests: upload and share", () => {
  it("files the upload shared-only in the chosen folder and shares it at the chosen level until the expiry", async () => {
    const { service, levels, policies, notices, events } = world();
    const out = await service.fulfil({
      actor: founder,
      source: "DILIGENCE",
      requestId: "00000000-0000-4000-8000-0000000009d7",
      documentId: UPLOAD.documentId,
      folderCode: "financials",
      accessLevel: "view_download",
      days: 14,
    });
    expect(out).toEqual({
      outcome: "OK",
      value: {
        requestId: "00000000-0000-4000-8000-0000000009d7",
        status: "SHARED",
      },
    });
    expect(levels).toEqual([
      {
        documentId: UPLOAD.documentId,
        level: "SHARED_ONLY",
        folder: "financials",
      },
    ]);
    expect(policies[0]).toMatchObject({
      scopeType: "relationship_shared",
      recipient: { type: "RELATIONSHIP", id: R1 },
      accessLevel: "view_download",
      expiresAt: "2026-10-22T09:00:00.000Z",
    });
    expect(events).toEqual(["document_shared"]);
    expect(notices.at(-1)).toMatchObject({
      actingSide: "COMPANY",
      target: "PROFILE",
    });

    const inbox = await service.inbox(founder, COMPANY);
    const item = inbox?.items.find(
      (i) => i.itemId === "00000000-0000-4000-8000-0000000009d7",
    );
    expect(item).toMatchObject({
      status: "SHARED",
      sharedDocument: { documentId: UPLOAD.documentId },
      // The intersection: the shared file now lives in the data room.
      dataRoom: { documentId: UPLOAD.documentId, folderCode: "financials" },
    });

    const again = await service.fulfil({
      actor: founder,
      source: "DILIGENCE",
      requestId: "00000000-0000-4000-8000-0000000009d7",
      documentId: FILED.documentId,
      accessLevel: "view",
      days: 30,
    });
    expect(again).toEqual({ outcome: "REFUSED", code: "ALREADY_ANSWERED" });
  });

  it("keeps an already filed document's level and folder", async () => {
    const { service, levels } = world();
    await service.fulfil({
      actor: founder,
      source: "DILIGENCE",
      requestId: "00000000-0000-4000-8000-0000000009d8",
      documentId: FILED.documentId,
      accessLevel: "view",
      days: 30,
    });
    expect(levels).toEqual([]);
  });

  it("never shares another company's document, and nobody else answers", async () => {
    const { service, policies } = world();
    const foreign = await service.fulfil({
      actor: founder,
      source: "DILIGENCE",
      requestId: "00000000-0000-4000-8000-0000000009d7",
      documentId: FOREIGN.documentId,
      accessLevel: "view",
      days: 30,
    });
    expect(foreign).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    const byInvestor = await service.fulfil({
      actor: investor,
      source: "DILIGENCE",
      requestId: "00000000-0000-4000-8000-0000000009d7",
      documentId: UPLOAD.documentId,
      accessLevel: "view",
      days: 30,
    });
    expect(byInvestor).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(policies).toEqual([]);
  });
});

describe("founder requests: decline", () => {
  it("declines with a note the investor is told about, once", async () => {
    const { service, notices, audits, named } = world();
    const out = await service.decline({
      actor: founder,
      source: "DILIGENCE",
      requestId: "00000000-0000-4000-8000-0000000009d8",
      note: "  After a term sheet.  ",
    });
    expect(out.outcome).toBe("OK");
    expect(named[1]?.decline?.note).toBe("After a term sheet.");
    expect(audits).toContain("diligence.request_declined");
    expect(notices.at(-1)).toMatchObject({
      title: "{actor} declined your request for Customer contracts",
      target: "PROFILE",
    });
    const counts = (await service.inbox(founder, COMPANY))?.counts;
    expect(counts).toEqual({ open: 1, answered: 0, declined: 1 });
    expect(
      await service.decline({
        actor: founder,
        source: "DILIGENCE",
        requestId: "00000000-0000-4000-8000-0000000009d8",
      }),
    ).toEqual({ outcome: "REFUSED", code: "ALREADY_ANSWERED" });
  });

  it("refuses another company's team", async () => {
    const { service } = world();
    expect(
      await service.decline({
        actor: otherFounder,
        source: "DILIGENCE",
        requestId: "00000000-0000-4000-8000-0000000009d8",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
  });
});

describe("founder requests: questions and answers", () => {
  it("records the investor's questions once, answers become the founder's claim, and the investor sees them", async () => {
    const { service, notices, recorded, policies } = world();
    const sent = await service.recordQuestions({
      actor: investor,
      relationshipId: R1,
      sentVia: "DILIGENCE_REQUEST",
      sentRef: "00000000-0000-4000-8000-0000000009c9",
      idempotencyKey: "questions-key-1",
      questions: [
        {
          question: "How many customers paid last month?",
          assumptionId: "TRACTION:1",
          assumptionLabel: "Paying customers",
        },
        {
          question: "What does the take rate depend on?",
          assumptionId: null,
          assumptionLabel: null,
        },
      ],
    });
    expect(sent.outcome).toBe("OK");
    expect(notices.at(-1)).toMatchObject({
      actingSide: "INVESTOR",
      target: "REQUESTS",
      key: "00000000-0000-4000-8000-0000000009c9",
    });
    const ids = sent.outcome === "OK" ? sent.value.questionIds : [];
    const first = ids[0] ?? "";

    // Before answering: the inbox shows one set of two open questions.
    const inbox = await service.inbox(founder, COMPANY);
    const set = inbox?.items.find((i) => i.kind === "QUESTIONS");
    expect(set).toMatchObject({
      itemId: "00000000-0000-4000-8000-0000000009c9",
      questions: [{ answer: null }, { answer: null }],
    });

    const answered = await service.answer({
      actor: founder,
      questionId: first,
      answer: "131 paid in September.",
      documentIds: [UPLOAD.documentId],
      idempotencyKey: "answer-key-1",
    });
    expect(answered).toMatchObject({
      outcome: "OK",
      value: { evidenceStatus: "DOCUMENT_SUPPORTED", recorded: true },
    });
    expect(recorded).toEqual([
      { about: "Paying customers", answer: "131 paid in September." },
    ]);
    // The evidence is shared with the asker, view only.
    expect(policies.at(-1)).toMatchObject({
      recipient: { type: "RELATIONSHIP", id: R1 },
      accessLevel: "view",
    });
    expect(notices.at(-1)).toMatchObject({
      actingSide: "COMPANY",
      title: "{actor} answered your question",
    });

    const theirs = await service.investorQuestions(investor, COMPANY);
    expect(theirs?.find((q) => q.questionId === first)?.answer).toMatchObject({
      text: "131 paid in September.",
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      documents: [
        { documentId: UPLOAD.documentId, title: "Management accounts" },
      ],
    });
    expect(theirs?.find((q) => q.questionId === ids[1])?.answer).toBeNull();
  });

  it("only the relationship's investor asks, and only the company's team answers", async () => {
    const { service } = world();
    expect(
      (
        await service.recordQuestions({
          actor: stranger,
          relationshipId: R1,
          sentVia: "CHAT_MESSAGE",
          sentRef: "00000000-0000-4000-8000-0000000009ca",
          idempotencyKey: "questions-key-2",
          questions: [
            { question: "Hello?", assumptionId: null, assumptionLabel: null },
          ],
        })
      ).outcome,
    ).toBe("REFUSED");
    const sent = await service.recordQuestions({
      actor: investor,
      relationshipId: R1,
      sentVia: "CHAT_MESSAGE",
      sentRef: "00000000-0000-4000-8000-0000000009cb",
      idempotencyKey: "questions-key-3",
      questions: [
        { question: "Runway?", assumptionId: null, assumptionLabel: null },
      ],
    });
    const id = sent.outcome === "OK" ? (sent.value.questionIds[0] ?? "") : "";
    for (const who of [otherFounder, investor, teammateWithoutRole]) {
      expect(
        await service.answer({
          actor: who,
          questionId: id,
          answer: "18 months.",
          documentIds: [],
          idempotencyKey: "answer-key-x",
        }),
      ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    }
    // Attaching another company's document is refused.
    expect(
      await service.answer({
        actor: founder,
        questionId: id,
        answer: "18 months.",
        documentIds: [FOREIGN.documentId],
        idempotencyKey: "answer-key-y",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_SHAREABLE" });
    // A stranger investor sees no questions of this relationship.
    expect(await service.investorQuestions(stranger, COMPANY)).toEqual([]);
  });
});

describe("founder requests: the access editor", () => {
  it("shares, lists, revokes, and keeps the history", async () => {
    const { service } = world();
    const shared = await service.share({
      actor: founder,
      documentId: FILED.documentId,
      relationshipId: R1,
      accessLevel: "view",
      days: 7,
    });
    expect(shared).toEqual({ outcome: "OK", value: { changed: 1 } });
    const access = await service.documentAccess(founder, FILED.documentId);
    expect(access?.grants).toHaveLength(1);
    expect(access?.grants[0]).toMatchObject({
      investorOrganisationName: "Zino Capital",
      accessLevel: "view",
      expiresAt: "2026-10-15T09:00:00.000Z",
    });
    expect(access?.candidates).toEqual([
      { relationshipId: R1, investorOrganisationName: "Zino Capital" },
    ]);
    const policyId = access?.grants[0]?.policyId ?? "";

    // Revoked: no longer counted as access; the history keeps both steps.
    expect(await service.revoke({ actor: otherFounder, policyId })).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
    expect(await service.revoke({ actor: founder, policyId })).toEqual({
      outcome: "OK",
      value: { changed: 1 },
    });
    const after = await service.documentAccess(founder, FILED.documentId);
    expect(after?.grants).toEqual([]);
    expect(after?.history.map((h) => h.what).sort()).toEqual([
      "REVOKED",
      "SHARED",
    ]);
  });

  it("never shares with another company's relationship, nor for another company", async () => {
    const { service, policies } = world();
    expect(
      await service.share({
        actor: founder,
        documentId: FILED.documentId,
        relationshipId: R_OTHER,
        accessLevel: "view",
        days: 7,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(
      await service.share({
        actor: otherFounder,
        documentId: FILED.documentId,
        relationshipId: R1,
        accessLevel: "view",
        days: 7,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(
      await service.documentAccess(otherFounder, FILED.documentId),
    ).toBeNull();
    expect(policies).toEqual([]);
  });

  it("shares and reports a whole folder, and sets a folder's level", async () => {
    const { service, documents } = world();
    expect(
      await service.share({
        actor: founder,
        companyId: COMPANY,
        folderCode: "cap_table",
        relationshipId: R1,
        accessLevel: "view_download",
        days: 30,
      }),
    ).toEqual({ outcome: "OK", value: { changed: 1 } });
    const folder = await service.folderAccess(founder, COMPANY, "cap_table");
    expect(folder?.investors).toEqual([
      {
        relationshipId: R1,
        investorOrganisationName: "Zino Capital",
        documents: 1,
      },
    ]);
    expect(
      await service.setFolderLevel({
        actor: founder,
        companyId: COMPANY,
        folderCode: "cap_table",
        level: "PRIVATE",
      }),
    ).toEqual({ outcome: "OK", value: { changed: 1 } });
    expect(
      documents.find((d) => d.documentId === FILED.documentId)?.level,
    ).toBe("PRIVATE");
    expect(
      await service.folderAccess(otherFounder, COMPANY, "cap_table"),
    ).toBeNull();
  });
});

describe("founder requests: ordering", () => {
  it("puts open items first and counts each kind", () => {
    const base = {
      kind: "DOCUMENT_REQUEST" as const,
      source: "DILIGENCE" as const,
      relationshipId: R1,
      investorOrganisationName: null,
      requesterName: null,
      title: "x",
      note: null,
      declineNote: null,
      sharedDocument: null,
      accessEndsAt: null,
      dataRoom: null,
    };
    const items = sortInbox([
      {
        ...base,
        itemId: "a",
        requestId: "a",
        requestedAt: "2026-10-07T00:00:00.000Z",
        status: "SHARED",
      },
      {
        ...base,
        itemId: "b",
        requestId: "b",
        requestedAt: "2026-10-01T00:00:00.000Z",
        status: "OPEN",
      },
      {
        ...base,
        itemId: "c",
        requestId: "c",
        requestedAt: "2026-10-06T00:00:00.000Z",
        status: "DECLINED",
      },
    ] as never);
    expect(items.map((i) => i.itemId)).toEqual(["b", "a", "c"]);
    expect(inboxCounts(items)).toEqual({ open: 1, answered: 1, declined: 1 });
  });
});

describe("founder shares go only to connected investors (2026-10-08)", () => {
  it("lists only connected investors to share with, and those waiting apart", async () => {
    const { service } = world();
    const access = await service.documentAccess(founder, FILED.documentId);
    expect(access?.candidates).toEqual([
      { relationshipId: R1, investorOrganisationName: "Zino Capital" },
    ]);
    expect(access?.awaitingConnection).toEqual([
      {
        relationshipId: R_PENDING,
        investorOrganisationName: "Pending Partners",
      },
    ]);
    const folder = await service.folderAccess(
      founder,
      COMPANY,
      FILED.folderCode,
    );
    expect(folder?.candidates.map((c) => c.relationshipId)).toEqual([R1]);
    expect(folder?.awaitingConnection.map((c) => c.relationshipId)).toEqual([
      R_PENDING,
    ]);
  });

  it("refuses a share with an investor not yet connected, server-side", async () => {
    const { service, policies } = world();
    expect(
      await service.share({
        actor: founder,
        documentId: FILED.documentId,
        relationshipId: R_PENDING,
        accessLevel: "view",
        days: 7,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_CONNECTED" });
    expect(policies).toEqual([]);
  });
});

describe("questions a diligence request carried (2026-10-08)", () => {
  it("tells the investor on their Diligence tab, counting answers: 1 of 2, then all", async () => {
    const { service, notices } = world();
    const vehicle = "00000000-0000-4000-8000-0000000009d7";
    const sent = await service.recordQuestions({
      actor: investor,
      relationshipId: R1,
      sentVia: "DILIGENCE_REQUEST",
      sentRef: vehicle,
      idempotencyKey: "questions-key-9",
      questions: [
        {
          question: "What is monthly burn?",
          assumptionId: null,
          assumptionLabel: null,
        },
        {
          question: "How long is runway?",
          assumptionId: null,
          assumptionLabel: null,
        },
      ],
    });
    const ids = sent.outcome === "OK" ? sent.value.questionIds : [];
    await service.answer({
      actor: founder,
      questionId: ids[0] ?? "",
      answer: "About 40k a month.",
      documentIds: [],
      idempotencyKey: "answer-key-91",
    });
    expect(notices.at(-1)).toMatchObject({
      actingSide: "COMPANY",
      target: "DILIGENCE",
      title:
        "{actor} answered 1 of 2 of your questions on Management accounts, last 12 months",
    });
    await service.answer({
      actor: founder,
      questionId: ids[1] ?? "",
      answer: "Eighteen months.",
      documentIds: [],
      idempotencyKey: "answer-key-92",
    });
    expect(notices.at(-1)).toMatchObject({
      target: "DILIGENCE",
      title:
        "{actor} answered all 2 of your questions on Management accounts, last 12 months",
    });
  });
});
