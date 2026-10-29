import { describe, expect, it } from "vitest";

import {
  decidePending,
  WHICH_TO_APPROVE,
  type PendingDecisionPort,
  type PendingDecisionStatus,
} from "../src/pending-decision.js";

/**
 * Approval by the person's own words (owner 2026-10-16: "it still makes
 * me click on approve"). Plain decision words are read by code with no
 * model call; each approval is the port's (the engine's own approve,
 * payload-bound); a change asked for never approves; several cards and
 * nothing saying which is asked about, never guessed.
 */

type Proposal = {
  proposalId: string;
  summary: string;
  status: PendingDecisionStatus;
};

const FOLLOW_UP: Proposal = {
  proposalId: "f1",
  summary: "Send the follow-up to Harbourline",
  status: "PENDING",
};
const MEETING: Proposal = {
  proposalId: "m1",
  summary: "Book a call with Nixo, Tue 14:00",
  status: "PENDING",
};
const REMINDER: Proposal = {
  proposalId: "r1",
  summary: "Reminder: send Savanna the deck",
  status: "PENDING",
};

function port(
  proposals: readonly Proposal[],
  options: {
    readonly approveStatus?: (id: string) => PendingDecisionStatus;
  } = {},
) {
  const calls = { read: 0, approve: [] as string[], decline: [] as string[] };
  const value: PendingDecisionPort = {
    proposals: () => Promise.resolve(proposals),
    // The model reading: it must not be needed for plain words. When it
    // is asked, it reads a yes (the riskiest reading for these tests).
    read: () => {
      calls.read += 1;
      return Promise.resolve({
        decision: "YES",
        remainder: null,
        onlyDecision: true,
        explicit: true,
      });
    },
    approve: (_context, proposalId) => {
      calls.approve.push(proposalId);
      return Promise.resolve({
        status: options.approveStatus?.(proposalId) ?? "SAVED",
      });
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

const turn = (
  utterance: string,
  recentTurns: readonly { role: "USER" | "Q"; text: string }[] = [],
) => ({ context, utterance, recentTurns });

describe("approval by words, read by code", () => {
  it.each([
    "I approve",
    "yes, send it",
    "go ahead",
    "confirmed",
    "I have given my approval",
    "I confirm it",
    "موافق، أرسلها",
  ])("%s: approves the one card shown, with no model reading", async (said) => {
    const { value, calls } = port([FOLLOW_UP]);
    const outcome = await decidePending(value, turn(said));
    expect(calls.approve).toEqual(["f1"]);
    expect(calls.read).toBe(0);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Send the follow-up to Harbourline.",
    });
  });

  it("'approve both' approves each card on its own, against its own payload", async () => {
    const { value, calls } = port([FOLLOW_UP, MEETING]);
    const outcome = await decidePending(value, turn("approve both"));
    expect(calls.approve).toEqual(["f1", "m1"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Send the follow-up to Harbourline. Done: Book a call with Nixo, Tue 14:00.",
    });
  });

  it("'approve all of them' approves every card shown", async () => {
    const { value, calls } = port([FOLLOW_UP, MEETING, REMINDER]);
    await decidePending(value, turn("approve all of them"));
    expect(calls.approve).toEqual(["f1", "m1", "r1"]);
  });

  it("several cards and nothing saying which: asks which, and approves nothing", async () => {
    const { value, calls } = port([FOLLOW_UP, MEETING]);
    const outcome = await decidePending(value, turn("I approve"));
    expect(calls.approve).toEqual([]);
    expect(calls.decline).toEqual([]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: `${WHICH_TO_APPROVE} "Send the follow-up to Harbourline" or "Book a call with Nixo, Tue 14:00"? Or say "both".`,
    });
  });

  it("'both' of three is asked about, never guessed", async () => {
    const { value, calls } = port([FOLLOW_UP, MEETING, REMINDER]);
    const outcome = await decidePending(value, turn("approve both"));
    expect(calls.approve).toEqual([]);
    expect(outcome.kind).toBe("REPLY");
  });

  it("the answer to 'which one?' decides it: a name, a position, or 'both'", async () => {
    const asked = `${WHICH_TO_APPROVE} "Send the follow-up to Harbourline" or "Book a call with Nixo, Tue 14:00"? Or say "both".`;
    const history = [
      { role: "USER" as const, text: "I approve" },
      { role: "Q" as const, text: asked },
    ];
    for (const [said, approved] of [
      ["the Harbourline one", ["f1"]],
      ["the second one", ["m1"]],
      ["both", ["f1", "m1"]],
    ] as const) {
      const { value, calls } = port([FOLLOW_UP, MEETING]);
      await decidePending(value, turn(said, history));
      expect(calls.approve).toEqual(approved);
    }
  });

  it("a name alone, with no question asked, is not decided by code: the reading of meaning judges it", async () => {
    const { value, calls } = port([FOLLOW_UP, MEETING]);
    await decidePending(value, turn("the Harbourline one"));
    expect(calls.read).toBe(1);
  });

  it("'sounds good, but change the date' is not an approval: Q asks for the new date, the card unchanged (live 2026-10-16)", async () => {
    const { value, calls } = port([FOLLOW_UP]);
    const outcome = await decidePending(
      value,
      turn("sounds good, but change the date"),
    );
    expect(calls.approve).toEqual([]);
    expect(calls.decline).toEqual([]);
    // No model reading is needed to ask, and never "waiting for your yes".
    expect(calls.read).toBe(0);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: 'What should the new date be for "Send the follow-up to Harbourline"? It stays as it is until you tell me.',
    });
    expect(JSON.stringify(outcome)).not.toMatch(/waiting for your yes/);
  });

  it("an edit that gives the new value is answered as a request, so it is prepared again; never approved", async () => {
    const { value, calls } = port([FOLLOW_UP]);
    const outcome = await decidePending(
      value,
      turn("yes but change the date to Friday"),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome).toEqual({
      kind: "ANSWER_THEN",
      before: null,
      after:
        "Still waiting for your approval: Send the follow-up to Harbourline.",
      about: "Send the follow-up to Harbourline",
      aboutId: "f1",
    });
  });

  it("one line per action: the action's own outcome line, when it settled, replaces the status line", async () => {
    const made = port([FOLLOW_UP, MEETING]);
    const value: PendingDecisionPort = {
      ...made.value,
      approve: (_c, id) =>
        Promise.resolve(
          id === "f1"
            ? { status: "SAVED", line: "Done. Sent to Harbourline." }
            : { status: "SAVED" },
        ),
    };
    expect(await decidePending(value, turn("approve both"))).toEqual({
      kind: "REPLY",
      line: "Done. Sent to Harbourline. Done: Book a call with Nixo, Tue 14:00.",
    });
  });

  it.each(["no, don't send it", "cancel that", "لا ترسلها"])(
    "%s: declines through the port, as the card's Decline does",
    async (said) => {
      const { value, calls } = port([FOLLOW_UP]);
      const outcome = await decidePending(value, turn(said));
      expect(calls.decline).toEqual(["f1"]);
      expect(calls.approve).toEqual([]);
      expect(outcome).toEqual({
        kind: "REPLY",
        line: "Declined: Send the follow-up to Harbourline. Nothing was changed.",
      });
    },
  );

  it("a card the engine finds changed since it was shown is refused and offered again", async () => {
    const { value } = port([FOLLOW_UP], { approveStatus: () => "CHANGED" });
    expect(await decidePending(value, turn("I approve"))).toEqual({
      kind: "REPLY",
      line: "That change was altered after it was prepared, so I didn't approve it: Send the follow-up to Harbourline. I can prepare it again for your approval.",
    });
  });

  it("a kind that keeps its card says so; nothing approved by words", async () => {
    const { value } = port([FOLLOW_UP], { approveStatus: () => "CARD_ONLY" });
    const outcome = await decidePending(value, turn("go ahead"));
    expect(outcome).toMatchObject({ kind: "REPLY" });
    expect(JSON.stringify(outcome)).toMatch(/tap on Approve on its card/);
  });

  it("words said to someone else (the turn reader: not to Q) decide nothing by code", async () => {
    const { value, calls } = port([FOLLOW_UP]);
    await decidePending(value, {
      ...turn("go ahead"),
      turn: { kind: "ANSWER", addressedToQ: false, namesAction: false },
    });
    expect(calls.approve).toEqual([]);
  });

  it("nothing waiting: plain words approve nothing", async () => {
    const { value, calls } = port([]);
    expect(await decidePending(value, turn("I approve"))).toEqual({
      kind: "NONE",
    });
    expect(calls.approve).toEqual([]);
  });

  // Stress 2026-10-28 (J7-I; the acceptance bank's rule): a bare yes with
  // exactly one card waiting approves it by code, with no model reading.
  it("a plain 'yes' alone approves the one card waiting, by code", async () => {
    const { value, calls } = port([FOLLOW_UP]);
    await decidePending(value, turn("yes"));
    expect(calls.read).toBe(0);
    expect(calls.approve).toEqual(["f1"]);
  });
});

describe("a plain yes or no to Q's own ask about the one card (live 2026-10-28, phone)", () => {
  const MANDATE: Proposal = {
    proposalId: "md1",
    summary: "Update your mandate",
    status: "PENDING",
  };
  const INTEREST: Proposal = {
    proposalId: "in1",
    summary: "Express interest in Sahel Pumps",
    status: "PENDING",
  };
  // The turn reader read the one word as a request (the phone run); the
  // desktop's reading was a reply. Neither may decide a one-word answer
  // to Q's own question.
  const misread = {
    kind: "TOOL_REQUEST",
    addressedToQ: true,
    namesAction: false,
  } as const;
  const asked = (card: Proposal, line: string) => [
    { role: "USER" as const, text: "Change my cheque size to 50k to 250k" },
    { role: "Q" as const, text: `${card.summary}. ${line}` },
  ];

  it.each([
    ["yes", "Not saved yet: tap Approve on the card, or tell me to go ahead."],
    [
      "ok",
      "It's waiting for your yes. Tap Approve on the card, or tell me to go ahead.",
    ],
    [
      "yes please",
      "Not saved yet: tap Approve on the card, or tell me to go ahead.",
    ],
  ])(
    "%s to a record change: approved by code, no model reading, whatever the turn reader said",
    async (said, line) => {
      const { value, calls } = port([MANDATE]);
      const outcome = await decidePending(value, {
        ...turn(said, asked(MANDATE, line)),
        turn: misread,
      });
      expect(calls.approve).toEqual(["md1"]);
      expect(calls.read).toBe(0);
      expect(outcome).toEqual({
        kind: "REPLY",
        line: "Done: Update your mandate.",
      });
    },
  );

  it("yes to an outward card's 'ready to send' ask: approved the same way", async () => {
    const { value, calls } = port([INTEREST]);
    const outcome = await decidePending(value, {
      ...turn(
        "yes",
        asked(
          INTEREST,
          "Ready to send: approve on the card, or tell me what to change.",
        ),
      ),
      turn: misread,
    });
    expect(calls.approve).toEqual(["in1"]);
    expect(calls.read).toBe(0);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Done: Express interest in Sahel Pumps.",
    });
  });

  it("no to the ask: declined by code", async () => {
    const { value, calls } = port([MANDATE]);
    const outcome = await decidePending(value, {
      ...turn(
        "no",
        asked(
          MANDATE,
          "Not saved yet: tap Approve on the card, or tell me to go ahead.",
        ),
      ),
      turn: misread,
    });
    expect(calls.decline).toEqual(["md1"]);
    expect(calls.approve).toEqual([]);
    expect(calls.read).toBe(0);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Declined: Update your mandate. Nothing was changed.",
    });
  });

  // Stress 2026-10-28 (J7-I; the acceptance bank's rule): with exactly one
  // card waiting, a bare yes approves it even after Q asked something
  // else; more than the bare yes answers Q's question.
  it("a bare yes when Q's last line asked something else approves the one card waiting", async () => {
    const { value, calls } = port([MANDATE]);
    await decidePending(
      value,
      turn("yes", [
        { role: "Q", text: "Shall I also look at their latest round?" },
      ]),
    );
    expect(calls.approve).toEqual(["md1"]);
  });

  it("a yes with more, after Q asked something else, answers that question, never the card", async () => {
    const { value, calls } = port([MANDATE]);
    const outcome = await decidePending(
      value,
      turn("yes, and their cap table", [
        { role: "Q", text: "Shall I also look at their latest round?" },
      ]),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome).toEqual({ kind: "NONE" });
  });

  it("two cards waiting: a plain yes still asks which", async () => {
    const { value, calls } = port([MANDATE, INTEREST]);
    const outcome = await decidePending(
      value,
      turn(
        "yes",
        asked(
          INTEREST,
          "Ready to send: approve on the card, or tell me what to change.",
        ),
      ),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: `${WHICH_TO_APPROVE} "Update your mandate" or "Express interest in Sahel Pumps"? Or say "both".`,
    });
  });

  it("more than the bare decision ('yes, but make it 300k') is never decided here", async () => {
    const { value, calls } = port([MANDATE]);
    const outcome = await decidePending(
      value,
      turn(
        "yes, but make it 300k",
        asked(
          MANDATE,
          "Not saved yet: tap Approve on the card, or tell me to go ahead.",
        ),
      ),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome.kind).not.toBe("REPLY");
  });
});

describe("the question back, answered (live 2026-10-16)", () => {
  it("a plain 'yes' to two cards asks in words the next turn reads, and 'both' then approves both", async () => {
    const first = port([FOLLOW_UP, MEETING]);
    const asked = await decidePending(first.value, turn("yes"));
    expect(first.calls.approve).toEqual([]);
    const line = asked.kind === "REPLY" ? asked.line : "";
    expect(line.startsWith(WHICH_TO_APPROVE)).toBe(true);
    const second = port([FOLLOW_UP, MEETING]);
    await decidePending(
      second.value,
      turn("both", [
        { role: "USER", text: "yes" },
        { role: "Q", text: line },
      ]),
    );
    expect(second.calls.approve).toEqual(["f1", "m1"]);
  });
});
