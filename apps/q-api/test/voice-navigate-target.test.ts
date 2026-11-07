import { describe, expect, it } from "vitest";

import { liveMoveOf } from "../src/voice/live/broker.js";
import { followOfAnswer } from "../src/voice/navigation.js";
import { createVoiceTurnBoard } from "../src/voice/turn-board.js";

/**
 * Q Workspace W3 (voice): a spoken move lands at the exact place Q named,
 * like a typed one, and a target never outlives its own destination.
 */
const ITEM = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const BASE = { asking: null, handoff: null, degraded: false } as const;

describe("spoken moves carry their target", () => {
  it("followOfAnswer reads the NAVIGATE target", () => {
    expect(
      followOfAnswer([
        {
          kind: "UI_INTENT",
          intent: {
            kind: "NAVIGATE",
            destination: "BOARD",
            target: { itemId: ITEM },
          },
        },
      ]).navigateTarget,
    ).toEqual({ itemId: ITEM });
    expect(
      followOfAnswer([
        {
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: "BOARD" },
        },
      ]).navigateTarget,
    ).toBeUndefined();
  });

  it("the board drops a target carried over to a different destination", () => {
    const board = createVoiceTurnBoard();
    const first = board.record("v1", {
      ...BASE,
      navigate: "BOARD",
      navigateTarget: { itemId: ITEM },
    });
    expect(first.navigateTarget).toEqual({ itemId: ITEM });
    // Same move re-recorded (presence, outcome): the target stays.
    const again = board.record("v1", { ...board.read("v1"), degraded: true });
    expect(again.navigateTarget).toEqual({ itemId: ITEM });
    // A later turn spreads the last state and moves elsewhere.
    const moved = board.record("v1", {
      ...board.read("v1"),
      navigate: "DISCOVER",
    });
    expect(moved.navigateTarget).toBeUndefined();
    const cleared = board.record("v1", {
      ...board.read("v1"),
      navigate: null,
      navigateTarget: { position: "latest" },
    });
    expect(cleared.navigateTarget).toBeUndefined();
  });

  it("the live move carries a well-formed target with its destination only", () => {
    expect(
      liveMoveOf({ navigate: "BOARD", navigateTarget: { itemId: ITEM } }),
    ).toEqual({
      navigate: "BOARD",
      navigateTarget: { itemId: ITEM },
      action: null,
    });
    expect(
      liveMoveOf({ navigate: "BOARD", navigateTarget: { selector: "#x" } }),
    ).toEqual({ navigate: "BOARD", action: null });
    expect(
      liveMoveOf({ navigate: null, navigateTarget: { itemId: ITEM } }),
    ).toBeNull();
  });
});
