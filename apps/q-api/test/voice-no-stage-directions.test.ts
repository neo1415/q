import { describe, expect, it } from "vitest";

import {
  DUPLEX_INSTRUCTIONS_PREFIX,
  BACKCHANNEL_INSTRUCTIONS,
} from "../src/voice/duplex/instructions.js";
import { forRealtime } from "../src/voice/duplex/broker.js";
import {
  renderSpeech,
  SPEECH_MARKUP,
} from "../src/voice/providers/speech-markup.js";
import { speakable } from "../src/voice/speech.js";

/**
 * voiceq-63 (founder, live 2026-10-04): "When I start to laugh... it does
 * something like 'ha', or it says 'chuckles'... that's weird." A sound is
 * never handed to a voice as a word: stage directions are removed from
 * every spoken text, a written laugh becomes the voice's own laugh where it
 * has one and nothing where it does not, and the realtime line is told to
 * laugh in its voice, never in words.
 */
describe("stage directions and written laughs are never spoken", () => {
  it.each([
    ["(chuckles) That's a fair point.", "That's a fair point."],
    ["That's a fair point *laughs softly*.", "That's a fair point."],
    [
      "Right [laughing] so the raise closes in May.",
      "Right so the raise closes in May.",
    ],
    ["(sighs) It slipped again.", "It slipped again."],
  ])("%s", (input, spoken) => {
    expect(speakable(input)).toBe(spoken);
  });

  it("keeps a reply's own words in brackets", () => {
    expect(speakable("Revenue (unaudited) is up.")).toBe(
      "Revenue (unaudited) is up.",
    );
  });

  const laugh = {
    sentence: "Ha! That's a good one.",
    reaction: "LAUGH" as const,
    pauseAfter: false,
    pace: "NORMAL" as const,
    emphasis: [],
  };

  it("eleven v3 laughs instead of reading 'Ha'", () => {
    expect(
      renderSpeech(
        "Ha! That's a good one.",
        [laugh],
        SPEECH_MARKUP.eleven_v3_conversational,
      ).text,
    ).toBe("[laughs] That's a good one.");
  });

  it("a voice that cannot laugh drops the written laugh, never says it", () => {
    expect(
      renderSpeech(
        "Ha! That's a good one.",
        [laugh],
        SPEECH_MARKUP.eleven_turbo_v2_5,
      ).text,
    ).toBe("That's a good one.");
  });

  it("the realtime line is told the words without the laugh, and to sound amused", () => {
    expect(forRealtime("Ha! Nice one. (chuckles) Okay, back to Nixo.")).toEqual(
      {
        say: "Nice one. Okay, back to Nixo.",
        amused: true,
      },
    );
    expect(forRealtime("Booked for Tue 10:00.")).toEqual({
      say: "Booked for Tue 10:00.",
      amused: false,
    });
  });

  it("the realtime instructions ask for paced, expressive speech and no sound words", () => {
    expect(DUPLEX_INSTRUCTIONS_PREFIX).toContain("PACING");
    expect(DUPLEX_INSTRUCTIONS_PREFIX).toMatch(/never say a sound as a word/iu);
    expect(BACKCHANNEL_INSTRUCTIONS).not.toMatch(
      /a soft laugh for something funny/u,
    );
    expect(BACKCHANNEL_INSTRUCTIONS).toMatch(/never the word "ha"/u);
  });
});
