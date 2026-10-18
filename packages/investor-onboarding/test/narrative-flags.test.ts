import { describe, expect, it } from "vitest";

import {
  narrativeFlags,
  narrativeMentions,
} from "../src/integration/mandate-review-service.js";

/**
 * CQ-PRE-REC-001 §24 with founder brief J7: each red flag the investor
 * names is read for whether they rule it out, would rather avoid it, or
 * neither (PREFERENCE_POLARITY, faked here). A ruled-out one only ever
 * becomes a question; an avoided one an AVOID proposal; nothing read adds
 * nothing.
 */
const NARRATIVE =
  "We mostly invest $250k to $1m at Seed and Series A, mostly fintech and B2B SaaS in Africa. I don't love hardware, and never show me gambling.";

/** The fake model: its reading of each mention, by flag. */
function read(
  mentions: ReturnType<typeof narrativeMentions>,
  byCode: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  return new Map(
    mentions.map((one) => [one.id, byCode[one.code] ?? "NEUTRAL"]),
  );
}

describe("narrative red flags", () => {
  it("hands each named flag to the reading with its own clause", () => {
    expect(
      narrativeMentions(NARRATIVE).map((one) => [one.code, one.sentence]),
    ).toEqual([
      ["hardware_heavy", "I don't love hardware"],
      ["gambling", "never show me gambling"],
    ]);
  });

  it("turns a ruled-out flag into an exclusion to confirm, an avoided one into avoid", () => {
    const mentions = narrativeMentions(NARRATIVE);
    expect(
      narrativeFlags(
        mentions,
        read(mentions, { hardware_heavy: "AVOIDED", gambling: "EXCLUDED" }),
      ),
    ).toEqual([
      { code: "hardware_heavy", kind: "AVOID", quote: "I don't love hardware" },
      { code: "gambling", kind: "EXCLUSION", quote: "never show me gambling" },
    ]);
  });

  it("adds nothing for a flag they want, or when nothing could be read", () => {
    const mentions = narrativeMentions(
      "We like hardware and crypto infrastructure.",
    );
    expect(
      narrativeFlags(mentions, read(mentions, { hardware_heavy: "WANTED" })),
    ).toEqual([]);
    expect(narrativeFlags(narrativeMentions(NARRATIVE), null)).toEqual([]);
  });

  it("does not match inside other words", () => {
    expect(narrativeMentions("never tokenised, no armsmiths")).toEqual([]);
  });
});
