import { describe, expect, it } from "vitest";

import {
  boardTimeline,
  cutAtWord,
  proposalOutcome,
  type BoardDecision,
} from "../src/features/q/board-timeline";
import type { QTurn, QTurnObjectBlock } from "../src/features/q/conversation";

/**
 * The Board's entry for a change Q prepared says what the thread says
 * (live run 2026-10-28: the thread said "Saved." while the Board still
 * said "Waiting for your yes"), and its title is never cut mid-word.
 */

function proposalBlock(
  status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING",
  proposalStatus: "PROPOSED" | "EXPIRED" | "WITHDRAWN" = "PROPOSED",
): QTurnObjectBlock {
  return {
    kind: "ACTION_PROPOSAL",
    proposal: {
      proposalId: "p1",
      runId: "run-1",
      summary: "Update your company profile",
      approval: {
        required: true,
        approval: { approvalId: "a1", status },
      },
      status: proposalStatus,
    },
  } as never;
}

function person(id: string, text: string): QTurn {
  return { kind: "PERSON", id, text, unconfirmed: false };
}

function q(id: string, text: string, blocks: QTurnObjectBlock[]): QTurn {
  return {
    kind: "Q",
    id,
    text,
    at: "2026-10-28T09:24:00Z",
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

const approved: BoardDecision = {
  approvalId: "a1",
  decision: "APPROVED",
  at: "2026-10-28T09:26:10Z",
};

describe("a prepared change on the Board", () => {
  it("waits for the person until it is decided", () => {
    expect(proposalOutcome([proposalBlock()], [])).toBeNull();
    const [entry] = boardTimeline([
      person("u1", "Update my company description"),
      q("q1", "Not saved yet: tap Approve on the card.", [proposalBlock()]),
    ]);
    expect(entry?.kind).toBe("Waiting for your yes");
    expect(entry?.outcome).toBeNull();
  });

  it("reads the decision this tab made, with its time, as the thread does", () => {
    const [entry] = boardTimeline(
      [
        person("u1", "Update my company description"),
        q("q1", "Not saved yet: tap Approve on the card.", [proposalBlock()]),
      ],
      [approved],
    );
    expect(entry?.kind).toBe("Approved");
    expect(entry?.outcome).toEqual({
      status: "APPROVED",
      at: "2026-10-28T09:26:10Z",
    });
    expect(
      proposalOutcome(
        [proposalBlock()],
        [{ ...approved, decision: "DECLINED" }],
      ),
    ).toMatchObject({ status: "DECLINED" });
  });

  it("reads the approval record the read-back carries", () => {
    expect(proposalOutcome([proposalBlock("APPROVED")], [])).toEqual({
      status: "APPROVED",
      at: undefined,
    });
    expect(proposalOutcome([proposalBlock("REJECTED")], [])).toMatchObject({
      status: "DECLINED",
    });
    expect(
      proposalOutcome([proposalBlock("PENDING", "EXPIRED")], []),
    ).toMatchObject({ status: "EXPIRED" });
  });

  it("never counts another change's decision", () => {
    expect(
      proposalOutcome([proposalBlock()], [{ ...approved, approvalId: "a9" }]),
    ).toBeNull();
  });
});

describe("a Board entry's title", () => {
  it("is cut at a word with an ellipsis, never mid-word", () => {
    const question =
      "Update my company description to: A consumer app that digitises ajo — rotating savings circles — for gig workers and young professionals in Lagos";
    const [entry] = boardTimeline([
      person("u1", question),
      q("q1", "Ready.", [proposalBlock()]),
    ]);
    expect(entry?.title.length).toBeLessThanOrEqual(120);
    expect(entry?.title.endsWith("…")).toBe(true);
    const head = entry?.title.slice(0, -1) ?? "?";
    expect(question.startsWith(head)).toBe(true);
    // The cut falls on a word boundary of the question.
    expect(question[head.length]).toBe(" ");
  });

  it("keeps a short title whole and squeezes whitespace", () => {
    expect(cutAtWord("  Accept the   interest ", 120)).toBe(
      "Accept the interest",
    );
    expect(cutAtWord("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
  });
});
