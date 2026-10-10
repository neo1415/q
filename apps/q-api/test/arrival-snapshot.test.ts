import { describe, expect, it } from "vitest";

import {
  ArrivalSnapshotSchema,
  relationshipMessagesPath,
  relationshipPagePath,
} from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  buildArrivalSnapshot,
  createArrivalSnapshots,
} from "../src/composition/arrival-snapshot.js";
import { arrivalLines, liveContextPackage } from "../src/voice/live/context.js";
import {
  COUNTERPART,
  NOW,
  REL,
  tensorGateBrief,
  tensorGateReport,
} from "./arrival-snapshot.fixtures.js";

const ACTOR = ActorContextSchema.parse({
  userId: "7b1c0e55-0000-4000-8000-0000000000a1",
  tenantId: "7b1c0e55-0000-4000-8000-0000000000a2",
  organisationId: "7b1c0e55-0000-4000-8000-0000000000a3",
  membershipId: "7b1c0e55-0000-4000-8000-0000000000a4",
  actorType: "HUMAN",
});

describe("buildArrivalSnapshot", () => {
  const snapshot = buildArrivalSnapshot({
    report: tensorGateReport(),
    briefs: [tensorGateBrief()],
    now: NOW,
  });
  const item = snapshot.items[0];

  it("is a valid, versioned contract with every headline's facts", () => {
    expect(() => ArrivalSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.contractVersion).toBe("arrival-snapshot.v1");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.unread).toEqual(["REMINDER"]);
    expect(item?.headline).toContain("TensorGate");
    expect(item?.availability).toBe("OK");
  });

  it("answers what's the request, what they said, and whether the time is booked", () => {
    expect(item?.facts.request).toMatchObject({
      kind: "CONNECTION_OR_INTEREST",
      from: "TensorGate",
    });
    expect(item?.facts.theirLatestMessage?.text).toBe(
      "Could we do Thursday 3pm for a call?",
    );
    expect(item?.facts.theirLatestMessage?.from).toBe("OTHER_SIDE");
    expect(item?.facts.messageCount).toBe(2);
    expect(item?.facts.meeting).toMatchObject({
      status: "SCHEDULED",
      booked: true,
      timing: "UPCOMING",
    });
    expect(item?.facts.suggestedNextAction?.kind).toBe("ANSWER_INTEREST");
    expect(item?.facts.openRequests[0]?.title).toBe("Latest cap table");
    expect(item?.facts.documents[0]?.title).toBe("Pitch deck v3");
    expect(item?.ids).toMatchObject({
      relationshipId: REL,
      investorOrganisationId: COUNTERPART,
      companyId: null,
    });
    expect(item?.sourceVersions.historySequence).toBe(7);
    expect(item?.evidence.map((e) => e.source)).toContain("THREAD");
  });

  it("opens the conversation at the relationship's messages route", () => {
    expect(item?.openPath).toBe(
      relationshipMessagesPath("INVESTOR_ORGANISATION", COUNTERPART),
    );
    expect(item?.openPath).toBe(
      `/relationships/investor/${COUNTERPART}/messages`,
    );
  });

  it("a pending relationship has no conversation: its path is the relationship page", () => {
    const pending = buildArrivalSnapshot({
      report: tensorGateReport(),
      briefs: [tensorGateBrief({ state: "INTEREST_EXPRESSED" })],
      now: NOW,
    });
    expect(pending.items[0]?.hasConversation).toBe(false);
    expect(pending.items[0]?.openPath).toBe(
      relationshipPagePath("INVESTOR_ORGANISATION", COUNTERPART),
    );
    expect(item?.hasConversation).toBe(true);
    expect(item?.openPath).toContain("/messages");
  });

  it("bounds the message preview", () => {
    const long = buildArrivalSnapshot({
      report: tensorGateReport(),
      briefs: [tensorGateBrief({ theirText: "x".repeat(900) })],
      now: NOW,
    });
    // The brief caps at 240; the snapshot never widens it.
    expect(
      long.items[0]?.facts.theirLatestMessage?.text?.length,
    ).toBeLessThanOrEqual(240);
  });

  it("marks the headline UNAVAILABLE rather than guessing when the thread was not read", () => {
    const partial = buildArrivalSnapshot({
      report: tensorGateReport(),
      briefs: [tensorGateBrief({ messagesUnavailable: true })],
      now: NOW,
    });
    expect(partial.items[0]?.availability).toBe("UNAVAILABLE");
    expect(partial.items[0]?.facts.theirLatestMessage).toBeNull();
    const none = buildArrivalSnapshot({
      report: tensorGateReport(),
      briefs: null,
      now: NOW,
    });
    expect(none.briefsRead).toBe(false);
    expect(none.items[0]?.availability).toBe("UNAVAILABLE");
    expect(none.items[0]?.openPath).toBeNull();
    // A notice has no relationship behind it: its own note is its fact.
    expect(none.items[1]?.availability).toBe("OK");
    expect(none.items[1]?.facts.note).toBe("An investor opened your profile.");
  });

  it("changes version when a fact changes, not when only the clock does", () => {
    const later = buildArrivalSnapshot({
      report: tensorGateReport(),
      briefs: [tensorGateBrief()],
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(later.version).toBe(snapshot.version);
    const changed = buildArrivalSnapshot({
      report: tensorGateReport(),
      briefs: [tensorGateBrief({ sequence: 8, meetingStatus: "CANCELLED" })],
      now: NOW,
    });
    expect(changed.version).not.toBe(snapshot.version);
    expect(changed.items[0]?.facts.meeting?.booked).toBe(false);
  });
});

describe("the live context package", () => {
  it("carries the arrival facts inside the cap, keeping the base", () => {
    const snapshot = buildArrivalSnapshot({
      report: tensorGateReport(),
      briefs: [tensorGateBrief()],
      now: NOW,
    });
    const text = liveContextPackage({
      firstName: "Ada",
      role: "founder",
      facts: {
        side: "COMPANY",
        organisation: "Acme",
        facts: ["a".repeat(150), "b".repeat(150), "c".repeat(150)],
      },
      referents: ["TensorGate"],
      arrival: arrivalLines(snapshot),
    });
    expect(text).not.toBeNull();
    expect(text?.length).toBeLessThanOrEqual(1_600);
    expect(text).toContain("Could we do Thursday 3pm for a call?");
    expect(text).toContain("TensorGate wants to connect");
    expect(text).toContain("Who: Ada");
  });
});

describe("createArrivalSnapshots freshness", () => {
  function scene(options?: { trustMs?: number }) {
    let clock = NOW.getTime();
    const counts = { probe: 0, attention: 0, briefs: 0 };
    const state = { epoch: "a".repeat(32), stamp: "s1", sequence: 7 };
    const snapshots = createArrivalSnapshots({
      now: () => new Date(clock),
      trustMs: options?.trustMs ?? 15_000,
      attention: () => {
        counts.attention += 1;
        return Promise.resolve(tensorGateReport());
      },
      briefs: () => {
        counts.briefs += 1;
        return Promise.resolve([tensorGateBrief({ sequence: state.sequence })]);
      },
      probe: () => {
        counts.probe += 1;
        return Promise.resolve({ epoch: state.epoch, stamp: state.stamp });
      },
    });
    return {
      snapshots,
      counts,
      state,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("builds once and serves a follow-up with no probe at all", async () => {
    const s = scene();
    const first = await s.snapshots.forActor(ACTOR);
    expect(s.counts).toEqual({ probe: 1, attention: 1, briefs: 1 });
    s.advance(3_000);
    const second = await s.snapshots.forActor(ACTOR);
    expect(second).toBe(first);
    expect(s.counts).toEqual({ probe: 1, attention: 1, briefs: 1 });
  });

  it("past the trust window asks the probe once; unchanged data is not rebuilt", async () => {
    const s = scene();
    const first = await s.snapshots.forActor(ACTOR);
    s.advance(20_000);
    expect(await s.snapshots.forActor(ACTOR)).toBe(first);
    expect(s.counts).toEqual({ probe: 2, attention: 1, briefs: 1 });
  });

  it("a changed source version builds a new snapshot with a new version", async () => {
    const s = scene({ trustMs: 0 });
    const first = await s.snapshots.forActor(ACTOR);
    s.state.stamp = "s2";
    s.state.sequence = 8;
    const next = await s.snapshots.forActor(ACTOR);
    expect(next).not.toBe(first);
    expect(next?.version).not.toBe(first?.version);
    expect(s.counts.attention).toBe(2);
  });

  it("a changed authorisation epoch never serves the old entry", async () => {
    const s = scene({ trustMs: 0 });
    await s.snapshots.forActor(ACTOR);
    s.state.epoch = "b".repeat(32);
    await s.snapshots.forActor(ACTOR);
    expect(s.counts.attention).toBe(2);
  });

  it("an invalidation (their own write) ends trust at once", async () => {
    const s = scene();
    await s.snapshots.forActor(ACTOR);
    s.snapshots.invalidateActor(ACTOR.userId);
    await s.snapshots.forActor(ACTOR);
    expect(s.counts.probe).toBe(2);
    expect(s.counts.attention).toBe(2);
  });

  it("is never built for a non-human actor", async () => {
    const s = scene();
    const q = ActorContextSchema.parse({ ...ACTOR, actorType: "Q" });
    expect(await s.snapshots.forActor(q)).toBeNull();
    expect(s.counts.probe).toBe(0);
  });
});
