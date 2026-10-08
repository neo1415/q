import { describe, expect, it } from "vitest";

import type {
  AssumptionBoardDto,
  AssumptionDto,
  InvestorQuestion,
} from "@capital-q/contracts";

import { withAskedQuestions } from "../src/index.js";

/**
 * Founder documents (2026-10-08): the investor's own questions on the
 * board. An answer is the founder's claim: unknown becomes claimed, a
 * document makes it evidenced; nothing moves down; truth class stays
 * USER_CLAIM; unanswered shows as waiting.
 */

const COMPANY = "00000000-0000-4000-8000-00000000b001";

const assumption = (
  id: string,
  standing: AssumptionDto["standing"],
): AssumptionDto => ({
  id,
  sectionLabel: "Traction",
  label: id,
  value: standing === "UNKNOWN" ? null : "140 SMEs",
  standing,
  truthClass: standing === "UNKNOWN" ? null : "USER_CLAIM",
  evidenceStatus:
    standing === "UNKNOWN"
      ? null
      : standing === "EVIDENCED"
        ? "DOCUMENT_SUPPORTED"
        : "SELF_REPORTED",
  unknownReason: standing === "UNKNOWN" ? "NOT_IN_DECK" : null,
  source: null,
  restsOn: [],
  question: "How many paid?",
});

const board = (assumptions: AssumptionDto[]): AssumptionBoardDto => ({
  companyId: COMPANY,
  basis: "CONFIRMED_DECK_READING",
  readAt: "2026-10-01T09:00:00.000Z",
  assumptions,
  counts: {
    evidenced: assumptions.filter((a) => a.standing === "EVIDENCED").length,
    claimed: assumptions.filter((a) => a.standing === "CLAIMED").length,
    unknown: assumptions.filter((a) => a.standing === "UNKNOWN").length,
  },
});

const question = (
  n: number,
  assumptionId: string | null,
  answer: InvestorQuestion["answer"],
): InvestorQuestion => ({
  questionId: `00000000-0000-4000-8000-00000000b1${String(10 + n)}`,
  position: 1,
  question: "How many paid?",
  assumptionId,
  assumptionLabel: null,
  askedAt: `2026-10-0${String(n)}T09:00:00.000Z`,
  answer,
});

const answer = (
  status: "SELF_REPORTED" | "DOCUMENT_SUPPORTED",
): NonNullable<InvestorQuestion["answer"]> => ({
  answerId: "00000000-0000-4000-8000-00000000b201",
  text: "131 paid in September.",
  answeredAt: "2026-10-07T09:00:00.000Z",
  truthClass: "USER_CLAIM",
  evidenceStatus: status,
  documents:
    status === "DOCUMENT_SUPPORTED"
      ? [
          {
            documentId: "00000000-0000-4000-8000-00000000b301",
            title: "Export",
          },
        ]
      : [],
});

describe("the board with the investor's own questions", () => {
  it("shows a question waiting, and changes nothing else", () => {
    const out = withAskedQuestions(
      board([assumption("TRACTION:1", "UNKNOWN")]),
      [question(5, "TRACTION:1", null)],
    );
    expect(out.assumptions[0]?.standing).toBe("UNKNOWN");
    expect(out.assumptions[0]?.asked?.answer).toBeNull();
  });

  it("an answer makes an unknown claimed; a document makes a claim evidenced; truth class stays USER_CLAIM", () => {
    const out = withAskedQuestions(
      board([
        assumption("TRACTION:1", "UNKNOWN"),
        assumption("TRACTION:2", "CLAIMED"),
      ]),
      [
        question(5, "TRACTION:1", answer("SELF_REPORTED")),
        question(6, "TRACTION:2", answer("DOCUMENT_SUPPORTED")),
      ],
    );
    expect(out.assumptions.map((a) => a.standing)).toEqual([
      "CLAIMED",
      "EVIDENCED",
    ]);
    expect(out.assumptions.every((a) => a.truthClass === "USER_CLAIM")).toBe(
      true,
    );
    expect(out.assumptions[0]?.unknownReason).toBeNull();
    expect(out.counts).toEqual({ evidenced: 1, claimed: 1, unknown: 0 });
  });

  it("never moves anything down, and ignores questions about nothing on the board", () => {
    const out = withAskedQuestions(
      board([assumption("TRACTION:1", "EVIDENCED")]),
      [
        question(5, "TRACTION:1", answer("SELF_REPORTED")),
        question(6, null, answer("SELF_REPORTED")),
      ],
    );
    expect(out.assumptions[0]?.standing).toBe("EVIDENCED");
    expect(out.assumptions[0]?.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
  });

  it("keeps the answered question when a newer one waits", () => {
    const out = withAskedQuestions(
      board([assumption("TRACTION:1", "UNKNOWN")]),
      [
        question(4, "TRACTION:1", answer("SELF_REPORTED")),
        question(6, "TRACTION:1", null),
      ],
    );
    expect(out.assumptions[0]?.standing).toBe("CLAIMED");
  });
});
