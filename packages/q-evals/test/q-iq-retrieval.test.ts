import { describe, expect, it } from "vitest";

import {
  measureQIqRetrieval,
  memoryQIqRetrieve,
  neededFactIds,
  qIqUuid,
  Q_IQ_TENANT_ID,
  renderQIqRetrievalReport,
  type QIqStoredChunk,
} from "../src/retrieval/q-iq-retrieval.js";
import { Q_IQ_DATASET } from "../src/datasets/q-iq/index.js";

/**
 * Q intelligence step 5 bar: the share of Q-IQ evidence questions whose
 * needed fact is in the final 8 hits, before (v1: the person's words, fused
 * order) and after (v2: rewritten from the ledger, multi-query, reranked).
 */
describe("Q-IQ retrieval recall at 8 (step 5)", () => {
  const retrieve = memoryQIqRetrieve();

  it("counts evidence questions from the dataset's own expectations", () => {
    const evidence = Q_IQ_DATASET.cases.flatMap((c) =>
      c.turns.filter((turn) => neededFactIds(turn).length > 0),
    );
    expect(evidence.length).toBeGreaterThan(200);
  });

  it("v2 with the reader's binding reaches >= 95% and beats v1", async () => {
    const before = await measureQIqRetrieval(retrieve, "V1_WORDS");
    const ledgerOnly = await measureQIqRetrieval(retrieve, "V2_LEDGER");
    const after = await measureQIqRetrieval(retrieve, "V2_READER");
    console.log(
      [before, ledgerOnly, after].map(renderQIqRetrievalReport).join("\n"),
    );
    expect(after.share).toBeGreaterThanOrEqual(0.95);
    expect(after.share).toBeGreaterThan(before.share);
    expect(ledgerOnly.share).toBeGreaterThan(before.share);
  });
});

/**
 * Live 2026-11-06: "How many borrowers does it have, and what's its loan
 * book?" after "What does Ledgerfold do?". Retrieval's half of the
 * question: with "it" bound to Ledgerfold, each part's chunk (borrowers,
 * loan book) reaches the final 8 hits among a dozen Ledgerfold chunks that
 * share their words, and another lender's borrower count does not crowd
 * them out.
 */
describe("compound pronoun follow-up: each part reaches the final hits", () => {
  const LEDGERFOLD = qIqUuid("live:ledgerfold");
  const OTHER = qIqUuid("live:other-lender");
  const stored = (
    key: string,
    subjectId: string,
    content: string,
    factId: string | null,
  ): QIqStoredChunk => ({
    chunkId: qIqUuid(`live:chunk:${key}`),
    subjectId,
    documentId: qIqUuid(`live:doc:${subjectId}`),
    documentTitle: "Pitch deck",
    content,
    factId,
    tenantId: Q_IQ_TENANT_ID,
    visibilityScope: "network_visible",
    sensitivityClass: "NETWORK_VISIBLE",
  });
  const chunks: QIqStoredChunk[] = [
    stored(
      "borrowers",
      LEDGERFOLD,
      "Traction. Ledgerfold has 2,150 active borrowers across Nairobi.",
      "borrowers",
    ),
    stored(
      "loan-book",
      LEDGERFOLD,
      "Portfolio. Ledgerfold's loan book is USD 410,000, up from USD 150,000; PAR30 is 3.8%.",
      "loan-book",
    ),
    ...Array.from({ length: 12 }, (_, at) =>
      stored(
        `noise-${String(at)}`,
        LEDGERFOLD,
        `Ledgerfold slide ${String(at)}: how we lend, how many retailers we reach and what the book of business looks like.`,
        null,
      ),
    ),
    stored(
      "other-borrowers",
      OTHER,
      "Traction. Another lender has 9,800 borrowers and a loan book of USD 2M.",
      null,
    ),
  ];
  const ledger = {
    entities: [
      {
        ref: "E1",
        kind: "COMPANY" as const,
        id: LEDGERFOLD,
        name: "Ledgerfold",
        firstTurn: 1,
        lastTurn: 2,
        via: ["SAID_BY_THEM" as const],
        of: null,
        value: null,
      },
    ],
    lists: [],
  };

  it("v2 brings both the borrowers and the loan-book chunk", async () => {
    const hits = await memoryQIqRetrieve(chunks)({
      mode: "V2_READER",
      words: "How many borrowers does it have, and what's its loan book?",
      previousWords: ["What does Ledgerfold do?"],
      focus: { ledger, boundRefs: ["E1"] },
    });
    expect(hits).toContain("borrowers");
    expect(hits).toContain("loan-book");
  });
});
