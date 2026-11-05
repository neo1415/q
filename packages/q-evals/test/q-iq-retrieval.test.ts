import { describe, expect, it } from "vitest";

import {
  measureQIqRetrieval,
  memoryQIqRetrieve,
  neededFactIds,
  renderQIqRetrievalReport,
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
