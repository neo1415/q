import { describe, expect, it } from "vitest";

import {
  createFounderDocumentReview,
  PITCH_TRANSCRIPT_SOURCE,
} from "../src/index.js";

/**
 * Lane ob1 + ov (2026-10-16): a stored pitch reading becomes proposals for
 * the founder's profile section steps, after the deck: a section the deck
 * already proposed, or the founder answered, is left alone. No model.
 */

const TENANT = "a0000000-0000-4000-8000-000000000001" as never;
const COMPANY = "c0000000-0000-4000-8000-000000000002";
const SESSION = "e0000000-0000-4000-8000-000000000003";
const READING = "f0000000-0000-4000-8000-000000000004";

function harness(options: {
  readonly sessionId?: string | null;
  readonly answered?: readonly string[];
  readonly pending?: readonly string[];
}) {
  const created: { stepKey: string; value: unknown; sources: unknown }[] = [];
  const review = createFounderDocumentReview({
    sql: {} as never,
    documents: {} as never,
    chunks: {} as never,
    sessions: {
      findById: () =>
        Promise.resolve({
          id: SESSION,
          journeyType: "founder",
          status: "ACTIVE",
          tenantId: TENANT,
          subject: { subjectType: "COMPANY", subjectId: COMPANY },
        }),
    } as never,
    responses: {
      listCurrent: () =>
        Promise.resolve(
          (options.answered ?? []).map((stepKey) => ({ stepKey, value: {} })),
        ),
    } as never,
    suggestions: {
      listPending: () =>
        Promise.resolve(
          (options.pending ?? []).map((stepKey) => ({ stepKey })),
        ),
    } as never,
    createSuggestion: (command) => {
      created.push({
        stepKey: command.stepKey,
        value: command.suggestedValue,
        sources: command.sourceRefs,
      });
      return Promise.resolve({});
    },
    extraction: {
      extract: () => Promise.reject(new Error("no model is called")),
    },
    pitchSections: {
      read: () =>
        Promise.resolve({
          sessionId:
            options.sessionId === undefined ? SESSION : options.sessionId,
          sections: [
            {
              key: "problem",
              facts: [{ label: "Who loses", value: "Clinics lose results." }],
            },
            {
              key: "solution",
              facts: [{ label: "What", value: "A strip reader." }],
            },
            { key: "team", facts: [{ label: "Founders", value: "Two." }] },
            { key: "moats", facts: [] },
          ],
        }),
    },
  });
  return { review, created };
}

const event = { tenantId: TENANT, companyId: COMPANY, readingId: READING };

describe("pitch section readings become founder proposals", () => {
  it("proposes each filled section for its own step, sourced to the pitch", async () => {
    const { review, created } = harness({});
    await review.onPitchSectionsRead(event);
    expect(created.map((c) => c.stepKey).sort()).toEqual([
      "F9.problem",
      "F9.solution",
    ]);
    expect(created[0]?.value).toMatchObject({
      type: "TEXT",
      text: "Who loses: Clinics lose results.",
    });
    expect(created[0]?.sources).toEqual([
      { sourceType: PITCH_TRANSCRIPT_SOURCE, sourceId: READING },
    ]);
  });

  it("the deck comes first: a proposed or answered section is left alone", async () => {
    const { review, created } = harness({
      pending: ["F9.solution"],
      answered: ["F9.problem"],
    });
    await review.onPitchSectionsRead(event);
    expect(created).toEqual([]);
  });

  it("no active founder session: nothing proposed", async () => {
    const { review, created } = harness({ sessionId: null });
    await expect(review.onPitchSectionsRead(event)).resolves.toMatchObject({
      kind: "SKIPPED",
    });
    expect(created).toEqual([]);
  });
});
