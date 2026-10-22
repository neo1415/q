import { describe, expect, it } from "vitest";

import {
  OPENAI_TE3_SMALL_1024_CONFIGURATION,
  type EmbeddingProvider,
} from "@capital-q/q-embeddings";
import {
  QA_BANK,
  QA_VECTORS_FORMAT,
  encodeQaVector,
  qaBankContentHash,
  qaWordings,
  type QaVectorsFile,
} from "@capital-q/q-pitch";

import {
  createQPitchQaMatcher,
  loadQPitchQaVectors,
} from "../src/composition/q-pitch-qa.js";

const DIMENSION = 64;
/** Each entry on its own direction; the question vector is chosen per test. */
const direction = (i: number) =>
  Array.from({ length: DIMENSION }, (_, j) => (j === i % DIMENSION ? 1 : 0));

const file: QaVectorsFile = {
  format: QA_VECTORS_FORMAT,
  configurationVersion: "test",
  modelCode: OPENAI_TE3_SMALL_1024_CONFIGURATION.modelCode,
  dimension: DIMENSION,
  contentHash: qaBankContentHash(),
  createdAt: "2026-10-22T00:00:00Z",
  thresholds: { answer: 0.9, margin: 0.1, clarifyFloor: 0.6 },
  calibration: {},
  entries: QA_BANK.map((e, i) => ({
    id: e.id,
    vectors: qaWordings(e).map(() => encodeQaVector(direction(i))),
  })),
};

const indexOf = (id: string) => QA_BANK.findIndex((e) => e.id === id);

function fakeProvider(
  vector: () => readonly number[],
  calls: { count: number },
): EmbeddingProvider {
  return {
    code: "openai",
    describe: () => ({
      providerCode: "openai",
      configuration: OPENAI_TE3_SMALL_1024_CONFIGURATION,
      endpoint: null,
    }),
    embedDocuments: async ({ inputs }) => {
      calls.count += 1;
      const v = vector();
      return {
        batchSize: inputs.length,
        latencyMs: 1,
        embeddings: inputs.map(() => ({
          vector: v,
          dimension: v.length,
          providerCode: "openai",
          modelCode: OPENAI_TE3_SMALL_1024_CONFIGURATION.modelCode,
          modelRevision: null,
          configurationVersion: "test",
          instructionVersion: "none",
          inputSha256: "0".repeat(64),
          inputCharacters: 1,
          latencyMs: 1,
        })),
      };
    },
    embedQuery: () => Promise.reject(new Error("not used")),
    health: () => Promise.reject(new Error("not used")),
  };
}

const ready = loadQPitchQaVectors(() => file);

describe("Q Story spoken questions: tier 1, then tier 2", () => {
  it("answers a confident word match without calling the provider", async () => {
    const calls = { count: 0 };
    const match = createQPitchQaMatcher({
      vectors: ready,
      provider: fakeProvider(() => direction(0), calls),
    });
    const decided = await match({
      text: "How do you make money?",
      side: "INVESTOR",
    });
    expect(decided).toMatchObject({
      kind: "ANSWER",
      entryId: "qa.business-model",
      tier: 1,
    });
    expect(calls.count).toBe(0);
  });

  it("asks tier 2 when tier 1 is not sure, and answers by meaning", async () => {
    const calls = { count: 0 };
    const target = indexOf("qa.data-location");
    const match = createQPitchQaMatcher({
      vectors: ready,
      provider: fakeProvider(() => direction(target), calls),
    });
    const decided = await match({
      text: "so where physically does all of it sit",
      side: "INVESTOR",
    });
    expect(calls.count).toBe(1);
    expect(decided).toMatchObject({
      kind: "ANSWER",
      entryId: "qa.data-location",
      tier: 2,
    });
  });

  it("leaves tier 1's decision when the provider fails", async () => {
    const failing = fakeProvider(() => direction(0), { count: 0 });
    const match = createQPitchQaMatcher({
      vectors: ready,
      provider: {
        ...failing,
        embedDocuments: () => Promise.reject(new Error("unavailable")),
      },
    });
    const decided = await match({
      text: "what's the weather in lagos tomorrow",
      side: "INVESTOR",
    });
    expect(decided).toMatchObject({ kind: "LEAVE_TO_Q", tier: 1 });
  });

  it("keeps tier 2 off without current vectors or the same model", async () => {
    const calls = { count: 0 };
    const provider = fakeProvider(() => direction(0), calls);
    const question = {
      text: "so where physically does all of it sit",
      side: "INVESTOR",
    } as const;
    for (const vectors of [
      loadQPitchQaVectors(() => {
        throw new Error("no file");
      }),
      loadQPitchQaVectors(() => ({ ...file, contentHash: "0".repeat(16) })),
      loadQPitchQaVectors(() => ({ ...file, modelCode: "another-model" })),
    ]) {
      const decided = await createQPitchQaMatcher({ vectors, provider })(
        question,
      );
      expect(decided.tier).toBe(1);
    }
    expect(calls.count).toBe(0);
    expect(
      await createQPitchQaMatcher({ vectors: ready, provider: undefined })(
        question,
      ),
    ).toMatchObject({ tier: 1 });
  });
});
