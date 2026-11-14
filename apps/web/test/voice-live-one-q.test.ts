import { isQVoiceSmallTalk } from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

import {
  createLiveBridge,
  HOLDING_CONTENT,
  ROUTE_AFTER_MS,
  ROUTED_NOTE,
  type LiveRouting,
} from "../src/features/voice/live/bridge";

/**
 * Owner 14 Nov 2026: "the voice is doing its own thing and Q is doing its
 * own thing." Replays the audit's live shapes (session eda5cd98, D3/D6)
 * through the bridge, no provider: code routes every utterance but small
 * talk to Q, the voice speaks Q's words, and nothing is ad-libbed while Q
 * works or claimed when nothing runs.
 */

type Sent = { type: string; delegation_id: string | null; content: string };

function harness(
  routing: LiveRouting | null = { isSmallTalk: isQVoiceSmallTalk },
) {
  let clock = 0;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 0;
  const sent: Sent[] = [];
  const pending = new Map<
    string,
    (outcome: { commentary: string | null }) => void
  >();
  const asked: { delegationId: string; request: string }[] = [];
  const bridge = createLiveBridge({
    send: (event) => {
      sent.push(event);
    },
    delegate: (request) => {
      asked.push({
        delegationId: request.delegationId,
        request: request.request,
      });
      return new Promise((resolve) => {
        pending.set(request.delegationId, resolve);
      });
    },
    newEventId: () => `e${String(sent.length)}`,
    now: () => clock,
    settleMs: 300,
    progressAfterMs: 5_000,
    routing: () => routing,
    timers: {
      setTimeout: (run, ms) => {
        nextId += 1;
        timers.push({ at: clock + ms, run, id: nextId });
        return nextId;
      },
      clearTimeout: (handle) => {
        const index = timers.findIndex((t) => t.id === handle);
        if (index >= 0) timers.splice(index, 1);
      },
    },
  });
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (next === undefined || next.at > until) break;
      timers.shift();
      clock = next.at;
      next.run();
    }
    clock = until;
  };
  const heard = (text: string) => {
    bridge.handle({ type: "session.input_transcript.delta", delta: text });
  };
  const said = (text: string) => {
    bridge.handle({ type: "session.output_transcript.delta", delta: text });
  };
  const delegation = (id: string) => {
    bridge.handle({
      type: "session.delegation.created",
      delegation: { id, type: "delegation", target: "client" },
    });
  };
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  const spoken = () =>
    sent.filter((e) => e.type === "session.commentary.append");
  return {
    bridge,
    sent,
    asked,
    pending,
    advance,
    heard,
    said,
    delegation,
    settle,
    spoken,
  };
}

/** Quiet long enough for code to read the utterance as finished. */
const FINISHED = ROUTE_AFTER_MS + 400;

describe("live line: code routes every turn but small talk to Q (D3)", () => {
  it.each([
    "go ahead",
    "I'm waiting for you",
    "still there?",
    "Excluding anyone I've already been in touch with, who fits best?",
  ])("'%s' reaches Q without the voice delegating it", (words) => {
    const h = harness();
    h.heard(words);
    h.advance(FINISHED);
    expect(h.asked).toEqual([{ delegationId: "heard_1", request: words }]);
    // The voice is told not to answer the words itself.
    expect(h.sent[0]).toMatchObject({
      type: "session.thinking.append",
      content: ROUTED_NOTE,
    });
  });

  it("leaves closed-set small talk to the voice", () => {
    const h = harness();
    h.heard("thanks, that's great");
    h.advance(FINISHED);
    expect(h.asked).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("sends a bare yes to Q when Q's last words asked them something", () => {
    const h = harness();
    h.said("I'd need to re-run the sweep. Want me to do that?");
    h.heard("yes");
    h.advance(FINISHED);
    expect(h.asked).toEqual([{ delegationId: "heard_1", request: "yes" }]);
  });

  it("routes small talk too when Q leads the call (guided)", () => {
    const h = harness({ isSmallTalk: isQVoiceSmallTalk, guided: true });
    h.heard("okay");
    h.advance(FINISHED);
    expect(h.asked.map((a) => a.request)).toEqual(["okay"]);
  });

  it("does not route while they are still talking", () => {
    const h = harness();
    h.heard("show me");
    h.advance(ROUTE_AFTER_MS - 200);
    h.heard(" the deck for Tensorgate");
    h.advance(ROUTE_AFTER_MS - 200);
    expect(h.asked).toEqual([]);
    h.advance(400);
    expect(h.asked.map((a) => a.request)).toEqual([
      "show me the deck for Tensorgate",
    ]);
  });

  it("one run when the voice delegates the same words after code routed them", async () => {
    const h = harness();
    h.heard("go ahead");
    h.advance(FINISHED);
    h.delegation("dlg_late");
    h.advance(2_000);
    expect(h.asked).toHaveLength(1);
    h.pending.get("heard_1")?.({
      commentary:
        "Say exactly the following words aloud. Words: Re-running it now.",
    });
    await h.settle();
    const spoken = h.spoken();
    expect(spoken).toHaveLength(1);
    // The answer closes the provider's delegation.
    expect(spoken[0]?.delegation_id).toBe("dlg_late");
  });

  it("one run when the voice delegates first", () => {
    const h = harness();
    h.heard("what's my top fit");
    h.delegation("dlg_1");
    h.advance(FINISHED + 2_000);
    expect(h.asked).toEqual([
      { delegationId: "dlg_1", request: "what's my top fit" },
    ]);
  });

  it("the voice decides only when the line is not routed (the interview)", () => {
    const h = harness(null);
    h.heard("go ahead");
    h.advance(FINISHED + 5_000);
    expect(h.asked).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

describe("live line: nothing ad-libbed while Q works, nothing claimed when nothing runs (D3, D6)", () => {
  it("a 20 s run gets exactly one holding line, with no question in it, then Q's words", async () => {
    const h = harness();
    h.heard("who are my strongest new fits");
    h.advance(FINISHED);
    h.advance(20_000);
    const holding = h.spoken();
    expect(holding).toHaveLength(1);
    expect(holding[0]?.content).toBe(HOLDING_CONTENT);
    expect(holding[0]?.content).not.toMatch(/keep the conversation|ask them/iu);
    h.pending.get("heard_1")?.({ commentary: "Q's exact words." });
    await h.settle();
    expect(h.spoken().map((e) => e.content)).toEqual([
      HOLDING_CONTENT,
      "Q's exact words.",
    ]);
  });

  it("says nothing at all when no run is running", () => {
    const h = harness();
    h.heard("thanks");
    h.advance(60_000);
    expect(h.sent).toEqual([]);
  });

  it("speaks a slow earlier answer as Q gave it, with no wrapper of the voice's own", async () => {
    const h = harness();
    h.heard("rank my pipeline");
    h.advance(FINISHED);
    h.heard("I'm waiting");
    h.advance(FINISHED);
    expect(h.asked.map((a) => a.request)).toEqual([
      "rank my pipeline",
      "I'm waiting",
    ]);
    h.pending.get("heard_1")?.({ commentary: "Q's ranking words." });
    await h.settle();
    expect(h.spoken().at(-1)?.content).toBe("Q's ranking words.");
  });
});
