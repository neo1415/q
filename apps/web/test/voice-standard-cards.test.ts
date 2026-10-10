// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isQVoiceCardReply,
  type QVoiceCardUpdate,
  type QVoiceTurnState,
} from "@capital-q/contracts";

import {
  noteToLine,
  registerCardDecider,
  setStandingNote,
  spokenNote,
} from "../src/features/voice/line-cards";
import {
  NAVIGATION_WAIT_MS,
  noteRoute,
  onNavigationOutcome,
  type NavigationOutcome,
} from "../src/features/q/ui-act-controller";
import { onLineNote } from "../src/features/voice/line-cards";
import { setHardLoad } from "../src/features/q/control/router-registry";
import { standardLineCards } from "../src/features/voice/provider/standard-cards";
import {
  MOVE_FAILED_LINE,
  performTurnChain,
} from "../src/features/voice/use-follow-turn";

/**
 * RECOVERY A, audit E-03: the standard voice line (Deepgram, think,
 * ElevenLabs) takes the page's decision cards the way the duplex line
 * does, through the same seam (line-cards.ts). And (with workstream C) a
 * spoken answer's whole chain of client actions is performed, in order,
 * after the move is announced.
 */

const FOCUS =
  'Screen note (data, not the person\'s words): a decision card is in focus. {"position":1,"of":2,"kind":"waiting for their yes","to":"Halyard Security","draft":"Hi"}';

function harness(options: { readonly canSpeak?: boolean } = {}) {
  const posted: QVoiceCardUpdate[] = [];
  const spoken: string[] = [];
  let canSpeak = options.canSpeak ?? true;
  const cards = standardLineCards({
    post: (update) => {
      posted.push(update);
      return Promise.resolve();
    },
    speak: (line) => {
      spoken.push(line);
    },
    canSpeak: () => canSpeak,
    isCardReply: isQVoiceCardReply,
  });
  return {
    cards,
    posted,
    spoken,
    setCanSpeak: (value: boolean) => {
      canSpeak = value;
    },
  };
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  setStandingNote(null);
});

describe("decision cards on the standard line (E-03)", () => {
  it("tells the server when a card comes into and out of focus", async () => {
    const h = harness();
    cleanups.push(h.cards.stop);
    cleanups.push(registerCardDecider(() => Promise.resolve({ ok: true })));
    setStandingNote(FOCUS);
    setStandingNote(null);
    await settle();
    expect(h.posted).toEqual([
      { kind: "FOCUS", inFocus: false },
      { kind: "FOCUS", inFocus: true },
      { kind: "FOCUS", inFocus: false },
    ]);
  });

  it("decides a spoken reply with the card's own code, from the person's words, and sends the verdict", async () => {
    const h = harness();
    cleanups.push(h.cards.stop);
    const decider = vi.fn(() =>
      Promise.resolve({ ok: true, done: "Sent to Halyard Security" }),
    );
    cleanups.push(registerCardDecider(decider));
    setStandingNote(FOCUS);
    h.cards.heard("Send it.");
    await settle();
    expect(decider).toHaveBeenCalledWith({
      words: "Send it.",
      heard: "Send it.",
    });
    expect(h.posted.at(-1)).toEqual({
      kind: "VERDICT",
      words: "Send it.",
      handled: true,
      outcome: { ok: true, done: "Sent to Halyard Security" },
    });
  });

  it("hands anything not about the cards back to Q", async () => {
    const h = harness();
    cleanups.push(h.cards.stop);
    cleanups.push(
      registerCardDecider(() =>
        Promise.resolve({
          ok: false,
          situation:
            "That isn't about the cards. Pass their words to ask_q; the cards stay on screen.",
        }),
      ),
    );
    setStandingNote(FOCUS);
    h.cards.heard("skip ahead to my readiness");
    await settle();
    expect(h.posted.at(-1)).toEqual({
      kind: "VERDICT",
      words: "skip ahead to my readiness",
      handled: false,
    });
    // A question is never even read as a card reply.
    const before = h.posted.length;
    h.cards.heard("What does Halyard invest in?");
    await settle();
    expect(h.posted.length).toBe(before);
  });

  it("says a note that asks Q to speak, once the line is quiet, from the note's facts", () => {
    const h = harness({ canSpeak: false });
    cleanups.push(h.cards.stop);
    noteToLine(`${FOCUS} Put this card to them briefly, then stop.`, true);
    expect(h.spoken).toEqual([]);
    h.setCanSpeak(true);
    h.cards.quiet();
    expect(h.spoken).toEqual([
      "First, I've drafted a message to Halyard Security. Send it?",
    ]);
    // A note that only informs is not said.
    noteToLine(FOCUS, false);
    expect(h.spoken).toHaveLength(1);
  });

  it("prefers the sender's ready line, and says a late briefing's own words", () => {
    expect(spokenNote("anything", "Here's your morning.")).toBe(
      "Here's your morning.",
    );
    expect(
      spokenNote(
        'Your briefing for them just came in: "Two investors replied overnight." At a natural pause, tell them this in your own words, briefly, then stop.',
      ),
    ).toBe("Your briefing just came in. Two investors replied overnight.");
    expect(spokenNote("Nothing to say here.")).toBeNull();
  });
});

describe("a spoken answer's chain of client actions (with workstream C)", () => {
  it("announces the move first, then performs every action in order, and leaves the move to the caller", () => {
    const calls: string[] = [];
    const turn: QVoiceTurnState = {
      sequence: 3,
      asking: null,
      navigate: "CAPITAL",
      handoff: null,
      degraded: false,
      clientAction: { kind: "RELOAD_PAGE" },
      clientActions: [
        { kind: "SET_THEME", theme: "DARK" },
        { kind: "RELOAD_PAGE" },
      ],
    } as QVoiceTurnState;
    const left = performTurnChain(
      turn,
      (action) => {
        calls.push(`act:${JSON.stringify(action)}`);
        return true;
      },
      (path) => {
        calls.push(`expect:${path ?? ""}`);
      },
      () => undefined,
    );
    expect(calls[0]).toMatch(/^expect:\/capital/u);
    expect(calls.slice(1)).toEqual([
      'act:{"kind":"SET_THEME","theme":"DARK"}',
      'act:{"kind":"RELOAD_PAGE"}',
    ]);
    expect(left.navigate).toBe("CAPITAL");
    expect(left.clientAction).toBeNull();
    expect(left.clientActions).toEqual([]);
  });

  it("still performs a lone clientAction from an older board", () => {
    const calls: unknown[] = [];
    performTurnChain(
      {
        sequence: 1,
        asking: null,
        navigate: null,
        handoff: null,
        degraded: false,
        clientAction: { kind: "RELOAD_PAGE" },
      },
      (action) => {
        calls.push(action);
        return true;
      },
      () => undefined,
    );
    expect(calls).toEqual([{ kind: "RELOAD_PAGE" }]);
  });
});

describe("a spoken move reports its receipt like a typed one (with workstream C)", () => {
  const moveTurn = {
    sequence: 7,
    asking: null,
    navigate: "CAPITAL",
    handoff: null,
    degraded: false,
  } as QVoiceTurnState;

  it("a move that never opens is reported FAILED, and the line is told to say so", () => {
    vi.useFakeTimers();
    try {
      const outcomes: NavigationOutcome[] = [];
      const notes: (string | undefined)[] = [];
      cleanups.push(onNavigationOutcome((o) => outcomes.push(o)));
      cleanups.push(
        onLineNote((_note, respond, say) => {
          if (respond) notes.push(say);
        }),
      );
      // No router on this screen and no call: the last resort is a load,
      // which (here) never lands.
      setHardLoad(() => undefined);
      cleanups.push(() => setHardLoad(null));
      performTurnChain(moveTurn, () => true);
      vi.advanceTimersByTime(NAVIGATION_WAIT_MS + 10);
      expect(outcomes).toEqual([
        {
          status: "FAILED",
          intentId: expect.any(String) as unknown,
          expected: expect.stringMatching(/capital/u) as unknown,
          reason: "NOT_LANDED",
        },
      ]);
      expect(notes).toEqual([MOVE_FAILED_LINE]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a move that lands is reported DONE, and nothing is said about it", () => {
    vi.useFakeTimers();
    try {
      const outcomes: NavigationOutcome[] = [];
      const notes: (string | undefined)[] = [];
      cleanups.push(onNavigationOutcome((o) => outcomes.push(o)));
      cleanups.push(
        onLineNote((_note, respond, say) => {
          if (respond) notes.push(say);
        }),
      );
      noteRoute("/somewhere-else");
      performTurnChain(moveTurn, () => true);
      const expected = outcomes.length;
      noteRoute("/capital");
      expect(outcomes.slice(expected)[0]).toMatchObject({ status: "DONE" });
      vi.advanceTimersByTime(NAVIGATION_WAIT_MS + 10);
      expect(notes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
