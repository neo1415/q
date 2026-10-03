import { describe, expect, it } from "vitest";

import { proposalContent } from "../src/domain/same-proposal.js";

/**
 * Lead 2026-10-03: a restated request made a second identical card, and
 * "yes" then met "which one?". Two proposals are the same card when type,
 * version, targets and values match; an idempotency key is not content.
 */
const SHARE = {
  actionType: "app.raise.share",
  actionVersion: 1,
  targets: [{ kind: "INVESTOR_ORGANISATION", investorOrganisationId: "i1" }],
  payload: { investor: "i1", scope: "relationship_shared", note: undefined },
};

describe("the same card, by content", () => {
  it("the same request twice, from two runs with their own keys, is one card", () => {
    expect(
      proposalContent({
        ...SHARE,
        payload: { ...SHARE.payload, idempotencyKey: "q-run-1" },
      }),
    ).toBe(
      proposalContent({
        ...SHARE,
        payload: {
          idempotencyKey: "q-run-2",
          scope: "relationship_shared",
          investor: "i1",
        },
      }),
    );
  });

  it("a payload read back from the database compares equal to the one just parsed", () => {
    const stored = JSON.parse(JSON.stringify(SHARE.payload)) as unknown;
    expect(proposalContent({ ...SHARE, payload: stored })).toBe(
      proposalContent(SHARE),
    );
  });

  it.each([
    [
      "a different value",
      { payload: { ...SHARE.payload, scope: "network_visible" } },
    ],
    [
      "a different target",
      {
        targets: [
          { kind: "INVESTOR_ORGANISATION", investorOrganisationId: "i2" },
        ],
      },
    ],
    ["a different action version", { actionVersion: 2 }],
    ["a different action type", { actionType: "app.raise.unshare" }],
  ])("%s is a second card", (_label, change) => {
    expect(proposalContent({ ...SHARE, ...change })).not.toBe(
      proposalContent(SHARE),
    );
  });
});

/**
 * Lead 2026-10-03 (run a4618f34): with deck#1 (INVESTORS) and deck#2
 * (ORGANISATION) both waiting, a request is matched only to the card whose
 * audience it asks for -- never to the other by action type and target.
 */
describe("two waiting cards for one deck, opposite audiences", () => {
  const deck = (audience: "INVESTORS" | "ORGANISATION") => ({
    actionType: "app.document.deck_audience.set",
    actionVersion: 1,
    targets: [{ kind: "DOCUMENT", documentId: "0302150a" }],
    payload: { documentId: "0302150a", audience },
  });
  const waiting = [
    { id: "30784a17", ...deck("INVESTORS") },
    { id: "deck-2", ...deck("ORGANISATION") },
  ];
  const match = (audience: "INVESTORS" | "ORGANISATION") =>
    waiting.find(
      (card) => proposalContent(card) === proposalContent(deck(audience)),
    )?.id;

  it("a request for ORGANISATION is the ORGANISATION card", () => {
    expect(match("ORGANISATION")).toBe("deck-2");
  });

  it("a request for INVESTORS is the INVESTORS card", () => {
    expect(match("INVESTORS")).toBe("30784a17");
  });
});
