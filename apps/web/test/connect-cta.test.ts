import { describe, expect, it } from "vitest";

import { connectCta } from "../src/features/network/connect-cta";

/**
 * Live check 2026-10-16: an investor's profile offered "Request to connect"
 * to a founder already Connected with them. One way forward, from the
 * canonical relationship state.
 */
describe("the founder's one way forward with an investor", () => {
  it("asks to connect only when there is no relationship to open", () => {
    expect(connectCta(undefined)).toEqual({ kind: "REQUEST" });
  });

  it("opens the record once in touch, whatever came after connecting", () => {
    for (const state of [
      "CONNECTED",
      "MEETING_HELD",
      "IN_DILIGENCE",
      "PAUSED",
      "INVESTED",
    ] as const) {
      expect(connectCta({ state, nextStep: "NONE" })).toEqual({
        kind: "OPEN",
        state,
      });
    }
  });

  it("answers their interest rather than asking again", () => {
    expect(
      connectCta({ state: "INTEREST_EXPRESSED", nextStep: "ANSWER_INTEREST" }),
    ).toEqual({ kind: "ANSWER" });
    // Our own interest, still waiting: the Connect panel says where it stands.
    expect(
      connectCta({ state: "INTEREST_EXPRESSED", nextStep: "AWAIT_ANSWER" }),
    ).toEqual({ kind: "REQUEST" });
  });

  it("offers no new ask after it was not taken forward", () => {
    expect(connectCta({ state: "DECLINED", nextStep: "NONE" }).kind).toBe(
      "ENDED",
    );
    expect(connectCta({ state: "PASSED", nextStep: "NONE" }).kind).toBe(
      "ENDED",
    );
  });
});
