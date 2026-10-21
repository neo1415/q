import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARRIVAL_SNAPSHOT_VERSION,
  ArrivalSnapshotSchema,
  QApprovalViewSchema,
  QPendingApprovalSchema,
  type ArrivalSnapshot,
  type ChatThreadDto,
  type QApprovalView,
  type QAttentionReport,
} from "@capital-q/contracts";

import {
  readArrival,
  type ArrivalReads,
} from "@/features/briefing/arrival-read";
import type { OwnContext } from "@/features/q/context";

/**
 * Speed lane 2026-10-20: the arrival read's waterfall, timed with a
 * latency model (fake timers, so the numbers are the critical path of the
 * read order, not this machine's speed). Each read waits only on what it
 * needs, and the attention report is read only when the snapshot is not.
 *
 * The model (ms) is an estimate per read: ~10 ms per database round trip
 * behind each API call (the measured DB hop), the Supabase auth hop for the
 * account, and the cold snapshot build measured live on 2026-10-15 (1.4 s).
 */
const LATENCY = {
  account: 80,
  workSince: 80,
  approvals: 60,
  approval: 70,
  workforce: 150,
  done: 120,
  notices: 60,
  context: 70,
  matches: 320,
  questions: 150,
  deckReview: 80,
  thread: 80,
  snapshotWarm: 30,
  snapshotCold: 1_400,
  attention: 900,
} as const;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = Date.parse("2026-10-20T09:00:00Z");

const SNAPSHOT: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
  contractVersion: ARRIVAL_SNAPSHOT_VERSION,
  version: "v1",
  asOf: "2026-10-20T09:00:00.000Z",
  unread: [],
  briefsRead: true,
  activity: null,
  items: [],
});

function view(approvalId: string, relationshipId: string): QApprovalView {
  return QApprovalViewSchema.parse({
    contractVersion: 1,
    approvalId,
    runId: id(600),
    status: "PENDING",
    requestedAt: "2026-10-19T15:43:31Z",
    expiresAt: "2026-10-21T09:00:00Z",
    canDecide: true,
    action: {
      actionId: id(800),
      actionType: "chat.message.send",
      actionVersion: 1,
      actionClass: "CONFIRM_REQUIRED",
      actionStatus: "AWAITING_APPROVAL",
      targets: [{ kind: "RELATIONSHIP", relationshipId }],
      summary: "Send a message",
      preview: "Hi Daniel, 20 minutes this week works well.",
    },
  });
}

const APPROVALS = [1, 2].map((n) =>
  QPendingApprovalSchema.parse({
    approvalId: id(n),
    runId: id(600),
    conversationId: null,
    summary: `Reply ${String(n)}`,
    requestedAt: "2026-10-19T15:43:31Z",
    expiresAt: "2026-10-21T09:00:00Z",
  }),
);

const THREAD: ChatThreadDto | null = null;

const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

function readsFor(
  context: OwnContext,
  snapshot: "WARM" | "COLD" | "DOWN",
  calls: string[],
): ArrivalReads {
  const called =
    <A extends unknown[], T>(
      name: string,
      ms: number,
      value: (...args: A) => T,
    ) =>
    (...args: A): Promise<T> => {
      calls.push(name);
      return after(ms, value(...args));
    };
  return {
    account: called("account", LATENCY.account, () => ({
      displayName: "Zino Okafor",
    })),
    workSince: called("workSince", LATENCY.workSince, () => null),
    approvals: called("approvals", LATENCY.approvals, () => APPROVALS),
    approval: called("approval", LATENCY.approval, (approvalId: string) =>
      view(approvalId, id(900)),
    ),
    workforce: called("workforce", LATENCY.workforce, () => null),
    done: called("done", LATENCY.done, () => []),
    notices: called("notices", LATENCY.notices, () => []),
    context: called("context", LATENCY.context, () => context),
    matches: called("matches", LATENCY.matches, () => ({
      label: "NOT_LOOKED_AT" as const,
      total: 0,
      items: [],
    })),
    questions: called("questions", LATENCY.questions, () => []),
    deckReview: called("deckReview", LATENCY.deckReview, () => null),
    thread: called("thread", LATENCY.thread, () => THREAD),
    snapshot: called(
      "snapshot",
      snapshot === "COLD" ? LATENCY.snapshotCold : LATENCY.snapshotWarm,
      () => (snapshot === "DOWN" ? null : SNAPSHOT),
    ),
    attention: called(
      "attention",
      LATENCY.attention,
      (): QAttentionReport | null => null,
    ),
  };
}

const FOUNDER: OwnContext = {
  kind: "FOUNDER",
  companyId: id(77),
  label: "Zino",
};
const INVESTOR: OwnContext = {
  kind: "INVESTOR",
  investorOrganisationId: id(78),
  label: "Halyard",
};

async function timed(
  context: OwnContext,
  snapshot: "WARM" | "COLD" | "DOWN",
): Promise<{
  readonly ms: number;
  readonly calls: readonly string[];
  readonly cards: number;
}> {
  const calls: string[] = [];
  const started = Date.now();
  const reading = readArrival(readsFor(context, snapshot, calls), {
    now: NOW,
    since: "2026-10-19T09:00:00.000Z",
    hoursAway: 24,
    seenMatches: null,
    dismissedHeld: [],
  });
  // When the read itself settled: reads it started and does not wait for
  // (still running on the servers) do not count.
  let settledAt = Number.NaN;
  void reading.then(() => {
    settledAt = Date.now();
  });
  await vi.runAllTimersAsync();
  const data = await reading;
  return { ms: settledAt - started, calls, cards: data.cards.length };
}

describe("arrival read order (speed lane 2026-10-20)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times the read for each kind of person (recorded in ARRIVAL-SPEED)", async () => {
    const rows: Record<string, number> = {};
    for (const [name, context] of [
      ["founder", FOUNDER],
      ["investor", INVESTOR],
    ] as const) {
      for (const snapshot of ["WARM", "COLD", "DOWN"] as const) {
        rows[`${name}/${snapshot.toLowerCase()}`] = (
          await timed(context, snapshot)
        ).ms;
      }
    }
    console.info("[arrival-read-timing]", rows);
    // Warm snapshot: the slowest independent chain, not their sum.
    // Founder: approvals -> view -> thread (60 + 70 + 80 = 210) against
    // context -> questions (70 + 150 = 220) and workforce (150).
    expect(rows["founder/warm"]).toBeLessThanOrEqual(230);
    // Investor: context -> matches (70 + 320 = 390).
    expect(rows["investor/warm"]).toBeLessThanOrEqual(400);
    // Cold: the snapshot build itself, nothing stacked after it.
    expect(rows["founder/cold"]).toBeLessThanOrEqual(LATENCY.snapshotCold + 10);
  });

  it("reads the attention report only when the snapshot did not answer", async () => {
    const warm = await timed(FOUNDER, "WARM");
    expect(warm.calls).not.toContain("attention");
    expect(warm.cards).toBe(2);
    const down = await timed(FOUNDER, "DOWN");
    expect(down.calls).toContain("attention");
  });

  it("reads each kind's own extras and nothing else", async () => {
    const founder = await timed(FOUNDER, "WARM");
    expect(founder.calls).toEqual(
      expect.arrayContaining(["questions", "deckReview"]),
    );
    expect(founder.calls).not.toContain("matches");
    const investor = await timed(INVESTOR, "WARM");
    expect(investor.calls).toContain("matches");
    expect(investor.calls).not.toContain("questions");
    expect(investor.calls).not.toContain("deckReview");
  });
});
