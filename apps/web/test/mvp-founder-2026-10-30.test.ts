import { describe, expect, it, vi } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";

vi.mock("server-only", () => ({}));
vi.mock("../src/features/q/context", () => ({
  qApiSession: vi.fn(() => Promise.resolve(null)),
  apiSession: vi.fn(() => Promise.resolve(null)),
  resolveOwnContext: vi.fn(),
}));

import { pointWords, splitGaps } from "../src/features/q/artifact-viewer";
import { followWork, type QTurn } from "../src/features/q/conversation";
import { composeBriefing } from "../src/features/home/briefing";
import { draftLabel, foldedPoints } from "../src/features/q/plan-card";

/**
 * MVP acceptance, live 2026-10-30 (founder.ledgerbridge and the investor
 * lane): what the person saw that was not honest or was said twice.
 */

describe("plan card: one line per step, and which draft it holds", () => {
  it("folds a step's continued note into its step's line", () => {
    const points = [
      "Step 8, “Prepare the position”: Your deck remains private.",
      "Step 9, “Revise the seed deck”: Your market is not yet covered.",
      "Step 9, continued: Your customer outcome is not yet quantified.",
    ];
    expect(foldedPoints(points)).toEqual([
      "Step 8, “Prepare the position”: Your deck remains private.",
      "Step 9, “Revise the seed deck”: Your market is not yet covered. Your customer outcome is not yet quantified.",
    ]);
  });

  it("a continuation with no step line before it stays its own line", () => {
    expect(foldedPoints(["Step 3, continued: x."])).toEqual([
      "Step 3, continued: x.",
    ]);
  });

  it("says the draft and its reviews, not 'Version 1'", () => {
    expect(
      draftLabel({
        redrafts: 2,
        reviews: [{ passed: true }, { passed: false }],
        openPoints: ["Step 5: open."],
      }),
    ).toEqual(["Draft 3", "1 of 2 reviews passed"]);
    expect(
      draftLabel({
        redrafts: 1,
        reviews: [{ passed: false }, { passed: false }],
        openPoints: [
          "This is the earlier draft: its revision scored lower in review, so this draft is shown, with the reviews of this draft.",
        ],
      }),
    ).toEqual(["An earlier draft", "0 of 2 reviews passed"]);
  });
});

describe("the plan's progress card shows once in the chat", () => {
  it("a PLAN delivery drops the job's progress block, which the turn that started it keeps", () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const work: QResultBlock = {
      kind: "WORK_IN_PROGRESS",
      jobId,
      title: "Your plan: What should I do today?",
    };
    const planBlock = {
      kind: "PLAN",
      planId: "22222222-2222-4222-8222-222222222222",
    } as unknown as QResultBlock;
    const q = (id: string, blocks: QResultBlock[]): QTurn =>
      ({
        kind: "Q",
        id,
        text: id,
        streaming: false,
        sourceCount: 0,
        publicSources: [],
        findings: [],
        uncertainties: [],
        blocks,
      }) as unknown as QTurn;
    const turns = [q("started", [work]), q("delivered", [planBlock, work])];
    followWork(turns);
    const kinds = turns.map((turn) =>
      turn.kind === "Q" ? turn.blocks.map((block) => block.kind) : [],
    );
    expect(kinds).toEqual([["WORK_IN_PROGRESS"], ["PLAN"]]);
    // A plan is not a document: no PDF of the turn is offered for it.
    expect(
      turns[1]?.kind === "Q" ? turns[1].deliversDocument : undefined,
    ).toBeUndefined();
  });
});

describe("a document's review points are apart from its evidence gaps", () => {
  it("lists them under their own label, without the internal prefix", () => {
    expect(
      splitGaps([
        "Revenue for 2025 is not stated.",
        "Reviewer's open point (Risks): The customer concentration is not quantified.",
      ]),
    ).toEqual({
      evidence: ["Revenue for 2025 is not stated."],
      review: ["Risks: The customer concentration is not quantified."],
    });
  });
});

describe("live 2026-10-31: a quoted point reads as words", () => {
  it("drops the memo's bold and the list marker opening a quote", () => {
    expect(
      splitGaps([
        'Reviewer\'s open point (Summary & recommendation): 2 figures without a basis, e.g. "- **Cheque and role:** Potential fit only as a co-investment."',
      ]).review,
    ).toEqual([
      'Summary & recommendation: 2 figures without a basis, e.g. "Cheque and role: Potential fit only as a co-investment."',
    ]);
    expect(pointWords("Revenue for **2025** is not stated.")).toBe(
      "Revenue for 2025 is not stated.",
    );
  });
});

describe("live 2026-10-31: the plan card's points are the chat's list", () => {
  it("the draft notice is apart, never counted as a point", () => {
    const notice =
      "This is the earlier draft: its revision scored lower in review, so this draft is shown, with the reviews of this draft.";
    expect(
      foldedPoints([notice, "Step 1, “A”: x.", "Step 2, “B”: y."]),
    ).toEqual(["Step 1, “A”: x.", "Step 2, “B”: y."]);
  });
});

describe("investor briefing: honest about regions", () => {
  it("pitches outside their declared regions are never said to match their mandate", () => {
    const briefing = composeBriefing({
      role: "INVESTOR",
      since: "2026-10-23T00:00:00.000Z",
      approvals: [],
      relationships: [],
      pitches: [
        { companyId: "c1", name: "Halyard Security" },
        { companyId: "c2", name: "Beacon Health" },
      ],
      pitchesOutsideRegions: true,
      mandate: "ACTIVE",
    });
    const item = briefing?.items.find((one) => one.href === "/discover");
    expect(item?.title).toBe("2 pitches outside your regions");
    expect(item?.title).not.toMatch(/match your mandate/u);
    expect(item?.description).toMatch(/^None in your regions has a pitch yet/u);
  });

  it("live 2026-10-31: in-region pitches are named apart; out-of-region ones never 'match your mandate'", () => {
    const briefing = composeBriefing({
      role: "INVESTOR",
      since: "2026-10-23T00:00:00.000Z",
      approvals: [],
      relationships: [],
      pitches: [
        { companyId: "c1", name: "Karoo Gridworks", outsideRegions: true },
        { companyId: "c2", name: "Kivu Traceworks", outsideRegions: true },
        { companyId: "c3", name: "Kycana Hub", outsideRegions: false },
        { companyId: "c4", name: "Portside", outsideRegions: true },
      ],
      mandate: "ACTIVE",
    });
    const item = briefing?.items.find((one) => one.href === "/discover");
    expect(item?.title).toBe("A pitch from Kycana Hub, in your regions");
    expect(item?.title).not.toMatch(/match your mandate/u);
    expect(item?.description).toBe(
      "Kycana Hub. 3 more are outside your regions.",
    );
    expect(item?.description).not.toMatch(/Karoo|Kivu/u);
  });
});
