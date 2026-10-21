import { describe, expect, it } from "vitest";

import { QRehearsalSummaryDtoSchema } from "@capital-q/contracts";

import { summaryReview } from "../src/composition/rehearsals.js";

/**
 * Work, Rehearsals (chosen design 2026-10-21): each past rehearsal in the
 * list says where its review stands, with the review's own first note
 * each way. Nothing is written that the review does not say.
 */
describe("a rehearsal's review, for the list", () => {
  it("is none when no review was written", () => {
    expect(summaryReview(null)).toEqual({
      state: "NONE",
      wentWell: null,
      workOn: null,
    });
  });

  it("is provisional, with no notes, while Q finishes it", () => {
    expect(
      summaryReview({
        overall: "So far",
        score: null,
        dimensions: [],
        wentRight: [],
        wentWrong: [],
        tips: [],
        provisional: true,
      }),
    ).toEqual({ state: "PROVISIONAL", wentWell: null, workOn: null });
  });

  it("carries the first note each way, word for word", () => {
    const review = summaryReview({
      overall: "Good",
      score: 76,
      dimensions: [],
      wentRight: [{ moment: "Calm on margins.", why: "" }],
      wentWrong: [
        { moment: "Team size only.", why: "", better: "Say what they do." },
      ],
      tips: [],
    });
    expect(review).toEqual({
      state: "READY",
      wentWell: "Calm on margins.",
      workOn: "Team size only.",
    });
    // An older client reading a newer list still parses it.
    expect(
      QRehearsalSummaryDtoSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        counterpart: {
          kind: "COMPANY",
          id: "00000000-0000-4000-8000-000000000002",
          name: "Pellucid",
        },
        status: "FINISHED",
        outcome: null,
        score: 76,
        exchanges: 4,
        createdAt: "2026-10-14T10:00:00.000Z",
        endedAt: "2026-10-14T10:20:00.000Z",
        review,
      }).success,
    ).toBe(true);
  });
});
