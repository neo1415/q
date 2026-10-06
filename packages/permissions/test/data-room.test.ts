import { describe, expect, it } from "vitest";

import type { DataRoomLevel, UtcTimestamp } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  activeGrants,
  checklistFor,
  createDataRoomService,
  projectForInvestor,
  type DataRoomChecklistEntry,
  type DataRoomDocument,
  type DataRoomRequestRecord,
  type DataRoomStore,
  type DisclosurePolicy,
} from "../src/index.js";

/**
 * Overnight A3: the data room. Four levels; an investor never receives a
 * title it may not see; a request is answered by an expiring grant (the
 * existing relationship_shared disclosure policy) that is a relationship
 * event plus an audit row; the investor who cannot find the company sees
 * nothing at all; only the owner changes levels or answers requests.
 */

const COMPANY = "00000000-0000-4000-8000-0000000005c1";
const TENANT = "00000000-0000-4000-8000-0000000005f1";
const ORG = "00000000-0000-4000-8000-0000000005a0";
const INV_ORG_1 = "00000000-0000-4000-8000-0000000005e1";
const INV_ORG_2 = "00000000-0000-4000-8000-0000000005e2";
const R1 = "00000000-0000-4000-8000-000000000501";
const NOW = "2026-10-06T09:00:00.000Z" as UtcTimestamp;

const actor = (userId: string, organisationId: string): ActorContext =>
  ({
    userId,
    tenantId: TENANT,
    organisationId,
    actorType: "HUMAN",
  }) as unknown as ActorContext;
const founder = actor("00000000-0000-4000-8000-0000000005a1", ORG);
const investorOne = actor(
  "00000000-0000-4000-8000-0000000005b1",
  "00000000-0000-4000-8000-0000000005d1",
);
const investorTwo = actor(
  "00000000-0000-4000-8000-0000000005b2",
  "00000000-0000-4000-8000-0000000005d2",
);
const stranger = actor(
  "00000000-0000-4000-8000-0000000005b3",
  "00000000-0000-4000-8000-0000000005d3",
);

const doc = (
  n: number,
  level: DataRoomLevel,
  title: string,
): DataRoomDocument => ({
  documentId: `00000000-0000-4000-8000-0000000005${String(10 + n)}`,
  tenantId: TENANT,
  companyId: COMPANY,
  title,
  documentType: "OTHER",
  level,
  folderCode: "corporate",
  checklistItemCode: null,
  validUntil: null,
  pageCount: 3,
  mimeType: "application/pdf",
  currentVersionId: `00000000-0000-4000-8000-0000000006${String(10 + n)}`,
  updatedAt: "2026-09-01T00:00:00.000Z",
  version: 1,
});

const PUBLIC_DOC = doc(1, "PUBLIC", "One-page summary");
const ON_REQUEST_DOC = doc(2, "ON_REQUEST", "Cap table summary");
const SHARED_ONLY_DOC = doc(3, "SHARED_ONLY", "Litigation with X");
const PRIVATE_DOC = doc(4, "PRIVATE", "Directors' passports");

function world() {
  const documents = [PUBLIC_DOC, ON_REQUEST_DOC, SHARED_ONLY_DOC, PRIVATE_DOC];
  const requests: DataRoomRequestRecord[] = [];
  const policies: DisclosurePolicy[] = [];
  const events: { eventType: string; payload: unknown }[] = [];
  const audits: { actionType: string }[] = [];
  const views: string[] = [];
  const notices: string[] = [];
  const relationships = new Map<string, string>([[INV_ORG_1, R1]]);
  const tx = { sql: {} } as unknown as TransactionContext;
  const transactions: TransactionManager = { run: (work) => work(tx) };

  const store: DataRoomStore = {
    folders: () =>
      Promise.resolve([
        { code: "corporate", label: "Company and incorporation" },
      ]),
    checklist: () => Promise.resolve([]),
    documentsOf: () => Promise.resolve(documents),
    document: (_e, id) =>
      Promise.resolve(documents.find((d) => d.documentId === id) ?? null),
    setLevel: (_tx, input) => {
      const index = documents.findIndex(
        (d) => d.documentId === input.document.documentId,
      );
      const current = documents[index];
      if (current === undefined || current.version !== input.expectedVersion)
        return Promise.resolve(null);
      documents[index] = {
        ...current,
        level: input.level,
        version: current.version + 1,
      };
      return Promise.resolve({ version: current.version + 1 });
    },
    insertRequest: (_tx, input) => {
      const replay = requests.find(
        (r) => r.note === `${input.userId}:${input.idempotencyKey}`,
      );
      if (replay !== undefined)
        return Promise.resolve({ id: replay.id, created: false });
      const id = `00000000-0000-4000-8000-0000000007${String(10 + requests.length)}`;
      requests.push({
        id,
        tenantId: input.tenantId,
        companyId: input.companyId,
        documentId: input.documentId,
        documentTitle:
          documents.find((d) => d.documentId === input.documentId)?.title ??
          null,
        relationshipId: input.relationshipId,
        investorOrganisationId: input.investorOrganisationId,
        investorOrganisationName: "Northbound Capital",
        requestedByName: "Daniel Reyes",
        note: `${input.userId}:${input.idempotencyKey}`,
        createdAt: NOW,
        decision: null,
        expiresAt: null,
      });
      return Promise.resolve({ id, created: true });
    },
    requests: (_e, filter) =>
      Promise.resolve(
        requests.filter(
          (r) =>
            filter.relationshipId === undefined ||
            r.relationshipId === filter.relationshipId,
        ),
      ),
    requestCompany: (_e, id) =>
      Promise.resolve(requests.some((r) => r.id === id) ? COMPANY : null),
    insertDecision: (_tx, input) => {
      const index = requests.findIndex((r) => r.id === input.requestId);
      const request = requests[index];
      if (request === undefined || request.decision !== null)
        return Promise.resolve(false);
      requests[index] = {
        ...request,
        decision: input.decision,
        expiresAt: input.expiresAt,
      };
      return Promise.resolve(true);
    },
    recordView: (_e, input) => {
      views.push(`${input.investorOrganisationId}:${input.documentId}`);
      return Promise.resolve();
    },
    viewsByOrganisation: () => Promise.resolve(new Map()),
    openedByCounts: () => Promise.resolve(new Map()),
  };

  const investorOrgOf = (who: ActorContext) =>
    who === investorOne
      ? INV_ORG_1
      : who === investorTwo
        ? INV_ORG_2
        : who === stranger
          ? "stranger"
          : null;

  const service = createDataRoomService({
    sql: {} as DatabaseExecutor,
    transactions,
    store,
    company: (id) =>
      Promise.resolve(
        id === COMPANY
          ? {
              id,
              tenantId: TENANT,
              organisationId: ORG,
              name: "Kora Health",
              stageCode: "seed",
              countryCode: "NG",
            }
          : null,
      ),
    investorOf: (who) => {
      const id = investorOrgOf(who);
      return Promise.resolve(
        id === null
          ? null
          : { investorOrganisationId: id, name: "Northbound Capital" },
      );
    },
    // The stranger's mandate does not admit the company (the pitch rule).
    investorMayFind: (who) => Promise.resolve(who !== stranger),
    ownerMayManage: () => Promise.resolve(true),
    relationshipOf: (_c, investorOrganisationId) =>
      Promise.resolve(relationships.get(investorOrganisationId) ?? null),
    ensureRelationship: ({ investorOrganisationId }) => {
      const id = "00000000-0000-4000-8000-000000000502";
      relationships.set(investorOrganisationId, id);
      return Promise.resolve(id);
    },
    policies: {
      grant: (command) => {
        const policy = {
          id: `00000000-0000-4000-8000-0000000008${String(10 + policies.length)}`,
          resource: command.resource,
          recipient: command.recipient,
          scopeType: command.scopeType,
          accessLevel: command.accessLevel,
          expiresAt: command.expiresAt ?? null,
          revokedAt: null,
          createdAt: NOW,
        } as unknown as DisclosurePolicy;
        policies.push(policy);
        return Promise.resolve({ outcome: "CREATED", policy } as never);
      },
    },
    policyRepository: {
      findUnrevokedForRecipient: (_e, query) =>
        Promise.resolve(
          policies.filter(
            (p) =>
              (p.recipient as { id: string } | null)?.id ===
                query.recipient.id && p.resource.type === query.resourceType,
          ),
        ),
    },
    access: {
      canDisclose: () => Promise.resolve({ outcome: "ALLOW" } as never),
    },
    signedInline: () =>
      Promise.resolve({
        url: "https://storage.example/signed",
        expiresAt: NOW,
      }),
    nameOf: () => Promise.resolve("Daniel Reyes"),
    appender: {
      append: (
        _tx: unknown,
        event: { eventType: string; payload: unknown },
      ) => {
        events.push(event);
        return Promise.resolve({} as never);
      },
    },
    audit: {
      record: (_tx: unknown, entry: { actionType: string }) => {
        audits.push(entry);
        return Promise.resolve();
      },
    } as never,
    notify: (input) => {
      notices.push(`${input.actingSide}:${input.title}`);
      return Promise.resolve();
    },
    newCorrelationId: () => "cor_test",
    now: () => NOW,
  });
  return { service, requests, policies, events, audits, views, notices };
}

const titles = (view: unknown) =>
  JSON.stringify(view)
    .match(/"title":"[^"]+"/g)
    ?.map((t) => t.slice(9, -1)) ?? [];

describe("data room visibility", () => {
  it("shows an investor only public and on-request titles, never shared-only or private ones", async () => {
    const { service } = world();
    const view = await service.view(investorOne, COMPANY);
    expect(view?.viewer).toBe("INVESTOR");
    expect(titles(view)).toEqual(["One-page summary", "Cap table summary"]);
    expect(JSON.stringify(view)).not.toContain("Litigation");
    expect(JSON.stringify(view)).not.toContain("passports");
    if (view?.viewer !== "INVESTOR") throw new Error("investor view");
    expect(view.documents.map((d) => [d.shownAs, d.access])).toEqual([
      ["PUBLIC", "OPEN"],
      ["ON_REQUEST", "REQUESTABLE"],
    ]);
  });

  it("shows nothing to an investor the pitch rule does not admit, or to a non-investor", async () => {
    const { service } = world();
    expect(await service.view(stranger, COMPANY)).toBeNull();
    expect(
      await service.view(
        actor("00000000-0000-4000-8000-0000000005c9", "x"),
        COMPANY,
      ),
    ).toBeNull();
    expect(
      await service.view(investorOne, "00000000-0000-4000-8000-0000000005cf"),
    ).toBeNull();
  });

  it("gives the owner every document with its level and ADR-001 scope", async () => {
    const { service } = world();
    const view = await service.view(founder, COMPANY);
    if (view?.viewer !== "OWNER") throw new Error("owner view");
    expect(view.documents.map((d) => [d.level, d.visibilityScope])).toEqual([
      ["PUBLIC", "network_visible"],
      ["ON_REQUEST", "specifically_shared"],
      ["SHARED_ONLY", "specifically_shared"],
      ["PRIVATE", "organisation_private"],
    ]);
  });

  it("lists a shared-only document to the one relationship it was granted to, and to no other", () => {
    const grants = activeGrants(
      [
        {
          id: "p1",
          resource: { type: "document", id: SHARED_ONLY_DOC.documentId },
          expiresAt: "2026-11-01T00:00:00.000Z",
          revokedAt: null,
        } as unknown as DisclosurePolicy,
        {
          id: "p2",
          resource: { type: "document", id: PRIVATE_DOC.documentId },
          expiresAt: "2026-10-01T00:00:00.000Z", // expired
          revokedAt: null,
        } as unknown as DisclosurePolicy,
      ],
      NOW,
    );
    const docs = [PUBLIC_DOC, SHARED_ONLY_DOC, PRIVATE_DOC];
    const granted = projectForInvestor(docs, {
      grants,
      openRequests: new Set(),
      views: new Map(),
    });
    expect(granted.map((d) => [d.title, d.shownAs, d.accessEndsAt])).toEqual([
      ["One-page summary", "PUBLIC", null],
      ["Litigation with X", "SHARED", "2026-11-01T00:00:00.000Z"],
    ]);
    const other = projectForInvestor(docs, {
      grants: new Map(),
      openRequests: new Set(),
      views: new Map(),
    });
    expect(other.map((d) => d.title)).toEqual(["One-page summary"]);
  });

  it("files the checklist by stage and country, in the country's own words", () => {
    const items: DataRoomChecklistEntry[] = [
      {
        code: "deck",
        folderCode: "fundraising",
        label: "Pitch deck",
        countryLabels: {},
        minStageRank: 1,
        countryCodes: null,
        defaultLevel: "PUBLIC",
      },
      {
        code: "good_standing",
        folderCode: "corporate",
        label: "Good-standing letter",
        countryLabels: { NG: "Company status report (CAC)" },
        minStageRank: 2,
        countryCodes: null,
        defaultLevel: "ON_REQUEST",
      },
      {
        code: "audited",
        folderCode: "financials",
        label: "Audited accounts",
        countryLabels: {},
        minStageRank: 4,
        countryCodes: null,
        defaultLevel: "SHARED_ONLY",
      },
      {
        code: "scuml",
        folderCode: "kyc_kyb",
        label: "SCUML certificate",
        countryLabels: {},
        minStageRank: 2,
        countryCodes: ["NG"],
        defaultLevel: "ON_REQUEST",
      },
    ];
    expect(checklistFor(items, "pre_seed", "NG").map((i) => i.code)).toEqual([
      "deck",
    ]);
    expect(checklistFor(items, "seed", "NG").map((i) => i.words)).toEqual([
      "Pitch deck",
      "Company status report (CAC)",
      "SCUML certificate",
    ]);
    expect(checklistFor(items, "seed", "KE").map((i) => i.code)).toEqual([
      "deck",
      "good_standing",
    ]);
    expect(checklistFor(items, "series_b", null).map((i) => i.code)).toEqual([
      "deck",
      "good_standing",
      "audited",
    ]);
  });
});

describe("request access and approval", () => {
  it("records a request as a relationship event and an audit row, once per key, and tells the founder", async () => {
    const { service, events, audits, notices, requests } = world();
    const first = await service.requestAccess({
      actor: investorOne,
      companyId: COMPANY,
      documentId: ON_REQUEST_DOC.documentId,
      note: "For our committee on 20 October",
      idempotencyKey: "key-00000001",
    });
    expect(first.outcome).toBe("OK");
    const again = await service.requestAccess({
      actor: investorOne,
      companyId: COMPANY,
      documentId: ON_REQUEST_DOC.documentId,
      idempotencyKey: "key-00000001",
    });
    expect(again).toEqual(first);
    expect(requests).toHaveLength(1);
    expect(events.map((e) => e.eventType)).toEqual([
      "data_room_access_requested",
    ]);
    expect(audits.map((a) => a.actionType)).toEqual([
      "data_room.access_requested",
    ]);
    expect(notices).toEqual(["INVESTOR:{actor} asked for Cap table summary"]);
    const view = await service.view(investorOne, COMPANY);
    if (view?.viewer !== "INVESTOR") throw new Error("investor view");
    expect(
      view.documents.find((d) => d.documentId === ON_REQUEST_DOC.documentId)
        ?.access,
    ).toBe("REQUESTED");
  });

  it("refuses a request for a document that is not on request, without confirming it exists", async () => {
    const { service, events } = world();
    for (const document of [SHARED_ONLY_DOC, PRIVATE_DOC, PUBLIC_DOC]) {
      const out = await service.requestAccess({
        actor: investorOne,
        companyId: COMPANY,
        documentId: document.documentId,
        idempotencyKey: `key-${document.documentId.slice(-8)}`,
      });
      expect(out).toEqual({ outcome: "REFUSED", code: "NOT_REQUESTABLE" });
    }
    expect(events).toHaveLength(0);
    expect(
      await service.requestAccess({
        actor: stranger,
        companyId: COMPANY,
        documentId: null,
        idempotencyKey: "key-stranger",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(
      await service.requestAccess({
        actor: founder,
        companyId: COMPANY,
        documentId: null,
        idempotencyKey: "key-founder",
      }),
    ).toEqual({ outcome: "REFUSED", code: "INVESTOR_ONLY" });
  });

  it("creates the canonical relationship on first contact rather than a parallel record", async () => {
    const { service, requests } = world();
    await service.requestAccess({
      actor: investorTwo,
      companyId: COMPANY,
      documentId: null,
      idempotencyKey: "key-two-0001",
    });
    expect(requests[0]?.relationshipId).toBe(
      "00000000-0000-4000-8000-000000000502",
    );
  });

  it("approves with an expiry: an expiring grant to that relationship, an event and an audit row; the investor can then open it", async () => {
    const { service, policies, events, audits, views } = world();
    const asked = await service.requestAccess({
      actor: investorOne,
      companyId: COMPANY,
      documentId: ON_REQUEST_DOC.documentId,
      idempotencyKey: "key-00000002",
    });
    if (asked.outcome !== "OK") throw new Error("asked");
    expect(
      await service.open({
        actor: investorOne,
        companyId: COMPANY,
        documentId: ON_REQUEST_DOC.documentId,
      }),
    ).toBeNull();
    // Only the owner answers.
    expect(
      await service.decide({
        actor: investorOne,
        requestId: asked.value.requestId,
        decision: "APPROVE",
        days: 30,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    const approved = await service.decide({
      actor: founder,
      requestId: asked.value.requestId,
      decision: "APPROVE",
      days: 14,
    });
    expect(approved).toEqual({
      outcome: "OK",
      value: { requestId: asked.value.requestId, status: "APPROVED" },
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      scopeType: "relationship_shared",
      recipient: { type: "RELATIONSHIP", id: R1 },
      accessLevel: "view",
      expiresAt: "2026-10-20T09:00:00.000Z",
    });
    expect(events.map((e) => e.eventType)).toContain(
      "data_room_access_granted",
    );
    expect(audits.map((a) => a.actionType)).toContain(
      "data_room.access_decided",
    );
    // Answered once.
    expect(
      await service.decide({
        actor: founder,
        requestId: asked.value.requestId,
        decision: "DECLINE",
      }),
    ).toEqual({ outcome: "REFUSED", code: "ALREADY_DECIDED" });
    const opened = await service.open({
      actor: investorOne,
      companyId: COMPANY,
      documentId: ON_REQUEST_DOC.documentId,
    });
    expect(opened).toMatchObject({
      downloadable: false,
      watermark: "Daniel Reyes · Northbound Capital · 2026-10-06 · view only",
    });
    expect(views).toEqual([`${INV_ORG_1}:${ON_REQUEST_DOC.documentId}`]);
    // Another investor still cannot open it.
    expect(
      await service.open({
        actor: investorTwo,
        companyId: COMPANY,
        documentId: ON_REQUEST_DOC.documentId,
      }),
    ).toBeNull();
  });

  it("declines with an audit row and no grant", async () => {
    const { service, policies, audits } = world();
    const asked = await service.requestAccess({
      actor: investorOne,
      companyId: COMPANY,
      documentId: null,
      idempotencyKey: "key-00000003",
    });
    if (asked.outcome !== "OK") throw new Error("asked");
    const declined = await service.decide({
      actor: founder,
      requestId: asked.value.requestId,
      decision: "DECLINE",
    });
    expect(declined.outcome).toBe("OK");
    expect(policies).toHaveLength(0);
    expect(audits.map((a) => a.actionType)).toEqual([
      "data_room.access_requested",
      "data_room.access_decided",
    ]);
  });
});

describe("levels", () => {
  it("lets only the owner change a level, with a version check and an audit row", async () => {
    const { service, audits } = world();
    expect(
      await service.setLevel({
        actor: investorOne,
        documentId: PRIVATE_DOC.documentId,
        level: "PUBLIC",
      }),
    ).toEqual({ outcome: "REFUSED", code: "OWNER_ONLY" });
    const set = await service.setLevel({
      actor: founder,
      documentId: PRIVATE_DOC.documentId,
      level: "ON_REQUEST",
      expectedVersion: 1,
    });
    expect(set).toEqual({
      outcome: "OK",
      value: {
        documentId: PRIVATE_DOC.documentId,
        level: "ON_REQUEST",
        version: 2,
      },
    });
    expect(audits.map((a) => a.actionType)).toEqual([
      "data_room.level_changed",
    ]);
    expect(
      await service.setLevel({
        actor: founder,
        documentId: PRIVATE_DOC.documentId,
        level: "PUBLIC",
        expectedVersion: 1,
      }),
    ).toEqual({ outcome: "REFUSED", code: "VERSION_CONFLICT" });
  });

  it("never opens a private document for an investor, even one who can find the company", async () => {
    const { service } = world();
    expect(
      await service.open({
        actor: investorOne,
        companyId: COMPANY,
        documentId: PRIVATE_DOC.documentId,
      }),
    ).toBeNull();
    expect(
      await service.open({
        actor: investorOne,
        companyId: COMPANY,
        documentId: PUBLIC_DOC.documentId,
      }),
    ).not.toBeNull();
    expect(
      await service.open({
        actor: stranger,
        companyId: COMPANY,
        documentId: PUBLIC_DOC.documentId,
      }),
    ).toBeNull();
  });
});
