import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";

import {
  collectPersonData,
  createDataRightsJobs,
  createDataRightsService,
  DATA_RIGHTS_POLICY,
  ERASED,
  eraseInDatabase,
  executeAccountDeletion,
  INVENTORY_SCHEMAS,
  PERSONAL_DATA_INVENTORY,
  type AuthAccountRemover,
  type DataRightsObjectRef,
  type DataRightsStorage,
} from "../src/index.js";

/**
 * Data rights (decision 107) against local Postgres with every migration
 * applied. Each case runs inside one transaction that is rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type Person = {
  readonly id: string;
  readonly auth: string;
  readonly email: string;
};

type World = {
  readonly founder: Person;
  readonly investor: Person;
  readonly stranger: Person;
  readonly tenantA: string;
  readonly tenantB: string;
  readonly orgA: string;
  readonly orgB: string;
  readonly relationshipId: string;
  readonly chatMessageId: string;
  readonly qConversationId: string;
  readonly strangerConversationId: string;
  readonly investorNoteId: string;
  readonly meetingId: string;
  readonly avatarKey: string;
};

const correlation = () => `cor_${randomUUID()}`;

async function person(
  tx: TransactionContext,
  label: string,
  tag: string,
): Promise<Person> {
  const auth = randomUUID();
  const email = `${label}-${tag}@example.invalid`;
  await tx.sql`insert into auth.users (id, email) values (${auth}, ${email})`;
  const [row] = await tx.sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${auth}`;
  if (row === undefined) throw new Error("profile trigger missing");
  await tx.sql`
    update identity.user_profiles
       set display_name = ${`${label} Person`}, given_name = ${label}, headline = 'Builder'
     where id = ${row.id}`;
  return { id: row.id, auth, email };
}

async function ownerRole(tx: TransactionContext): Promise<string> {
  const [role] = await tx.sql<{ id: string }[]>`
    select id from permissions.roles where code = 'organisation_owner'`;
  if (role === undefined) throw new Error("owner role missing");
  return role.id;
}

async function member(
  tx: TransactionContext,
  tenantId: string,
  organisationId: string,
  userId: string,
  owner: boolean,
): Promise<string> {
  const [membership] = await tx.sql<{ id: string }[]>`
    insert into identity.organisation_memberships (tenant_id, organisation_id, user_id)
    values (${tenantId}, ${organisationId}, ${userId}) returning id`;
  if (membership === undefined) throw new Error("membership");
  if (owner) {
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
                 values (${membership.id}, ${await ownerRole(tx)})`;
  }
  return membership.id;
}

async function world(tx: TransactionContext): Promise<World> {
  const tag = randomUUID().slice(0, 8);
  const founder = await person(tx, "founder", tag);
  const investor = await person(tx, "investor", tag);
  const stranger = await person(tx, "stranger", tag);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const tenantX = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgX = randomUUID();
  await tx.sql`insert into identity.tenants (id, name) values
    (${tenantA}, 'DR A'), (${tenantB}, 'DR B'), (${tenantX}, 'DR X')`;
  await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values
    (${orgA}, ${tenantA}, 'company', 'DR Co', ${`dr-co-${tag}`}),
    (${orgB}, ${tenantB}, 'investment_firm', 'DR Capital', ${`dr-cap-${tag}`}),
    (${orgX}, ${tenantX}, 'company', 'DR Other', ${`dr-x-${tag}`})`;
  await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values
    (${tenantA}, ${orgA}), (${tenantB}, ${orgB}), (${tenantX}, ${orgX})`;
  await member(tx, tenantA, orgA, founder.id, true);
  const investorMembership = await member(tx, tenantB, orgB, investor.id, true);
  await member(tx, tenantX, orgX, stranger.id, true);

  const companyId = randomUUID();
  const investorOrgId = randomUUID();
  await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
    values (${companyId}, ${tenantA}, ${orgA}, 'DR Co', ${`dr-co-${tag}`})`;
  await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
    values (${investorOrgId}, ${tenantB}, ${orgB}, 'VC', 'DR Capital')`;
  const relationshipId = randomUUID();
  await tx.sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
    values (${relationshipId}, ${tenantA}, ${companyId}, ${investorOrgId}, 'CONNECTED')`;
  await tx.sql`
    insert into network.relationship_events
      (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
    values (${tenantA}, ${relationshipId}, 1, 'interest_expressed', 'HUMAN', ${founder.id}, 'DISCOVER', 'relationship_shared', ${correlation()})`;

  // A relationship chat message from the founder to the investor.
  const chat = randomUUID();
  await tx.sql`insert into communication.conversations (id, tenant_id, relationship_id)
    values (${chat}, ${tenantA}, ${relationshipId})`;
  const [message] = await tx.sql<{ id: string }[]>`
    insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
    values (${tenantA}, ${chat}, ${founder.id}, 'COMPANY', 'TEXT', 'Hello from the founder', ${`dr-${tag}`})
    returning id`;

  // The investor's private note about the company: never in the founder's export.
  const investorNoteId = randomUUID();
  await tx.sql`
    insert into network.relationship_notes
      (id, tenant_id, organisation_id, relationship_id, investor_organisation_id, author_user_id, author_membership_id, body)
    values (${investorNoteId}, ${tenantB}, ${orgB}, ${relationshipId}, ${investorOrgId}, ${investor.id}, ${investorMembership},
            'INVESTOR PRIVATE: founder seems tired')`;

  // The founder's conversation with Q, with a run and two messages.
  const qConversationId = randomUUID();
  await tx.sql`insert into q_runtime.conversations (id, tenant_id, user_id, context_type, title, summary)
    values (${qConversationId}, ${tenantA}, ${founder.id}, 'PERSONAL', 'My raise', 'We talked about the raise')`;
  const [run] = await tx.sql<{ id: string }[]>`
    insert into q_runtime.runs (tenant_id, actor_user_id, objective, capability, consequence_class, correlation_id, conversation_id)
    values (${tenantA}, ${founder.id}, 'How much runway do I have?', 'ANSWER', 'LOW', ${correlation()}, ${qConversationId})
    returning id`;
  await tx.sql`insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content) values
    (${tenantA}, ${qConversationId}, ${run?.id ?? null}, 'USER', 'FOUNDER SECRET: runway is 4 months'),
    (${tenantA}, ${qConversationId}, ${run?.id ?? null}, 'Q', 'Noted.')`;

  // A stranger's conversation in another tenant.
  const strangerConversationId = randomUUID();
  await tx.sql`insert into q_runtime.conversations (id, tenant_id, user_id, context_type, title)
    values (${strangerConversationId}, ${tenantX}, ${stranger.id}, 'PERSONAL', 'STRANGER TITLE')`;

  // What Q remembers about the founder.
  await tx.sql`
    insert into q_knowledge.memory_items
      (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key, content, content_sha256, write_mode, status, visibility_scope)
    values (${tenantA}, 'user', ${founder.id}, 'preference', 'tone.formal', 'Prefers formal tone',
            ${createHash("sha256").update("Prefers formal tone").digest("hex")}, 'USER_CONFIRMED', 'active', 'personal_private')`;

  // A meeting both sides attended.
  const meetingId = randomUUID();
  await tx.sql`
    insert into communication.meetings
      (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at, time_zone, google_event_id, idempotency_key)
    values (${meetingId}, ${tenantA}, ${relationshipId}, ${founder.id}, ${tenantA}, 'Intro call',
            now(), now() + interval '30 minutes', 'Africa/Lagos', ${`evt${tag}`}, ${`meeting-${tag}`})`;
  await tx.sql`
    insert into communication.meeting_participants (meeting_id, participant_tenant_id, user_id, role, display_name, email) values
      (${meetingId}, ${tenantA}, ${founder.id}, 'ORGANISER', 'founder Person', ${founder.email}),
      (${meetingId}, ${tenantB}, ${investor.id}, 'ATTENDEE', 'investor Person', ${investor.email})`;

  // A notice and the founder's photo.
  await tx.sql`
    insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
    values (${tenantA}, ${founder.id}, 'Q_WORK', 'Your draft is ready', ${`dr-notice-${tag}`})`;
  const avatarKey = `img/${tenantA}/${randomUUID()}.webp`;
  await tx.sql`
    insert into core.profile_images
      (tenant_id, subject_type, subject_id, kind, status, upload_key, declared_content_type, declared_byte_size,
       object_key, ready_at, created_by_user_id, upload_expires_at)
    values (${tenantA}, 'PERSON', ${founder.id}, 'AVATAR', 'READY', ${`up/${randomUUID()}`}, 'image/webp', 1000,
            ${avatarKey}, now(), ${founder.id}, now() + interval '1 hour')`;

  return {
    founder,
    investor,
    stranger,
    tenantA,
    tenantB,
    orgA,
    orgB,
    relationshipId,
    chatMessageId: message?.id ?? "",
    qConversationId,
    strangerConversationId,
    investorNoteId,
    meetingId,
    avatarKey,
  };
}

function inOne(tx: TransactionContext): TransactionManager {
  return { run: (work) => work(tx) };
}

type FakeStorage = DataRightsStorage & {
  readonly objects: Map<string, Uint8Array>;
  readonly deleted: string[];
};

function fakeStorage(seed: Record<string, Uint8Array> = {}): FakeStorage {
  const objects = new Map<string, Uint8Array>(Object.entries(seed));
  const deleted: string[] = [];
  const id = (o: DataRightsObjectRef) => `${o.bucket}/${o.key}`;
  return {
    objects,
    deleted,
    putObject: ({ object, body }) => {
      objects.set(id(object), body);
      return Promise.resolve();
    },
    openObjectStream: (object) => {
      const bytes = objects.get(id(object));
      if (bytes === undefined) return Promise.reject(new Error("missing"));
      let sent = false;
      const body: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
        }),
      };
      return Promise.resolve({ body });
    },
    deleteObject: (object) => {
      deleted.push(id(object));
      objects.delete(id(object));
      return Promise.resolve();
    },
    createDownloadAuthorization: ({ object, expiresInSeconds }) =>
      Promise.resolve({
        url: `https://storage.invalid/${id(object)}?signed=1`,
        providerExpiresAt: new Date(
          Date.now() + expiresInSeconds * 1000,
        ).toISOString(),
      }),
  };
}

function fakeAuth(
  tx: TransactionContext,
): AuthAccountRemover & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    removeAuthAccount: async (authUserId) => {
      calls.push(authUserId);
      // Local stand-in for the Auth admin API: the account and its sessions go.
      await tx.sql`delete from auth.users where id = ${authUserId}`;
    },
  };
}

/** Reads one file out of a ZIP built by buildZip (local headers only). */
function unzip(zip: Uint8Array): Map<string, string> {
  const buffer = Buffer.from(zip);
  const files = new Map<string, string>();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const start = offset + 30 + nameLength;
    files.set(
      name,
      inflateRawSync(buffer.subarray(start, start + size)).toString("utf8"),
    );
    offset = start + size;
  }
  return files;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("@capital-q/data-rights against local Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function scenario(
    body: (w: World, tx: TransactionContext) => Promise<void>,
  ) {
    try {
      await db.transactions.run(async (tx) => {
        await body(await world(tx), tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  it("classifies exactly the tables that exist, and every predicate runs", async () => {
    const rows = await db.sql<{ name: string }[]>`
      select n.nspname || '.' || c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p') and not c.relispartition
         and n.nspname = any(${[...INVENTORY_SCHEMAS]}::text[])`;
    const live = new Set(rows.map((row) => row.name));
    const classified = new Set(
      PERSONAL_DATA_INVENTORY.map((entry) => entry.table),
    );
    expect([...live].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !live.has(t)).sort()).toEqual([]);
    const person = { userId: randomUUID(), email: "nobody@example.invalid" };
    for (const entry of PERSONAL_DATA_INVENTORY) {
      if (entry.person === undefined) continue;
      const where = entry.person;
      await expect(
        db.sql`select count(*) from ${db.sql(entry.table)} where ${where.build(db.sql, person)}`,
      ).resolves.toBeDefined();
    }
  });

  it("never lets deleting a person's own rows cascade into another party's records", async () => {
    const deleting = new Set(
      PERSONAL_DATA_INVENTORY.filter(
        // Specials other than the exports are never deleted (superseded, ended).
        (e) =>
          e.class === "DELETE" &&
          (e.special === undefined || e.special === "EXPORTS"),
      ).map((e) => e.table),
    );
    const edges = await db.sql<{ child: string; parent: string }[]>`
      select cn.nspname || '.' || cc.relname as child, pn.nspname || '.' || pc.relname as parent
        from pg_constraint k
        join pg_class cc on cc.oid = k.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
        join pg_class pc on pc.oid = k.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
       where k.contype = 'f' and k.confdeltype = 'c'`;
    const unsafe = edges
      .filter((e) => deleting.has(e.parent) && !deleting.has(e.child))
      .map((e) => `${e.child} -> ${e.parent}`);
    expect(unsafe).toEqual([]);
  });

  it("exports only the person's own data: no counterparty's private note, no other tenant, no secrets", async () => {
    await scenario(async (w, tx) => {
      await tx.sql`
        insert into integrations.google_accounts (tenant_id, user_id, google_subject, email, scopes, refresh_token_ciphertext)
        values (${w.tenantA}, ${w.founder.id}, 'sub123', ${w.founder.email}, '{gmail.send}', ${Buffer.alloc(40, 1)})`;
      const collected = await collectPersonData(tx.sql, {
        userId: w.founder.id,
        email: w.founder.email,
      });
      const text = JSON.stringify([...collected.tables.entries()]);
      expect(text).toContain("FOUNDER SECRET: runway is 4 months");
      expect(text).toContain("Hello from the founder");
      expect(text).toContain("Prefers formal tone");
      expect(text).not.toContain("INVESTOR PRIVATE");
      expect(text).not.toContain("STRANGER TITLE");
      expect(text).not.toContain(w.investor.email);
      expect(text).not.toContain("refresh_token");
      expect(collected.tables.get("identity.user_profiles")?.[0]?.["id"]).toBe(
        w.founder.id,
      );
      expect(collected.files.map((f) => f.object.key)).toContain(w.avatarKey);

      const stranger = await collectPersonData(tx.sql, {
        userId: w.stranger.id,
        email: w.stranger.email,
      });
      const theirs = JSON.stringify([...stranger.tables.entries()]);
      expect(theirs).toContain("STRANGER TITLE");
      expect(theirs).not.toContain("FOUNDER SECRET");
      expect(theirs).not.toContain("Hello from the founder");
    });
  });

  it("builds the export in the background, notifies, links only for its owner, rate limits and expires", async () => {
    await scenario(async (w, tx) => {
      const storage = fakeStorage({
        [`cq-profile-images/${w.avatarKey}`]: new Uint8Array([1, 2, 3]),
      });
      const service = createDataRightsService({
        transactions: inOne(tx),
        storage,
      });
      const jobs = createDataRightsJobs({
        transactions: inOne(tx),
        storage,
        auth: fakeAuth(tx),
      });
      const first = await service.requestExport({
        userId: w.founder.id,
        idempotencyKey: "export-key-1",
      });
      expect(first.kind).toBe("REQUESTED");
      const replay = await service.requestExport({
        userId: w.founder.id,
        idempotencyKey: "export-key-1",
      });
      expect(replay.kind).toBe("ALREADY_REQUESTED");
      if (first.kind !== "REQUESTED" || replay.kind !== "ALREADY_REQUESTED")
        return;
      expect(replay.export.id).toBe(first.export.id);

      expect(await jobs.buildNextExport()).toBe(true);
      const overview = await service.overview(w.founder.id);
      expect(overview.latestExport?.status).toBe("READY");
      const zipKey = [...storage.objects.keys()].find((k) =>
        k.startsWith("cq-data-exports-private/"),
      );
      expect(zipKey).toBeDefined();
      const files = unzip(
        storage.objects.get(zipKey ?? "") ?? new Uint8Array(),
      );
      expect(files.get("data/q_runtime/conversation_messages.json")).toContain(
        "FOUNDER SECRET",
      );
      expect(
        [...files.keys()].some((name) => name.startsWith("files/profile/")),
      ).toBe(true);
      expect(files.has("manifest.json")).toBe(true);

      const notices = await tx.sql`
        select 1 from communication.notifications
         where user_id = ${w.founder.id} and kind = 'DATA_EXPORT_READY'`;
      expect(notices.length).toBe(1);

      expect(
        (
          await service.createDownloadLink({
            userId: w.investor.id,
            exportId: first.export.id,
          })
        ).kind,
      ).toBe("NOT_FOUND");
      const link = await service.createDownloadLink({
        userId: w.founder.id,
        exportId: first.export.id,
      });
      expect(link.kind).toBe("LINK");

      await service.requestExport({
        userId: w.founder.id,
        idempotencyKey: "export-key-2",
      });
      await jobs.buildNextExport();
      await service.requestExport({
        userId: w.founder.id,
        idempotencyKey: "export-key-3",
      });
      await jobs.buildNextExport();
      const limited = await service.requestExport({
        userId: w.founder.id,
        idempotencyKey: "export-key-4",
      });
      expect(limited.kind).toBe("RATE_LIMITED");

      await tx.sql`update identity.data_export_requests set expires_at = clock_timestamp() - interval '1 second', completed_at = clock_timestamp() - interval '2 seconds'
                    where user_id = ${w.founder.id} and status = 'READY'`;
      expect(await jobs.expireExports()).toBe(3);
      expect(
        storage.deleted.filter((k) => k.startsWith("cq-data-exports-private/"))
          .length,
      ).toBe(3);
      expect(
        (
          await service.createDownloadLink({
            userId: w.founder.id,
            exportId: first.export.id,
          })
        ).kind,
      ).toBe("NOT_FOUND");
    });
  });

  it("schedules deletion only with a fresh re-authentication and the typed words, and the grace period can be cancelled", async () => {
    await scenario(async (w, tx) => {
      const service = createDataRightsService({ transactions: inOne(tx) });
      const base = {
        userId: w.founder.id,
        confirmation: DATA_RIGHTS_POLICY.confirmationWords,
        organisationsToClose: [w.orgA],
      };
      expect(
        (await service.requestDeletion({ ...base, stepUp: null })).kind,
      ).toBe("STEP_UP_REQUIRED");
      expect(
        (
          await service.requestDeletion({
            ...base,
            stepUp: {
              authUserId: w.founder.auth,
              method: "password",
              at: nowSeconds() - 3600,
            },
          })
        ).kind,
      ).toBe("STEP_UP_REQUIRED");
      // Someone else's fresh sign-in does not confirm it is this person.
      expect(
        (
          await service.requestDeletion({
            ...base,
            stepUp: {
              authUserId: w.investor.auth,
              method: "password",
              at: nowSeconds(),
            },
          })
        ).kind,
      ).toBe("STEP_UP_REQUIRED");
      const fresh = {
        authUserId: w.founder.auth,
        method: "password" as const,
        at: nowSeconds(),
      };
      expect(
        (
          await service.requestDeletion({
            ...base,
            stepUp: fresh,
            confirmation: "delete",
          })
        ).kind,
      ).toBe("CONFIRMATION_MISMATCH");
      expect(
        (
          await service.requestDeletion({
            ...base,
            stepUp: fresh,
            organisationsToClose: [],
          })
        ).kind,
      ).toBe("ORGANISATIONS_CHANGED");
      const scheduled = await service.requestDeletion({
        ...base,
        stepUp: fresh,
      });
      expect(scheduled.kind).toBe("SCHEDULED");
      if (scheduled.kind !== "SCHEDULED") return;
      const graceMs =
        new Date(scheduled.deletion.scheduledFor).getTime() - Date.now();
      expect(graceMs).toBeGreaterThan(
        (DATA_RIGHTS_POLICY.graceDays - 1) * 86_400_000,
      );
      expect(
        (await service.requestDeletion({ ...base, stepUp: fresh })).kind,
      ).toBe("ALREADY_SCHEDULED");

      // Not due yet: the job does nothing.
      const storage = fakeStorage();
      const auth = fakeAuth(tx);
      const early = await executeAccountDeletion({
        transactions: inOne(tx),
        storage,
        auth,
        requestId: scheduled.deletion.id,
      });
      expect(early.kind).toBe("NOT_DUE");

      expect((await service.cancelDeletion(w.founder.id)).kind).toBe(
        "CANCELLED",
      );
      expect((await service.cancelDeletion(w.founder.id)).kind).toBe(
        "NOTHING_TO_CANCEL",
      );
      await tx.sql`update identity.account_deletion_requests set scheduled_for = requested_at where id = ${scheduled.deletion.id}`;
      expect(
        (
          await executeAccountDeletion({
            transactions: inOne(tx),
            storage,
            auth,
            requestId: scheduled.deletion.id,
          })
        ).kind,
      ).toBe("NOT_DUE");
      const profile = await tx.sql<
        { status: string }[]
      >`select status from identity.user_profiles where id = ${w.founder.id}`;
      expect(profile[0]?.status).toBe("active");
      expect(auth.calls).toEqual([]);
    });
  });

  it("refuses while the person is the last owner of a team others remain in", async () => {
    await scenario(async (w, tx) => {
      const teammate = await person(tx, "teammate", randomUUID().slice(0, 8));
      await member(tx, w.tenantA, w.orgA, teammate.id, false);
      const service = createDataRightsService({ transactions: inOne(tx) });
      const preflight = await service.preflight(w.founder.id);
      expect(preflight.find((o) => o.organisationId === w.orgA)?.outcome).toBe(
        "TRANSFER_REQUIRED",
      );
      const outcome = await service.requestDeletion({
        userId: w.founder.id,
        stepUp: { authUserId: w.founder.auth, method: "otp", at: nowSeconds() },
        confirmation: DATA_RIGHTS_POLICY.confirmationWords,
        organisationsToClose: [],
      });
      expect(outcome.kind).toBe("TRANSFER_REQUIRED");
    });
  });

  it("deletes the person's content, anonymises what others keep, removes storage and the sign-in, and is idempotent", async () => {
    await scenario(async (w, tx) => {
      const storage = fakeStorage();
      const auth = fakeAuth(tx);
      const service = createDataRightsService({
        transactions: inOne(tx),
        storage,
      });
      const jobs = createDataRightsJobs({
        transactions: inOne(tx),
        storage,
        auth,
      });
      await service.requestExport({
        userId: w.founder.id,
        idempotencyKey: "before-delete",
      });
      await jobs.buildNextExport();
      const scheduled = await service.requestDeletion({
        userId: w.founder.id,
        stepUp: {
          authUserId: w.founder.auth,
          method: "password",
          at: nowSeconds(),
        },
        confirmation: DATA_RIGHTS_POLICY.confirmationWords,
        organisationsToClose: [w.orgA],
      });
      if (scheduled.kind !== "SCHEDULED") throw new Error(scheduled.kind);
      await tx.sql`update identity.account_deletion_requests set scheduled_for = requested_at where id = ${scheduled.deletion.id}`;

      const outcomes = await jobs.runDueDeletions();
      expect(outcomes.map((o) => o.kind)).toEqual(["COMPLETED"]);

      // The tombstone.
      const [profile] = await tx.sql<
        {
          status: string;
          display_name: string;
          given_name: string | null;
          auth_user_id: string | null;
          closed_at: Date | null;
        }[]
      >`select status, display_name, given_name, auth_user_id, closed_at from identity.user_profiles where id = ${w.founder.id}`;
      expect(profile).toMatchObject({
        status: "closed",
        display_name: "Former user",
        given_name: null,
        auth_user_id: null,
      });
      expect(profile?.closed_at).not.toBeNull();
      expect(auth.calls).toEqual([w.founder.auth]);
      expect(
        (await tx.sql`select 1 from auth.users where id = ${w.founder.auth}`)
          .length,
      ).toBe(0);

      // The person's own content is gone.
      expect(
        (
          await tx.sql`select 1 from q_runtime.conversation_messages where conversation_id = ${w.qConversationId}`
        ).length,
      ).toBe(0);
      expect(
        (
          await tx.sql`select 1 from communication.notifications where user_id = ${w.founder.id}`
        ).length,
      ).toBe(0);
      expect(
        (
          await tx.sql`select 1 from identity.data_export_requests where user_id = ${w.founder.id}`
        ).length,
      ).toBe(0);
      // A conversation a kept run still points at stays, emptied.
      const [conversation] = await tx.sql<
        { title: string | null; summary: string | null }[]
      >`
        select title, summary from q_runtime.conversations where id = ${w.qConversationId}`;
      if (conversation !== undefined)
        expect(conversation).toEqual({ title: null, summary: null });
      const [run] = await tx.sql<{ objective: string }[]>`
        select objective from q_runtime.runs where actor_user_id = ${w.founder.id}`;
      expect(run?.objective).toBe(ERASED);
      // Memory went through its lifecycle, words erased.
      const memory = await tx.sql<{ status: string; content: string }[]>`
        select status, content from q_knowledge.memory_items where owner_context_id = ${w.founder.id}`;
      expect(memory).toEqual([{ status: "forgotten", content: ERASED }]);

      // The counterparty still sees the shared history, anonymised.
      const [message] = await tx.sql<{ body: string; name: string }[]>`
        select m.body, p.display_name as name from communication.messages m
          join identity.user_profiles p on p.id = m.sender_user_id where m.id = ${w.chatMessageId}`;
      expect(message).toEqual({
        body: "Hello from the founder",
        name: "Former user",
      });
      expect(
        (
          await tx.sql`select 1 from network.relationship_events where relationship_id = ${w.relationshipId} and actor_id = ${w.founder.id}`
        ).length,
      ).toBe(1);
      const participants = await tx.sql<
        { user_id: string; display_name: string; email: string }[]
      >`
        select user_id, display_name, email from communication.meeting_participants where meeting_id = ${w.meetingId}`;
      const theirs = participants.find((p) => p.user_id === w.founder.id);
      expect(theirs?.display_name).toBe("Former user");
      expect(theirs?.email).toMatch(/@deleted\.invalid$/u);
      expect(participants.find((p) => p.user_id === w.investor.id)?.email).toBe(
        w.investor.email,
      );
      // The investor's own note is untouched.
      const [note] = await tx.sql<
        { body: string }[]
      >`select body from network.relationship_notes where id = ${w.investorNoteId}`;
      expect(note?.body).toBe("INVESTOR PRIVATE: founder seems tired");

      // The sole-member organisation closed; memberships ended.
      const [org] = await tx.sql<
        { status: string }[]
      >`select status from identity.organisations where id = ${w.orgA}`;
      expect(org?.status).toBe("closed");
      expect(
        (
          await tx.sql`select 1 from identity.organisation_memberships where user_id = ${w.founder.id} and membership_status = 'active'`
        ).length,
      ).toBe(0);

      // Storage: the export file and the photo.
      expect(
        storage.deleted.some((k) => k.startsWith("cq-data-exports-private/")),
      ).toBe(true);
      expect(storage.deleted).toContain(`cq-profile-images/${w.avatarKey}`);

      // The anonymised record of the deletion itself.
      const [request] = await tx.sql<
        { status: string; report: Record<string, unknown> }[]
      >`
        select status, report from identity.account_deletion_requests where id = ${scheduled.deletion.id}`;
      expect(request?.status).toBe("COMPLETED");
      expect(JSON.stringify(request?.report)).not.toContain(w.founder.email);
      expect(
        (
          await tx.sql`select 1 from audit.security_events where user_id = ${w.founder.id} and event_type = 'account_deleted'`
        ).length,
      ).toBe(1);

      // Idempotent: the job finds nothing to do, and the erasure itself repeats cleanly.
      expect((await jobs.runDueDeletions()).length).toBe(0);
      await expect(
        eraseInDatabase(tx.sql, {
          userId: w.founder.id,
          email: w.founder.email,
          organisationsToClose: [w.orgA],
        }),
      ).resolves.toBeDefined();
      expect(
        (
          await tx.sql`select 1 from audit.security_events where user_id = ${w.founder.id} and event_type = 'account_deleted'`
        ).length,
      ).toBe(1);

      // The stranger is untouched.
      const [stranger] = await tx.sql<
        { title: string }[]
      >`select title from q_runtime.conversations where id = ${w.strangerConversationId}`;
      expect(stranger?.title).toBe("STRANGER TITLE");
    });
  });

  it("a retry after the auth removal failed finishes the job", async () => {
    await scenario(async (w, tx) => {
      const storage = fakeStorage();
      const service = createDataRightsService({
        transactions: inOne(tx),
        storage,
      });
      const scheduled = await service.requestDeletion({
        userId: w.founder.id,
        stepUp: {
          authUserId: w.founder.auth,
          method: "password",
          at: nowSeconds(),
        },
        confirmation: DATA_RIGHTS_POLICY.confirmationWords,
        organisationsToClose: [w.orgA],
      });
      if (scheduled.kind !== "SCHEDULED") throw new Error(scheduled.kind);
      await tx.sql`update identity.account_deletion_requests set scheduled_for = requested_at where id = ${scheduled.deletion.id}`;
      const failing: AuthAccountRemover = {
        removeAuthAccount: () =>
          Promise.reject(new Error("AUTH_ACCOUNT_REMOVAL_FAILED")),
      };
      await expect(
        executeAccountDeletion({
          transactions: inOne(tx),
          storage,
          auth: failing,
          requestId: scheduled.deletion.id,
        }),
      ).rejects.toThrow();
      // Profile already closed, request still PROCESSING; after the lease, a retry completes.
      await tx.sql`update identity.account_deletion_requests set lease_until = clock_timestamp() - interval '1 second' where id = ${scheduled.deletion.id}`;
      const auth = fakeAuth(tx);
      const retried = await executeAccountDeletion({
        transactions: inOne(tx),
        storage,
        auth,
        requestId: scheduled.deletion.id,
      });
      expect(retried.kind).toBe("COMPLETED");
      expect(auth.calls).toEqual([w.founder.auth]);
    });
  });
});
