import { describe, expect, it } from "vitest";

import { answerPdfOffered } from "../src/features/documents/answer-pdf";
import { followWork, type QTurn } from "../src/features/q/conversation";

/**
 * Owner 2026-10-24: a lone "PDF" sat under every reply, a working card's
 * included. Only an answer that is a document offers one.
 */
const prose = (length: number) =>
  "The market is fragmented and price-led. ".repeat(40).slice(0, length);

describe("which answers offer a PDF", () => {
  it("never a short reply, a working card, or an answer whose document card has its own PDF", () => {
    expect(answerPdfOffered({ text: prose(400), blockKinds: [] })).toBe(false);
    expect(
      answerPdfOffered({
        text: prose(1_500),
        blockKinds: ["WORK_IN_PROGRESS"],
      }),
    ).toBe(false);
    expect(
      answerPdfOffered({
        text: prose(1_500),
        blockKinds: ["ARTIFACT_REFERENCE"],
      }),
    ).toBe(false);
  });

  it("a long analytic answer, or a shorter one laid out with headings or a list", () => {
    expect(answerPdfOffered({ text: prose(1_300), blockKinds: [] })).toBe(true);
    const structured = `## Where it stands\n${prose(620)}\n\n1. Validate kiosk margins\n2. Secure site approvals`;
    expect(answerPdfOffered({ text: structured, blockKinds: [] })).toBe(true);
    expect(answerPdfOffered({ text: prose(700), blockKinds: [] })).toBe(false);
  });

  it("a delivery whose card is the earlier one that followed the work is still a document's delivery", () => {
    const jobId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
    const work = { kind: "WORK_IN_PROGRESS", jobId, title: "Plan" } as const;
    const document = {
      kind: "ARTIFACT_REFERENCE",
      artifactId: "11111111-1111-4111-8111-111111111111",
      type: "ANALYSIS",
      status: "READY",
      title: "Plan",
    } as never;
    const turn = (id: string, blocks: readonly never[]): QTurn => ({
      kind: "Q",
      id,
      text: prose(1_300),
      streaming: false,
      sourceCount: 0,
      publicSources: [],
      findings: [],
      uncertainties: [],
      blocks,
    });
    const turns = [
      turn("start", [work as never]),
      turn("delivery", [document, work as never]),
    ];
    followWork(turns);
    const delivery = turns[1];
    expect(delivery?.kind === "Q" && delivery.deliversDocument).toBe(true);
    expect(delivery?.kind === "Q" ? delivery.blocks : null).toEqual([]);
  });
});
