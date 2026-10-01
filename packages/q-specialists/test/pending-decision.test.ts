import { describe, expect, it } from "vitest";

import {
  decidePending,
  statusLine,
  type PendingDecisionPort,
  type PendingDecisionStatus,
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

function port(options: {
  readonly proposals: readonly Proposal[];
  readonly reading: Awaited<ReturnType<PendingDecisionPort["read"]>>;
  readonly approveStatus?: PendingDecisionStatus;
}) {
  const calls = { read: 0, approve: [] as string[], decline: [] as string[] };
  const value: PendingDecisionPort = {
    proposals: () => Promise.resolve(options.proposals),
    read: () => {
      calls.read += 1;
      return Promise.resolve(options.reading);
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
    expect(await decidePending(value, turn("yes"))).toEqual({ kind: "NONE" });
    expect(calls.read).toBe(0);
    expect(calls.approve).toEqual([]);
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
    expect(calls.decline).toEqual(["p1"]);
    expect(outcome).toEqual({
      kind: "ANSWER_THEN",
      before:
        "Declined: Reminder: Send Savanna the updated deck. Nothing was changed.",
      after: null,
    });
  });

  it("approves a yes with more said, then answers the rest", async () => {
    const { value, calls } = port({
      proposals: [REMINDER],
      reading: { decision: "YES", remainder: "go ahead" },
    });
    const outcome = await decidePending(value, turn("yes, go ahead"));
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
    expect(asked).toEqual([
      "Q looks after Nixo for you. Shall I go ahead with exactly this, unchanged?",
    ]);
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

  it("a decided change elsewhere is not offered again", async () => {
    const { value, calls } = withElsewhere([{ ...ERRAND, status: "SAVED" }], {
      decision: "YES",
      remainder: null,
    });
    expect(await decidePending(value, turn("yes"))).toEqual({ kind: "NONE" });
    expect(calls.approve).toEqual([]);
  });
});
