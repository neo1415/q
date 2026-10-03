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
