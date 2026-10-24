import { describe, expect, it } from "vitest";

import { nextCursor, withDelta } from "../src/features/q/conversation-delta";

/**
 * Egress (2026-10-24): a read-back asks only for what came after the last
 * message it read, and folds that into what the thread holds.
 */
const message = (messageId: string, runId: string, role = "Q") =>
  ({
    messageId,
    runId,
    role,
    text: messageId,
    createdAt: "2026-10-24T22:00:00Z",
  }) as never;

describe("a read-back of only the new turns", () => {
  it("adds the new messages once, after what is held", () => {
    const held = [message("m1", "r1", "USER"), message("m2", "r1")];
    const merged = withDelta(held, [message("m2", "r1"), message("m3", "r2")]);
    expect(merged.map((one) => one.messageId)).toEqual(["m1", "m2", "m3"]);
  });

  it("drops the runs a later fragment of the same spoken turn replaced", () => {
    const held = [
      message("m1", "r1", "USER"),
      message("m2", "r1"),
      message("m3", "r2", "USER"),
    ];
    const merged = withDelta(held, [message("m4", "r3", "USER")], ["r2"]);
    expect(merged.map((one) => one.messageId)).toEqual(["m1", "m2", "m4"]);
  });

  it("starts the next read after the last message a read returned", () => {
    expect(nextCursor(null, [message("m1", "r1"), message("m2", "r1")])).toBe(
      "m2",
    );
    expect(nextCursor("m2", [])).toBe("m2");
  });
});
