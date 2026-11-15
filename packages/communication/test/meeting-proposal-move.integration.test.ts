import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createCounterpartNotices,
  createMeetingProposalPort,
  createNetworkMeetingActivityWriter,
  createPostgresMeetingDirectory,
  createPostgresProposalStore,
  createPostgresScheduleStore,
  createScheduleService,
  type MeetingProposalPort,
  type TimeOption,
} from "../src/index.js";
import { createFakeAppEmail } from "../src/testing/index.js";

/**
 * Live audit 2026-11-15 D9/D10 against PostgreSQL: an accepted move of a
 * booked meeting answers "moved" with that meeting, although the partial
 * unique index `meeting_time_proposals_meeting_idx` keeps `meeting_id` on
 * the proposal that booked it; and the move's notice says it is a move.
 * No calendar is connected (the time is agreed on Capital Q). Leaves rows
 * behind: run against a scratch database (CQ_TEST_DATABASE_URL).
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const ahead = (days: number, hour: number): TimeOption => {
  const start = new Date(Date.now() + days * 24 * 3_600_000);
  start.setUTCHours(hour, 0, 0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    timeZone: "Africa/Lagos",
  };
};

describe("@capital-q/communication meeting move proposals against PostgreSQL", () => {
  let db: RequestDatabase;
  let port: MeetingProposalPort;
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
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Move ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Move ${type}`}, ${`move-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@move.example.invalid`})`;
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
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Move Co', ${`move-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Move Capital')`;
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
    const schedule = createScheduleService({
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
      // No calendar anywhere: the agreed time is recorded on Capital Q.
      calendars: () => Promise.resolve(null),
      activity: createNetworkMeetingActivityWriter(),
      email: createFakeAppEmail(),
    });
    port = createMeetingProposalPort({
      transactions: db.transactions,
      schedule,
      counterpartNotices: createCounterpartNotices(db.sql),
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const as = (actor: ActorContext) =>
    port.forActor(actor, `cor_${randomUUID()}`);

  it("D9: an accepted move answers moved with the moved meeting; the index keeps meeting_id on the booking proposal", async () => {
    const first = await as(founder).propose({
      actorUserId: founder.userId,
      relationshipId: ids.relationship,
      purpose: "Move check: booked call",
      options: [ahead(3, 9)],
      idempotencyKey: `founder-first-${randomUUID()}`,
    });
    if (first.outcome !== "OK") throw new Error("first proposal refused");
    const accepted = await as(investor).respond({
      actorUserId: investor.userId,
      proposalId: first.proposal.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: `investor-first-${randomUUID()}`,
    });
    expect(accepted).toMatchObject({ outcome: "OK", booked: true });
    if (accepted.outcome !== "OK" || accepted.meetingId === null)
      throw new Error("first call not booked");
    const meetingId = accepted.meetingId;
    expect(accepted.proposal.meetingId).toBe(meetingId);

    const move = await as(founder).propose({
      actorUserId: founder.userId,
      relationshipId: ids.relationship,
      purpose: "Move check: booked call",
      options: [ahead(5, 13), ahead(6, 9)],
      rescheduleOfMeetingId: meetingId,
      idempotencyKey: `founder-move-${randomUUID()}`,
    });
    if (move.outcome !== "OK") throw new Error("move refused");

    // D10: the investor reads that it is a move, from the booked time.
    const [notice] = await db.sql<{ title: string; body: string | null }[]>`
      select title, body from communication.notifications
       where user_id = ${investor.userId} and kind = 'TIME_PROPOSED'
         and title like '%proposed moving your call%'`;
    expect(notice?.body).toContain("This moves the call booked for");
    expect(notice?.body).toContain(
      "The call stays as booked until a new time is accepted.",
    );
    expect(notice?.body).not.toContain("Nothing is booked");

    const accept = {
      actorUserId: investor.userId,
      proposalId: move.proposal.id,
      action: "ACCEPT" as const,
      optionIndex: 0,
      idempotencyKey: `investor-move-${randomUUID()}`,
    };
    const out = await as(investor).respond(accept);
    expect(out).toMatchObject({
      outcome: "OK",
      confirmed: true,
      booked: true,
      meetingId,
      calendarInvite: false,
      proposal: { rescheduleOfMeetingId: meetingId, meetingId: null },
    });
    // The same key again: the same answer, still the one meeting.
    expect(await as(investor).respond(accept)).toMatchObject({
      outcome: "OK",
      recorded: false,
      booked: true,
      meetingId,
    });

    const rows = await db.sql<
      { id: string; state: string; meeting_id: string | null }[]
    >`
      select id, state, meeting_id from communication.meeting_time_proposals
       where relationship_id = ${ids.relationship}`;
    expect(rows.find((r) => r.id === first.proposal.id)?.meeting_id).toBe(
      meetingId,
    );
    expect(rows.find((r) => r.id === move.proposal.id)).toMatchObject({
      state: "CONFIRMED",
      meeting_id: null,
    });
    const meetings = await db.sql<
      { id: string; status: string; starts_at: Date }[]
    >`
      select id, status, starts_at from communication.meetings
       where relationship_id = ${ids.relationship}`;
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({ id: meetingId, status: "SCHEDULED" });
    expect(meetings[0]?.starts_at.toISOString()).toBe(
      new Date(ahead(5, 13).startsAt).toISOString(),
    );

    // Why the move never writes meeting_id: the index refuses a second
    // proposal on the same meeting (the failure the live accept swallowed).
    const store = createPostgresProposalStore({
      transactions: db.transactions,
    });
    await expect(
      store.attachMeeting(move.proposal.id, meetingId),
    ).rejects.toThrow(/CONSTRAINT/);
    const [index] = await db.sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
       where schemaname = 'communication'
         and indexname = 'meeting_time_proposals_meeting_idx'`;
    expect(index?.indexdef).toMatch(/UNIQUE INDEX .*\(meeting_id\)/);
  });
});
