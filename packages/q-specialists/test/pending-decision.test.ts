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

  it("does not approve a yes that asks for a different change ('yes but change the time'): it needs its own approval", async () => {
    const { value, calls } = port({
      proposals: [REMINDER],
      reading: { decision: "YES", remainder: "but change the time to 3pm" },
    });
    const outcome = await decidePending(
      value,
      turn("yes but change the time to 3pm"),
    );
    expect(calls.approve).toEqual([]);
    expect(outcome).toEqual({
      kind: "ANSWER_THEN",
      before: null,
      after: statusLine("PENDING", REMINDER.summary),
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
