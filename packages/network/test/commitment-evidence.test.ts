import type { ActorContext } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  amountMismatch,
  commitmentEvidenceStatus,
  commitmentReviewFlags,
  countsTowardFee,
  createCommitmentService,
} from "../src/index.js";

/**
 * S9 (meetings design R11, 2026-11-18): a commitment's corroboration grade
 * is kept apart from its status, raised only by the other side's
 * independent word or a document, and a disagreement goes to the admin's
 * review queue without changing either side's facts.
 */
const base = {
  transferSentAt: null,
  transferReference: null,
  evidenceDocumentId: null,
};

describe("the corroboration grade", () => {
  it("is one side's word until the other side confirms", () => {
    for (const status of ["DETECTED", "ADOPTED", "STATED", "DISPUTED"]) {
      expect(commitmentEvidenceStatus({ ...base, status })).toBe(
        "SELF_REPORTED",
      );
    }
    expect(commitmentEvidenceStatus({ ...base, status: "CONFIRMED" })).toBe(
      "MULTI_SOURCE_SUPPORTED",
    );
  });

  it("keeps 'sent' as the investor's word, and receipt as both only with a sent reference", () => {
    const sent = {
      ...base,
      status: "TRANSFER_SENT",
      transferSentAt: new Date("2026-11-25T10:00:00Z"),
      transferReference: "UETR 9b2",
    };
    expect(commitmentEvidenceStatus(sent)).toBe("SELF_REPORTED");
    expect(commitmentEvidenceStatus({ ...sent, status: "RECEIVED" })).toBe(
      "MULTI_SOURCE_SUPPORTED",
    );
    // Sent with no reference: nothing to match the receipt by.
    expect(
      commitmentEvidenceStatus({
        ...sent,
        status: "RECEIVED",
        transferReference: "  ",
      }),
    ).toBe("SELF_REPORTED");
  });

  it("is raised by a document, never to verified", () => {
    const documented = {
      ...base,
      status: "TRANSFER_SENT",
      evidenceDocumentId: "00000000-0000-4000-8000-0000000000d1",
    };
    expect(commitmentEvidenceStatus(documented)).toBe("DOCUMENT_SUPPORTED");
    expect(countsTowardFee("DOCUMENT_SUPPORTED")).toBe(false);
    expect(countsTowardFee("SELF_REPORTED")).toBe(false);
    expect(countsTowardFee("MULTI_SOURCE_SUPPORTED")).toBe(true);
  });

  it("flags money received that was never sent, unless a document backs it", () => {
    expect(
      commitmentReviewFlags({ ...base, status: "RECEIVED" }).map(
        (f) => f.reason,
      ),
    ).toEqual(["RECEIVED_WITHOUT_SENT"]);
    expect(
      commitmentReviewFlags({
        ...base,
        status: "RECEIVED",
        evidenceDocumentId: "00000000-0000-4000-8000-0000000000d1",
      }),
    ).toEqual([]);
    expect(commitmentReviewFlags({ ...base, status: "CONFIRMED" })).toEqual([]);
  });

  it("compares a changed amount exactly, by currency too", () => {
    const stated = { amount: "250000", currencyCode: "USD" };
    expect(
      amountMismatch(stated, { amount: "250000.00", currencyCode: "USD" }),
    ).toBeNull();
    expect(
      amountMismatch(stated, { amount: "200000", currencyCode: "USD" }),
    ).toContain("Both stand until the other side agrees.");
    expect(
      amountMismatch(stated, { amount: "250000", currencyCode: "EUR" }),
    ).not.toBeNull();
  });
});

// --- The service: a note is appended; a mismatch is flagged, never applied.

type Query = { readonly text: string; readonly values: readonly unknown[] };

function fakeSql(queries: Query[], answer: (text: string) => unknown[]) {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push({ text, values });
    return Promise.resolve(answer(text));
  };
  return Object.assign(sql, { json: (value: unknown) => value });
}

const ACTOR = {
  tenantId: "00000000-0000-4000-8000-0000000000a0",
  userId: "00000000-0000-4000-8000-0000000000a1",
} as unknown as ActorContext;
const COMMITMENT = "00000000-0000-4000-8000-0000000000c1";
const RELATIONSHIP = "00000000-0000-4000-8000-0000000000e1";

function serviceWith(side: "COMPANY" | "INVESTOR", queries: Query[]) {
  const answer = (text: string): unknown[] => {
    if (
      text.includes("from network.commitments") &&
      text.includes("evidence_status, evidence_document_id")
    ) {
      return [
        {
          id: COMMITMENT,
          relationship_id: RELATIONSHIP,
          amount: "250000",
          currency_code: "USD",
          level: "SOFT",
          status: "STATED",
          stated_by_side: "INVESTOR",
          transfer_sent_at: null,
          transfer_reference: null,
          evidence_document_id: null,
          evidence_status: "SELF_REPORTED",
        },
      ];
    }
    if (text.includes("insert into network.commitment_notes")) {
      return [{ id: "00000000-0000-4000-8000-0000000000f1" }];
    }
    if (text.includes("select status, relationship_id")) {
      return [
        {
          status: "STATED",
          relationship_id: RELATIONSHIP,
          transfer_sent_at: null,
          transfer_reference: null,
          evidence_document_id: null,
          evidence_status: "SELF_REPORTED",
        },
      ];
    }
    return [];
  };
  const sql = fakeSql(queries, answer);
  const appended: string[] = [];
  const service = createCommitmentService({
    sql: sql as never,
    transactions: {
      run: (work: (tx: { sql: typeof sql }) => Promise<unknown>) =>
        work({ sql }),
    } as never,
    interests: {
      relationshipById: () =>
        Promise.resolve({
          side,
          status: {
            projection: { state: "IN_DILIGENCE" },
            relationship: { tenantId: ACTOR.tenantId },
          },
        }),
    } as never,
    appender: {
      append: (_tx: unknown, event: { eventType: string }) => {
        appended.push(event.eventType);
        return Promise.resolve();
      },
    } as never,
    newCorrelationId: () => "cor_test",
  });
  return { service, appended };
}

describe("commitment notes (S9)", () => {
  it("appends a change, flags the mismatch for review and leaves the stated amount alone", async () => {
    const queries: Query[] = [];
    const { service, appended } = serviceWith("COMPANY", queries);
    const out = await service.addNote(
      ACTOR,
      COMMITMENT,
      {
        kind: "CHANGE",
        body: "We agreed 200,000 on the call.",
        proposed: { amount: "200000", currencyCode: "USD" },
      },
      "note-change-0001",
    );
    expect(out).toEqual({
      outcome: "OK",
      value: { noteId: "00000000-0000-4000-8000-0000000000f1", flagged: true },
    });
    expect(
      queries.some((q) =>
        q.text.includes("insert into network.commitment_review_flags"),
      ),
    ).toBe(true);
    // Neither side's facts change: no update to the amount or status.
    expect(
      queries.some((q) =>
        /update network\.commitments\s+set (?:amount|status)/u.test(q.text),
      ),
    ).toBe(false);
    expect(appended).toEqual(["commitment_note_added"]);
  });

  it("refuses a document from the investor's side, and a change with no amount", async () => {
    const { service } = serviceWith("INVESTOR", []);
    expect(
      await service.addNote(
        ACTOR,
        COMMITMENT,
        {
          kind: "EVIDENCE",
          body: "Wire receipt",
          documentId: "00000000-0000-4000-8000-0000000000d1",
        },
        "note-evidence-0001",
      ),
    ).toEqual({ outcome: "REFUSED", code: "NOT_ALLOWED" });
    expect(
      await service.addNote(
        ACTOR,
        COMMITMENT,
        { kind: "CHANGE", body: "Different" },
        "note-change-0002",
      ),
    ).toEqual({ outcome: "REFUSED", code: "NOT_ALLOWED" });
  });

  it("does not accept a document that is not the relationship company's", async () => {
    const { service } = serviceWith("COMPANY", []);
    expect(
      await service.addNote(
        ACTOR,
        COMMITMENT,
        {
          kind: "EVIDENCE",
          body: "Someone else's file",
          documentId: "00000000-0000-4000-8000-0000000000d9",
        },
        "note-evidence-0002",
      ),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
  });
});
