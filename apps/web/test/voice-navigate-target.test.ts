// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { movePath, voiceMovePath } from "../src/features/voice/live/move";
import { performTurnChain } from "../src/features/voice/use-follow-turn";

/** Q Workspace W3 (voice): a spoken move lands at the place Q named. */
const ITEM = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

describe("spoken moves at the exact place", () => {
  it("builds the same path a typed move does", () => {
    expect(voiceMovePath("BOARD", { itemId: ITEM })).toBe(
      `/board?item=${ITEM}`,
    );
    expect(voiceMovePath("BOARD", undefined)).toBe("/board");
    expect(voiceMovePath(null, { itemId: ITEM })).toBeNull();
    // An interview hand-off has no page and takes no target.
    expect(voiceMovePath("INTERVIEW", { position: "latest" })).toBeNull();
    expect(
      movePath({
        navigate: "CAPITAL",
        navigateTarget: { sectionId: "commitments", position: "section" },
        action: null,
      }),
    ).toBe("/relationships?view=capital#section-commitments");
  });

  it("the voice board's move goes to the target", () => {
    const moved: string[] = [];
    performTurnChain(
      {
        sequence: 1,
        asking: null,
        navigate: "BOARD",
        navigateTarget: { itemId: ITEM },
        handoff: null,
        degraded: false,
      },
      () => true,
      (path) => moved.push(path),
      () => undefined,
    );
    expect(moved).toEqual([`/board?item=${ITEM}`]);
  });
});
