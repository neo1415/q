import { describe, expect, it } from "vitest";

import {
  deliveryFromCue,
  PLAIN_DELIVERY,
  SpeechCueSchema,
  SpeechDeliverySchema,
} from "../src/speech/delivery.js";

describe("one cue, for a prompt with no room for more", () => {
  it("opens the reply with a reaction, or pauses after its first sentence", () => {
    expect(deliveryFromCue("SIGH")).toEqual({
      ...PLAIN_DELIVERY,
      reaction: "SIGH",
      reactionAt: 0,
    });
    expect(deliveryFromCue("PAUSE")).toEqual({
      ...PLAIN_DELIVERY,
      pauseAfter: [0],
    });
    expect(deliveryFromCue(null)).toEqual(PLAIN_DELIVERY);
  });

  it("is a closed vocabulary: no tag, no free text", () => {
    for (const bad of ["[laughs]", "laughs", "WHISPER", ""]) {
      expect(SpeechCueSchema.safeParse(bad).success).toBe(false);
    }
  });
});

/**
 * The delivery a model may ask for beside its reply (CQ-VOICE-010): a
 * closed vocabulary with restraint built into the shape, so that what a
 * model is allowed to request is decided here, not in its reply.
 */
describe("SpeechDeliverySchema", () => {
  it("defaults to speaking the reply as written", () => {
    expect(SpeechDeliverySchema.parse({})).toEqual(PLAIN_DELIVERY);
  });

  it("accepts one restrained reaction, two pauses, a pace and two emphases", () => {
    expect(
      SpeechDeliverySchema.parse({
        reaction: "CHUCKLE",
        reactionAt: 1,
        pauseAfter: [0, 2],
        pace: "SLOWER",
        emphasis: ["on me", "twice"],
      }),
    ).toMatchObject({ reaction: "CHUCKLE", pace: "SLOWER" });
  });

  it("refuses anything outside the vocabulary", () => {
    for (const bad of [
      { reaction: "SCREAM" },
      { reaction: "[laughs]" },
      { pace: "VERY_FAST" },
      { pauseAfter: [0, 1, 2] },
      { emphasis: ["a", "b", "c"] },
      { emphasis: ["x".repeat(41)] },
      { reactionAt: -1 },
      { reactionAt: 12 },
      { pauseAfter: [1.5] },
      // Free text has nowhere to go.
      { tone: "sarcastic" },
      { ssml: '<break time="3s"/>' },
    ]) {
      expect(
        SpeechDeliverySchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});
