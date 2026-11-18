import { readFileSync } from "node:fs";

import { isQVoiceSmallTalk } from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

import {
  afterMove,
  asksToRepeat,
  compareSpoken,
  completeRequest,
  CONTINUE_AFTER_MS,
  createLiveBridge,
  endsUnfinished,
  HOLDING_CONTENT,
  HOLDING_LINE,
  MOVE_FAILED_LINE,
  ROUTE_AFTER_MS,
  sayExactly,
  type DelegationOutcome,
  type DelegationRequest,
  type MoveReceipt,
} from "../src/features/voice/live/bridge";
import { fastMoveLine } from "../src/features/voice/live/live-call";
import { moveNote } from "../src/features/voice/live/move";

/**
 * Audit 15 Nov 2026 (RC1): the voice is an I/O channel for the one Q.
 * Replays the owner's founder session turns (founder-turns.jsonl, F7)
 * through the bridge with no provider: one code-chosen holding line at
 * most, "say that again" replays Q's words by code, a sentence a pause
 * split is one run, a cut approval line is reported, and the voice is
 * never told a page is "coming up".
 */

type Turn = { readonly turn_id: string; readonly user_words: string | null };

const AUDIT = new URL(
  "../../../docs/ai-handoff/audits/2026-11-15-q-voice-audit/founder-turns.jsonl",
  import.meta.url,
);
const turns: readonly Turn[] = readFileSync(AUDIT, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Turn);
const words = (id: string): string => {
  const said = turns.find((turn) => turn.turn_id === id)?.user_words;
  if (typeof said !== "string") throw new Error(`no words for ${id}`);
  return said;
};

type Sent = { type: string; delegation_id: string | null; content: string };

function harness(options: { receipt?: MoveReceipt | null } = {}) {
  let clock = 0;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 0;
  const sent: Sent[] = [];
  const pending = new Map<string, (outcome: DelegationOutcome) => void>();
  const asked: DelegationRequest[] = [];
  const bridge = createLiveBridge({
    send: (event) => {
      sent.push(event);
    },
    delegate: (request) => {
      asked.push(request);
      return new Promise((resolve) => {
        pending.set(
          `${request.delegationId}${request.early === true ? ":early" : ""}`,
          resolve,
        );
      });
    },
    newEventId: () => `e${String(sent.length)}`,
    now: () => clock,
    settleMs: 300,
    progressAfterMs: 5_000,
    routing: () => ({ isSmallTalk: isQVoiceSmallTalk }),
    followMove: () => Promise.resolve(options.receipt ?? null),
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
  const settle = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };
  /** Q answers a delegation (its early ask and then the whole). */
  const answer = async (id: string, outcome: DelegationOutcome) => {
    pending.get(`${id}:early`)?.(outcome);
    await settle();
  };
  const spoken = () =>
    sent
      .filter((e) => e.type === "session.commentary.append")
      .map((e) => e.content);
  return { bridge, sent, asked, advance, heard, said, settle, answer, spoken };
}

const FINISHED = ROUTE_AFTER_MS + 100;
const qAnswer = (said: string, extra: Partial<DelegationOutcome> = {}) => ({
  commentary: sayExactly(said),
  said,
  runId: "11111111-1111-4111-8111-111111111111",
  ...extra,
});

describe("holding lines: one, code-chosen, only for a run still going (RC1)", () => {
  it("a turn answered fast gets no holding line at all", async () => {
    const h = harness();
    h.heard(words("F7-09"));
    h.advance(FINISHED);
    h.advance(3_000);
    await h.answer("heard_1", qAnswer("Here are the strongest fits."));
    h.advance(10_000);
    expect(h.spoken().some((line) => line === HOLDING_CONTENT)).toBe(false);
    expect(h.spoken()).toEqual([sayExactly("Here are the strongest fits.")]);
  });

  it("a slow run gets exactly one, and the answer follows with nothing stacked", async () => {
    const h = harness();
    h.heard(words("F7-04"));
    h.advance(FINISHED);
    h.advance(30_000);
    await h.answer(
      "heard_1",
      qAnswer("Start with three months of revenue evidence."),
    );
    const spoken = h.spoken();
    expect(spoken.filter((line) => line === HOLDING_CONTENT)).toHaveLength(1);
    expect(spoken).toHaveLength(2);
    const handed = h.bridge.takeHanded().map((line) => line.kind);
    expect(handed).toEqual(["HOLDING", "ANSWER"]);
  });

  it("no holding line once the start of the answer was said", async () => {
    const h = harness();
    h.heard(words("F7-06"));
    h.advance(FINISHED);
    h.advance(1_000);
    await h.answer("heard_1", {
      ...qAnswer("Add three months of revenue evidence."),
      partial: true,
    });
    h.advance(20_000);
    expect(h.spoken().some((line) => line === HOLDING_CONTENT)).toBe(false);
  });

  it("an utterance that becomes two runs still gets one holding line", () => {
    const h = harness();
    h.heard("Compare Zino Aviation and Nixo on revenue?");
    h.advance(FINISHED);
    h.advance(6_000);
    h.heard("Also tell me who leads each.");
    h.advance(FINISHED);
    h.advance(10_000);
    // Holding for the first; the second came after they spoke again and
    // gets its own, never two on top of each other, and never the same
    // words twice in a row (owner 18 Nov 2026).
    const holdings = h
      .spoken()
      .filter((line) => line.startsWith("Say only this short line aloud"));
    expect(holdings.length).toBeLessThanOrEqual(2);
    if (holdings.length === 2) expect(holdings[1]).not.toBe(holdings[0]);
    expect(
      h.bridge.takeHanded().filter((l) => l.kind === "HOLDING"),
    ).toHaveLength(holdings.length);
  });

  it("the holding line itself claims nothing", () => {
    expect(HOLDING_LINE).toBe("Working on it.");
    expect(HOLDING_CONTENT).toMatch(/Ask nothing/u);
  });
});

describe("'say that again' replays Q's last words by code (founder F7-15, F7-16)", () => {
  const LAST =
    "I excluded Zino Aviation because you're already in diligence with them.";

  it.each(["F7-15", "F7-16"])(
    "%s: no Q run, Q's exact words again",
    async (id) => {
      const h = harness();
      h.heard(
        "Leave out companies I'm already talking to. Who are the best fits?",
      );
      h.advance(FINISHED);
      await h.answer("heard_1", qAnswer(LAST));
      h.said(LAST);
      h.heard(words(id));
      h.advance(FINISHED + CONTINUE_AFTER_MS);
      expect(h.asked.filter((a) => a.early === true)).toHaveLength(1);
      expect(h.spoken().at(-1)).toBe(sayExactly(LAST));
      expect(h.bridge.takeHanded().at(-1)).toMatchObject({
        kind: "REPEAT",
        words: LAST,
      });
    },
  );

  it("reads only a closed set of repeat requests", () => {
    for (const ask of [
      "repeat that",
      "Say that again",
      "can you say that again please",
      "Sorry, what did you say?",
      "pardon",
      words("F7-15"),
      words("F7-16"),
    ]) {
      expect(asksToRepeat(ask)).toBe(true);
    }
    for (const ask of [
      "repeat the analysis for Nixo",
      "say again why Zino is first and compare it with Chidi",
      "what did you say about Nixo's revenue",
      "Can you repeat the sweep with pre-revenue companies only",
    ]) {
      expect(asksToRepeat(ask)).toBe(false);
    }
  });
});

describe("a sentence a pause split is one run (founder F7-03, F7-22)", () => {
  it("F7-03: '…Um. So' waits for the rest instead of routing alone", () => {
    const h = harness();
    const whole = words("F7-03");
    const cut = whole.indexOf(" , which");
    h.heard(whole.slice(0, cut));
    h.advance(FINISHED);
    expect(h.asked).toEqual([]);
    h.heard(whole.slice(cut));
    h.advance(FINISHED + CONTINUE_AFTER_MS);
    expect(h.asked.map((a) => a.request)).toEqual([
      expect.stringContaining("which problems can we fix"),
    ]);
    expect(h.asked[0]?.request).toMatch(/^Thank you\. Um\. So/u);
  });

  it("F7-22: the rest replaces the run on the first half, which is never spoken", async () => {
    const h = harness();
    const whole = words("F7-22");
    const cut = whole.indexOf(" . Just confirm");
    h.heard(whole.slice(0, cut + 2));
    h.advance(FINISHED);
    expect(h.asked.map((a) => a.delegationId)).toEqual(["heard_1"]);
    h.advance(1_500);
    h.heard(whole.slice(cut + 2));
    h.advance(FINISHED);
    const merged = h.asked.at(-1);
    expect(merged).toMatchObject({
      delegationId: "heard_2",
      replaces: "heard_1",
    });
    expect(merged?.request).toContain("I thought Zino Aviation was the first");
    expect(merged?.request).toContain("Just confirm");
    await h.answer(
      "heard_1",
      qAnswer("Chidi was first in the earlier shortlist."),
    );
    await h.answer(
      "heard_2",
      qAnswer("Yes, Zino Aviation was first and Chidi second."),
    );
    expect(h.spoken()).toEqual([
      sayExactly("Yes, Zino Aviation was first and Chidi second."),
    ]);
  });

  it("a whole request is never merged into the next one", () => {
    const h = harness();
    h.heard("What's Nixo's runway?");
    h.advance(FINISHED);
    h.advance(1_000);
    h.heard("And show me Zino Aviation's deck.");
    h.advance(FINISHED);
    expect(h.asked.at(-1)?.replaces).toBeUndefined();
  });

  it("reads open endings and whole requests by code", () => {
    expect(endsUnfinished("Thank you. Um. So")).toBe(true);
    expect(endsUnfinished("which problems, and")).toBe(true);
    expect(endsUnfinished("Show me the deck.")).toBe(false);
    expect(completeRequest("I thought Zino Aviation was the first .")).toBe(
      false,
    );
    expect(
      completeRequest("What would materially improve your assessment?"),
    ).toBe(true);
    expect(completeRequest("Show me Tensorgate's deck.")).toBe(true);
  });
});

describe("a spoken yes after a cut approval line (founder P1, F7-11/F7-12)", () => {
  const APPROVAL =
    "It's drafted and on the card for your approval. Nothing is sent until you approve it. Shall I go ahead?";

  it("tells Q the line was cut, so the content is read back first", async () => {
    const h = harness();
    h.heard(words("F7-11"));
    h.advance(FINISHED + CONTINUE_AFTER_MS);
    await h.answer("heard_1", qAnswer(APPROVAL, { approvalPending: true }));
    // The voice stopped at "on the card for your ap…".
    h.said("It's drafted and on the card for your ap");
    h.heard(words("F7-12"));
    h.advance(FINISHED);
    expect(h.asked.at(-1)).toMatchObject({ request: "Yes", lastLineCut: true });
  });

  it("a line heard to its end is not reported cut", async () => {
    const h = harness();
    h.heard(words("F7-11"));
    h.advance(FINISHED + CONTINUE_AFTER_MS);
    await h.answer("heard_1", qAnswer(APPROVAL, { approvalPending: true }));
    h.said(APPROVAL);
    h.heard("Yes");
    h.advance(FINISHED);
    expect(h.asked.at(-1)?.lastLineCut).toBeUndefined();
  });
});

describe("the voice never says a page is coming up (RC1, F7-03, F7-06)", () => {
  const SAID =
    "I've opened Capital. The main distinction is straightforward: documentation can remove uncertainty.";

  it("a page still loading: Q's claim is dropped by code, nothing is added", async () => {
    const h = harness({ receipt: "PENDING" });
    h.heard("which problems can we fix through better documentation?");
    h.advance(FINISHED);
    await h.answer(
      "heard_1",
      qAnswer(SAID, { move: { navigate: "CAPITAL", action: null } }),
    );
    expect(h.spoken()).toEqual([
      sayExactly(
        "The main distinction is straightforward: documentation can remove uncertainty.",
      ),
    ]);
    expect(h.spoken().join(" ")).not.toMatch(/coming up|opened/u);
  });

  it("a page that opened: Q's words exactly as given", async () => {
    const h = harness({ receipt: "DONE" });
    h.heard("open capital");
    h.advance(FINISHED);
    await h.answer(
      "heard_1",
      qAnswer(SAID, { move: { navigate: "CAPITAL", action: null } }),
    );
    expect(h.spoken()).toEqual([sayExactly(SAID)]);
  });

  it("a page that did not open says so in code's words", () => {
    const out = afterMove(qAnswer(SAID), SAID, "FAILED");
    expect(out.said).toBe(
      `${MOVE_FAILED_LINE} The main distinction is straightforward: documentation can remove uncertainty.`,
    );
  });

  it("no note or fast line tells the voice to say 'coming up'", () => {
    expect(moveNote("PENDING")).not.toMatch(/say it is coming up/u);
    expect(fastMoveLine("/discover", "PENDING")).not.toMatch(
      /say it is coming up/u,
    );
  });
});

describe("what the voice said is checked against what it was handed (RC5)", () => {
  it("finds added words, changed figures and a cut line", () => {
    const handed =
      "Pre-seed to Series A, with fifty thousand to one hundred million euros cheques.";
    expect(compareSpoken(handed, handed)).toEqual({
      diverged: false,
      cut: false,
    });
    expect(
      compareSpoken(
        handed,
        "Pre-seed to Series A, with 50 billion to 100 million euros cheques.",
      ),
    ).toMatchObject({ diverged: true });
    expect(compareSpoken(handed, `Mm. ${handed}`)).toMatchObject({
      diverged: true,
      cut: false,
    });
    expect(compareSpoken(handed, "Pre-seed to Series A, with fifty")).toEqual({
      diverged: true,
      cut: true,
    });
  });
});

type InvestorTurn = {
  readonly turn_id: string;
  readonly user_words: string | null;
  readonly q_text: string | null;
};
const investor: readonly InvestorTurn[] = readFileSync(
  new URL(
    "../../../docs/ai-handoff/audits/2026-11-15-q-voice-audit/investor-turns.jsonl",
    import.meta.url,
  ),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as InvestorTurn);
const investorTurn = (id: string): InvestorTurn => {
  const turn = investor.find((one) => one.turn_id === id);
  if (turn === undefined) throw new Error(`no record ${id}`);
  return turn;
};

describe("every request of theirs gets exactly one spoken answer, the latest valid one (RC9)", () => {
  it("investor bdd2ef8f: an answer landing on their 'Um' waits for the pause, then is spoken", async () => {
    const h = harness();
    h.heard(investorTurn("v-47e5ab44-060").user_words ?? "");
    h.advance(FINISHED);
    h.advance(2_000);
    h.heard(investorTurn("v-47e5ab44-062").user_words ?? "");
    h.advance(200);
    const answer = (investorTurn("v-47e5ab44-063").q_text ?? "").replace(
      /…$/u,
      ".",
    );
    await h.answer("heard_1", qAnswer(answer));
    // Not handed over their words, and never dropped.
    expect(h.spoken()).toEqual([]);
    h.advance(1_000);
    await h.settle();
    expect(h.spoken()).toEqual([sayExactly(answer)]);
  });

  it("an older answer waits for the newer request and is dropped once that one is spoken", async () => {
    const h = harness();
    h.heard("What's Nixo's runway?");
    h.advance(FINISHED);
    h.heard("Who leads Zino Aviation's round?");
    h.advance(FINISHED);
    await h.answer("heard_1", qAnswer("Nixo has fourteen months of runway."));
    expect(h.spoken()).toEqual([]);
    await h.answer(
      "heard_2",
      qAnswer("Zino Aviation's round has no lead yet."),
    );
    expect(h.spoken()).toEqual([
      sayExactly("Zino Aviation's round has no lead yet."),
    ]);
    expect(
      h.sent.some(
        (e) =>
          e.type === "session.thinking.append" && e.content.includes("Nixo"),
      ),
    ).toBe(false);
  });

  it("the held older answer is spoken when the newer request comes back with nothing", async () => {
    const h = harness();
    h.heard("What's Nixo's runway?");
    h.advance(FINISHED);
    h.heard("Who leads Zino Aviation's round?");
    h.advance(FINISHED);
    await h.answer("heard_1", qAnswer("Nixo has fourteen months of runway."));
    await h.answer("heard_2", { commentary: null });
    expect(h.spoken()).toEqual([
      sayExactly("Nixo has fourteen months of runway."),
    ]);
  });

  it("a nudge never makes the answer they waited for past", async () => {
    const h = harness();
    h.heard("Rank my pipeline by fit?");
    h.advance(FINISHED);
    h.heard("I'm still waiting");
    h.advance(FINISHED);
    await h.answer("heard_1", qAnswer("Tensorgate first, then Ledgerfold."));
    expect(h.spoken()).toEqual([
      sayExactly("Tensorgate first, then Ledgerfold."),
    ]);
  });
});
