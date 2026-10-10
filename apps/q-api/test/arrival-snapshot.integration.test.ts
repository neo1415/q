import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import type { QAttentionReport, RelationshipBrief } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  createRoundTripCounter,
  withRoundTripCounter,
  type RequestDatabase,
} from "@capital-q/database";
import { arrivalSnapshotFact } from "@capital-q/model-gateway/q";
import type { ActorContext } from "@capital-q/security";

import {
  createArrivalSnapshots,
  createPostgresArrivalProbe,
} from "../src/composition/arrival-snapshot.js";
import { tensorGateBrief } from "./arrival-snapshot.fixtures.js";

/**
 * W1 against local PostgreSQL: a TensorGate-shaped relationship (an
 * investor who asked to connect, two messages, a booked call). The
 * snapshot is built once, a follow-up on unchanged data sends ZERO
 * queries, a change makes a new version, and a revoked membership is never
 * served the old entry. The brief and attention readers here are
 * DB-backed and authorise on the active membership, as the real services
 * do; the cache and probe under test are the production ones.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("the arrival snapshot, against PostgreSQL (W1)", () => {
  let db: RequestDatabase;
  let founder: ActorContext;
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    relationship: randomUUID(),
    conversation: randomUUID(),
    meeting: randomUUID(),
    membership: randomUUID(),
    founderUser: "",
    investorUser: "",
  };

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    await db.transactions.run(async ({ sql }) => {
      const users: string[] = [];
      for (const [tenant, org, type, membership] of [
        [ids.tenantCo, ids.orgCo, "company", ids.membership],
        [ids.tenantInv, ids.orgInv, "investment_firm", randomUUID()],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Arrival ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Arrival ${type}`}, ${`arrival-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@arrival.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id, membership_status)
          values (${membership}, ${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      ids.founderUser = users[0] ?? "";
      ids.investorUser = users[1] ?? "";
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Arrival Co', ${`arrival-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'TensorGate')`;
      await sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
        values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;
      await sql`insert into communication.conversations (id, tenant_id, relationship_id)
        values (${ids.conversation}, ${ids.tenantCo}, ${ids.relationship})`;
      await sql`insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
        values (${ids.tenantCo}, ${ids.conversation}, ${ids.investorUser}, 'INVESTOR', 'TEXT', 'Hello from TensorGate', ${`arrival-${randomUUID()}`})`;
      await sql`insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
        values (${ids.tenantCo}, ${ids.conversation}, ${ids.investorUser}, 'INVESTOR', 'TEXT', 'Could we do Thursday 3pm for a call?', ${`arrival-${randomUUID()}`})`;
      await sql`insert into communication.meetings (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, status, google_event_id, idempotency_key)
        values (${ids.meeting}, ${ids.tenantCo}, ${ids.relationship}, ${ids.investorUser}, ${ids.tenantInv}, 'Intro call',
                now() + interval '6 days', now() + interval '6 days 30 minutes', 'Europe/London', 'SCHEDULED',
                ${`arrival${randomUUID().replace(/-/gu, "").slice(0, 20)}`}, ${`arrival-${randomUUID()}`})`;
    });
    founder = {
      userId: ids.founderUser,
      tenantId: ids.tenantCo,
      organisationId: ids.orgCo,
      membershipId: ids.membership,
      actorType: "HUMAN",
    } as ActorContext;
  });

  afterAll(async () => {
    await db.close();
  });

  /** DB-backed readers that authorise on the active membership, as the real ones do. */
  async function active(actor: ActorContext): Promise<boolean> {
    const rows = await db.sql<{ ok: boolean }[]>`
      select exists (select 1 from identity.organisation_memberships m
                      where m.id = ${actor.membershipId ?? null}::uuid
                        and m.user_id = ${actor.userId}
                        and m.membership_status = 'active') as ok`;
    return rows[0]?.ok === true;
  }

  async function briefFromDatabase(
    actor: ActorContext,
  ): Promise<readonly RelationshipBrief[] | null> {
    if (!(await active(actor))) return null;
    const messages = await db.sql<
      { body: string; created_at: Date; n: number }[]
    >`
      select m.body, m.created_at, count(*) over ()::int as n
        from communication.messages m
       where m.conversation_id = ${ids.conversation}
       order by m.created_at desc limit 1`;
    const meeting = await db.sql<{ status: string }[]>`
      select status from communication.meetings where id = ${ids.meeting}`;
    const events = await db.sql<{ seq: number }[]>`
      select coalesce(max(sequence), 0)::int as seq
        from network.relationship_events where relationship_id = ${ids.relationship}`;
    const base = tensorGateBrief({
      theirText: messages[0]?.body ?? "",
      meetingStatus:
        meeting[0]?.status === "SCHEDULED" ? "SCHEDULED" : "CANCELLED",
      sequence: (events[0]?.seq ?? 0) + (messages[0]?.n ?? 0),
    });
    return [
      {
        ...base,
        relationshipId: ids.relationship,
        counterparty: {
          kind: "INVESTOR_ORGANISATION",
          id: ids.investor,
          name: "TensorGate",
        },
        messages: { ...base.messages, count: messages[0]?.n ?? 0 },
      },
    ];
  }

  async function attentionFromDatabase(
    actor: ActorContext,
  ): Promise<QAttentionReport> {
    const readable = await active(actor);
    return {
      items: [
        {
          key: `interest:${ids.relationship}`,
          source: "INTEREST_REQUEST",
          title: "TensorGate wants to connect and is waiting for your answer",
          entity: { kind: "RELATIONSHIP", id: ids.relationship },
          counterpart: "TensorGate",
          since: new Date().toISOString(),
          decidable: readable,
        },
      ],
      activity: null,
      unread: [],
      readAt: new Date().toISOString(),
    };
  }

  function snapshotsWith(trustMs: number) {
    return createArrivalSnapshots({
      attention: (actor) => attentionFromDatabase(actor),
      briefs: (actor) => briefFromDatabase(actor),
      probe: createPostgresArrivalProbe({ sql: db.sql }),
      trustMs,
    });
  }

  it("builds the snapshot, then a follow-up costs zero round trips", async () => {
    const snapshots = snapshotsWith(60_000);
    const build = createRoundTripCounter("w1-build");
    const first = await withRoundTripCounter(build, () =>
      snapshots.forActor(founder),
    );
    expect(build.count).toBeGreaterThan(0);
    const item = first?.items[0];
    expect(item?.availability).toBe("OK");
    expect(item?.facts.theirLatestMessage?.text).toBe(
      "Could we do Thursday 3pm for a call?",
    );
    expect(item?.facts.meeting?.booked).toBe(true);
    expect(item?.openPath).toBe(
      `/relationships/investor/${ids.investor}/messages`,
    );

    // Three follow-ups: "what's the request?", "what did they say?",
    // "did they accept the time?" Each reads the snapshot; none touches
    // the database.
    for (const question of ["request", "said", "accepted"]) {
      const counter = createRoundTripCounter(`w1-followup-${question}`);
      const again = await withRoundTripCounter(counter, () =>
        snapshots.forActor(founder),
      );
      expect(counter.count).toBe(0);
      expect(again).toBe(first);
      const fact = arrivalSnapshotFact(again);
      expect(fact?.statement).toContain("TensorGate wants to connect");
      expect(fact?.statement).toContain("Could we do Thursday 3pm for a call?");
      expect(fact?.statement).toContain("it is booked");
    }
  });

  it("outside the trust window one probe query confirms unchanged data; a change builds a new version", async () => {
    const snapshots = snapshotsWith(0);
    const first = await snapshots.forActor(founder);
    const probeOnly = createRoundTripCounter("w1-probe");
    const same = await withRoundTripCounter(probeOnly, () =>
      snapshots.forActor(founder),
    );
    expect(probeOnly.count).toBe(1);
    expect(same).toBe(first);

    await db.sql`insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
      values (${ids.tenantCo}, ${ids.conversation}, ${ids.investorUser}, 'INVESTOR', 'TEXT', 'Actually, Friday 10am works better.', ${`arrival-${randomUUID()}`})`;
    const next = await snapshots.forActor(founder);
    expect(next?.version).not.toBe(first?.version);
    expect(next?.items[0]?.facts.theirLatestMessage?.text).toBe(
      "Actually, Friday 10am works better.",
    );
    expect(next?.items[0]?.facts.messageCount).toBe(3);

    await db.sql`update communication.meetings set status = 'CANCELLED', cancelled_at = now() where id = ${ids.meeting}`;
    const cancelled = await snapshots.forActor(founder);
    expect(cancelled?.version).not.toBe(next?.version);
    expect(cancelled?.items[0]?.facts.meeting?.booked).toBe(false);
  });

  it("a revoked membership is never served the old entry or its protected content", async () => {
    const snapshots = snapshotsWith(0);
    const before = await snapshots.forActor(founder);
    expect(before?.items[0]?.facts.theirLatestMessage?.text).toBeTruthy();

    await db.sql`update identity.organisation_memberships set membership_status = 'revoked', left_at = now()
      where id = ${ids.membership}`;
    const after = await snapshots.forActor(founder);
    expect(after).not.toBe(before);
    const item = after?.items[0];
    expect(item?.availability).toBe("UNAVAILABLE");
    expect(item?.facts.theirLatestMessage).toBeNull();
    expect(item?.facts.meeting).toBeNull();
    expect(item?.openPath).toBeNull();
    expect(JSON.stringify(after)).not.toContain("Could we do Thursday");
    expect(JSON.stringify(after)).not.toContain("Friday 10am");
  });
});
