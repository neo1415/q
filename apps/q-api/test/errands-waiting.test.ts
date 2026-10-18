import { describe, expect, it } from "vitest";

import type { MeetingView } from "@capital-q/communication";
import {
  ActorContextSchema,
  type ActorContextResolver,
} from "@capital-q/security";

import {
  createErrandRunner,
  type ErrandPatch,
  type ErrandRow,
  type ErrandStore,
} from "../src/composition/errands.js";
import {
  createWorkWakeListener,
  waitingDecision,
} from "../src/composition/waiting.js";

/**
 * Waiting like a person (founder direction 2026-10-01): an errand waiting
 * for the other side says what it waits for, continues the moment they
 * accept (a wake, not the next tick), resumes once however often it is
 * woken, never resumes after a decline or lost access, reminds them once
 * after 3 days and tells the owner plainly after 7.
 */

const USER = "00000000-0000-4000-8000-0000000000b1";
const TENANT = "00000000-0000-4000-8000-00000000000a";
const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const OTHER_RELATIONSHIP = "00000000-0000-4000-8000-0000000000c2";
const FILED = new Date("2026-10-01T09:00:00Z");
const DAY = 24 * 3_600_000;

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});

const resolves: ActorContextResolver = {
  resolveHumanContext: () =>
    Promise.resolve({ status: "RESOLVED", context: actor }),
};
const revoked: ActorContextResolver = {
  resolveHumanContext: () =>
    Promise.resolve({ status: "CONTEXT_NOT_ACCESSIBLE" }),
};

function world(options: {
  readonly resolver?: ActorContextResolver;
  readonly state?: "INTEREST_EXPRESSED" | "CONNECTED" | "DECLINED";
  readonly now?: Date;
}) {
  let state = options.state ?? "INTEREST_EXPRESSED";
  let clock = options.now ?? new Date(FILED.getTime() + 60_000);
  const row: ErrandRow = {
    id: "00000000-0000-4000-8000-0000000000f1",
    tenant_id: TENANT,
    user_id: USER,
    organisation_id: null,
    q_action_id: "00000000-0000-4000-8000-0000000000d1",
    relationship_id: RELATIONSHIP,
    counterpart_name: "Ledgerfold",
    plan: {
      relationshipId: RELATIONSHIP,
      counterpartName: "Ledgerfold",
      expressInterest: false,
      openingMessage: "Hello from our fund, glad to be connected.",
      brief: null,
      bookCall: { purpose: "Intro call", durationMinutes: 30 },
    },
    stage: "WAITING_CONNECTION",
    seen_until: null,
    replies_sent: 0,
    meeting_id: null,
    expires_at: new Date(FILED.getTime() + 14 * DAY),
    created_at: FILED,
  };
  let status: "ACTIVE" | "DONE" | "STOPPED" | "FAILED" | "EXPIRED" = "ACTIVE";
  let current: ErrandRow = row;
  const patches: ErrandPatch[] = [];
  const notices: string[] = [];
  const sent: string[] = [];
  const booked: string[] = [];
  const nudged: string[] = [];
  const nudgeKeys = new Set<string>();
  const view: MeetingView = {
    id: "00000000-0000-4000-8000-0000000000e1",
    relationshipId: RELATIONSHIP,
    purpose: "Intro call",
    startsAt: "2026-10-03T09:00:00.000Z",
    endsAt: "2026-10-03T09:30:00.000Z",
    timeZone: "Europe/London",
    status: "SCHEDULED",
    organisedByYou: true,
    organiserName: "Ada",
    meetLink: "https://meet.google.com/abc-defg-hij",
    attendees: [],
    hasBrief: false,
  };
  const store: ErrandStore = {
    due: () => Promise.resolve(status === "ACTIVE" ? [current] : []),
    dueFor: (relationshipId) =>
      Promise.resolve(
        status === "ACTIVE" && relationshipId === current.relationship_id
          ? [current]
          : [],
      ),
    authUserOf: () => Promise.resolve("00000000-0000-4000-8000-0000000000aa"),
    update: (_id, patch) => {
      if (status !== "ACTIVE") return Promise.resolve();
      patches.push(patch);
      if (patch.status !== undefined) status = patch.status;
      current = {
        ...current,
        ...(patch.stage === undefined ? {} : { stage: patch.stage }),
        ...(patch.seenUntil === undefined
          ? {}
          : { seen_until: patch.seenUntil }),
        ...(patch.meetingId === undefined
          ? {}
          : { meeting_id: patch.meetingId }),
      };
      return Promise.resolve();
    },
    meetingOf: () => Promise.resolve(current.meeting_id),
    notify: (notice) => {
      if (!notices.includes(notice.step)) notices.push(notice.step);
      return Promise.resolve();
    },
    list: () => Promise.resolve([]),
    stop: () => Promise.resolve(false),
  };
  const runner = createErrandRunner({
    store,
    resolver: options.resolver ?? resolves,
    chat: {
      readForQ: () =>
        Promise.resolve({
          side: "INVESTOR" as const,
          connected: state === "CONNECTED",
          blocked: false,
          messages: [],
        }),
      send: (input) => {
        if (input.request.kind === "TEXT") sent.push(input.idempotencyKey);
        return Promise.resolve(null);
      },
    },
    schedule: {
      findSlots: () =>
        Promise.resolve({
          outcome: "OK" as const,
          timeZone: "Europe/London",
          slots: [
            {
              start: new Date("2026-10-03T09:00:00Z"),
              end: new Date("2026-10-03T09:30:00Z"),
            },
          ],
        }),
      schedule: (input) => {
        booked.push(input.idempotencyKey);
        return Promise.resolve({
          outcome: "OK" as const,
          meeting: view,
          alreadyScheduled: false,
        });
      },
    },
    relationships: {
      byRelationship: () =>
        Promise.resolve({
          side: "INVESTOR" as const,
          counterpart: {
            kind: "COMPANY" as const,
            id: "00000000-0000-4000-8000-0000000000c9",
          },
          status: {
            relationshipId: RELATIONSHIP,
            companyId: "00000000-0000-4000-8000-0000000000c9",
            investorOrganisationId: "00000000-0000-4000-8000-0000000000c8",
            state,
            stateSince: "2026-10-01T09:00:00.000Z",
            milestones: [],
            nextStep: "WAIT",
            projectorVersion: "test",
          } as never,
        }),
    },
    composer: {
      compose: () => Promise.resolve({ reply: null, forPerson: [] }),
    },
    nameOf: () => Promise.resolve("Ada"),
    nudger: {
      nudge: (input) => {
        if (nudgeKeys.has(input.key)) return Promise.resolve(0);
        nudgeKeys.add(input.key);
        nudged.push(input.waitingName);
        return Promise.resolve(1);
      },
    },
    now: () => clock,
  });
  return {
    runner,
    patches,
    notices,
    sent,
    booked,
    nudged,
    status: () => status,
    accept: () => {
      state = "CONNECTED";
    },
    decline: () => {
      state = "DECLINED";
    },
    later: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe("an errand waiting for the other side", () => {
  it("says what it waits for, and does not fail", async () => {
    const w = world({});
    await w.runner.tick();
    expect(w.status()).toBe("ACTIVE");
    expect(w.patches.at(-1)?.lastStep).toBe(
      "Waiting for Ledgerfold to accept your interest.",
    );
    expect(w.sent).toEqual([]);
  });

  it("continues the moment they accept, once however often it is woken", async () => {
    const w = world({});
    await w.runner.tick();
    w.accept();
    // A double event: two wakes, concurrently.
    const [first, second] = await Promise.all([
      w.runner.wake(RELATIONSHIP),
      w.runner.wake(RELATIONSHIP),
    ]);
    expect(first + second).toBeGreaterThanOrEqual(1);
    expect(w.sent.filter((key) => key.endsWith(":open"))).toHaveLength(1);
    expect(w.booked).toHaveLength(1);
    expect(w.notices).toContain("connected");
    expect(w.notices).toContain("call");
    // Another relationship's acceptance wakes nothing here.
    expect(await w.runner.wake(OTHER_RELATIONSHIP)).toBe(0);
  });

  it("never resumes after they decline", async () => {
    const w = world({});
    w.decline();
    await w.runner.wake(RELATIONSHIP);
    expect(w.status()).toBe("STOPPED");
    expect(w.notices).toEqual(["declined"]);
    w.accept();
    expect(await w.runner.wake(RELATIONSHIP)).toBe(0);
    expect(w.sent).toEqual([]);
  });

  it("never resumes once the owner's access is revoked", async () => {
    const w = world({ resolver: revoked, state: "CONNECTED" });
    await w.runner.wake(RELATIONSHIP);
    expect(w.status()).toBe("STOPPED");
    expect(w.sent).toEqual([]);
    expect(w.booked).toEqual([]);
  });

  it("reminds them once after 3 days, then tells the owner plainly after 7", async () => {
    const w = world({});
    await w.runner.tick();
    expect(w.nudged).toEqual([]);
    w.later(3 * DAY);
    await w.runner.tick();
    await w.runner.tick();
    expect(w.nudged).toEqual(["Ada"]);
    expect(w.patches.at(-1)?.lastStep).toContain(
      "Waiting for Ledgerfold to accept",
    );
    expect(w.notices).not.toContain("waiting-long");
    w.later(4 * DAY);
    await w.runner.tick();
    expect(w.nudged).toEqual(["Ada"]);
    expect(w.notices).toEqual(["waiting-long"]);
    expect(w.status()).toBe("ACTIVE");
  });
});

describe("waiting policy and the wake listener", () => {
  it("waits, reminds at 3 days, tells the owner at 7", () => {
    expect(waitingDecision(FILED, new Date(FILED.getTime() + 2 * DAY))).toBe(
      "WAIT",
    );
    expect(waitingDecision(FILED, new Date(FILED.getTime() + 3 * DAY))).toBe(
      "NUDGE",
    );
    expect(waitingDecision(FILED, new Date(FILED.getTime() + 7 * DAY))).toBe(
      "TELL_OWNER",
    );
  });

  it("wakes every target for a relationship id, and ignores anything else", async () => {
    const woken: string[] = [];
    const listener = createWorkWakeListener({
      listen: () => Promise.resolve(),
      channel: "q_work_wake",
      targets: [
        {
          name: "errands",
          wake: (id) => {
            woken.push(`errands:${id}`);
            return Promise.resolve(1);
          },
        },
        {
          name: "delegations",
          wake: () => Promise.reject(new Error("one target failing")),
        },
      ],
    });
    await listener.handle(RELATIONSHIP);
    await listener.handle("not-an-id; drop table");
    expect(woken).toEqual([`errands:${RELATIONSHIP}`]);
  });
});
