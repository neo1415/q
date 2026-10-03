import { describe, expect, it } from "vitest";

import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { ActorContext } from "@capital-q/security";

import {
  createRelationshipOutcomeService,
  type RelationshipEventAppender,
  type RelationshipPartyView,
} from "../src/index.js";

/**
 * Post-meeting outcomes (2026-10-02): who may pass, pause and resume, what
 * the shared event and the outbox carry, and what a founder may read of a
 * pass. The database's own guarantees (RLS, append-only, reference rows)
 * are pgTAP 630; this is the service's authorisation and privacy.
 */

const RELATIONSHIP = "00000000-0000-4000-8000-000000000101";
const COMPANY = "00000000-0000-4000-8000-0000000001c1";
const INVESTOR_ORG = "00000000-0000-4000-8000-0000000001e1";
const PASS_ID = "00000000-0000-4000-8000-0000000001a1";

const actor = (userId: string): ActorContext => ({
  userId: userId as ActorContext["userId"],
  tenantId: "00000000-0000-4000-8000-0000000000f1" as ActorContext["tenantId"],
  actorType: "HUMAN",
});
const investor = actor("00000000-0000-4000-8000-0000000000b1");
const founder = actor("00000000-0000-4000-8000-0000000000a1");
const stranger = actor("00000000-0000-4000-8000-0000000000c1");

type PassRow = {
  id: string;
  created_at: Date;
  reason_code: string | null;
  label: string | null;
  note: string | null;
  share_with_founder: boolean;
};

function world(state: string, passRows: PassRow[] = []) {
  const events: { eventType: string; payload: unknown }[] = [];
  const announced: unknown[] = [];
  const inserted: unknown[][] = [];

  const view = (side: "INVESTOR" | "COMPANY"): RelationshipPartyView =>
    ({
      side,
      counterpart:
        side === "INVESTOR"
          ? { kind: "COMPANY", id: COMPANY }
          : { kind: "INVESTOR_ORGANISATION", id: INVESTOR_ORG },
      status: {
        relationship: {
          id: RELATIONSHIP,
          tenantId: "00000000-0000-4000-8000-0000000000f2",
          companyId: COMPANY,
          investorOrganisationId: INVESTOR_ORG,
        },
        projection: { state },
      },
    }) as unknown as RelationshipPartyView;

  const fake = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("where passed_by_user_id")) return Promise.resolve([]);
    if (text.includes("from network.relationship_pass_reasons")) {
      return Promise.resolve(
        ["VALUATION", "TIMING"].includes(String(values[0]))
          ? [{ code: values[0] }]
          : [],
      );
    }
    if (text.includes("insert into network.relationship_passes")) {
      inserted.push(values);
      return Promise.resolve([{ id: PASS_ID }]);
    }
    if (text.includes("from network.relationship_passes p")) {
      return Promise.resolve(passRows);
    }
    if (text.includes("for update")) return Promise.resolve([]);
    if (text.includes("from network.relationship_events")) {
      const kinds = new Set(values.slice(1).map(String));
      const latest = events.findLast((event) => kinds.has(event.eventType));
      return Promise.resolve(
        latest === undefined ? [] : [{ event_type: latest.eventType }],
      );
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };
  const sql = fake as unknown as DatabaseExecutor;
  // One transaction at a time, as the relationship's row lock makes them.
  let queue: Promise<unknown> = Promise.resolve();
  const transactions: TransactionManager = {
    run: (work) => {
      const next = queue.then(() =>
        work({ sql: fake as unknown as TransactionContext["sql"] }),
      );
      queue = next.catch(() => undefined);
      return next;
    },
  };
  const appender: RelationshipEventAppender = {
    append: (_tx, input) => {
      events.push({ eventType: input.eventType, payload: input.payload });
      return Promise.resolve(
        {} as Awaited<ReturnType<RelationshipEventAppender["append"]>>,
      );
    },
  };
  const outbox: OutboxWriter = {
    enqueue: (_tx, event) => {
      announced.push(event.data);
      return Promise.resolve({ status: "ENQUEUED" as const });
    },
  };
  const service = createRelationshipOutcomeService({
    sql,
    transactions,
    interests: {
      relationshipById: ({ actor: who }) =>
        Promise.resolve(
          who.userId === investor.userId
            ? view("INVESTOR")
            : who.userId === founder.userId
              ? view("COMPANY")
              : null,
        ),
    },
    appender,
    outbox,
    newCorrelationId: () => "cor_test0000",
  });
  return { service, events, announced, inserted };
}

const pass = (
  service: ReturnType<typeof world>["service"],
  who: ActorContext,
  extra: Partial<Parameters<typeof service.pass>[0]> = {},
) =>
  service.pass({
    actor: who,
    relationshipId: RELATIONSHIP,
    reasonCode: "VALUATION",
    note: "Priced above our band",
    shareWithFounder: false,
    idempotencyKey: "pass-key-0001",
    ...extra,
  });

describe("Pass after a meeting", () => {
  it("a founder cannot pass on themselves: refused, nothing recorded", async () => {
    const w = world("MEETING_HELD");
    expect(await pass(w.service, founder)).toEqual({
      outcome: "REFUSED",
      code: "NOT_ALLOWED",
    });
    expect(w.events).toEqual([]);
    expect(w.inserted).toEqual([]);
  });

  it("someone who is not a party (another tenant) gets the one not-found", async () => {
    const w = world("MEETING_HELD");
    expect(await pass(w.service, stranger)).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
    expect(w.events).toEqual([]);
  });

  it("the investor passes: the shared event and the outbox carry no reason and no note", async () => {
    const w = world("MEETING_HELD");
    expect(await pass(w.service, investor)).toEqual({
      outcome: "OK",
      relationshipId: RELATIONSHIP,
      deduplicated: false,
    });
    expect(w.events).toEqual([
      {
        eventType: "relationship_passed",
        payload: { passId: PASS_ID, side: "INVESTOR", reasonShared: false },
      },
    ]);
    expect(w.announced).toEqual([
      {
        relationshipId: RELATIONSHIP,
        companyId: COMPANY,
        investorOrganisationId: INVESTOR_ORG,
        outcome: "PASSED",
        side: "INVESTOR",
        passId: PASS_ID,
      },
    ]);
    const everythingShared = JSON.stringify([w.events, w.announced]);
    expect(everythingShared).not.toContain("VALUATION");
    expect(everythingShared).not.toContain("Priced above");
    // The reason is kept, privately, on the pass record.
    expect(w.inserted[0]).toContain("Priced above our band");
    expect(w.inserted[0]).toContain(false);
  });

  it("sharing is only what they ticked, and sharing nothing shares nothing", async () => {
    const shared = world("CONNECTED");
    await pass(shared.service, investor, { shareWithFounder: true });
    expect(shared.events[0]?.payload).toMatchObject({ reasonShared: true });
    const empty = world("CONNECTED");
    await pass(empty.service, investor, {
      shareWithFounder: true,
      reasonCode: null,
      note: null,
    });
    expect(empty.events[0]?.payload).toMatchObject({ reasonShared: false });
  });

  it("refuses an unknown reason, a state with no match, and repeats a pass as a no-op", async () => {
    expect(
      await pass(world("CONNECTED").service, investor, {
        reasonCode: "NOT_A_REASON",
      }),
    ).toEqual({ outcome: "REFUSED", code: "INVALID_REASON" });
    expect(await pass(world("INTEREST_EXPRESSED").service, investor)).toEqual({
      outcome: "REFUSED",
      code: "NOT_IN_STATE",
    });
    const again = world("PASSED");
    expect(await pass(again.service, investor)).toMatchObject({
      outcome: "OK",
      deduplicated: true,
    });
    expect(again.events).toEqual([]);
  });
});

describe("Pause and Resume", () => {
  it("only the investor side pauses or resumes", async () => {
    const w = world("CONNECTED");
    for (const act of [w.service.pause, w.service.resume]) {
      expect(
        await act({ actor: founder, relationshipId: RELATIONSHIP }),
      ).toEqual({ outcome: "REFUSED", code: "NOT_ALLOWED" });
    }
    expect(w.events).toEqual([]);
  });

  it("pause records a shared pause; resume lifts a pause or a pass; repeats are no-ops", async () => {
    const live = world("IN_DILIGENCE");
    await live.service.pause({ actor: investor, relationshipId: RELATIONSHIP });
    expect(live.events.map((e) => e.eventType)).toEqual([
      "relationship_paused",
    ]);
    expect(
      await live.service.resume({
        actor: investor,
        relationshipId: RELATIONSHIP,
      }),
    ).toMatchObject({ outcome: "OK", deduplicated: true });

    const passed = world("PASSED");
    await passed.service.resume({
      actor: investor,
      relationshipId: RELATIONSHIP,
    });
    expect(passed.events.map((e) => e.eventType)).toEqual([
      "relationship_resumed",
    ]);
    expect(
      await world("PASSED").service.pause({
        actor: investor,
        relationshipId: RELATIONSHIP,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_IN_STATE" });
  });
});

describe("a meeting's confirmed outcome", () => {
  it("either side records diligence or progress in a live match", async () => {
    const w = world("MEETING_HELD");
    await w.service.recordMeetingOutcome({
      actor: founder,
      relationshipId: RELATIONSHIP,
      outcome: { kind: "DILIGENCE" },
    });
    await w.service.recordMeetingOutcome({
      actor: investor,
      relationshipId: RELATIONSHIP,
      outcome: { kind: "PROGRESSED", step: "FOLLOW_UP_MEETING" },
    });
    expect(w.events).toEqual([
      { eventType: "diligence_started", payload: { side: "COMPANY" } },
      {
        eventType: "relationship_progressed",
        payload: { side: "INVESTOR", step: "FOLLOW_UP_MEETING" },
      },
    ]);
    expect(
      await world("PASSED").service.recordMeetingOutcome({
        actor: investor,
        relationshipId: RELATIONSHIP,
        outcome: { kind: "DILIGENCE" },
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_IN_STATE" });
  });
});

describe("what each side reads of a pass", () => {
  const row = (shared: boolean): PassRow => ({
    id: PASS_ID,
    created_at: new Date("2026-10-02T10:00:00Z"),
    reason_code: "TIMING",
    label: "Timing",
    note: "Too early for this fund",
    share_with_founder: shared,
  });

  it("the founder reads nothing of a private reason, and the investor reads all of it", async () => {
    const w = world("PASSED", [row(false)]);
    expect(
      await w.service.latestPass({
        actor: founder,
        relationshipId: RELATIONSHIP,
      }),
    ).toBeNull();
    expect(
      await w.service.latestPass({
        actor: investor,
        relationshipId: RELATIONSHIP,
      }),
    ).toMatchObject({ reasonCode: "TIMING", note: "Too early for this fund" });
    expect(
      await w.service.latestPass({
        actor: stranger,
        relationshipId: RELATIONSHIP,
      }),
    ).toBeNull();
  });

  it("the founder reads a reason the investor shared", async () => {
    const w = world("PASSED", [row(true)]);
    expect(
      await w.service.latestPass({
        actor: founder,
        relationshipId: RELATIONSHIP,
      }),
    ).toMatchObject({ reasonLabel: "Timing", sharedWithFounder: true });
  });

  it("a reset pass is not the current answer", async () => {
    const w = world("MEETING_HELD", [row(true)]);
    expect(
      await w.service.latestPass({
        actor: investor,
        relationshipId: RELATIONSHIP,
      }),
    ).toBeNull();
  });
});

describe("two tabs deciding at once (break-it sweep 2026-10-03)", () => {
  it("records one pause when Pause lands twice before either is read back", async () => {
    // The projection both requests read is still MEETING_HELD.
    const { service, events } = world("MEETING_HELD");
    const [first, second] = await Promise.all([
      service.pause({ actor: investor, relationshipId: RELATIONSHIP }),
      service.pause({ actor: investor, relationshipId: RELATIONSHIP }),
    ]);
    expect(first).toMatchObject({ outcome: "OK" });
    expect(second).toMatchObject({ outcome: "OK" });
    expect(
      events.filter((e) => e.eventType === "relationship_paused"),
    ).toHaveLength(1);
  });

  it("records one resume for a double-clicked Resume", async () => {
    const { service, events } = world("PAUSED");
    await service.resume({ actor: investor, relationshipId: RELATIONSHIP });
    const again = await service.resume({
      actor: investor,
      relationshipId: RELATIONSHIP,
    });
    expect(again).toMatchObject({ outcome: "OK", deduplicated: true });
    expect(
      events.filter((e) => e.eventType === "relationship_resumed"),
    ).toHaveLength(1);
  });

  it("records one pass for two tabs passing with their own keys", async () => {
    const { service, events } = world("MEETING_HELD");
    await pass(service, investor, { idempotencyKey: "tab-one-key-0001" });
    await pass(service, investor, { idempotencyKey: "tab-two-key-0002" });
    expect(
      events.filter((e) => e.eventType === "relationship_passed"),
    ).toHaveLength(1);
  });
});
