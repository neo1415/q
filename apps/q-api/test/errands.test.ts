import { describe, expect, it } from "vitest";

import type { MeetingView } from "@capital-q/communication";
import {
  ActorContextSchema,
  type ActorContextResolver,
} from "@capital-q/security";

import {
  createErrandRunner,
  ErrandStartPayloadSchema,
  type ErrandPatch,
  type ErrandReplyComposer,
  type ErrandRow,
  type ErrandStore,
} from "../src/composition/errands.js";

/**
 * Errands (founder direction 2026-09-29): one approval, an exact plan Q
 * carries forward. What must hold: nothing moves until they are connected;
 * every step runs as the person, once (step-scoped keys, marked as Q's);
 * Q replies only from the approved brief; losing access stops the errand.
 */

const USER = "00000000-0000-4000-8000-0000000000b1";
const TENANT = "00000000-0000-4000-8000-00000000000a";
const ORG = "00000000-0000-4000-8000-0000000000b2";
const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const ACTION = "00000000-0000-4000-8000-0000000000d1";
const MEETING = "00000000-0000-4000-8000-0000000000e1";
const NOW = new Date("2026-09-30T09:00:00Z");

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "00000000-0000-4000-8000-0000000000b3",
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

function plan(overrides: Record<string, unknown> = {}) {
  return {
    relationshipId: RELATIONSHIP,
    counterpartName: "Ledgerfold",
    expressInterest: false,
    openingMessage: "Hello from our fund, glad to be connected.",
    brief: null,
    bookCall: { purpose: "Intro call", durationMinutes: 30 },
    ...overrides,
  };
}

function row(overrides: Partial<ErrandRow> = {}): ErrandRow {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    tenant_id: TENANT,
    user_id: USER,
    organisation_id: ORG,
    q_action_id: ACTION,
    relationship_id: RELATIONSHIP,
    counterpart_name: "Ledgerfold",
    plan: plan(),
    stage: "WAITING_CONNECTION",
    seen_until: null,
    replies_sent: 0,
    meeting_id: null,
    expires_at: new Date(NOW.getTime() + 86_400_000),
    ...overrides,
  };
}

type Message = {
  from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
  senderName: string;
  kind: "TEXT";
  text: string;
  attachmentTitle: null;
  sentAt: string;
};

function world(options: {
  readonly errand: ErrandRow;
  readonly connected?: boolean;
  readonly blocked?: boolean;
  readonly messages?: readonly Message[];
  readonly resolver?: ActorContextResolver;
  readonly reply?: string | null;
  readonly forPerson?: readonly string[];
}) {
  const patches: ErrandPatch[] = [];
  const notices: { step: string; title: string; body: string | null }[] = [];
  const sent: {
    body: string;
    key: string;
    qDelegationId: string | undefined;
  }[] = [];
  const booked: { key: string; startsAt: Date }[] = [];
  const composed: { brief: string; thread: string }[] = [];
  let meeting: string | null = options.errand.meeting_id;

  const store: ErrandStore = {
    due: () => Promise.resolve([options.errand]),
    authUserOf: () => Promise.resolve("00000000-0000-4000-8000-0000000000aa"),
    update: (_id, patch) => {
      patches.push(patch);
      if (patch.meetingId !== undefined) meeting = patch.meetingId;
      return Promise.resolve();
    },
    meetingOf: () => Promise.resolve(meeting),
    notify: (notice) => {
      notices.push({
        step: notice.step,
        title: notice.title,
        body: notice.body,
      });
      return Promise.resolve();
    },
    list: () => Promise.resolve([]),
    stop: () => Promise.resolve(false),
  };
  const view: MeetingView = {
    id: MEETING,
    relationshipId: RELATIONSHIP,
    purpose: "Intro call",
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: "2026-10-01T09:30:00.000Z",
    timeZone: "Europe/London",
    status: "SCHEDULED",
    organisedByYou: true,
    organiserName: "Ada",
    meetLink: "https://meet.google.com/abc-defg-hij",
    attendees: [],
    hasBrief: false,
  };
  const composer: ErrandReplyComposer = {
    compose: (input) => {
      composed.push({ brief: input.brief, thread: input.thread });
      return Promise.resolve({
        reply: options.reply ?? null,
        forPerson: [...(options.forPerson ?? [])],
      });
    },
  };
  const runner = createErrandRunner({
    store,
    resolver: options.resolver ?? resolves,
    chat: {
      readForQ: () =>
        Promise.resolve({
          side: "INVESTOR" as const,
          connected: options.connected ?? true,
          blocked: options.blocked ?? false,
          // The chat's read also names each message and whether Q sent it.
          messages: (options.messages ?? []).map((message, index) => ({
            ...message,
            id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            viaQ: false,
            envelope: null,
          })),
        }),
      send: (input) => {
        if (input.request.kind === "TEXT") {
          sent.push({
            body: input.request.body,
            key: input.idempotencyKey,
            qDelegationId: input.qDelegationId,
          });
        }
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
              start: new Date("2026-10-01T09:00:00Z"),
              end: new Date("2026-10-01T09:30:00Z"),
            },
          ],
        }),
      schedule: (input) => {
        booked.push({ key: input.idempotencyKey, startsAt: input.startsAt });
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
          status: null,
        }),
    },
    composer,
    nameOf: () => Promise.resolve("Ada"),
    now: () => NOW,
  });
  return { runner, patches, notices, sent, booked, composed };
}

describe("errands", () => {
  it("waits, doing nothing, until both sides are connected", async () => {
    const w = world({ errand: row(), connected: false });
    await w.runner.tick();
    expect(w.sent).toEqual([]);
    expect(w.booked).toEqual([]);
    expect(w.notices).toEqual([]);
  });

  it("once connected, sends the approved opening as Q's, books the call and tells the person", async () => {
    const w = world({ errand: row() });
    await w.runner.tick();
    expect(w.sent[0]).toEqual({
      body: "Hello from our fund, glad to be connected.",
      key: "errand:00000000-0000-4000-8000-0000000000f1:open",
      // Marked as Q's by the errand itself, so every message can be.
      qDelegationId: "00000000-0000-4000-8000-0000000000f1",
    });
    expect(w.booked).toEqual([
      {
        key: "errand:00000000-0000-4000-8000-0000000000f1:call",
        startsAt: new Date("2026-10-01T09:00:00Z"),
      },
    ]);
    expect(w.notices.map((notice) => notice.step)).toEqual([
      "connected",
      "call",
    ]);
    expect(w.notices[1]?.body).toContain("https://meet.google.com/");
    // No brief and the call is booked: nothing is left for Q.
    expect(w.patches.at(-1)).toMatchObject({
      status: "DONE",
      stage: "FINISHED",
    });
  });

  it("answers only from the approved brief and hands the rest back", async () => {
    const brief = "We invest $250k-$1m at pre-seed in fintech infrastructure.";
    const w = world({
      errand: row({
        plan: plan({ brief, bookCall: null, openingMessage: null }),
        stage: "CONVERSING",
        seen_until: new Date("2026-09-30T08:00:00Z"),
      }),
      messages: [
        {
          from: "OTHER_SIDE",
          senderName: "Kemi",
          kind: "TEXT",
          text: "What cheque size, and who else is in your portfolio?",
          attachmentTitle: null,
          sentAt: "2026-09-30T08:30:00Z",
        },
      ],
      reply: "We write $250k-$1m cheques at pre-seed.",
      forPerson: ["Who else is in the portfolio?"],
    });
    await w.runner.tick();
    expect(w.composed).toHaveLength(1);
    expect(w.composed[0]?.brief).toBe(brief);
    expect(w.sent).toEqual([
      {
        body: "We write $250k-$1m cheques at pre-seed.",
        key: "errand:00000000-0000-4000-8000-0000000000f1:reply:2026-09-30T08:30:00.000Z",
        qDelegationId: "00000000-0000-4000-8000-0000000000f1",
      },
    ]);
    expect(w.notices[0]?.body).toBe("Who else is in the portfolio?");
    // A brief keeps the errand open for later questions.
    expect(w.patches.some((patch) => patch.status === "DONE")).toBe(false);
  });

  it("never re-reads words it has already answered", async () => {
    const w = world({
      errand: row({
        plan: plan({ brief: "We invest at pre-seed only, in fintech." }),
        stage: "CALL_BOOKED",
        meeting_id: MEETING,
        seen_until: new Date("2026-09-30T08:45:00Z"),
      }),
      messages: [
        {
          from: "OTHER_SIDE",
          senderName: "Kemi",
          kind: "TEXT",
          text: "Thanks!",
          attachmentTitle: null,
          sentAt: "2026-09-30T08:30:00Z",
        },
      ],
      reply: "You're welcome.",
    });
    await w.runner.tick();
    expect(w.composed).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it("without a brief, tells the person what they wrote instead of answering", async () => {
    const w = world({
      errand: row({
        plan: plan({ bookCall: null }),
        stage: "CONVERSING",
        seen_until: new Date("2026-09-30T08:00:00Z"),
      }),
      messages: [
        {
          from: "OTHER_SIDE",
          senderName: "Kemi",
          kind: "TEXT",
          text: "Can you share your deck?",
          attachmentTitle: null,
          sentAt: "2026-09-30T08:30:00Z",
        },
      ],
    });
    await w.runner.tick();
    expect(w.composed).toEqual([]);
    expect(w.sent).toEqual([]);
    expect(w.notices[0]?.body).toBe("Can you share your deck?");
  });

  it("stops, sending nothing, when the person's access is gone", async () => {
    const w = world({ errand: row(), resolver: revoked });
    await w.runner.tick();
    expect(w.sent).toEqual([]);
    expect(w.booked).toEqual([]);
    expect(w.patches[0]).toMatchObject({ status: "STOPPED" });
  });

  it("stops when messaging is blocked", async () => {
    const w = world({ errand: row(), blocked: true });
    await w.runner.tick();
    expect(w.sent).toEqual([]);
    expect(w.patches[0]).toMatchObject({ status: "STOPPED" });
  });

  it("a plan starting from a company must express interest", () => {
    const fromCompany = {
      ...plan(),
      relationshipId: undefined,
      companyId: "00000000-0000-4000-8000-0000000000c9",
    };
    expect(ErrandStartPayloadSchema.safeParse(fromCompany).success).toBe(false);
    expect(
      ErrandStartPayloadSchema.safeParse({
        ...fromCompany,
        expressInterest: true,
      }).success,
    ).toBe(true);
  });
});
