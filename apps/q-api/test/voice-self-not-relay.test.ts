import { Q_SYSTEM_V2, Q_SYSTEM_VOICE_V3 } from "@capital-q/q-core";
import { describe, expect, it } from "vitest";

import {
  ASK_Q_TOO_LONG,
  DUPLEX_CAP_NOTICE,
} from "../src/voice/duplex/broker.js";
import {
  BACKCHANNEL_INSTRUCTIONS,
  BRIDGE_INSTRUCTIONS,
  DUPLEX_INSTRUCTIONS_PREFIX,
  DUPLEX_LISTENING_INSTRUCTIONS_PREFIX,
  GUIDED_CONDUCT,
} from "../src/voice/duplex/instructions.js";
import {
  LIVE_APPROVAL_READY,
  LIVE_HOLDING_LINES,
  LIVE_NOT_FINISHED,
  LIVE_SAY_EXACTLY,
} from "../src/voice/live/broker.js";
import { liveContextPackage } from "../src/voice/live/context.js";
import {
  LIVE_GREETING_REPLIES,
  livePrompt,
  SELF_NOT_RELAY,
} from "../src/voice/live/prompt.js";
import {
  APPROVAL_QUESTION,
  DURABLE_HANDOFF_LINE,
  STORY_LINE,
} from "../src/voice/turn.js";

/**
 * Owner 19 Nov 2026 (voice, 07:19-07:34 UTC): as it handed their words on,
 * the line said "I'll ask for a view on that", "I'll ask which one they
 * meant" and "I'll ask to do that": a go-between between the person and
 * Q. There is one Q, and it is the one speaking. Its fixed lines never
 * relay, and its voice and dialogue prompts never describe Q as someone
 * else the voice carries words to.
 */

/** A spoken line that relays: asking, checking with or passing to another. */
const RELAY_LINE =
  /\b(?:I(?:'ll|’ll| will| am going to|'m going to)|let me) (?:go )?(?:ask|check with|pass|relay|forward|hand|find out from)\b|\bask(?:ing)? Q\b|\bQ (?:will|is going to|says|said)\b|\b(?:the user|the person)\b/iu;

/** A prompt that frames Q as a third party the voice serves or asks. */
const THIRD_PARTY_Q =
  /\bQ's (?:backend|voice|answer|words)\b|\bask(?:ing)? Q\b|\bQ (?:opens|reads|shows|answers|will)\b|\bhand(?:s|ing)? (?:it|this|that|them) to Q\b/u;

/** The prompt text, without the rule that names the forbidden phrases. */
const withoutRule = (text: string): string =>
  text
    .replace(SELF_NOT_RELAY, "")
    .replace(/Never say you will ask[^.]*\./gu, "");

describe("Q speaks as itself on every voice line, never as a go-between", () => {
  const fixedLines: readonly (readonly [string, string])[] = [
    ...LIVE_HOLDING_LINES.map((line) => ["holding line", line] as const),
    ...LIVE_GREETING_REPLIES.map((line) => ["greeting", line] as const),
    ["approval ready", LIVE_APPROVAL_READY],
    ["not finished", LIVE_NOT_FINISHED],
    ["approval question", APPROVAL_QUESTION],
    ["story", STORY_LINE],
    ["durable handoff", DURABLE_HANDOFF_LINE],
    ["duplex cap", DUPLEX_CAP_NOTICE],
    ["ask too long", ASK_Q_TOO_LONG],
  ];

  it.each(fixedLines)("the %s line speaks in the first person", (_, line) => {
    expect(line).not.toMatch(RELAY_LINE);
  });

  it("catches the relay lines heard on 19 Nov", () => {
    for (const heard of [
      "I'll ask for a view on that.",
      "I'll ask which one they meant.",
      "I'll ask to do that.",
      "I'll ask Q.",
      "Let me check with Q.",
    ]) {
      expect(heard).toMatch(RELAY_LINE);
    }
    for (const fine of [
      "On it.",
      "Ask me again, or ask for a smaller piece and I'll build up.",
      "Shall I go ahead?",
    ]) {
      expect(fine).not.toMatch(RELAY_LINE);
    }
  });

  const livePrompts = [
    ["investor", livePrompt({ role: "investor", firstName: "Ada" })],
    ["founder", livePrompt({ role: "founder" })],
    ["guided", livePrompt({ guided: true })],
    ["briefing", livePrompt({ briefingOpening: true, role: "investor" })],
    ["interview", livePrompt({ role: "founder", interview: "- Sector" })],
  ] as const;

  it.each(livePrompts)(
    "the %s live prompt carries the one-Q rule and never frames Q as someone else",
    (_, prompt) => {
      expect(prompt).toContain(SELF_NOT_RELAY);
      expect(withoutRule(prompt)).not.toMatch(THIRD_PARTY_Q);
    },
  );

  it.each([
    ["duplex", DUPLEX_INSTRUCTIONS_PREFIX],
    ["duplex listening", DUPLEX_LISTENING_INSTRUCTIONS_PREFIX],
    ["bridge", BRIDGE_INSTRUCTIONS],
    ["backchannel", BACKCHANNEL_INSTRUCTIONS],
    ["guided", GUIDED_CONDUCT],
    ["voice charter", Q_SYSTEM_VOICE_V3.template],
    ["dialogue charter", Q_SYSTEM_V2.template],
  ])("the %s prompt never frames Q as someone else", (_, prompt) => {
    expect(withoutRule(prompt)).not.toMatch(THIRD_PARTY_Q);
  });

  it("the duplex and bridge lines forbid relaying out loud", () => {
    expect(DUPLEX_INSTRUCTIONS_PREFIX).toContain("never a go-between");
    expect(BRIDGE_INSTRUCTIONS).toContain(
      "never say you will ask, check with or pass it to anyone",
    );
  });

  it("says each exact line as Q's own", () => {
    expect(LIVE_SAY_EXACTLY).toContain("as yourself");
  });

  it("the call's background never tells the voice to ask Q", () => {
    const text =
      liveContextPackage({
        facts: null,
        referents: [],
        preparedEntities: ["Ada Obi, a person: founder of Example Ltd."],
        arrival: ["Two requests wait."],
      }) ?? "";
    expect(text).toContain("you have already researched");
    expect(text).not.toMatch(THIRD_PARTY_Q);
    expect(text).not.toMatch(/\bQ (?:already|has)\b/u);
  });
});
