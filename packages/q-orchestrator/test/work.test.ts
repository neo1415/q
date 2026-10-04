import { describe, expect, it } from "vitest";

import {
  createInMemoryQCheckpointStore,
  createQWorkEngine,
  groundedPicks,
  OutreachGrantSchema,
  type Candidate,
  type DelegationRef,
  type LaneObservation,
  type LanePatch,
  type Notice,
  type ObservedMessage,
  type OutreachGrant,
  type QEnvelope,
  type QWorkPorts,
  type ShortlistPick,
  type StandInObservation,
} from "../src/index.js";

/**
 * Deterministic tests of Q's delegated work (ADR 0030): the graphs with
 * fake ports and a fake model. No database, no provider.
 */

const REF: DelegationRef = {
  delegationId: "d0000000-0000-4000-8000-000000000001",
  userId: "u0000000-0000-4000-8000-000000000001",
  tenantId: "t0000000-0000-4000-8000-000000000001",
  principalName: "Ada Investor",
  threadId: "work:d0000000-0000-4000-8000-000000000001",
};

const GRANT: OutreachGrant = OutreachGrantSchema.parse({
  maxCompanies: 2,
  openingMessage: "Hello, I'm Q for Ada. Ada liked your pitch.",
  brief: "Ada invests 250k-1m at seed in African fintech and logistics.",
  topics: ["Monthly revenue"],
  interview: { questions: ["Who are your first customers?", "Why now?"] },
  call: {
    purpose: "Intro call",
    durationMinutes: 30,
    windows: [{ days: [1, 2, 3, 4, 5], startHour: 10, endHour: 16 }],
    mayBookInWindows: false,
  },
});

type Recorder = {
  posts: { key: string; body: string; envelope: QEnvelope | null }[];
  notices: Notice[];
  steps: string[];
  lanes: Map<string, LanePatch[]>;
  finished: { status: string; summary: string }[];
  booked: string[];
  nudged: string[];
};

type Script = {
  candidates?: Candidate[];
  shortlist?: ShortlistPick[] | null;
  converse?: QWorkPorts["converse"];
  interviewTurn?: QWorkPorts["interviewTurn"];
  standInReply?: QWorkPorts["standInReply"];
};

function fakePorts(script: Script = {}): { ports: QWorkPorts; rec: Recorder } {
  const rec: Recorder = {
    posts: [],
    notices: [],
    steps: [],
    lanes: new Map(),
    finished: [],
    booked: [],
    nudged: [],
  };
  const postKeys = new Set<string>();
  const noticeKeys = new Set<string>();
  let laneCounter = 0;
  const ports: QWorkPorts = {
    step: (_ref, _lane, key) => {
      rec.steps.push(key);
      return Promise.resolve();
    },
    notify: (_ref, notice) => {
      if (!noticeKeys.has(notice.key)) {
        noticeKeys.add(notice.key);
        rec.notices.push(notice);
      }
      return Promise.resolve();
    },
    finishDelegation: (_ref, status, summary) => {
      rec.finished.push({ status, summary });
      return Promise.resolve();
    },
    summarise: () => Promise.resolve(),
    updateLane: (laneId, patch) => {
      rec.lanes.set(laneId, [...(rec.lanes.get(laneId) ?? []), patch]);
      return Promise.resolve();
    },
    source: () => Promise.resolve(script.candidates ?? []),
    shortlist: () =>
      Promise.resolve(script.shortlist === undefined ? [] : script.shortlist),
    expressInterest: (_ref, companyId) =>
      Promise.resolve({ outcome: "OK", relationshipId: `rel-${companyId}` }),
    openLane: () => {
      laneCounter += 1;
      return Promise.resolve(`lane-${String(laneCounter)}`);
    },
    post: (_ref, _relationshipId, key, body, envelope) => {
      // Idempotent on its key, like the chat service.
      if (!postKeys.has(key)) {
        postKeys.add(key);
        rec.posts.push({ key, body, envelope });
      }
      return Promise.resolve(true);
    },
    converse:
      script.converse ??
      (() =>
        Promise.resolve({
          reply: "Thanks!",
          learned: [],
          forPerson: [],
          ready: false,
        })),
    interviewTurn:
      script.interviewTurn ??
      ((_ref, input) =>
        Promise.resolve({
          answered: true,
          answer: input.answerSoFar,
          followUp: null,
        })),
    report: () =>
      Promise.resolve({
        recommendation: "PROCEED",
        path: "/work/d0000000-0000-4000-8000-000000000001/lanes/lane-1/report",
        headline: "Strong early customers; revenue is their own claim.",
      }),
    slots: () =>
      Promise.resolve({
        outcome: "OK",
        slots: [
          { start: "2026-10-06T10:00:00.000Z", label: "Mon 6 Oct, 11:00" },
          { start: "2026-10-06T13:00:00.000Z", label: "Mon 6 Oct, 14:00" },
        ],
      }),
    book: (_ref, _relationshipId, input) => {
      rec.booked.push(input.at);
      return Promise.resolve({
        outcome: "OK",
        meetingId: "m0000000-0000-4000-8000-000000000001",
        when: "Mon 6 Oct, 11:00",
        meetLink: "https://meet.google.com/abc-defg-hij",
      });
    },
    standInReply:
      script.standInReply ??
      (() =>
        Promise.resolve({
          reply: "We're at seed.",
          deferred: false,
          forPerson: [],
        })),
    standInLane: () => Promise.resolve("standin-lane-1"),
    nudgeCounterpart: (_ref, _relationshipId, key) => {
      if (rec.nudged.includes(key)) return Promise.resolve(false);
      rec.nudged.push(key);
      return Promise.resolve(true);
    },
  };
  return { ports, rec };
}

let clock = Date.parse("2026-10-01T09:00:00.000Z");
const tick = (ms = 60_000) => {
  clock += ms;
  return new Date(clock).toISOString();
};

function message(
  id: string,
  text: string,
  options: Partial<ObservedMessage> = {},
): ObservedMessage {
  return {
    id,
    at: tick(),
    from: "OTHER_SIDE",
    senderName: "Femi Founder",
    text,
    envelope: null,
    viaQ: false,
    ...options,
  };
}

function observe(over: Partial<LaneObservation> = {}): LaneObservation {
  return {
    now: tick(),
    status: "ACTIVE",
    access: "OK",
    relationshipId: "rel-c1",
    chatPath: "/relationships/company/c1/messages",
    connected: true,
    declined: false,
    messages: [],
    q2qLastDay: 0,
    answer: null,
    ...over,
  };
}

const LANE = (laneId: string, grant: OutreachGrant = GRANT) => ({
  ref: REF,
  laneId,
  grant,
  counterpartName: "Femi Co",
  reasons: [{ reason: "Seed fintech", quote: "seed-stage payments" }],
  relationshipId: "rel-c1",
});

describe("groundedPicks", () => {
  const candidates: Candidate[] = [
    {
      companyId: "c1",
      name: "Pay Co",
      material: "Pitch: we are a seed-stage payments company in Lagos.",
    },
    {
      companyId: "c2",
      name: "Haul Co",
      material: "Deck: logistics marketplace, 40 trucks.",
    },
  ];
  it("keeps a pick only with a reason quoting the candidate's material", () => {
    const picks = groundedPicks(
      [
        {
          companyId: "c1",
          name: "x",
          reasons: [{ reason: "fit", quote: "seed-stage  payments company" }],
        },
        {
          companyId: "c2",
          name: "Haul Co",
          reasons: [{ reason: "fit", quote: "200 trucks across Kenya" }],
        },
        {
          companyId: "c9",
          name: "Ghost",
          reasons: [{ reason: "fit", quote: "anything at all here" }],
        },
      ],
      candidates,
      5,
    );
    expect(picks.map((pick) => pick.companyId)).toEqual(["c1"]);
    expect(picks[0]?.name).toBe("Pay Co");
  });
  it("never exceeds the approved number", () => {
    const picks = groundedPicks(
      candidates.map((candidate) => ({
        companyId: candidate.companyId,
        name: candidate.name,
        reasons: [{ reason: "fit", quote: candidate.material.slice(0, 20) }],
      })),
      candidates,
      1,
    );
    expect(picks).toHaveLength(1);
  });
});

describe("outreach: source → shortlist → open lanes", () => {
  it("expresses interest in the grounded picks and tells the person once", async () => {
    const { ports, rec } = fakePorts({
      candidates: [
        {
          companyId: "c1",
          name: "Pay Co",
          material: "We are a seed-stage payments company.",
        },
        {
          companyId: "c2",
          name: "Haul Co",
          material: "Logistics marketplace with 40 trucks.",
        },
        {
          companyId: "c3",
          name: "Grow Co",
          material: "Agritech input financing.",
        },
      ],
      shortlist: [
        {
          companyId: "c1",
          name: "Pay Co",
          reasons: [
            { reason: "payments", quote: "seed-stage payments company" },
          ],
        },
        {
          companyId: "c2",
          name: "Haul Co",
          reasons: [{ reason: "logistics", quote: "Logistics marketplace" }],
        },
        {
          companyId: "c3",
          name: "Grow Co",
          reasons: [{ reason: "agri", quote: "Agritech input financing" }],
        },
      ],
    });
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    const lanes = await engine.runOutreach(REF, GRANT);
    expect(lanes).toEqual(["lane-1", "lane-2"]);
    expect(rec.steps).toContain("interest:c1");
    expect(rec.steps).toContain("interest:c2");
    expect(rec.steps).not.toContain("interest:c3");
    const batch = rec.notices.filter(
      (notice) => notice.key === "interest-batch",
    );
    expect(batch).toHaveLength(1);
    expect(batch[0]?.title).toContain("Pay Co, Haul Co");
    // A second run on the finished thread does nothing again.
    expect(await engine.runOutreach(REF, GRANT)).toEqual(["lane-1", "lane-2"]);
    expect(
      rec.notices.filter((notice) => notice.key === "interest-batch"),
    ).toHaveLength(1);
  });

  it("invents nothing when the shortlist call fails", async () => {
    const { ports, rec } = fakePorts({
      candidates: [{ companyId: "c1", name: "Pay Co", material: "payments" }],
      shortlist: null,
    });
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    expect(await engine.runOutreach(REF, GRANT)).toEqual([]);
    expect(rec.finished[0]?.status).toBe("FAILED");
    expect(rec.steps.some((step) => step.startsWith("interest:"))).toBe(false);
  });

  it("says so when nothing fits", async () => {
    const { ports, rec } = fakePorts({ candidates: [] });
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    await engine.runOutreach(REF, GRANT);
    expect(rec.notices[0]?.key).toBe("no-fits");
    expect(rec.finished[0]?.status).toBe("DONE");
  });
});

describe("lane: accept → chat → interview → report → times → book", () => {
  it("runs the whole plan, labelled as Q, and survives a restart", async () => {
    const checkpoints = createInMemoryQCheckpointStore();
    const script: Script = {
      converse: (_ref, input) =>
        Promise.resolve({
          reply:
            input.topicsOpen.length > 0
              ? "What is your monthly revenue?"
              : "Thanks.",
          learned: input.thread.includes("40k")
            ? [{ topic: "Monthly revenue", words: "about 40k a month" }]
            : [],
          forPerson: input.thread.includes("valuation")
            ? ["What valuation would Ada accept?"]
            : [],
          ready: false,
        }),
    };
    const first = fakePorts(script);
    let engine = createQWorkEngine({ checkpoints, ports: first.ports });
    const lane = LANE("lane-1");

    // Not yet accepted: waits, says nothing.
    expect(await engine.advanceLane(lane, observe({ connected: false }))).toBe(
      "WAITING",
    );
    expect(first.rec.posts).toHaveLength(0);

    // Accepted: the opening message, as Q.
    await engine.advanceLane(lane, observe());
    expect(first.rec.posts[0]?.key).toBe("open");
    expect(first.rec.posts[0]?.body).toBe(GRANT.openingMessage);
    expect(first.rec.posts[0]?.envelope).toEqual({
      protocol: "cq.q2q/1",
      side: "INVESTOR",
      intent: "INFO",
    });

    // A restart: a fresh engine on the same checkpoints carries on.
    engine = createQWorkEngine({ checkpoints, ports: first.ports });
    const m1 = message("m1", "Hi! Happy to talk. What's the valuation?");
    await engine.advanceLane(lane, observe({ messages: [m1] }));
    expect(first.rec.posts.at(-1)?.key).toBe("reply:m1");
    expect(
      first.rec.notices.some(
        (n) => n.key === "ask:m1" && n.priority === "NEEDS_YOU",
      ),
    ).toBe(true);

    // Topic learned → the interview starts.
    const m2 = message("m2", "We do about 40k a month.");
    await engine.advanceLane(lane, observe({ messages: [m1, m2] }));
    expect(first.rec.posts.at(-1)?.key).toBe("interview:0");
    expect(first.rec.posts.at(-1)?.body).toContain(
      "Question 1 of 2: Who are your first customers?",
    );

    const m3 = message("m3", "Three banks in Lagos.");
    await engine.advanceLane(lane, observe({ messages: [m1, m2, m3] }));
    expect(first.rec.posts.at(-1)?.key).toBe("interview:1");

    const m4 = message("m4", "Card rails just opened up.");
    await engine.advanceLane(lane, observe({ messages: [m1, m2, m3, m4] }));
    // Report filed and the person asked for times; nothing booked yet.
    expect(first.rec.posts.some((post) => post.key === "interview:done")).toBe(
      true,
    );
    const report = first.rec.notices.find((n) => n.key === "report:lane-1");
    expect(report?.priority).toBe("NEEDS_YOU");
    expect(report?.link).toBe(
      "/work/d0000000-0000-4000-8000-000000000001/lanes/lane-1/report",
    );
    expect(first.rec.notices.some((n) => n.key === "times:lane-1:0")).toBe(
      true,
    );
    expect(first.rec.booked).toHaveLength(0);
    const patches = first.rec.lanes.get("lane-1") ?? [];
    expect(patches.some((patch) => patch.needs?.kind === "TIMES")).toBe(true);
    expect(patches.some((patch) => patch.interview?.length === 2)).toBe(true);

    // The person picks a time (from any Q, or the panel).
    await engine.advanceLane(
      lane,
      observe({
        messages: [m1, m2, m3, m4],
        answer: {
          kind: "BOOK_AT",
          id: "answer-1",
          at: "2026-10-06T10:00:00.000Z",
        },
      }),
    );
    expect(first.rec.booked).toEqual(["2026-10-06T10:00:00.000Z"]);
    expect(first.rec.posts.at(-1)?.body).toContain(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(
      first.rec.notices.some((n) => n.key === "booked:answer:answer-1"),
    ).toBe(true);

    // The same answer seen again books nothing twice.
    await engine.advanceLane(
      lane,
      observe({
        messages: [m1, m2, m3, m4],
        answer: {
          kind: "BOOK_AT",
          id: "answer-1",
          at: "2026-10-06T10:00:00.000Z",
        },
      }),
    );
    expect(first.rec.booked).toHaveLength(1);

    // "Book another meeting for this time."
    await engine.advanceLane(
      lane,
      observe({
        messages: [m1, m2, m3, m4],
        answer: {
          kind: "BOOK_AT",
          id: "answer-2",
          at: "2026-10-13T10:00:00.000Z",
        },
      }),
    );
    expect(first.rec.booked).toEqual([
      "2026-10-06T10:00:00.000Z",
      "2026-10-13T10:00:00.000Z",
    ]);

    // Stop: the lane ends and says nothing more.
    const before = first.rec.posts.length;
    expect(
      await engine.advanceLane(
        lane,
        observe({
          status: "STOPPED",
          messages: [m1, m2, m3, m4, message("m5", "Hello?")],
        }),
      ),
    ).toBe("FINISHED");
    expect(first.rec.posts.length).toBe(before);
    expect(await engine.advanceLane(lane, observe())).toBe("FINISHED");
  });

  it("books the first free time inside the windows when allowed, with no interview", async () => {
    const grant = OutreachGrantSchema.parse({
      ...GRANT,
      topics: [],
      brief: null,
      interview: null,
      call: { ...GRANT.call, mayBookInWindows: true },
    });
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    await engine.advanceLane(
      LANE("lane-2", grant),
      observe({ connected: false }),
    );
    await engine.advanceLane(LANE("lane-2", grant), observe());
    expect(rec.booked).toEqual(["2026-10-06T10:00:00.000Z"]);
    expect(rec.posts.map((post) => post.key)).toEqual(["open", "booked:auto"]);
  });

  it("parks a call on a revoked calendar: one attempt, one notice, then books once reconnected (meetfix-57)", async () => {
    const grant = OutreachGrantSchema.parse({
      ...GRANT,
      topics: [],
      brief: null,
      interview: null,
      call: { ...GRANT.call, mayBookInWindows: true },
    });
    const { ports, rec } = fakePorts();
    let connected = false;
    let attempts = 0;
    const okSlots = ports.slots;
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports: {
        ...ports,
        calendarReady: () => Promise.resolve(connected),
        slots: (ref, relationshipId, call) => {
          attempts += 1;
          return connected
            ? okSlots(ref, relationshipId, call)
            : Promise.resolve({ outcome: "REFUSED", code: "CALENDAR_REVOKED" });
        },
      },
    });
    await engine.advanceLane(
      LANE("lane-3", grant),
      observe({ connected: false }),
    );
    for (let minute = 0; minute < 10; minute += 1) {
      await engine.advanceLane(LANE("lane-3", grant), observe());
    }
    expect(attempts).toBe(1);
    expect(rec.booked).toEqual([]);
    const held = rec.notices.filter((notice) =>
      notice.key.startsWith("calendar-blocked:"),
    );
    expect(held).toHaveLength(1);
    expect(held[0]?.link).toBe("/settings/reconnect/google");
    expect(held[0]?.title).toBe(
      "Reconnect Google to book your call with Femi Co",
    );
    expect(
      rec.lanes
        .get("lane-3")
        ?.some((patch) =>
          patch.lastStep?.startsWith(
            "Call on hold: your Google Calendar connection expired",
          ),
        ),
    ).toBe(true);

    connected = true;
    await engine.advanceLane(LANE("lane-3", grant), observe());
    expect(attempts).toBe(2);
    expect(rec.booked).toEqual(["2026-10-06T10:00:00.000Z"]);
  });

  it("ends a declined lane with a notice", async () => {
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    await engine.advanceLane(LANE("lane-3"), observe({ connected: false }));
    expect(
      await engine.advanceLane(
        LANE("lane-3"),
        observe({ connected: false, declined: true }),
      ),
    ).toBe("FINISHED");
    expect(rec.notices[0]?.key).toBe("declined:lane-3");
    expect(rec.posts).toHaveLength(0);
  });

  it("stops when access is lost", async () => {
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    expect(
      await engine.advanceLane(LANE("lane-4"), observe({ access: "LOST" })),
    ).toBe("FINISHED");
    expect(rec.posts).toHaveLength(0);
    expect(rec.lanes.get("lane-4")?.at(-1)?.stage).toBe("STOPPED");
  });

  it("nudges once after a day and moves on after three days of silence", async () => {
    const grant = OutreachGrantSchema.parse({
      ...GRANT,
      topics: [],
      brief: null,
      call: null,
    });
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    const lane = LANE("lane-5", grant);
    await engine.advanceLane(lane, observe({ connected: false }));
    await engine.advanceLane(lane, observe());
    expect(rec.posts.map((post) => post.key)).toEqual(["open", "interview:0"]);
    tick(25 * 3_600_000);
    await engine.advanceLane(lane, observe());
    expect(rec.posts.at(-1)?.key).toBe("nudge:0");
    tick(48 * 3_600_000);
    await engine.advanceLane(lane, observe());
    expect(rec.posts.at(-1)?.key).toBe("interview:1");
    const answered = (rec.lanes.get("lane-5") ?? []).find(
      (patch) => patch.interview !== undefined,
    );
    expect(answered?.interview?.[0]?.answer).toBe("(No answer.)");
  });
});

describe("interview answered by the founder's Q", () => {
  it("marks the answer as their Q's, so the report can say so", async () => {
    const grant = OutreachGrantSchema.parse({
      ...GRANT,
      topics: [],
      brief: null,
      interview: { questions: ["Who are your first customers?"] },
      call: null,
    });
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    const lane = LANE("lane-7", grant);
    await engine.advanceLane(lane, observe({ connected: false }));
    await engine.advanceLane(lane, observe());
    const fromTheirQ = message("s1", "Three banks, per Femi's brief.", {
      viaQ: true,
      envelope: { protocol: "cq.q2q/1", side: "COMPANY", intent: "ANSWER" },
    });
    await engine.advanceLane(lane, observe({ messages: [fromTheirQ] }));
    const answered = (rec.lanes.get("lane-7") ?? []).find(
      (patch) => patch.interview !== undefined,
    );
    expect(answered?.interview?.[0]).toMatchObject({ byQ: true });
  });
});

describe("waiting for them to accept, like a person", () => {
  it("names what it waits for, reminds once at 3 days, tells the owner at 7, and continues on acceptance", async () => {
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    const lane = LANE("lane-w1");
    expect(await engine.advanceLane(lane, observe({ connected: false }))).toBe(
      "WAITING",
    );
    expect(rec.lanes.get("lane-w1")?.[0]?.lastStep).toBe(
      "Waiting for Femi Co to accept your interest.",
    );
    tick(3 * 24 * 3_600_000);
    await engine.advanceLane(lane, observe({ connected: false }));
    await engine.advanceLane(lane, observe({ connected: false }));
    expect(rec.nudged).toEqual(["lane:lane-w1"]);
    expect(rec.notices.some((n) => n.key === "waiting-long:lane-w1")).toBe(
      false,
    );
    tick(4 * 24 * 3_600_000);
    await engine.advanceLane(lane, observe({ connected: false }));
    const told = rec.notices.filter((n) => n.key === "waiting-long:lane-w1");
    expect(told).toHaveLength(1);
    expect(told[0]?.priority).toBe("NEEDS_YOU");
    expect(rec.posts).toHaveLength(0);
    // They accept: the same observation twice resumes once.
    const accepted = observe();
    await engine.advanceLane(lane, accepted);
    await engine.advanceLane(lane, accepted);
    expect(rec.posts.filter((post) => post.key === "open")).toHaveLength(1);
  });

  it("never resumes after a decline", async () => {
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    const lane = LANE("lane-w2");
    await engine.advanceLane(lane, observe({ connected: false }));
    expect(
      await engine.advanceLane(
        lane,
        observe({ connected: false, declined: true }),
      ),
    ).toBe("FINISHED");
    expect(await engine.advanceLane(lane, observe())).toBe("FINISHED");
    expect(rec.posts).toHaveLength(0);
  });
});

describe("Q-to-Q (cq.q2q/1)", () => {
  const fromQ = (id: string, intent: QEnvelope["intent"]) =>
    message(id, "Q for Femi: an update.", {
      viaQ: true,
      envelope: { protocol: "cq.q2q/1", side: "COMPANY", intent },
    });

  it("answers another Q only when it asks, and never past the daily cap", async () => {
    const { ports, rec } = fakePorts();
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    const lane = LANE("lane-6");
    await engine.advanceLane(lane, observe({ connected: false }));
    await engine.advanceLane(lane, observe());
    const info = fromQ("q1", "ANSWER");
    await engine.advanceLane(lane, observe({ messages: [info] }));
    expect(rec.posts.some((post) => post.key === "reply:q1")).toBe(false);
    const capped = fromQ("q2", "ASK");
    await engine.advanceLane(
      lane,
      observe({ messages: [info, capped], q2qLastDay: 6 }),
    );
    expect(rec.posts.some((post) => post.key === "reply:q2")).toBe(false);
    const ask = fromQ("q3", "ASK");
    await engine.advanceLane(
      lane,
      observe({ messages: [info, capped, ask], q2qLastDay: 2 }),
    );
    expect(rec.posts.some((post) => post.key === "reply:q3")).toBe(true);
  });
});

describe("founder stand-in", () => {
  const STAND_IN_REF: DelegationRef = {
    ...REF,
    principalName: "Femi Founder",
    threadId: "work:standin-1",
  };
  const grant = {
    brief: "We are at seed, raising 1m, 3 bank pilots.",
    awayAfterMinutes: 30,
  };
  const thread = (messages: ObservedMessage[], q2qLastDay = 0) => ({
    relationshipId: "rel-1",
    counterpartName: "Ada Capital",
    chatPath: "/relationships/investor/i1/messages",
    messages,
    q2qLastDay,
  });
  const standIn = (over: Partial<StandInObservation>): StandInObservation => ({
    now: tick(),
    status: "ACTIVE",
    access: "OK",
    away: false,
    threads: [],
    ...over,
  });

  it("answers while away, hands back on return, and stops when told", async () => {
    const { ports, rec } = fakePorts({
      standInReply: (_ref, input) =>
        Promise.resolve(
          input.thread.includes("burn")
            ? {
                reply: "Femi will answer that when back.",
                deferred: true,
                forPerson: ["What is your burn?"],
              }
            : {
                reply: "We're at seed, raising 1m.",
                deferred: false,
                forPerson: [],
              },
        ),
    });
    const engine = createQWorkEngine({
      checkpoints: createInMemoryQCheckpointStore(),
      ports,
    });
    // Present: Q says nothing.
    const q1 = message("i1", "What stage are you?", { senderName: "Ada" });
    await engine.advanceStandIn(
      STAND_IN_REF,
      grant,
      standIn({ threads: [thread([q1])] }),
    );
    expect(rec.posts).toHaveLength(0);

    // Away: Q answers from the brief, as Q.
    await engine.advanceStandIn(
      STAND_IN_REF,
      grant,
      standIn({ away: true, threads: [thread([q1])] }),
    );
    expect(rec.posts[0]).toMatchObject({
      key: "standin:i1",
      envelope: { protocol: "cq.q2q/1", side: "COMPANY", intent: "ANSWER" },
    });
    // The same message is not answered twice.
    await engine.advanceStandIn(
      STAND_IN_REF,
      grant,
      standIn({ away: true, threads: [thread([q1])] }),
    );
    expect(rec.posts).toHaveLength(1);

    const q2 = message("i2", "What's your burn?", { senderName: "Ada" });
    await engine.advanceStandIn(
      STAND_IN_REF,
      grant,
      standIn({ away: true, threads: [thread([q1, q2])] }),
    );
    expect(rec.posts.at(-1)?.envelope?.intent).toBe("DEFER");
    expect(
      rec.notices.some(
        (n) => n.key === "standin-ask:i2" && n.priority === "NEEDS_YOU",
      ),
    ).toBe(true);

    // Back: one hand-back message per thread and one notice.
    await engine.advanceStandIn(
      STAND_IN_REF,
      grant,
      standIn({ away: false, threads: [thread([q1, q2])] }),
    );
    expect(rec.posts.at(-1)?.envelope?.intent).toBe("HANDBACK");
    const handback = rec.notices.find((n) => n.key.startsWith("handback:"));
    expect(handback?.title).toBe("While you were away, Q answered 2 messages");
    expect(handback?.priority).toBe("NEEDS_YOU");

    // Another Q's non-question is not answered.
    const qInfo = message("i3", "Q for Ada: noted.", {
      viaQ: true,
      envelope: { protocol: "cq.q2q/1", side: "INVESTOR", intent: "INFO" },
    });
    const count = rec.posts.length;
    await engine.advanceStandIn(
      STAND_IN_REF,
      grant,
      standIn({ away: true, threads: [thread([q1, q2, qInfo])] }),
    );
    expect(rec.posts.length).toBe(count);

    expect(
      await engine.advanceStandIn(
        STAND_IN_REF,
        grant,
        standIn({ status: "STOPPED" }),
      ),
    ).toBe("FINISHED");
    expect(rec.finished.at(-1)?.status).toBe("STOPPED");
  });
});
