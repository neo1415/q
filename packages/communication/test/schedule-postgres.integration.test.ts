import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createNetworkMeetingActivityWriter,
  createCounterpartNotices,
  createPostgresMeetingDirectory,
  createPostgresScheduleStore,
  createScheduleService,
  type ScheduleService,
} from "../src/index.js";
import {
  createFakeAppEmail,
  createFakeCalendar,
} from "../src/testing/index.js";

/**
 * BIZ-008 against PostgreSQL (fake calendar and SMTP): the meeting, its
 * participants, `meeting_scheduled`/`meeting_cancelled` history, the T-15
 * reminder, notifications and the prep brief, with the real SQL. Leaves
 * rows behind: run against a scratch database (CQ_TEST_DATABASE_URL).
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("@capital-q/communication schedule against PostgreSQL", () => {
  let db: RequestDatabase;
  let service: ScheduleService;
  let clock = new Date(Date.now() + 60_000);
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    relationship: randomUUID(),
  };
  let founder: ActorContext;
  let investor: ActorContext;
  const calendar = createFakeCalendar("ben@schedule.example.invalid");
  const email = createFakeAppEmail();

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    const users: string[] = [];
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      for (const [tenant, org, type] of [
        [ids.tenantCo, ids.orgCo, "company"],
        [ids.tenantInv, ids.orgInv, "investment_firm"],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Meet ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Meet ${type}`}, ${`meet-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@schedule.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`update identity.user_profiles set display_name = ${type === "company" ? "Ada" : "Ben"} where id = ${profile.id}`;
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
          values (${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Meet Co', ${`meet-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Meet Capital')`;
      await sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
        values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;
    });
    const actor = (userId: string, tenantId: string, organisationId: string) =>
      ({
        userId,
        tenantId,
        organisationId,
        membershipId: randomUUID(),
        actorType: "HUMAN",
      }) as ActorContext;
    founder = actor(users[0] ?? "", ids.tenantCo, ids.orgCo);
    investor = actor(users[1] ?? "", ids.tenantInv, ids.orgInv);
    service = createScheduleService({
      store: createPostgresScheduleStore({
        sql: db.sql,
        transactions: db.transactions,
      }),
      transactions: db.transactions,
      parties: (a, relationshipId) =>
        Promise.resolve(
          relationshipId !== ids.relationship
            ? null
            : a.organisationId === ids.orgCo
              ? { side: "COMPANY", connected: true }
              : a.organisationId === ids.orgInv
                ? { side: "INVESTOR", connected: true }
                : null,
        ),
      directory: createPostgresMeetingDirectory({ sql: db.sql }),
      calendars: (userId) =>
        Promise.resolve(userId === investor.userId ? calendar : null),
      activity: createNetworkMeetingActivityWriter(),
      email,
      now: () => clock,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("schedules, briefs, reminds and cancels with history on the relationship", async () => {
    const startsAt = new Date(clock.getTime() + 20 * 3_600_000);
    const scheduled = await service.schedule({
      actor: investor,
      relationshipId: ids.relationship,
      purpose: "Intro call",
      startsAt,
      durationMinutes: 30,
      timeZone: "Europe/London",
      idempotencyKey: `q-action:${randomUUID()}`,
      correlationId: `cor_${randomUUID()}`,
    });
    expect(scheduled.outcome).toBe("OK");
    if (scheduled.outcome !== "OK") return;
    expect(scheduled.meeting.attendees).toEqual(["Ada"]);
    expect(calendar.inserted[0]?.attendees[0]?.email).toMatch(
      /@schedule\.example\.invalid$/,
    );

    const seenByFounder = await service.listMeetings(founder, ids.relationship);
    expect(seenByFounder?.[0]?.meetLink).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    // Booking also suggests a rehearsal (REHEARSE, MEETING_PREP_READY), so
    // both notices exist; the newest is not necessarily the booking one.
    expect(
      (await service.listNotifications(founder)).items.map((n) => n.kind),
    ).toEqual(
      expect.arrayContaining(["MEETING_SCHEDULED", "MEETING_PREP_READY"]),
    );

    expect(await service.prepareBriefs(`cor_${randomUUID()}`)).toBeGreaterThan(
      0,
    );
    const brief = await service.brief(investor, scheduled.meeting.id);
    expect(brief?.body).toContain("With: Meet Co (Ada)");

    clock = new Date(startsAt.getTime() - 14 * 60_000);
    const delivered = await service.deliverDue(`cor_${randomUUID()}`);
    expect(delivered.emailed).toBeGreaterThan(0);
    expect(email.sent.some((m) => m.subject.includes("Intro call"))).toBe(true);

    const cancelled = await service.cancel({
      actor: investor,
      meetingId: scheduled.meeting.id,
      correlationId: `cor_${randomUUID()}`,
    });
    expect(cancelled).toEqual({ outcome: "OK", alreadyDone: false });

    const history = await db.sql<{ event_type: string }[]>`
      select event_type from network.relationship_events
       where relationship_id = ${ids.relationship} order by sequence`;
    expect(history.map((row) => row.event_type)).toEqual([
      "meeting_scheduled",
      "meeting_cancelled",
    ]);
  });

  it("keeps one reminder per idempotency key", async () => {
    const input = {
      actor: founder,
      title: "Follow up",
      dueAt: new Date(clock.getTime() + 3_600_000),
      channel: "IN_APP" as const,
      idempotencyKey: `own-${randomUUID()}`,
    };
    const first = await service.createReminder(input);
    const second = await service.createReminder(input);
    expect(first.outcome === "OK" && first.alreadyCreated).toBe(false);
    expect(second.outcome === "OK" && second.alreadyCreated).toBe(true);
    expect(await service.listReminders(founder)).toHaveLength(1);
  });
  it("records a time agreed in the chat without Google, and tells the other side (AUTO 2026-10-02)", async () => {
    const startsAt = new Date(clock.getTime() + 30 * 3_600_000);
    const key = `errand:${randomUUID()}:agreed`;
    const agreed = await service.recordAgreed({
      actor: founder,
      relationshipId: ids.relationship,
      purpose: "Agreed call",
      startsAt,
      durationMinutes: 30,
      timeZone: "Africa/Lagos",
      idempotencyKey: key,
      correlationId: `cor_${randomUUID()}`,
    });
    expect(agreed.outcome).toBe("OK");
    if (agreed.outcome !== "OK") return;
    expect(agreed.meeting.meetLink).toBeNull();
    expect(agreed.invitees.map((person) => person.email)).toHaveLength(1);
    const again = await service.recordAgreed({
      actor: founder,
      relationshipId: ids.relationship,
      purpose: "Agreed call",
      startsAt,
      durationMinutes: 30,
      timeZone: "Africa/Lagos",
      idempotencyKey: key,
      correlationId: `cor_${randomUUID()}`,
    });
    expect(again.outcome === "OK" && again.alreadyScheduled).toBe(true);
    const events = await db.sql<{ event_type: string }[]>`
      select event_type from network.relationship_events
       where relationship_id = ${ids.relationship} and event_type = 'meeting_scheduled'`;
    expect(events.length).toBeGreaterThanOrEqual(1);

    const notices = createCounterpartNotices(db.sql);
    const told = await notices.notify({
      relationshipId: ids.relationship,
      actingSide: "COMPANY",
      kind: "TIME_PROPOSED",
      title: "Q, on behalf of Ada, proposed times for a call",
      body: "1. Mon",
      target: "CHAT",
      key: `test:${key}`,
      priority: "NEEDS_YOU",
    });
    expect(told).toBe(1);
    expect(
      await notices.notify({
        relationshipId: ids.relationship,
        actingSide: "COMPANY",
        kind: "TIME_PROPOSED",
        title: "again",
        body: null,
        target: "CHAT",
        key: `test:${key}`,
        priority: "NEEDS_YOU",
      }),
    ).toBe(0);
    const [row] = await db.sql<{ user_id: string; link_path: string }[]>`
      select user_id, link_path from communication.notifications
       where dedupe_key = ${`time_proposed:test:${key}`}`;
    expect(row?.user_id).toBe(investor.userId);
    expect(row?.link_path).toBe(
      `/relationships/company/${ids.company}/messages`,
    );
  });
});
