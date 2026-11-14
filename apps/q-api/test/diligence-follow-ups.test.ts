import { describe, expect, it } from "vitest";

import type { DiligenceView } from "@capital-q/permissions";

import { diligenceFollowUps } from "../src/composition/diligence-follow-ups.js";

/**
 * Addendum "resolving investor uncertainty" (14 Nov 2026, slices 5-6): the
 * requests that named the uncertainty they resolve, with what came back,
 * from the diligence service's own per-party view.
 */
const view = (requests: DiligenceView["requests"]): DiligenceView => ({
  relationshipId: "88888888-0000-4000-8000-000000000007",
  side: "INVESTOR",
  open: true,
  shares: [
    {
      policyId: "70000000-0000-4000-8000-000000000001",
      documentId: "60000000-0000-4000-8000-000000000001",
      title: "Bank statement Oct 2026.pdf",
      documentType: "FINANCIALS",
      sharedAt: "2026-11-15T08:30:00.000Z",
      scanned: true,
      viewedAt: null,
      qSummary: "Receipts of about USD 41,800 across October 2026.",
    },
  ],
  requests,
});

const request = (
  overrides: Partial<DiligenceView["requests"][number]>,
): DiligenceView["requests"][number] => ({
  requestId: "50000000-0000-4000-8000-000000000001",
  title: "October 2026 bank statements",
  note: null,
  requestedAt: "2026-11-14T10:00:00.000Z",
  requestedByName: "Savanna Seed (fictional)",
  status: "OPEN",
  declineNote: null,
  fulfilledBy: null,
  fulfilledAt: null,
  about: null,
  questions: null,
  ...overrides,
});

describe("diligence follow-ups for the re-assessment note", () => {
  it("lists only requests that named an uncertainty, with the shared document and Q's summary of it", () => {
    const out = diligenceFollowUps(
      view([
        request({
          title: "Pitch deck",
          requestId: "50000000-0000-4000-8000-000000000002",
        }),
        request({
          status: "FULFILLED",
          fulfilledBy: {
            documentId: "60000000-0000-4000-8000-000000000001",
            title: "Bank statement Oct 2026.pdf",
          },
          fulfilledAt: "2026-11-15T08:30:00.000Z",
          about: {
            statement: "October MRR rests on the founder's word only.",
            standing: "FOUNDER_CONFIRMED",
          },
        }),
      ]),
    );
    expect(out).toEqual([
      {
        title: "October 2026 bank statements",
        about: {
          statement: "October MRR rests on the founder's word only.",
          standing: "FOUNDER_CONFIRMED",
        },
        status: "FULFILLED",
        requestedAt: "2026-11-14T10:00:00.000Z",
        fulfilledAt: "2026-11-15T08:30:00.000Z",
        document: {
          title: "Bank statement Oct 2026.pdf",
          summary: "Receipts of about USD 41,800 across October 2026.",
        },
        answers: [],
        declineNote: null,
      },
    ]);
  });

  it("carries each answer's evidence status and date, never the answer's text", () => {
    const [one] = diligenceFollowUps(
      view([
        request({
          about: { statement: "Churn is unknown.", standing: "REPORTED" },
          questions: [
            {
              questionId: "40000000-0000-4000-8000-000000000001",
              question: "What is monthly churn?",
              assumptionId: null,
              assumptionLabel: null,
              answer: {
                text: "About 2% a month (private detail).",
                answeredAt: "2026-11-16T09:00:00.000Z",
                truthClass: "USER_CLAIM",
                evidenceStatus: "SELF_REPORTED",
              },
            },
          ],
        }),
      ]),
    );
    expect(one?.answers).toEqual([
      {
        answeredAt: "2026-11-16T09:00:00.000Z",
        evidenceStatus: "SELF_REPORTED",
      },
    ]);
    expect(JSON.stringify(one)).not.toContain("private detail");
  });
});
