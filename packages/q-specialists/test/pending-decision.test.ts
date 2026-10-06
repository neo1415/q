import { describe, expect, it } from "vitest";

import {
  decidePending,
  statusLine,
  type PendingDecisionPort,
  type PendingDecisionStatus,
  type PendingTurnReading,
} from "../src/pending-decision.js";

/**
 * A typed yes or no to a waiting change (founder fixture #1; live
 * 2026-10-01: "yes, go ahead" -> "The reminder has been saved" while the
 * action still waited). The reading is a model's (faked here); approving
 * and the words about the result are code's.
 */
type Proposal = {
  proposalId: string;
  summary: string;
  status: PendingDecisionStatus;
};

/**
 * What a model reads the kind of reply to be (DECISION_READER v2, J7):
 * the fake model of these tests, by the words. Words not listed read as
 * nothing more than the decision the case gives.
 */
const ONLY = { onlyDecision: true } as const;
const CLEAR = { onlyDecision: true, explicit: true } as const;
const POINTED = {
  onlyDecision: true,
  explicit: true,
  pointsAtIt: true,
} as const;
const OWN_REQUEST = { asksSomethingElse: true } as const;
const MEANING: Readonly<
  Record<
    string,
    Partial<NonNullable<Awaited<ReturnType<PendingDecisionPort["read"]>>>>
  >
> = {
  yes: ONLY,
  "yes, go ahead": CLEAR,
  "go ahead": CLEAR,
  "approve it": POINTED,
  "Yes, send it to them": POINTED,
  "Okay. I give the approval. Go ahead.": CLEAR,
  "approve the Nixon one": { explicit: true, pointsAtIt: true },
  no: ONLY,
  "No thanks.": ONLY,
  "no, leave it": CLEAR,
  "cancel that": POINTED,
  "Cancel that.": POINTED,
  "scrap it": POINTED,
  "cancel the meeting": POINTED,
  "don't do it": POINTED,
  "no, scrap the Ajopot one": { explicit: true, pointsAtIt: true },
  "Cancel the call with Nixo.": { explicit: true, pointsAtIt: true },
  "yes, and what is next for Nixo?": { explicit: false },
  "go ahead and share it with Savanna Seed, approved": {
    explicit: true,
    pointsAtIt: true,
  },
  "yes but make it 30 minutes instead": OWN_REQUEST,
  "Yes, approve the meeting with Nixo for the next five minutes.": {
    explicit: true,
    pointsAtIt: true,
  },
  "Yes, confirm the meeting with Nixo in the next five minutes.": {
    explicit: true,
    pointsAtIt: true,
  },
  "Book another one with Nixo for the next five minutes.": {
    pointsAtIt: true,
    ...OWN_REQUEST,
  },
  "Yes, approve the meeting with Nixo but move it to three.": {
    explicit: true,
    pointsAtIt: true,
    ...OWN_REQUEST,
  },
  "Book a meeting with Nixo in the next five minutes.": {
    pointsAtIt: true,
    ...OWN_REQUEST,
  },
  "We've decided not to proceed with Ledgefold for now.": OWN_REQUEST,
  "We're starting diligence with Ledgerfold.": OWN_REQUEST,
  "Make Ajopot seed deck private to my organisation again": OWN_REQUEST,
  "don't proceed": OWN_REQUEST,
  "let's proceed with the pass": OWN_REQUEST,
  "Let's proceed with the pass on Ledgerfold.": OWN_REQUEST,
  "share my raise with Savanna Seed": { pointsAtIt: true, ...OWN_REQUEST },
  "just handle it": OWN_REQUEST,
};
/** Questions about something else read as nothing to decide. */
const UNRELATED_WORDS: ReadonlySet<string> = new Set([
  "what is Nixo raising?",
  "what's my runway?",
  "what's Nixo's runway?",
]);

function port(options: {
  readonly proposals: readonly Proposal[];
  readonly reading: Awaited<ReturnType<PendingDecisionPort["read"]>>;
  readonly approveStatus?: PendingDecisionStatus;
}) {
  const calls = { read: 0, approve: [] as string[], decline: [] as string[] };
  const value: PendingDecisionPort = {
    proposals: () => Promise.resolve(options.proposals),
    read: (input) => {
      calls.read += 1;
      if (options.reading === null) return Promise.resolve(null);
      if (UNRELATED_WORDS.has(input.utterance)) {
        return Promise.resolve({ decision: "UNRELATED", remainder: null });
      }
      return Promise.resolve({
        ...options.reading,
        ...(MEANING[input.utterance] ?? {}),
      });
    },
    approve: (_context, proposalId) => {
      calls.approve.push(proposalId);
      return Promise.resolve({ status: options.approveStatus ?? "SAVED" });
    },
    decline: (_context, proposalId) => {
      calls.decline.push(proposalId);
      return Promise.resolve({ status: "DECLINED" });
    },
  };
  return { value, calls };
}

const context = {
  actor: {} as never,
  runId: "run",
  correlationId: "cor_x",
  tenantId: "t",
  userId: "u",
};
const REMINDER: Proposal = {
  proposalId: "p1",
  summary: "Reminder: Send Savanna the updated deck.",
  status: "PENDING",
};
const turn = (utterance: string) => ({ context, utterance, recentTurns: [] });

describe("a typed decision on a waiting change", () => {
  it("approves the one waiting change on a yes, and says what the engine reports", async () => {
    const { value, calls } = port({
      proposals: [REMINDER],
      reading: { decision: "YES", remainder: null },
    });
    const outcome = await decidePending(value, turn("yes, go ahead"));
    expect(calls.approve).toEqual(["p1"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Reminder: Send Savanna the updated deck.",
    });
  });

  it("reports the engine's status, not success, when the approval did not save", async () => {
    for (const status of [
      "SAVING",
      "NOT_SAVED",
      "EXPIRED",
      "CHANGED",
    ] as const) {
      const { value } = port({
        proposals: [REMINDER],
        reading: { decision: "YES", remainder: null },
        approveStatus: status,
      });
      const outcome = await decidePending(value, turn("go ahead"));
      expect(outcome).toEqual({
        kind: "REPLY",
        line: statusLine(status, REMINDER.summary),
      });
      expect(statusLine(status, REMINDER.summary)).not.toMatch(/^Done/);
    }
  });

  it("reads nothing and approves nothing when nothing is waiting ('yes' with nothing pending)", async () => {
    const { value, calls } = port({
      proposals: [],
      reading: { decision: "YES", remainder: null },
    });
    expect(await decidePending(value, turn("yes"))).toEqual({ kind: "NONE" });
    expect(calls.read).toBe(0);
    expect(calls.approve).toEqual([]);
  });

  it("does not approve a stale proposal (expired, declined or already saved)", async () => {
    const { value, calls } = port({
      proposals: [
        { ...REMINDER, status: "EXPIRED" },
        { proposalId: "p2", summary: "Old change", status: "DECLINED" },
        { proposalId: "p3", summary: "Done change", status: "SAVED" },
      ],
      reading: { decision: "YES", remainder: null },
    });
    // Nothing waits: a yes is answered with where the latest one stands
    // (live 2026-10-02), and nothing is approved.
    expect(await decidePending(value, turn("yes"))).toEqual({
      kind: "REPLY",
      line: "Already approved and done: Done change.",
    });
    expect(calls.approve).toEqual([]);
    // Words about something else are read as such (J7), and decide nothing.
    expect(await decidePending(value, turn("what is Nixo raising?"))).toEqual({
      kind: "NONE",
    });
    expect(calls.read).toBe(2);
  });

  it("asks whether to go ahead with exactly this, unchanged, so a yes that changes it is not approved ('yes but change the time')", async () => {
    let asked = "";
    const { value, calls } = port({
      proposals: [REMINDER],
      // How the reader reads a change to the proposal under that question.
      reading: { decision: "NO", remainder: "make it 30 minutes instead" },
    });
    const outcome = await decidePending(
      {
        ...value,
        read: (input) => {
          asked = input.question;
          return value.read(input);
        },
      },
      turn("yes but make it 30 minutes instead"),
    );
    expect(asked).toContain("exactly this, unchanged");
    expect(calls.approve).toEqual([]);
    // Not approved, and not declined either (lead 2026-10-03: only an
    // explicit no declines): the change they want is answered as its own
    // proposal, and this one is said to be still waiting.
    expect(calls.decline).toEqual([]);
    expect(outcome).toEqual({
      kind: "ANSWER_THEN",
      before: null,
      after:
        "Still waiting for your approval: Reminder: Send Savanna the updated deck.",
      about: "Reminder: Send Savanna the updated deck.",
      aboutId: "p1",
    });
  });

  it("approves a yes with more said, then answers the rest", async () => {
    const { value, calls } = port({
      proposals: [REMINDER],
      reading: { decision: "YES", remainder: "and what is next for Nixo?" },
    });
    const outcome = await decidePending(
      value,
      turn("yes, and what is next for Nixo?"),
    );
    expect(calls.approve).toEqual(["p1"]);
    expect(outcome).toEqual({
      kind: "ANSWER_THEN",
      before: "Done: Reminder: Send Savanna the updated deck.",
      after: null,
    });
  });

  it("declines on a no, through the engine", async () => {
    const { value, calls } = port({
      proposals: [REMINDER],
      reading: { decision: "NO", remainder: null },
    });
    const outcome = await decidePending(value, turn("no, leave it"));
    expect(calls.decline).toEqual(["p1"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Declined: Reminder: Send Savanna the updated deck. Nothing was changed.",
    });
  });

  it("answers the turn as any other when the words are about something else, or were not read", async () => {
    for (const reading of [
      { decision: "UNRELATED" as const, remainder: null },
      null,
    ]) {
      const { value, calls } = port({ proposals: [REMINDER], reading });
      expect(await decidePending(value, turn("what's my runway?"))).toEqual({
        kind: "NONE",
      });
      expect(calls.approve).toEqual([]);
      expect(calls.decline).toEqual([]);
    }
  });

  it("asks which, by name, when more than one change is waiting", async () => {
    const { value, calls } = port({
      proposals: [
        REMINDER,
        { proposalId: "p2", summary: "Update your website", status: "PENDING" },
      ],
      reading: { decision: "YES", remainder: null },
    });
    const outcome = await decidePending(value, turn("yes"));
    expect(calls.approve).toEqual([]);
    expect(outcome.kind).toBe("REPLY");
    expect(outcome.kind === "REPLY" ? outcome.line : "").toContain(
      '"Reminder: Send Savanna the updated deck" and "Update your website"',
    );
  });
});

describe("a restatement is not an approval (QA 2026-10-03)", () => {
  const SHARE: Proposal = {
    proposalId: "s1",
    summary: "Share your raise with Savanna Seed",
    status: "PENDING",
  };

  it("the same request again, with the card waiting here: ready and waiting, nothing approved", async () => {
    const { value, calls } = port({
      proposals: [SHARE],
      reading: { decision: "YES", remainder: null },
    });
    const outcome = await decidePending(
      value,
      turn("share my raise with Savanna Seed"),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "That's ready: Share your raise with Savanna Seed. It's waiting for your yes. Tap Approve on the card, or tell me to go ahead.",
    });
  });

  it('"yes, go ahead" approves it', async () => {
    const { value, calls } = port({
      proposals: [SHARE],
      reading: { decision: "YES", remainder: null },
    });
    expect(await decidePending(value, turn("yes, go ahead"))).toEqual({
      kind: "REPLY",
      line: "Done: Share your raise with Savanna Seed.",
    });
    expect(calls.approve).toEqual(["s1"]);
  });
});

describe("only a reply to the card decides it (lead 2026-10-03, run ad0b0067)", () => {
  const PASS: Proposal = {
    proposalId: "be4511b3",
    summary: "Decide not to proceed for now",
    status: "PENDING",
  };
  const request = {
    kind: "TOOL_REQUEST",
    addressedToQ: true,
    namesAction: true,
  } as const;
  const statement = {
    kind: "ANSWER",
    addressedToQ: true,
    namesAction: true,
  } as const;
  const reply = {
    kind: "ANSWER",
    addressedToQ: true,
    namesAction: false,
  } as const;
  const said = (utterance: string, turn: PendingTurnReading | null) => ({
    ...turn_(utterance),
    turn,
  });
  const turn_ = (utterance: string) => ({
    context,
    utterance,
    recentTurns: [],
  });

  it.each([
    ["We've decided not to proceed with Ledgefold for now.", request],
    ["We've decided not to proceed with Ledgefold for now.", statement],
    ["We've decided not to proceed with Ledgefold for now.", null],
    ["don't proceed", request],
    ["let's proceed with the pass", request],
    ["Let's proceed with the pass on Ledgerfold.", statement],
  ] as const)(
    "%s (%o): neither approved nor declined, whatever the decision reading",
    async (utterance, turn) => {
      for (const decision of ["YES", "NO"] as const) {
        const { value, calls } = port({
          proposals: [PASS],
          reading: { decision, remainder: null },
        });
        const outcome = await decidePending(value, said(utterance, turn));
        expect(calls.approve).toEqual([]);
        expect(calls.decline).toEqual([]);
        expect(outcome).toEqual(
          decision === "YES"
            ? {
                kind: "REPLY",
                line: "That's ready: Decide not to proceed for now. It's waiting for your yes. Tap Approve on the card, or tell me to go ahead.",
              }
            : {
                kind: "ANSWER_THEN",
                before: null,
                after:
                  "Still waiting for your approval: Decide not to proceed for now.",
                about: "Decide not to proceed for now",
                aboutId: "be4511b3",
              },
        );
      }
    },
  );

  it.each([
    ["yes, go ahead", request],
    ["approve it", request],
    ["yes, go ahead", null],
    ["Yes, send it to them", reply],
  ] as const)("%s (%o) still approves", async (utterance, turn) => {
    const { value, calls } = port({
      proposals: [PASS],
      reading: { decision: "YES", remainder: null },
    });
    expect(await decidePending(value, said(utterance, turn))).toEqual({
      kind: "REPLY",
      line: "Done: Decide not to proceed for now.",
    });
    expect(calls.approve).toEqual(["be4511b3"]);
  });

  it("a request with nothing waiting is never answered 'already done'", async () => {
    const { value } = port({
      proposals: [{ ...PASS, status: "SAVED" }],
      reading: { decision: "YES", remainder: null },
    });
    expect(
      await decidePending(
        value,
        said("let's proceed with the pass on Ajopot", request),
      ),
    ).toEqual({ kind: "NONE" });
  });
});

describe("a new request never declines the waiting card (QA 2026-10-03)", () => {
  const PASS: Proposal = {
    proposalId: "o1",
    summary: "Decide not to proceed for now",
    status: "PENDING",
  };
  const DECK: Proposal = {
    proposalId: "d1",
    summary: "Make Ajopot seed deck visible to investors",
    status: "PENDING",
  };

  it.each([
    [PASS, "We're starting diligence with Ledgerfold."],
    [PASS, "We've decided not to proceed with Ledgefold for now."],
    [DECK, "Make Ajopot seed deck private to my organisation again"],
  ])(
    "%s / %s: read NO, still not declined; the card waits",
    async (card, words) => {
      const { value, calls } = port({
        proposals: [card],
        reading: { decision: "NO", remainder: words },
      });
      const outcome = await decidePending(value, turn(words));
      expect(calls.decline).toEqual([]);
      expect(calls.approve).toEqual([]);
      expect(outcome).toEqual({
        kind: "ANSWER_THEN",
        before: null,
        after: `Still waiting for your approval: ${card.summary}.`,
        about: card.summary,
        aboutId: card.proposalId,
      });
    },
  );

  it.each([
    "no",
    "No thanks.",
    "cancel that",
    "don't do it",
    "no, scrap the Ajopot one",
  ])("an explicit no declines it: %s", async (words) => {
    const { value, calls } = port({
      proposals: [DECK],
      reading: { decision: "NO", remainder: null },
    });
    expect(await decidePending(value, turn(words))).toEqual({
      kind: "REPLY",
      line: "Declined: Make Ajopot seed deck visible to investors. Nothing was changed.",
    });
    expect(calls.decline).toEqual(["d1"]);
  });
});

describe("a yes in a new conversation to a change asked for elsewhere (live 2026-10-01)", () => {
  const ERRAND: Proposal = {
    proposalId: "b23ff5cc",
    summary: "Q looks after Nixo for you",
    status: "PENDING",
  };
  const withElsewhere = (
    elsewhere: readonly Proposal[],
    reading: Awaited<ReturnType<PendingDecisionPort["read"]>>,
    here: readonly Proposal[] = [],
  ) => {
    const made = port({ proposals: here, reading });
    const asked: string[] = [];
    const value: PendingDecisionPort = {
      ...made.value,
      read: (input) => {
        asked.push(input.question);
        return made.value.read(input);
      },
      recentElsewhere: () => Promise.resolve(elsewhere),
    };
    return { value, calls: made.calls, asked };
  };

  it("approves the one recent change from another conversation, the status line naming it", async () => {
    const { value, calls, asked } = withElsewhere([ERRAND], {
      decision: "YES",
      remainder: null,
    });
    const outcome = await decidePending(value, turn("yes, go ahead"));
    // Read by meaning (J7): a clear approval of the only change waiting.
    expect(asked).toHaveLength(1);
    expect(calls.approve).toEqual(["b23ff5cc"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Q looks after Nixo for you.",
    });
  });

  it("asks which, by name, when several recent changes wait elsewhere; approves nothing", async () => {
    const { value, calls } = withElsewhere(
      [ERRAND, { ...REMINDER, proposalId: "p2" }],
      { decision: "YES", remainder: null },
    );
    const outcome = await decidePending(value, turn("yes, go ahead"));
    expect(calls.approve).toEqual([]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: '2 changes are waiting for your approval: "Q looks after Nixo for you" and "Reminder: Send Savanna the updated deck". Which one do you mean?',
    });
  });

  it("a change waiting in this conversation is the one meant; elsewhere is not read", async () => {
    let elsewhereRead = 0;
    const made = port({
      proposals: [REMINDER],
      reading: { decision: "YES", remainder: null },
    });
    const value: PendingDecisionPort = {
      ...made.value,
      recentElsewhere: () => {
        elsewhereRead += 1;
        return Promise.resolve([ERRAND]);
      },
    };
    await decidePending(value, turn("yes"));
    expect(elsewhereRead).toBe(0);
    expect(made.calls.approve).toEqual(["p1"]);
  });

  it("nothing waiting anywhere, or a turn that is not a decision: answered as any other", async () => {
    const none = withElsewhere([], { decision: "YES", remainder: null });
    expect(await decidePending(none.value, turn("yes"))).toEqual({
      kind: "NONE",
    });
    expect(none.calls.read).toBe(0);
    const unrelated = withElsewhere([ERRAND], {
      decision: "UNRELATED",
      remainder: null,
    });
    expect(
      await decidePending(unrelated.value, turn("what's Nixo's runway?")),
    ).toEqual({ kind: "NONE" });
    expect(unrelated.calls.approve).toEqual([]);
  });

  const SHARE: Proposal = {
    proposalId: "s1",
    summary: "Share your raise with Savanna Seed",
    status: "PENDING",
  };
  const midConversation = (utterance: string) => ({
    context,
    utterance,
    recentTurns: [{ role: "USER" as const, text: "what's my runway?" }],
  });

  it("QA 2026-10-03: a restated request in another conversation never approves the card there", async () => {
    // The reader hears the same request as agreeing; that is not a yes.
    for (const words of [
      turn("share my raise with Savanna Seed"),
      midConversation("share my raise with Savanna Seed"),
    ]) {
      const { value, calls } = withElsewhere([SHARE], {
        decision: "YES",
        remainder: null,
      });
      const outcome = await decidePending(value, words);
      expect(calls.approve).toEqual([]);
      expect(calls.decline).toEqual([]);
      expect(outcome).toEqual({
        kind: "REPLY",
        line: "That's ready: Share your raise with Savanna Seed. It's waiting for your yes. Tap Approve on the card, or tell me to go ahead.",
      });
    }
  });

  it("QA run 528f4c4e: a new request in a fresh conversation is never a reply to a card from another", async () => {
    const CLINICREST: Proposal = {
      proposalId: "c1",
      summary: "Express interest in Clinicrest",
      status: "PENDING",
    };
    const reads: readonly PendingTurnReading[] = [
      // "just handle it": a request to act, routed to delegation.
      { kind: "TOOL_REQUEST", addressedToQ: true, namesAction: false },
      // A hand-over or a declared action the reader named.
      { kind: "TOOL_REQUEST", addressedToQ: true, namesAction: true },
      // A question.
      { kind: "QUESTION_TO_Q", addressedToQ: true, namesAction: false },
      // Even read as a reply: words that neither approve nor name it.
      { kind: "CONTROL", addressedToQ: true, namesAction: false },
    ];
    for (const reading of reads) {
      const { value, calls } = withElsewhere([CLINICREST], {
        decision: "YES",
        remainder: null,
      });
      const outcome = await decidePending(value, {
        ...turn("just handle it"),
        turn: reading,
      });
      expect(outcome).toEqual({ kind: "NONE" });
      expect(calls.approve).toEqual([]);
    }
    // A plain yes in a fresh conversation still resolves the one card.
    const yes = withElsewhere([CLINICREST], {
      decision: "YES",
      remainder: null,
    });
    await decidePending(yes.value, {
      ...turn("yes, go ahead"),
      turn: { kind: "CONTROL", addressedToQ: true, namesAction: false },
    });
    expect(yes.calls.approve).toEqual(["c1"]);
  });

  it("elsewhere, mid-conversation: a bare yes does not approve; an approval naming the card does", async () => {
    const bare = withElsewhere([SHARE], { decision: "YES", remainder: null });
    await decidePending(bare.value, midConversation("yes, go ahead"));
    expect(bare.calls.approve).toEqual([]);
    const ok = withElsewhere([SHARE], { decision: "YES", remainder: null });
    const outcome = await decidePending(
      ok.value,
      midConversation("go ahead and share it with Savanna Seed, approved"),
    );
    expect(ok.calls.approve).toEqual(["s1"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Share your raise with Savanna Seed.",
    });
  });

  it("elsewhere, a no that does not point to the card declines nothing", async () => {
    const { value, calls } = withElsewhere([SHARE], {
      decision: "NO",
      remainder: null,
    });
    expect(await decidePending(value, midConversation("no, not that"))).toEqual(
      { kind: "NONE" },
    );
    expect(calls.decline).toEqual([]);
  });

  it("a decided change elsewhere is not offered again", async () => {
    const { value, calls } = withElsewhere([{ ...ERRAND, status: "SAVED" }], {
      decision: "YES",
      remainder: null,
    });
    expect(await decidePending(value, turn("yes"))).toEqual({ kind: "NONE" });
    expect(calls.approve).toEqual([]);
  });
});

describe("the founder's lines, live 2026-10-02 (Zino)", () => {
  const ERRAND: Proposal = {
    proposalId: "e1",
    summary: "Q looks after Nixo for you",
    status: "PENDING",
  };
  const CALL: Proposal = {
    proposalId: "m1",
    summary: "Call with Kazikit, Tue 6 Oct, 14:00",
    status: "PENDING",
  };

  it('"Okay. I give the approval. Go ahead." approves the one change waiting, with no name', async () => {
    const { value, calls } = port({
      proposals: [ERRAND],
      reading: { decision: "YES", remainder: null },
    });
    const outcome = await decidePending(
      value,
      turn("Okay. I give the approval. Go ahead."),
    );
    expect(calls.read).toBe(1);
    expect(calls.approve).toEqual(["e1"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Q looks after Nixo for you.",
    });
  });

  it("when the words cannot be read, nothing is approved or declined (the safe fallback)", async () => {
    const { value, calls } = port({ proposals: [ERRAND], reading: null });
    expect(
      await decidePending(value, turn("Okay. I give the approval. Go ahead.")),
    ).toEqual({ kind: "NONE" });
    expect(calls.approve).toEqual([]);
    expect(calls.decline).toEqual([]);
  });

  it('with two waiting, "approve the Nixon one" picks Nixo by the same name matcher', async () => {
    const { value, calls } = port({
      proposals: [CALL, ERRAND],
      reading: { decision: "YES", remainder: null },
    });
    const outcome = await decidePending(value, turn("approve the Nixon one"));
    expect(calls.approve).toEqual(["e1"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Q looks after Nixo for you.",
    });
  });

  it("with two waiting and no name, asks which; approves nothing", async () => {
    const { value, calls } = port({
      proposals: [CALL, ERRAND],
      reading: { decision: "YES", remainder: null },
    });
    const outcome = await decidePending(
      value,
      turn("Okay. I give the approval. Go ahead."),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome.kind).toBe("REPLY");
  });

  it("nothing waiting, an approval again: where the errand really stands, never an argument", async () => {
    const { value, calls } = port({
      proposals: [{ ...ERRAND, status: "SAVED" }],
      reading: { decision: "YES", remainder: null },
    });
    const outcome = await decidePending(
      {
        ...value,
        progress: () =>
          Promise.resolve(
            "Q is looking after Nixo for you: waiting for them to accept, so nothing is booked yet.",
          ),
      },
      turn("Okay. I give the approval. Go ahead."),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Q is looking after Nixo for you: waiting for them to accept, so nothing is booked yet.",
    });
    expect(JSON.stringify(outcome)).not.toMatch(/waiting for your approval/);
  });
});

describe("an explicit decision that restates its card (voiceq-63, live 2026-10-04)", () => {
  const CALL: Proposal = {
    proposalId: "daeef460",
    summary: "Call with Nixo",
    status: "PENDING",
  };
  const asRequest = {
    kind: "TOOL_REQUEST",
    addressedToQ: true,
    namesAction: true,
  } as const;
  const said = (utterance: string) => ({
    context,
    utterance,
    recentTurns: [],
    turn: asRequest,
  });

  it.each([
    "Yes, approve the meeting with Nixo for the next five minutes.",
    "Yes, confirm the meeting with Nixo in the next five minutes.",
  ])("%s approves the waiting card, with nothing left over", async (words) => {
    const { value, calls } = port({
      proposals: [CALL],
      // The reader heard "for the next five minutes" as more to do.
      reading: { decision: "YES", remainder: "for the next five minutes" },
    });
    const outcome = await decidePending(value, said(words));
    expect(calls.approve).toEqual(["daeef460"]);
    expect(outcome).toEqual({ kind: "REPLY", line: "Done: Call with Nixo." });
  });

  it("cancel the call with Nixo declines it", async () => {
    const { value, calls } = port({
      proposals: [CALL],
      reading: { decision: "NO", remainder: null },
    });
    await decidePending(value, said("Cancel the call with Nixo."));
    expect(calls.decline).toEqual(["daeef460"]);
  });

  it.each(["cancel that", "Cancel that.", "scrap it", "cancel the meeting"])(
    "%s declines the waiting card, read as a request or not",
    async (words) => {
      const { value, calls } = port({
        proposals: [CALL],
        reading: { decision: "NO", remainder: null },
      });
      await decidePending(value, said(words));
      expect(calls.decline).toEqual(["daeef460"]);
    },
  );

  it.each([
    "Book another one with Nixo for the next five minutes.",
    "Yes, approve the meeting with Nixo but move it to three.",
    "Book a meeting with Nixo in the next five minutes.",
  ])("%s is its own request: nothing approved", async (words) => {
    const { value, calls } = port({
      proposals: [CALL],
      reading: { decision: "YES", remainder: null },
    });
    await decidePending(value, said(words));
    expect(calls.approve).toEqual([]);
  });
});
