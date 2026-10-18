import { describe, expect, it } from "vitest";

import type { QMessage, QResultBlock } from "@capital-q/contracts";
import type { QStreamState } from "@capital-q/api-client";

import { turnsFrom } from "../src/features/q/conversation";

/**
 * What an answer carries into the browser (QX-001 §8-§10).
 *
 * Two rules, and the second is the one that matters. Objects a person can
 * act on come through so a card can be drawn for them. Evidence
 * references never do: a reference is only identifiers, and whether
 * somebody may see the document behind one is disclosure's decision at
 * render time — not something this projection may pre-empt. Carrying the
 * blocks through verbatim broke that, which is why it is pinned here.
 */

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const DOCUMENT = "a0000000-0000-4000-8000-00000000000b";

function state(message: QMessage): QStreamState {
  return {
    messages: [message],
    partial: null,
    stage: null,
    failure: null,
    approval: null,
    proposals: [],
  } as unknown as QStreamState;
}

function answer(blocks: readonly QResultBlock[]): QMessage {
  return {
    messageId: "f0000000-0000-4000-8000-000000000004",
    runId: "f0000000-0000-4000-8000-000000000001",
    role: "Q",
    text: "Here is what I found.",
    createdAt: "2026-09-21T12:00:00.000Z",
    blocks,
  } as unknown as QMessage;
}

const qTurn = (message: QMessage) => {
  const turn = turnsFrom(state(message), [])[0];
  if (turn === undefined || turn.kind !== "Q") {
    throw new Error("expected a Q turn");
  }
  return turn;
};

describe("objects the answer referred to", () => {
  it("come through so a card can be drawn for them", () => {
    const turn = qTurn(
      answer([
        { kind: "COMPANY_REFERENCE", companyId: COMPANY },
        {
          kind: "CLARIFICATION_REQUEST",
          question: "Which round did you mean?",
          options: ["The seed", "The bridge"],
        },
      ]),
    );
    expect(turn.blocks.map((block) => block.kind)).toEqual([
      "COMPANY_REFERENCE",
      "CLARIFICATION_REQUEST",
    ]);
  });

  it("do not include what the answer already renders as prose", () => {
    // TEXT, FINDING and UNCERTAINTY are the answer's own; a second copy
    // as a card would be the same sentence twice in a box.
    const turn = qTurn(
      answer([
        { kind: "TEXT", text: "Annual recurring revenue is USD 2.4m." },
        {
          kind: "UNCERTAINTY",
          statement: "The burn rate is not on record.",
          confidence: "LOW",
        },
      ]),
    );
    expect(turn.blocks).toEqual([]);
    expect(turn.uncertainties).toHaveLength(1);
  });
});

describe("evidence identifiers", () => {
  it("never cross into the conversation the browser holds", () => {
    const turn = qTurn(
      answer([
        {
          kind: "EVIDENCE",
          evidenceRefs: [{ kind: "DOCUMENT", documentId: DOCUMENT, page: 6 }],
        },
      ]),
    );
    // The count is the whole of what a person is told here.
    expect(turn.sourceCount).toBe(1);
    expect(JSON.stringify(turn)).not.toContain(DOCUMENT);
  });

  it("are dropped from a navigation suggestion too", () => {
    // SHOW_EVIDENCE carries the same references by another name, and
    // there is no evidence surface to send anybody to.
    const turn = qTurn(
      answer([
        {
          kind: "UI_INTENT",
          intent: {
            kind: "SHOW_EVIDENCE",
            evidenceRefs: [{ kind: "DOCUMENT", documentId: DOCUMENT, page: 2 }],
          },
        },
        {
          kind: "UI_INTENT",
          intent: { kind: "OPEN_COMPANY", companyId: COMPANY },
        },
      ]),
    );
    expect(turn.blocks).toHaveLength(1);
    expect(JSON.stringify(turn)).not.toContain(DOCUMENT);
  });
});
