import { describe, expect, it } from "vitest";

import type { OnboardingSuggestion } from "../src/contracts/index.js";
import {
  supersededDocumentOffers,
  withSources,
} from "../src/application/superseded-offers.js";

/**
 * Live 25 Oct (run b9-0746): a second deck's "Stage · Seed" sat in the
 * panel beside the first deck's. Their material read again supersedes; a
 * different value is a contradiction and stays.
 */

const DECK_1 = [
  { sourceType: "EVIDENCE_DOCUMENT", sourceId: "doc-1" },
  { sourceType: "EVIDENCE_DOCUMENT_VERSION", sourceId: "ver-1" },
] as const;
const DECK_2 = [
  { sourceType: "EVIDENCE_DOCUMENT", sourceId: "doc-2" },
  { sourceType: "EVIDENCE_DOCUMENT_VERSION", sourceId: "ver-2" },
] as const;

let n = 0;
function offer(
  stepKey: string,
  suggestedValue: OnboardingSuggestion["suggestedValue"],
  sourceRefs: OnboardingSuggestion["sourceRefs"],
  status: OnboardingSuggestion["status"] = "PENDING",
): OnboardingSuggestion {
  n += 1;
  return {
    id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    sessionId: "b0000000-0000-4000-8000-000000000001",
    stepKey,
    targetField: stepKey.toLowerCase(),
    suggestedValue,
    sourceRefs,
    confidence: null,
    status,
    modelRunId: null,
    createdAt: "2026-10-25T07:47:38.000Z",
    resolvedAt: null,
  } as OnboardingSuggestion;
}

const SEED = { type: "SINGLE_SELECT", optionKey: "seed" } as const;
const PRE_SEED = { type: "SINGLE_SELECT", optionKey: "pre_seed" } as const;

describe("a re-read document's offers", () => {
  it("supersede the same value offered from their earlier document", () => {
    const first = offer("F1.stage", SEED, DECK_1);
    const other = offer("F4.team_size", { type: "RANGE", value: "2" }, DECK_1);
    expect(
      supersededDocumentOffers([first, other], {
        stepKey: "F1.stage",
        suggestedValue: { optionKey: "seed", type: "SINGLE_SELECT" },
      }),
    ).toEqual([first]);
  });

  it("leave a different value standing: two documents disagree", () => {
    const first = offer("F1.stage", PRE_SEED, DECK_1);
    expect(
      supersededDocumentOffers([first], {
        stepKey: "F1.stage",
        suggestedValue: SEED,
      }),
    ).toEqual([]);
  });

  it("never touch an offer from Q's research or the conversation", () => {
    const research = offer("F1.stage", SEED, [
      { sourceType: "PUBLIC_WEB", sourceId: "https://example.com" },
    ]);
    const qRecommendation = offer("F1.stage", SEED, [
      { sourceType: "Q_RECOMMENDATION", sourceId: "run-1" },
    ]);
    expect(
      supersededDocumentOffers([research, qRecommendation], {
        stepKey: "F1.stage",
        suggestedValue: SEED,
      }),
    ).toEqual([]);
  });

  it("never reopen one already settled", () => {
    const accepted = offer("F1.stage", SEED, DECK_1, "ACCEPTED");
    expect(
      supersededDocumentOffers([accepted], {
        stepKey: "F1.stage",
        suggestedValue: SEED,
      }),
    ).toEqual([]);
  });
});

describe("the superseding offer's sources", () => {
  it("cite every document, newest first, each once", () => {
    expect(withSources(DECK_2, [...DECK_1, DECK_2[0]])).toEqual([
      ...DECK_2,
      ...DECK_1,
    ]);
  });

  it("stay within the 20 references a suggestion keeps", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      sourceType: "EVIDENCE_DOCUMENT",
      sourceId: `doc-${String(i)}`,
    }));
    const more = Array.from({ length: 15 }, (_, i) => ({
      sourceType: "EVIDENCE_DOCUMENT",
      sourceId: `old-${String(i)}`,
    }));
    const kept = withSources(many, more);
    expect(kept).toHaveLength(20);
    expect(kept[0]?.sourceId).toBe("doc-0");
  });
});
