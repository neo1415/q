import { describe, expect, it } from "vitest";

import type { DataRoomView } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createMaterialDocumentReads,
  createOwnCompanyMembership,
} from "../src/composition/material-documents.js";

/**
 * R0: a data-room document's type and text reach Q only through the data
 * room's own view of the person: on-request titles get no opening and no
 * text, and nothing the view did not list is looked up at all.
 */
const COMPANY = "00000000-0000-4000-8000-00000000c0aa";
const CERT = "00000000-0000-4000-8000-00000000c001";
const TAX = "00000000-0000-4000-8000-00000000c003";
const actor = {
  userId: "00000000-0000-4000-8000-0000000000a1",
  tenantId: "00000000-0000-4000-8000-0000000000b1",
} as ActorContext;

const room: DataRoomView = {
  viewer: "INVESTOR",
  companyId: COMPANY,
  folders: [{ code: "corporate", label: "Corporate" }],
  documents: [CERT, TAX].map((documentId, index) => ({
    documentId,
    title: index === 0 ? "Certificate of Incorporation" : "Tax assurance",
    folderCode: "corporate",
    shownAs: index === 0 ? ("PUBLIC" as const) : ("ON_REQUEST" as const),
    access: index === 0 ? ("OPEN" as const) : ("REQUESTABLE" as const),
    kind: "PDF",
    pageCount: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
    validUntil: null,
    openedAt: null,
    accessEndsAt: null,
  })),
};

function reads(view: DataRoomView | null) {
  const asked: unknown[][] = [];
  const fake = (_strings: TemplateStringsArray, ...values: unknown[]) => {
    asked.push(values);
    return Promise.resolve([
      {
        id: CERT,
        document_type: "CERTIFICATE_OF_INCORPORATION",
        text: "This is to certify",
      },
      { id: TAX, document_type: "TAX", text: "Secret tax words" },
    ]);
  };
  return {
    asked,
    port: createMaterialDocumentReads({
      sql: fake as unknown as DatabaseExecutor,
      view: () => Promise.resolve(view),
    }),
  };
}

describe("data-room documents for Q", () => {
  it("lists what the view lists, with an opening only where they may open it", async () => {
    const { port } = reads(room);
    const documents = await port.documents(actor, COMPANY);
    expect(documents?.map((d) => [d.documentId, d.access, d.opening])).toEqual([
      [CERT, "OPEN", "This is to certify"],
      [TAX, "REQUESTABLE", null],
    ]);
  });

  it("reads the text of an open document, never an on-request one", async () => {
    const { port, asked } = reads(room);
    expect(await port.documentText(actor, COMPANY, CERT)).toEqual({
      text: "This is to certify",
      truncated: false,
    });
    const before = asked.length;
    expect(await port.documentText(actor, COMPANY, TAX)).toBeNull();
    expect(asked.length).toBe(before);
  });

  it("looks nothing up when the data room refuses them", async () => {
    const { port, asked } = reads(null);
    expect(await port.documents(actor, COMPANY)).toBeNull();
    expect(await port.documentText(actor, COMPANY, CERT)).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("documentPages (Q room W3)", () => {
  function pages(view: DataRoomView | null) {
    const asked: unknown[][] = [];
    const fake = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      asked.push(values);
      return Promise.resolve([
        { page_number: 1, text: null, page_count: 3 },
        { page_number: 2, text: "Page two", page_count: 3 },
        { page_number: 3, text: null, page_count: 3 },
      ]);
    };
    return {
      asked,
      port: createMaterialDocumentReads({
        sql: fake as unknown as DatabaseExecutor,
        view: () => Promise.resolve(view),
      }),
    };
  }

  it("reads the asked pages of a document they may open, with the count", async () => {
    const { port } = pages(room);
    expect(
      await port.documentPages(actor, COMPANY, CERT, { from: 2, to: 2 }),
    ).toEqual({ pageCount: 3, pages: [{ page: 2, text: "Page two" }] });
  });

  it("never looks up an on-request document, or any without a view", async () => {
    const { port, asked } = pages(room);
    expect(
      await port.documentPages(actor, COMPANY, TAX, { from: 1, to: 1 }),
    ).toBeNull();
    const none = pages(null);
    expect(
      await none.port.documentPages(actor, COMPANY, CERT, { from: 1, to: 1 }),
    ).toBeNull();
    expect([...asked, ...none.asked]).toEqual([]);
  });
});

// Stress 2026-10-28 (F03, S02-F): a highly confidential document listed in
// the room (the founder's management accounts) is held back: no opening,
// no text, no pages, whoever may open it on screen.
describe("a highly confidential document is never read for Q", () => {
  const ACCOUNTS = "00000000-0000-4000-8000-00000000c009";
  const owner: DataRoomView = {
    viewer: "OWNER",
    companyId: COMPANY,
    stageCode: "seed",
    countryCode: "NG",
    folders: [{ code: "finance", label: "Finance" }],
    documents: [
      {
        documentId: ACCOUNTS,
        title: "LedgerBridge financial report Sept 2026",
        folderCode: "finance",
        checklistItemCode: null,
        level: "PRIVATE",
        visibilityScope: "organisation_private",
        kind: "PDF",
        pageCount: 2,
        updatedAt: "2026-10-28T00:00:00.000Z",
        validUntil: null,
        sharedWith: 0,
        openedBy: 0,
        version: 1,
      },
    ],
    checklist: [],
    requests: [],
  };
  function held() {
    const asked: unknown[][] = [];
    const fake = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      asked.push(values);
      return Promise.resolve([
        {
          id: ACCOUNTS,
          document_type: "MANAGEMENT_ACCOUNTS",
          sensitivity_class: "HIGHLY_CONFIDENTIAL",
          text: "Recognised MRR $51,000",
          page_number: 1,
          page_count: 2,
        },
      ]);
    };
    return createMaterialDocumentReads({
      sql: fake as unknown as DatabaseExecutor,
      view: () => Promise.resolve(owner),
    });
  }

  it("lists it as held back with no opening", async () => {
    const documents = await held().documents(actor, COMPANY);
    expect(documents).toEqual([
      expect.objectContaining({
        documentId: ACCOUNTS,
        access: "OWNER",
        opening: null,
        heldBack: true,
      }),
    ]);
  });

  it("reads neither its text nor its pages", async () => {
    const port = held();
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
    expect(
      await port.documentPages(actor, COMPANY, ACCOUNTS, { from: 1, to: 2 }),
    ).toBeNull();
  });
});

// ADR 0078 (owner decision 99, "shared means readable"): a highly
// confidential document the founder shared with ONE investor's
// organisation is read for that investor's Q only, under the grant the
// data room resolves for them, checked again at the read itself; every
// other investor, the owner, a revoked grant and RESTRICTED stay held back.
describe("a shared highly confidential document (ADR 0078)", () => {
  const ACCOUNTS = "00000000-0000-4000-8000-00000000c009";
  const PASSPORT = "00000000-0000-4000-8000-00000000c00a";
  const GRANT = "00000000-0000-4000-8000-0000000009aa";
  const investorRoom: DataRoomView = {
    viewer: "INVESTOR",
    companyId: COMPANY,
    folders: [{ code: "finance", label: "Finance" }],
    documents: [ACCOUNTS, PASSPORT].map((documentId, index) => ({
      documentId,
      title: index === 0 ? "Management accounts Sept 2026" : "Passport",
      folderCode: "finance",
      shownAs: "SHARED" as const,
      access: "OPEN" as const,
      kind: "PDF",
      pageCount: 2,
      updatedAt: "2026-10-28T00:00:00.000Z",
      validUntil: null,
      openedAt: null,
      accessEndsAt: "2026-12-01T00:00:00.000Z",
    })),
  };
  const rows = [
    {
      id: ACCOUNTS,
      document_type: "MANAGEMENT_ACCOUNTS",
      sensitivity_class: "HIGHLY_CONFIDENTIAL",
      text: "Cash $410,000; monthly burn $38,000",
      page_number: 1,
      page_count: 2,
    },
    {
      id: PASSPORT,
      document_type: "IDENTITY",
      sensitivity_class: "RESTRICTED",
      text: "Passport number X",
      page_number: 1,
      page_count: 1,
    },
  ];
  function shared(
    view: DataRoomView,
    grant: { current: { grantId: string; expiresAt: string | null } | null },
    withLookup = true,
  ) {
    const askedFor: string[] = [];
    const fake = (_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve(rows);
    const port = createMaterialDocumentReads({
      sql: fake as unknown as DatabaseExecutor,
      view: () => Promise.resolve(view),
      ...(withLookup
        ? {
            sharedGrant: (_actor: ActorContext, _c: string, id: string) => {
              askedFor.push(id);
              return Promise.resolve(grant.current);
            },
          }
        : {}),
    });
    return { port, askedFor };
  }
  const active = { grantId: GRANT, expiresAt: "2026-12-01T00:00:00.000Z" };

  it("lists, reads and pages it for the investor it was shared with, naming the grant", async () => {
    const { port } = shared(investorRoom, { current: active });
    const documents = await port.documents(actor, COMPANY);
    expect(documents?.[0]).toMatchObject({
      documentId: ACCOUNTS,
      opening: "Cash $410,000; monthly burn $38,000",
      sharedUnder: active,
    });
    expect(documents?.[0]?.heldBack).toBeUndefined();
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toEqual({
      text: "Cash $410,000; monthly burn $38,000",
      truncated: false,
      sharedUnder: active,
    });
    expect(
      await port.documentPages(actor, COMPANY, ACCOUNTS, { from: 1, to: 1 }),
    ).toMatchObject({ sharedUnder: active });
  });

  it("stays held back for an investor with no grant (another investor)", async () => {
    const { port } = shared(investorRoom, { current: null });
    const documents = await port.documents(actor, COMPANY);
    expect(documents?.[0]).toMatchObject({ heldBack: true, opening: null });
    expect(documents?.[0]?.sharedUnder).toBeUndefined();
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
    expect(
      await port.documentPages(actor, COMPANY, ACCOUNTS, { from: 1, to: 2 }),
    ).toBeNull();
  });

  it("closes the moment the grant is revoked, even after it was listed", async () => {
    const grant: {
      current: { grantId: string; expiresAt: string | null } | null;
    } = { current: active };
    const { port } = shared(investorRoom, grant);
    expect((await port.documents(actor, COMPANY))?.[0]?.sharedUnder).toEqual(
      active,
    );
    grant.current = null;
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
    expect(
      await port.documentPages(actor, COMPANY, ACCOUNTS, { from: 1, to: 2 }),
    ).toBeNull();
  });

  it("never unlocks RESTRICTED, and never asks without the share lookup", async () => {
    const { port, askedFor } = shared(investorRoom, { current: active });
    expect(await port.documentText(actor, COMPANY, PASSPORT)).toBeNull();
    expect(askedFor).not.toContain(PASSPORT);
    const none = shared(investorRoom, { current: active }, false);
    expect(await none.port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
  });

  it("the owner view never asks for a share (ADR 0079 decides it instead)", async () => {
    const ownerRoom: DataRoomView = {
      viewer: "OWNER",
      companyId: COMPANY,
      stageCode: "seed",
      countryCode: "NG",
      folders: [{ code: "finance", label: "Finance" }],
      documents: [
        {
          documentId: ACCOUNTS,
          title: "Management accounts Sept 2026",
          folderCode: "finance",
          checklistItemCode: null,
          level: "SHARED_ONLY",
          visibilityScope: "specifically_shared",
          kind: "PDF",
          pageCount: 2,
          updatedAt: "2026-10-28T00:00:00.000Z",
          validUntil: null,
          sharedWith: 1,
          openedBy: 0,
          version: 1,
        },
      ],
      checklist: [],
      requests: [],
    };
    const { port, askedFor } = shared(ownerRoom, { current: active });
    // Composed without the member lookup: still held back.
    expect((await port.documents(actor, COMPANY))?.[0]).toMatchObject({
      heldBack: true,
    });
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
    expect(askedFor).toEqual([]);
  });
});

// ADR 0079 (owner decision 100): a founder's own Q reads their own
// company's highly confidential documents, as a current member of the
// company that owns them, with the membership named (provenance). Another
// company's member, an ended membership, an investor's view and RESTRICTED
// material stay held back; the lookup is asked afresh at every read.
describe("the founder's own highly confidential documents (ADR 0079)", () => {
  const ACCOUNTS = "00000000-0000-4000-8000-00000000c009";
  const PASSPORT = "00000000-0000-4000-8000-00000000c00a";
  const MEMBERSHIP = "00000000-0000-4000-8000-0000000000d1";
  const ownRead = { companyId: COMPANY, membershipId: MEMBERSHIP };
  const ownerDoc = (documentId: string, title: string) => ({
    documentId,
    title,
    folderCode: "finance",
    checklistItemCode: null,
    level: "PRIVATE" as const,
    visibilityScope: "organisation_private" as const,
    kind: "PDF",
    pageCount: 2,
    updatedAt: "2026-11-01T00:00:00.000Z",
    validUntil: null,
    sharedWith: 0,
    openedBy: 0,
    version: 1,
  });
  const ownerRoom: DataRoomView = {
    viewer: "OWNER",
    companyId: COMPANY,
    stageCode: "seed",
    countryCode: "GB",
    folders: [{ code: "finance", label: "Finance" }],
    documents: [
      ownerDoc(ACCOUNTS, "Management accounts Oct 2026"),
      ownerDoc(PASSPORT, "Founder passport"),
    ],
    checklist: [],
    requests: [],
  };
  const investorRoom: DataRoomView = {
    viewer: "INVESTOR",
    companyId: COMPANY,
    folders: [{ code: "finance", label: "Finance" }],
    documents: [
      {
        documentId: ACCOUNTS,
        title: "Management accounts Oct 2026",
        folderCode: "finance",
        shownAs: "SHARED" as const,
        access: "OPEN" as const,
        kind: "PDF",
        pageCount: 2,
        updatedAt: "2026-11-01T00:00:00.000Z",
        validUntil: null,
        openedAt: null,
        accessEndsAt: null,
      },
    ],
  };
  const rows = [
    {
      id: ACCOUNTS,
      document_type: "MANAGEMENT_ACCOUNTS",
      sensitivity_class: "HIGHLY_CONFIDENTIAL",
      text: "Cash GBP 388,070 at 31 October 2026",
      page_number: 1,
      page_count: 2,
    },
    {
      id: PASSPORT,
      document_type: "IDENTITY",
      sensitivity_class: "RESTRICTED",
      text: "Passport number X",
      page_number: 1,
      page_count: 1,
    },
  ];
  function own(view: DataRoomView, member: { current: typeof ownRead | null }) {
    const askedFor: string[] = [];
    // A single-document lookup (the pages' classification read names the
    // document) answers that document's row only.
    const fake = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const named = rows.filter((row) => values.includes(row.id));
      return Promise.resolve(named.length === 1 ? named : rows);
    };
    const port = createMaterialDocumentReads({
      sql: fake as unknown as DatabaseExecutor,
      view: () => Promise.resolve(view),
      ownMember: (_actor: ActorContext, companyId: string) => {
        askedFor.push(companyId);
        return Promise.resolve(member.current);
      },
    });
    return { port, askedFor };
  }

  it("lists, reads and pages it for a current member, naming the membership", async () => {
    const { port } = own(ownerRoom, { current: ownRead });
    const documents = await port.documents(actor, COMPANY);
    expect(documents?.[0]).toMatchObject({
      documentId: ACCOUNTS,
      access: "OWNER",
      opening: "Cash GBP 388,070 at 31 October 2026",
      ownCompanyRead: ownRead,
    });
    expect(documents?.[0]?.heldBack).toBeUndefined();
    expect(documents?.[0]?.sharedUnder).toBeUndefined();
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toEqual({
      text: "Cash GBP 388,070 at 31 October 2026",
      truncated: false,
      ownCompanyRead: ownRead,
    });
    expect(
      await port.documentPages(actor, COMPANY, ACCOUNTS, { from: 1, to: 1 }),
    ).toMatchObject({ ownCompanyRead: ownRead });
  });

  it("stays held back without a current membership (another company, an ended one)", async () => {
    const { port } = own(ownerRoom, { current: null });
    expect((await port.documents(actor, COMPANY))?.[0]).toMatchObject({
      heldBack: true,
      opening: null,
    });
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
    expect(
      await port.documentPages(actor, COMPANY, ACCOUNTS, { from: 1, to: 2 }),
    ).toBeNull();
  });

  it("refuses a membership resolved for a different company", async () => {
    const { port } = own(ownerRoom, {
      current: {
        companyId: "00000000-0000-4000-8000-00000000cbbb",
        membershipId: MEMBERSHIP,
      },
    });
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
  });

  it("closes the moment the membership ends, even after it was listed", async () => {
    const member: { current: typeof ownRead | null } = { current: ownRead };
    const { port } = own(ownerRoom, member);
    expect((await port.documents(actor, COMPANY))?.[0]?.ownCompanyRead).toEqual(
      ownRead,
    );
    member.current = null;
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
  });

  it("never unlocks RESTRICTED for the owner", async () => {
    const { port, askedFor } = own(ownerRoom, { current: ownRead });
    expect((await port.documents(actor, COMPANY))?.[1]).toMatchObject({
      documentId: PASSPORT,
      heldBack: true,
      opening: null,
    });
    askedFor.length = 0;
    expect(await port.documentText(actor, COMPANY, PASSPORT)).toBeNull();
    expect(
      await port.documentPages(actor, COMPANY, PASSPORT, { from: 1, to: 1 }),
    ).toBeNull();
    expect(askedFor).toEqual([]);
  });

  it("never reads for an investor's view, without a grant, whatever the member lookup says", async () => {
    const { port, askedFor } = own(investorRoom, { current: ownRead });
    expect((await port.documents(actor, COMPANY))?.[0]).toMatchObject({
      heldBack: true,
    });
    expect(await port.documentText(actor, COMPANY, ACCOUNTS)).toBeNull();
    expect(askedFor).toEqual([]);
  });
});

describe("createOwnCompanyMembership (ADR 0079)", () => {
  const MEMBERSHIP = "00000000-0000-4000-8000-0000000000d1";
  const ORG = "00000000-0000-4000-8000-0000000000e1";
  const member = {
    ...actor,
    organisationId: ORG,
    membershipId: MEMBERSHIP,
  } as ActorContext;

  it("asks for an active membership of the company's own organisation, from the context", async () => {
    const asked: { text: string; values: unknown[] }[] = [];
    const fake = (strings: TemplateStringsArray, ...values: unknown[]) => {
      asked.push({ text: strings.join("?"), values });
      return Promise.resolve([
        { company_id: COMPANY.toUpperCase(), membership_id: MEMBERSHIP },
      ]);
    };
    const lookup = createOwnCompanyMembership(
      fake as unknown as DatabaseExecutor,
    );
    expect(await lookup(member, COMPANY)).toEqual({
      companyId: COMPANY,
      membershipId: MEMBERSHIP,
    });
    expect(asked[0]?.text).toMatch(/membership_status = 'active'/u);
    expect(asked[0]?.text).toMatch(/c\.organisation_id = \?/u);
    expect(asked[0]?.values).toEqual([
      COMPANY,
      actor.tenantId,
      ORG,
      MEMBERSHIP,
      actor.userId,
    ]);
  });

  it("is null with no membership row, and asks nothing without a membership in the context", async () => {
    const asked: unknown[] = [];
    const fake = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      asked.push(values);
      return Promise.resolve([]);
    };
    const lookup = createOwnCompanyMembership(
      fake as unknown as DatabaseExecutor,
    );
    expect(await lookup(member, COMPANY)).toBeNull();
    expect(await lookup(actor, COMPANY)).toBeNull();
    expect(asked.length).toBe(1);
  });
});
