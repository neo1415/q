import { describe, expect, it } from "vitest";

import {
  asksToSkipDiscovery,
  atMostOneQuestion,
  conversationMode,
  coverageFromCompany,
  coverageFromMandate,
  coverageFromOnboarding,
  DISCOVERY_EXIT_CHIP,
  DISCOVERY_GAPS,
  DISCOVERY_QUESTION_CAP,
  discoveryNote,
  discoveryTurn,
  INITIAL_CONVERSATION_STATE,
  nextDiscoveryGap,
  reduceAll,
  reduceConversation,
  type ConversationState,
  type DiscoveryCoverage,
} from "../src/index.js";

const founder: DiscoveryCoverage = { side: "FOUNDER", known: [] };

const turn = (
  state: ConversationState,
  input: Partial<Parameters<typeof discoveryTurn>[1]>,
) => {
  const decided = discoveryTurn(state, {
    words: "help",
    discoveryShape: false,
    underspecified: false,
    task: false,
    coverage: founder,
    ...input,
  });
  return { ...decided, state: reduceAll(state, decided.events) };
};

describe("HQ-5 discovery mode in the conversation reducer", () => {
  it("is entered when the plan picks DISCOVERY", () => {
    const one = turn(INITIAL_CONVERSATION_STATE, { discoveryShape: true });
    expect(conversationMode(one.state)).toBe("DISCOVERY");
    expect(one.turn?.kind).toBe("ASK");
  });

  it("is entered when underspecified repeats, not on the first one", () => {
    const first = turn(INITIAL_CONVERSATION_STATE, { underspecified: true });
    expect(first.turn).toBeNull();
    expect(conversationMode(first.state)).toBe("TASK");
    const second = turn(first.state, { underspecified: true });
    expect(conversationMode(second.state)).toBe("DISCOVERY");
    expect(second.turn?.kind).toBe("ASK");
  });

  it("a clear ask between two vague ones resets the streak", () => {
    const a = turn(INITIAL_CONVERSATION_STATE, { underspecified: true });
    const b = turn(a.state, { underspecified: false });
    const c = turn(b.state, { underspecified: true });
    expect(conversationMode(c.state)).toBe("TASK");
  });

  it("asks one gap a turn, never one already declared or asked", () => {
    const coverage: DiscoveryCoverage = {
      side: "FOUNDER",
      known: ["WHAT_THEY_DO", "STAGE"],
    };
    let state = INITIAL_CONVERSATION_STATE;
    const asked: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const next = turn(state, { discoveryShape: i === 0, coverage });
      state = next.state;
      if (next.turn?.kind !== "ASK") throw new Error("expected a question");
      asked.push(next.turn.gap);
      expect(next.turn.known).toEqual([
        "what the company does",
        "the company's stage",
      ]);
      expect(next.turn.chips).toContain(DISCOVERY_EXIT_CHIP);
    }
    expect(asked).toEqual(["TRACTION", "RAISE_AMOUNT", "TIMELINE"]);
  });

  it("every question is about something they did, never a hypothetical", () => {
    for (const gap of [...DISCOVERY_GAPS.FOUNDER, ...DISCOVERY_GAPS.INVESTOR]) {
      expect(gap.question, gap.key).toMatch(/\blast\b/iu);
      expect(gap.question, gap.key).not.toMatch(
        /\bwould you\b|\bif you\b|\bimagine\b/iu,
      );
      expect(gap.question.match(/\?/gu)?.length, gap.key).toBe(1);
    }
  });

  it('"just show me" exits, in their words or by the chip, and holds', () => {
    for (const words of [
      DISCOVERY_EXIT_CHIP,
      "ok, just show me",
      "skip",
      "stop asking questions",
      "Just show me the list please",
    ]) {
      const opened = turn(INITIAL_CONVERSATION_STATE, { discoveryShape: true });
      const exit = turn(opened.state, { words });
      expect(exit.turn, words).toEqual({
        kind: "EXIT",
        reason: "ASKED_TO_SKIP",
        known: [],
      });
      expect(conversationMode(exit.state)).toBe("TASK");
      // Vague again later: no more questions in this conversation.
      const later = turn(exit.state, {
        discoveryShape: true,
        underspecified: true,
      });
      expect(later.turn, words).toBeNull();
    }
  });

  it("only a whole turn asking to skip is an exit", () => {
    expect(asksToSkipDiscovery("show me how you got that number")).toBe(false);
    expect(
      asksToSkipDiscovery("can you skip the intro and tell me about Maji Loop"),
    ).toBe(false);
    expect(asksToSkipDiscovery("Just show me.")).toBe(true);
  });

  it("the opening ask itself is never read as an exit", () => {
    const opened = turn(INITIAL_CONVERSATION_STATE, {
      discoveryShape: true,
      words: "just show me",
    });
    expect(opened.turn?.kind).toBe("ASK");
  });

  it("a clear task ends discovery and is answered as itself", () => {
    const opened = turn(INITIAL_CONVERSATION_STATE, { discoveryShape: true });
    const task = turn(opened.state, { task: true });
    expect(task.turn).toBeNull();
    expect(task.state.discovery.exited).toBe("TASK");
    // Not sticky: a later vague ask opens it again.
    const again = turn(task.state, { discoveryShape: true });
    expect(again.turn?.kind).toBe("ASK");
  });

  it("stops at the question cap", () => {
    const state: ConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      discovery: {
        active: true,
        asked: Array.from(
          { length: DISCOVERY_QUESTION_CAP },
          (_, i) => `G${String(i)}`,
        ),
        underspecifiedInARow: 0,
        exited: null,
      },
    };
    const capped = turn(state, {});
    expect(capped.turn).toEqual({ kind: "EXIT", reason: "CAP", known: [] });
    expect(turn(capped.state, { discoveryShape: true }).turn).toBeNull();
  });

  it("moves to a next step when every gap is covered, or there is no gap model", () => {
    const covered = turn(INITIAL_CONVERSATION_STATE, {
      discoveryShape: true,
      coverage: {
        side: "INVESTOR",
        known: DISCOVERY_GAPS.INVESTOR.map((gap) => gap.key),
      },
    });
    expect(covered.turn?.kind === "EXIT" && covered.turn.reason).toBe(
      "COVERED",
    );
    const none = turn(INITIAL_CONVERSATION_STATE, {
      discoveryShape: true,
      coverage: null,
    });
    expect(none.turn?.kind === "EXIT" && none.turn.reason).toBe("NO_GAP_MODEL");
  });

  it("other events leave discovery as it is", () => {
    const opened = turn(INITIAL_CONVERSATION_STATE, { discoveryShape: true });
    const after = reduceConversation(opened.state, { type: "TURN_STARTED" });
    expect(after.discovery).toBe(opened.state.discovery);
  });
});

describe("HQ-5 the gap model's coverage", () => {
  it("reads onboarding steps", () => {
    expect(
      coverageFromOnboarding("FOUNDER", [
        "F1.stage",
        "F6.target_amount",
        "F5.customers",
      ]),
    ).toEqual(["STAGE", "TRACTION", "RAISE_AMOUNT"]);
    expect(
      coverageFromOnboarding("INVESTOR", ["I2.cheque_min", "I3.geography"]),
    ).toEqual(["CHEQUE_SIZE", "GEOGRAPHIES"]);
  });

  it("reads a declared mandate, wherever a dimension is stated", () => {
    expect(
      coverageFromMandate({
        cheque: { typical: "250000" },
        stage: { minStageCode: "seed", maxStageCode: null },
        constraints: [{ dimension: "investment_role" }],
        taxonomyPreferences: [
          { vocabularyCode: "industry" },
          { vocabularyCode: "geography" },
        ],
      }),
    ).toEqual([
      "SECTORS",
      "STAGES",
      "CHEQUE_SIZE",
      "GEOGRAPHIES",
      "LEAD_OR_FOLLOW",
    ]);
    expect(
      coverageFromMandate({
        cheque: null,
        stage: { minStageCode: null, maxStageCode: null },
        constraints: [],
        taxonomyPreferences: [],
      }),
    ).toEqual([]);
  });

  it("reads the company record", () => {
    expect(
      coverageFromCompany({ stageCode: "seed", shortDescription: " " }),
    ).toEqual(["STAGE"]);
  });

  it("the next gap skips known and asked", () => {
    expect(
      nextDiscoveryGap({
        side: "INVESTOR",
        known: ["SECTORS"],
        asked: ["STAGES"],
      })?.key,
    ).toBe("CHEQUE_SIZE");
  });
});

describe("HQ-5 discovery's note and its one question", () => {
  it("ASK names the one question and what is already held", () => {
    const opened = turn(INITIAL_CONVERSATION_STATE, {
      discoveryShape: true,
      coverage: { side: "FOUNDER", known: ["STAGE"] },
    });
    if (opened.turn === null) throw new Error("expected a turn");
    const note = discoveryNote(opened.turn);
    expect(note).toContain("ask exactly this one question");
    expect(note).toContain("The last time you explained the company");
    expect(note).toContain("never ask about it: the company's stage");
  });

  it("EXIT asks for a concrete, grounded next step and no question", () => {
    const note = discoveryNote({
      kind: "EXIT",
      reason: "ASKED_TO_SKIP",
      known: [],
    });
    expect(note).toContain("Ask no question");
    expect(note).toContain("one concrete recommendation or next step");
    expect(note).toContain("grounded only in what Capital Q holds");
  });

  it("keeps code's question, or else the first, and the reflection", () => {
    expect(
      atMostOneQuestion(
        "You followed on a seed. How much do you invest? What did you pass on last?",
        "What did you pass on last?",
      ),
    ).toBe("You followed on a seed. What did you pass on last?");
    expect(atMostOneQuestion("Got it. Where? Why?")).toBe("Got it. Where?");
    expect(atMostOneQuestion("One thing. Where?")).toBe("One thing. Where?");
  });
});
