import { describe, expect, it } from "vitest";

import type { DataRoomView } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createMaterialDocumentReads } from "../src/composition/material-documents.js";

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
