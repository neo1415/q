import { describe, expect, it } from "vitest";

import {
  Q_SILENCE_THINGS,
  Q_VISIBLE_STAGES,
  silenceHum,
  silenceProgressLine,
  silenceStageLine,
  silenceThreadLine,
  stripSilenceBeats,
  type QSilenceFocus,
} from "../src/index.js";

/**
 * W4b: a beat of the silence ladder is never a line of the conversation.
 * Every line the ladder can write is recognised; an answer is never cut.
 */

const focuses: (QSilenceFocus | null)[] = [
  null,
  { name: "Ledgerline" },
  { name: "Kestrel Heat" },
  ...Q_SILENCE_THINGS.map((thing) => ({ name: "Ledgerline", thing })),
];

function everyLine(): string[] {
  const lines: string[] = [];
  for (const stage of [null, ...Q_VISIBLE_STAGES]) {
    for (const focus of focuses) {
      for (let seed = 0; seed < 40; seed += 1) {
        const stageLine = silenceStageLine(stage, focus, seed);
        if (stageLine !== null) lines.push(stageLine);
        const progress = silenceProgressLine(stage, focus, seed);
        if (progress !== null) lines.push(progress);
      }
    }
  }
  for (let seed = 0; seed < 40; seed += 1) lines.push(silenceHum(seed).text);
  return lines;
}

describe("stripping the silence ladder from what Q said (W4b)", () => {
  it("recognises every stage line, progress line and hum the ladder writes", () => {
    for (const line of everyLine()) {
      expect(stripSilenceBeats(line), line).toBe("");
    }
  });

  it("removes a leading run of beats, the thread after them, and keeps the answer", () => {
    const beats = [
      silenceStageLine(
        "REVIEWING_COMPANY",
        { name: "Ledgerline", thing: "deck" },
        3,
      ),
      silenceProgressLine(
        "REVIEWING_COMPANY",
        { name: "Ledgerline", thing: "deck" },
        5,
      ),
      silenceHum(2).text,
      silenceThreadLine("how was Lagos?", 4),
    ];
    const answer = "Ledgerline's deck asks for $2M. The burn is not stated.";
    expect(stripSilenceBeats(`${beats.join(" ")} ${answer}`)).toBe(answer);
    // As one provider message with no spaces between the parts.
    expect(stripSilenceBeats(`${beats.slice(0, 2).join("")}${answer}`)).toBe(
      answer,
    );
  });

  it("never cuts an answer that only resembles a beat", () => {
    for (const answer of [
      "Checking the evidence: two of three claims have documents.",
      "By the way, did you mean the seed round?",
      "Looking at Ledgerline, the round is $2M.",
      "Still looking good: the raise closed in June.",
      "Hmm, that one is unclear.",
      "Right, here is what I found.",
    ]) {
      expect(stripSilenceBeats(answer)).toBe(answer);
    }
  });
});
