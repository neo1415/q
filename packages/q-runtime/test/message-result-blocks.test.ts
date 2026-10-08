import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";

import { toQMessage } from "../src/contracts/index.js";
import type { QConversationMessage } from "../src/contracts/index.js";

/**
 * Q's structured answer, read back from history (CQ-Q-BLOCKS-HISTORY-001).
 *
 * The cards used to live only on the run's completion event, so a refresh
 * turned an answer you could act on into prose. Now they are stored — and
 * the thing that makes storing them safe is that the public contract is
 * the allowlist in both directions. These pin that, including the one
 * that matters most: history must not become a way to reintroduce private
 * evidence identifiers the live path was careful to keep out.
 */

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const DOCUMENT = "a0000000-0000-4000-8000-00000000000b";

function stored(blocks?: readonly QResultBlock[]): QConversationMessage {
  return {
    id: "f0000000-0000-4000-8000-000000000004",
    tenantId: "c0000000-0000-4000-8000-0000000000aa",
    conversationId: "d0000000-0000-4000-8000-000000000001",
    runId: "f0000000-0000-4000-8000-000000000001",
    role: "Q",
    content: "Here is what I found.",
    contentType: "TEXT",
    ...(blocks === undefined ? {} : { blocks }),
    createdAt: "2026-09-21T12:00:00.000Z",
  } as unknown as QConversationMessage;
}

describe("a stored Q answer", () => {
  it("carries its objects back to a client", () => {
    const message = toQMessage(
      stored([
        { kind: "COMPANY_REFERENCE", companyId: COMPANY },
        {
          kind: "CLARIFICATION_REQUEST",
          question: "Which round did you mean?",
        },
      ]),
    );
    expect(message.role).toBe("Q");
    expect(
      message.role === "Q" ? message.blocks?.map((b) => b.kind) : null,
    ).toEqual(["COMPANY_REFERENCE", "CLARIFICATION_REQUEST"]);
  });

  it("is prose when there was nothing structured to keep", () => {
    // An empty array is not "no blocks" by accident: it means the answer
    // had none, and the message must not claim otherwise.
    const message = toQMessage(stored([]));
    expect(message.role === "Q" ? message.blocks : undefined).toBeUndefined();
    const plain = toQMessage(stored());
    expect(plain.role === "Q" ? plain.blocks : undefined).toBeUndefined();
  });
});

describe("what history may not smuggle back", () => {
  it("refuses a private evidence reference on the way out", () => {
    // The QX-001 finding, now applied to the durable path. A reference is
    // only identifiers, and whether somebody may see the document behind
    // one is disclosure's decision at render time. A row that somehow
    // held one -- an older build, a hand-written insert -- must not become
    // a structured object a browser holds.
    const message = toQMessage(
      stored([
        {
          kind: "EVIDENCE",
          evidenceRefs: [{ kind: "DOCUMENT", documentId: DOCUMENT, page: 6 }],
        },
        { kind: "COMPANY_REFERENCE", companyId: COMPANY },
      ] as unknown as readonly QResultBlock[]),
    );
    const text = JSON.stringify(message);
    expect(text).not.toContain(DOCUMENT);
    // The rest of the answer still arrives; one bad block is not a reason
    // to lose the company card beside it.
    expect(text).toContain(COMPANY);
  });

  it("does not let a reference become authorisation", () => {
    // A block names a company. It does not grant sight of one: the id
    // travels because a client needs something to ask about, and every
    // read behind it still resolves through the same checks the live
    // answer did. Pinned as a statement of intent that a future change
    // has to argue with.
    const message = toQMessage(
      stored([{ kind: "COMPANY_REFERENCE", companyId: COMPANY }]),
    );
    const blocks = message.role === "Q" ? (message.blocks ?? []) : [];
    const reference = blocks[0];
    expect(reference?.kind).toBe("COMPANY_REFERENCE");
    // Nothing that looks like a grant, a token or a scope rides along.
    expect(Object.keys(reference ?? {})).toEqual(["kind", "companyId"]);
  });
});

describe("answer cards read back from history (INC-1, G-D13)", () => {
  it("keeps a stored ANSWER_CARDS block, so cards survive a reload", () => {
    const card = (key: string) => ({
      key,
      name: key,
      line: null,
      hue: 1,
      fit: { score: 8.8, measured: 5, of: 7 },
      reasons: ["why"],
      measures: [],
      view: null,
      said: null,
      sourceCount: 0,
      subject: null,
      about: null,
      raise: null,
    });
    const message = toQMessage(
      stored([
        {
          kind: "ANSWER_CARDS",
          shape: "RANKED",
          title: "Top three on mandate fit",
          cards: [card("a"), card("b"), card("c")],
          followUps: [],
        } as unknown as QResultBlock,
      ]),
    );
    const blocks = message.role === "Q" ? message.blocks : undefined;
    expect(blocks?.map((b) => b.kind)).toEqual(["ANSWER_CARDS"]);
    expect(
      blocks?.[0]?.kind === "ANSWER_CARDS" ? blocks[0].cards.length : 0,
    ).toBe(3);
  });
});
