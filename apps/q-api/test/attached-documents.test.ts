import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  bestByName,
  createAttachedDocumentReads,
} from "../src/composition/attached-documents.js";

/**
 * Lane 8: a document attached to Q is authorised by Evidence as the
 * person first; only then are its pages read, kept to that document, its
 * current version and the person's own tenant.
 */

const TENANT_A = "a0000000-0000-4000-8000-000000000001";
const TENANT_B = "b0000000-0000-4000-8000-000000000001";
const DOC = "d0000000-0000-4000-8000-000000000001";
const VERSION = "e0000000-0000-4000-8000-000000000001";

const actorA = { tenantId: TENANT_A, userId: "u-a" } as ActorContext;
const actorB = { tenantId: TENANT_B, userId: "u-b" } as ActorContext;

type Version = {
  id: string;
  originalFilename: string;
  mimeType: string;
  uploadedAt: string;
  processingStatus: string;
  malwareScanStatus: string;
  textExtractionStatus: string;
};

const version = (overrides: Partial<Version> = {}): Version => ({
  id: VERSION,
  originalFilename: "term-sheet.pdf",
  mimeType: "application/pdf",
  uploadedAt: "2026-10-22T09:00:00.000Z",
  processingStatus: "COMPLETED",
  malwareScanStatus: "CLEAN",
  textExtractionStatus: "COMPLETED",
  ...overrides,
});

const held = (v: Version | null = version(), title = "Term sheet") => ({
  document: { id: DOC, title, status: "ACTIVE" },
  currentVersion: v,
});

/** A fake executor: records each query's bound values, answers in turn. */
function fakeSql(answers: unknown[][]): {
  sql: DatabaseExecutor;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    return Promise.resolve(answers.shift() ?? []);
  }) as unknown as DatabaseExecutor;
  return { sql, calls };
}

/** Evidence as tenant A's only: anyone else is refused, like a typo. */
const evidenceOf =
  (states: (Version | null)[]) => (actor: ActorContext, documentId: string) => {
    if (actor.tenantId !== TENANT_A || documentId !== DOC) {
      return Promise.reject(new Error("DOCUMENT_NOT_FOUND"));
    }
    const next = states.length > 1 ? states.shift() : states[0];
    return Promise.resolve(held(next ?? null));
  };

describe("attached document reads", () => {
  it("reads a short document whole, as the person, in their tenant", async () => {
    const { sql, calls } = fakeSql([
      [
        { page_number: 1, text: "Valuation $8m.", chars: 14, rank: 0 },
        { page_number: 2, text: "Pro-rata rights.", chars: 16, rank: 0 },
      ],
    ]);
    const reads = createAttachedDocumentReads({
      sql,
      get: evidenceOf([version()]),
      list: () => Promise.resolve([]),
    });
    const out = await reads.read(actorA, { documentId: DOC });
    expect(out?.document).toMatchObject({
      state: "READ",
      title: "Term sheet",
      whole: true,
      pageCount: 2,
      pages: [
        { page: 1, text: "Valuation $8m." },
        { page: 2, text: "Pro-rata rights." },
      ],
    });
    // The privileged read is kept to their tenant, that document, that version.
    expect(calls[0]?.slice(0, 3)).toEqual([TENANT_A, DOC, VERSION]);
  });

  // Stress 2026-10-28 (item 2): management accounts are HIGHLY_CONFIDENTIAL,
  // outside every firewall plan; their pages never reach a model.
  it("never reads a highly confidential document's pages, and says why", async () => {
    const { sql, calls } = fakeSql([]);
    const reads = createAttachedDocumentReads({
      sql,
      get: () =>
        Promise.resolve({
          document: {
            id: DOC,
            title: "LedgerBridge financial report Sept 2026",
            status: "ACTIVE",
            sensitivityClass: "HIGHLY_CONFIDENTIAL",
          },
          currentVersion: version(),
        }),
      list: () => Promise.resolve([]),
    });
    const out = await reads.read(actorA, { documentId: DOC });
    expect(out?.document).toMatchObject({
      state: "UNREADABLE",
      reason: expect.stringMatching(/highly confidential/u) as unknown,
    });
    expect(calls).toHaveLength(0);
  });

  it("another tenant's person gets nothing, and no page is read", async () => {
    const { sql, calls } = fakeSql([]);
    const reads = createAttachedDocumentReads({
      sql,
      get: evidenceOf([version()]),
      list: () => Promise.resolve([]),
    });
    const out = await reads.read(actorB, { documentId: DOC });
    expect(out).toEqual({ document: null, others: [] });
    expect(calls).toHaveLength(0);
  });

  it("waits, bounded, for a file still being read", async () => {
    const { sql } = fakeSql([
      [{ page_number: 1, text: "Hello.", chars: 6, rank: 0 }],
    ]);
    let clock = 0;
    const reads = createAttachedDocumentReads({
      sql,
      get: evidenceOf([
        version({ processingStatus: "QUEUED" }),
        version({ processingStatus: "PROCESSING" }),
        version(),
      ]),
      list: () => Promise.resolve([]),
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    const out = await reads.read(actorA, { documentId: DOC });
    expect(out?.document).toMatchObject({ state: "READ" });
    expect(clock).toBe(800);
  });

  it("says it is still reading past the bound, rather than answering from nothing", async () => {
    let clock = 0;
    const reads = createAttachedDocumentReads({
      sql: fakeSql([]).sql,
      get: evidenceOf([version({ processingStatus: "PROCESSING" })]),
      list: () => Promise.resolve([]),
      waitMs: 1_000,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    const out = await reads.read(actorA, { documentId: DOC });
    expect(out?.document).toMatchObject({ state: "READING" });
  });

  it("access revoked while it waits: nothing", async () => {
    let calls = 0;
    const reads = createAttachedDocumentReads({
      sql: fakeSql([]).sql,
      get: () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(held(version({ processingStatus: "QUEUED" })))
          : Promise.reject(new Error("FORBIDDEN"));
      },
      list: () => Promise.resolve([]),
      sleep: () => Promise.resolve(),
    });
    expect((await reads.read(actorA, { documentId: DOC }))?.document).toBe(
      null,
    );
  });

  it("an image is unreadable, said plainly, without waiting", async () => {
    let slept = 0;
    const reads = createAttachedDocumentReads({
      sql: fakeSql([]).sql,
      get: evidenceOf([
        version({ mimeType: "image/png", processingStatus: "QUEUED" }),
      ]),
      list: () => Promise.resolve([]),
      sleep: () => {
        slept += 1;
        return Promise.resolve();
      },
    });
    const out = await reads.read(actorA, { documentId: DOC });
    expect(out?.document).toMatchObject({
      state: "UNREADABLE",
      reason: expect.stringContaining("image") as unknown,
    });
    expect(slept).toBe(0);
  });

  it("a long document: its opening and the pages that answer the question", async () => {
    const long = "x".repeat(3_000);
    const rows = Array.from({ length: 10 }, (_, index) => ({
      page_number: index + 1,
      text: long,
      chars: long.length,
      rank: index + 1 === 7 ? 0.5 : 0,
    }));
    const { sql, calls } = fakeSql([rows]);
    const reads = createAttachedDocumentReads({
      sql,
      get: evidenceOf([version()]),
      list: () => Promise.resolve([]),
    });
    const out = await reads.read(actorA, {
      documentId: DOC,
      question: "what is the liquidation preference?",
    });
    const document = out?.document;
    if (document?.state !== "READ") throw new Error("not read");
    expect(document.whole).toBe(false);
    expect(document.pages.map((page) => page.page)).toEqual([1, 2, 7]);
    expect(calls[0]).toContain("what is the liquidation preference?");
  });

  it("finds one sent earlier by its name, else their latest", async () => {
    const contract = {
      document: { id: DOC, title: "Supplier contract", status: "ACTIVE" },
      currentVersion: version({
        originalFilename: "acme-contract.docx",
        uploadedAt: "2026-10-01T09:00:00.000Z",
      }),
    };
    const deck = {
      document: {
        id: "d0000000-0000-4000-8000-000000000002",
        title: "Deck",
        status: "ACTIVE",
      },
      currentVersion: version({ uploadedAt: "2026-10-21T09:00:00.000Z" }),
    };
    expect(bestByName([deck, contract], "that contract")?.document.title).toBe(
      "Supplier contract",
    );
    const reads = createAttachedDocumentReads({
      sql: fakeSql([
        [{ page_number: 1, text: "Deck text.", chars: 10, rank: 0 }],
      ]).sql,
      get: () => Promise.reject(new Error("unused")),
      list: () => Promise.resolve([contract, deck]),
    });
    const latest = await reads.read(actorA, {});
    expect(latest?.document?.title).toBe("Deck");
    expect(latest?.others.map((other) => other.title)).toEqual([
      "Supplier contract",
    ]);
  });
});
