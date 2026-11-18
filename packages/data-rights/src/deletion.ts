import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";

import {
  columnIdentifier,
  FORMER_USER,
  PERSONAL_DATA_INVENTORY,
  tableIdentifier,
  type ErasurePerson,
  type InventoryEntry,
  type SqlFragment,
} from "./inventory.js";
import {
  DATA_EXPORT_BUCKET,
  type AuthAccountRemover,
  type DataRightsObjectRef,
  type DataRightsStorage,
} from "./ports.js";
import { organisationsForDeletion } from "./organisations.js";

/**
 * The account deletion job (decision 107), run by the workers once a
 * request's grace period has passed. It executes the inventory:
 *
 *   1. Storage first, outside any transaction: the person's export files,
 *      their pictures, and the documents of organisations closing with the
 *      account. Deleting an object that is already gone succeeds.
 *   2. One database transaction, in erasure mode (SET LOCAL, so it ends
 *      with the transaction): Q memory and knowledge about the person go
 *      through their lifecycle (forgotten; superseded by an erased
 *      revision), memberships end, sole-member organisations close, other
 *      parties' rows lose the person's name and address, the person's own
 *      rows are deleted (children first), and the profile becomes the
 *      neutral tombstone every kept row already points to. A security
 *      event records the deletion with counts only.
 *   3. The auth account is removed, which ends every session.
 *
 * Every step is safe to repeat: a retry after a crash at any point redoes
 * the same work and lands in the same state. A row another record depends
 * on cannot be removed; it is scrubbed instead and counted as kept.
 */

export const ERASED = "[Removed at the person's request]";

/** How long one worker may hold a deletion before another may take it. */
const LEASE_MINUTES = 15;

export type DeletionReport = {
  readonly deleted: Readonly<Record<string, number>>;
  readonly anonymised: Readonly<Record<string, number>>;
  readonly keptReferenced: Readonly<Record<string, number>>;
  readonly storageObjects: number;
  readonly organisationsClosed: number;
  readonly membershipsEnded: number;
};

export type DeletionOutcome =
  | { readonly kind: "NOT_DUE" }
  | { readonly kind: "BLOCKED"; readonly reason: string }
  | { readonly kind: "COMPLETED"; readonly report: DeletionReport };

type Claimed = {
  readonly id: string;
  readonly user_id: string;
  readonly organisations_to_close: string[];
};

async function claim(
  transactions: TransactionManager,
  requestId: string,
): Promise<Claimed | null> {
  return transactions.run(async (tx) => {
    const rows = await tx.sql<Claimed[]>`
      update identity.account_deletion_requests
         set status = 'PROCESSING',
             started_at = coalesce(started_at, clock_timestamp()),
             attempts = least(attempts + 1, 100),
             lease_until = clock_timestamp() + make_interval(mins => ${LEASE_MINUTES}),
             failure_code = null
       where id = ${requestId}
         and scheduled_for <= clock_timestamp()
         and (status in ('SCHEDULED', 'BLOCKED')
              or (status = 'PROCESSING'
                  and (lease_until is null or lease_until < clock_timestamp())))
      returning id, user_id, organisations_to_close`;
    return rows[0] ?? null;
  });
}

async function block(
  transactions: TransactionManager,
  requestId: string,
  code: string,
): Promise<void> {
  await transactions.run(async (tx) => {
    await tx.sql`
      update identity.account_deletion_requests
         set status = 'BLOCKED', failure_code = ${code}, lease_until = null
       where id = ${requestId} and status = 'PROCESSING'`;
  });
}

/** Storage objects that go with the account. Read-only. */
export async function storageObjectsForDeletion(
  sql: DatabaseExecutor,
  userId: string,
  organisationsToClose: readonly string[],
): Promise<DataRightsObjectRef[]> {
  const objects: DataRightsObjectRef[] = [];
  const exports = await sql<{ bucket: string | null; key: string | null }[]>`
    select storage_bucket as bucket, storage_key as key
      from identity.data_export_requests
     where user_id = ${userId} and storage_key is not null`;
  for (const row of exports) {
    if (row.key !== null) {
      objects.push({ bucket: row.bucket ?? DATA_EXPORT_BUCKET, key: row.key });
    }
  }
  const pictures = await sql<
    { upload_key: string; object_key: string | null }[]
  >`
    select upload_key, object_key from core.profile_images
     where subject_type = 'PERSON' and subject_id = ${userId}`;
  for (const row of pictures) {
    objects.push({ bucket: "cq-profile-images", key: row.upload_key });
    if (row.object_key !== null) {
      objects.push({ bucket: "cq-profile-images", key: row.object_key });
    }
  }
  if (organisationsToClose.length > 0) {
    const documents = await sql<{ bucket: string; key: string }[]>`
      select v.storage_bucket as bucket, v.storage_key as key
        from evidence.document_versions v
        join evidence.documents d on d.id = v.document_id
       where d.owner_organisation_id = any(${organisationsToClose as string[]}::uuid[])
         and v.uploaded_by_user_id = ${userId}`;
    objects.push(...documents);
  }
  return objects;
}

/**
 * Children before parents among the tables the job deletes from, read
 * from the live catalogue so a new foreign key orders itself.
 */
async function deleteOrder(
  sql: DatabaseExecutor,
  tables: readonly string[],
): Promise<string[]> {
  const edges = await sql<{ child: string; parent: string }[]>`
    select cn.nspname || '.' || cc.relname as child,
           pn.nspname || '.' || pc.relname as parent
      from pg_constraint k
      join pg_class cc on cc.oid = k.conrelid
      join pg_namespace cn on cn.oid = cc.relnamespace
      join pg_class pc on pc.oid = k.confrelid
      join pg_namespace pn on pn.oid = pc.relnamespace
     where k.contype = 'f' and k.conrelid <> k.confrelid`;
  const set = new Set(tables);
  const childrenOf = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!set.has(edge.child) || !set.has(edge.parent)) continue;
    const children = childrenOf.get(edge.parent) ?? new Set<string>();
    children.add(edge.child);
    childrenOf.set(edge.parent, children);
  }
  const ordered: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (table: string) => {
    if (state.get(table) !== undefined) return;
    state.set(table, "visiting");
    for (const child of childrenOf.get(table) ?? []) visit(child);
    state.set(table, "done");
    ordered.push(table);
  };
  for (const table of tables) visit(table);
  return ordered;
}

async function present(sql: DatabaseExecutor, table: string): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    select to_regclass(${table}) is not null as present`;
  return rows[0]?.present === true;
}

function scrubStatement(
  sql: DatabaseExecutor,
  entry: InventoryEntry,
  person: ErasurePerson,
): SqlFragment | null {
  if (entry.scrub === undefined || entry.person === undefined) return null;
  const sets = Object.entries(entry.scrub).map(
    ([column, piece]) =>
      sql`${columnIdentifier(sql, column)} = ${piece.build(sql, person)}`,
  );
  const [first, ...rest] = sets;
  if (first === undefined) return null;
  const assignments = rest.reduce((all, one) => sql`${all}, ${one}`, first);
  return sql`update ${tableIdentifier(sql, entry.table)} set ${assignments}
              where ${entry.person.build(sql, person)}`;
}

/** Q memory: forgotten through its lifecycle, words erased. */
async function eraseMemory(
  sql: DatabaseExecutor,
  userId: string,
): Promise<number> {
  const rows = await sql`
    update q_knowledge.memory_items
       set status = case when status in ('candidate', 'confirmed', 'active') then 'forgotten' else status end,
           valid_to = coalesce(valid_to, now()),
           content = ${ERASED},
           quote = case when memory_type = 'small_talk' then ${ERASED} else null end,
           structured_value = '{}'::jsonb,
           content_sha256 = encode(sha256(convert_to(${ERASED} || id::text, 'UTF8')), 'hex'),
           updated_at = now()
     where ((owner_context_type = 'user' and owner_context_id = ${userId})
            or (subject_type = 'PERSON' and subject_id = ${userId}))
       and content <> ${ERASED}`;
  return rows.count;
}

/**
 * Claims about the person: a new SUPERSEDED revision carrying the erased
 * marker becomes current (claims are never deleted), and the statement of
 * every earlier revision is replaced by the marker under erasure mode.
 */
async function erasePersonClaims(
  sql: DatabaseExecutor,
  userId: string,
): Promise<number> {
  const claims = await sql<{ id: string; tenant_id: string; n: number }[]>`
    select id, tenant_id, current_revision_number as n
      from evidence.claims
     where subject_type = 'PERSON' and subject_id = ${userId}
       and statement <> ${ERASED}
     for update`;
  for (const claim of claims) {
    const [revision] = await sql<{ id: string }[]>`
      insert into evidence.claim_revisions
        (tenant_id, claim_id, revision_number, statement, structured_value,
         truth_class, evidence_status, lifecycle_status, change_reason,
         changed_by_type, changed_by_id)
      select tenant_id, id, current_revision_number + 1, ${ERASED}, '{}'::jsonb,
             'UNKNOWN', 'NO_EVIDENCE', 'SUPERSEDED',
             'Erased at the person''s request (data rights)', 'capital_q_system', ${userId}
        from evidence.claims where id = ${claim.id}
      returning id`;
    if (revision === undefined) continue;
    await sql`
      update evidence.claims
         set statement = ${ERASED}, structured_value = '{}'::jsonb,
             truth_class = 'UNKNOWN', evidence_status = 'NO_EVIDENCE',
             lifecycle_status = 'SUPERSEDED',
             current_revision_id = ${revision.id},
             current_revision_number = current_revision_number + 1
       where id = ${claim.id}`;
    await sql`
      update evidence.claim_revisions set statement = ${ERASED}
       where claim_id = ${claim.id} and statement <> ${ERASED}`;
  }
  return claims.length;
}

/** Knowledge about the person: the same, through knowledge revisions. */
async function erasePersonKnowledge(
  sql: DatabaseExecutor,
  userId: string,
): Promise<number> {
  const objects = await sql<{ id: string }[]>`
    select id from q_knowledge.objects
     where subject_type = 'PERSON' and subject_id = ${userId}
       and statement <> ${ERASED}
     for update`;
  for (const object of objects) {
    const [revision] = await sql<{ id: string }[]>`
      insert into q_knowledge.revisions
        (tenant_id, knowledge_object_id, revision_number, statement, structured_value,
         truth_class, evidence_status, confidence_class, change_reason,
         created_by_type, created_by_id)
      select tenant_id, id, current_revision_number + 1, ${ERASED}, '{}'::jsonb,
             'UNKNOWN', 'NO_EVIDENCE', confidence_class,
             'Erased at the person''s request (data rights)', 'capital_q_system', ${userId}
        from q_knowledge.objects where id = ${object.id}
      returning id`;
    if (revision === undefined) continue;
    await sql`
      update q_knowledge.objects
         set statement = ${ERASED}, structured_value = '{}'::jsonb,
             truth_class = 'UNKNOWN', evidence_status = 'NO_EVIDENCE',
             status = 'SUPERSEDED',
             current_revision_id = ${revision.id},
             current_revision_number = current_revision_number + 1
       where id = ${object.id}`;
    await sql`
      update q_knowledge.revisions set statement = ${ERASED}
       where knowledge_object_id = ${object.id} and statement <> ${ERASED}`;
  }
  return objects.length;
}

/** Ends roles and memberships; closes the organisations they agreed to close. */
async function endMemberships(
  sql: DatabaseExecutor,
  userId: string,
  organisationsToClose: readonly string[],
): Promise<{ readonly closed: number; readonly ended: number }> {
  // Close first: the keep-an-owner rule does not hold a closed organisation.
  const closed =
    organisationsToClose.length === 0
      ? { count: 0 }
      : await sql`
          update identity.organisations
             set status = 'closed', version = version + 1
           where id = any(${organisationsToClose as string[]}::uuid[])
             and status <> 'closed'`;
  await sql`
    update identity.membership_roles mr
       set valid_until = greatest(mr.valid_from + interval '1 microsecond', now())
      from identity.organisation_memberships m
     where m.id = mr.membership_id and m.user_id = ${userId}
       and (mr.valid_until is null or mr.valid_until > now())`;
  const ended = await sql`
    update identity.organisation_memberships
       set membership_status = 'left', left_at = greatest(joined_at, now())
     where user_id = ${userId} and membership_status = 'active'`;
  return { closed: closed.count, ended: ended.count };
}

async function profileImages(
  sql: DatabaseExecutor,
  userId: string,
): Promise<number> {
  const rows = await sql`
    update core.profile_images
       set status = case when status in ('PENDING', 'FAILED') and object_key is null then 'FAILED' else 'REMOVED' end,
           ended_at = coalesce(ended_at, now())
     where subject_type = 'PERSON' and subject_id = ${userId}
       and status in ('PENDING', 'READY')`;
  return rows.count;
}

/** The tombstone: the profile keeps its id and nothing that identifies. */
async function closeProfile(
  sql: DatabaseExecutor,
  userId: string,
): Promise<void> {
  await sql`
    update identity.user_profiles
       set display_name = ${FORMER_USER}, given_name = null, family_name = null,
           headline = null, avatar_storage_key = null, primary_locale = null,
           timezone = null, country_code = null, status = 'closed',
           closed_at = coalesce(closed_at, now())
     where id = ${userId}`;
}

type SavepointCapable = DatabaseExecutor & {
  readonly savepoint: <T>(
    work: (sql: DatabaseExecutor) => Promise<T>,
  ) => Promise<T>;
};

/** One statement in its own savepoint: its failure undoes only itself. */
async function attempt(
  sql: DatabaseExecutor,
  statement: (inner: DatabaseExecutor) => SqlFragment | null,
): Promise<number | null> {
  try {
    return await (sql as SavepointCapable).savepoint(async (inner) => {
      const built = statement(inner);
      if (built === null) return 0;
      const result = await built;
      return result.count;
    });
  } catch {
    return null;
  }
}

/** Rows one by one, when the table's set could not go at once. */
const ROW_BY_ROW_LIMIT = 5_000;

async function deleteRowByRow(
  sql: DatabaseExecutor,
  entry: InventoryEntry & {
    readonly person: NonNullable<InventoryEntry["person"]>;
  },
  person: ErasurePerson,
): Promise<number> {
  const hasId = await sql<{ present: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
       where table_schema || '.' || table_name = ${entry.table}
         and column_name = 'id') as present`;
  if (hasId[0]?.present !== true) return 0;
  const rows = await sql<{ id: string }[]>`
    select id::text as id from ${tableIdentifier(sql, entry.table)}
     where ${entry.person.build(sql, person)}
     limit ${ROW_BY_ROW_LIMIT}`;
  let removed = 0;
  for (const row of rows) {
    const n = await attempt(
      sql,
      (inner) =>
        inner`delete from ${tableIdentifier(inner, entry.table)} where id::text = ${row.id}`,
    );
    removed += n ?? 0;
  }
  return removed;
}

/** The database part. Safe to repeat. */
export async function eraseInDatabase(
  sql: DatabaseExecutor,
  input: {
    readonly userId: string;
    readonly email: string;
    readonly organisationsToClose: readonly string[];
  },
): Promise<Omit<DeletionReport, "storageObjects">> {
  const { userId } = input;
  const person: ErasurePerson = { userId, email: input.email };
  await sql`select set_config('cq.data_rights_erasure', 'on', true)`;
  const deleted: Record<string, number> = {};
  const anonymised: Record<string, number> = {};
  const kept: Record<string, number> = {};
  const note = (into: Record<string, number>, table: string, n: number) => {
    if (n > 0) into[table] = (into[table] ?? 0) + n;
  };

  note(anonymised, "q_knowledge.memory_items", await eraseMemory(sql, userId));
  note(anonymised, "evidence.claims", await erasePersonClaims(sql, userId));
  note(
    anonymised,
    "q_knowledge.objects",
    await erasePersonKnowledge(sql, userId),
  );
  note(anonymised, "core.profile_images", await profileImages(sql, userId));
  const memberships = await endMemberships(
    sql,
    userId,
    input.organisationsToClose,
  );

  // Other parties' rows: the person's name and address come out.
  for (const entry of PERSONAL_DATA_INVENTORY) {
    if (entry.class === "DELETE" || entry.class === "NOT_PERSONAL") continue;
    if (entry.special !== undefined || entry.scrub === undefined) continue;
    if (!(await present(sql, entry.table))) continue;
    const n = await attempt(sql, (inner) =>
      scrubStatement(inner, entry, person),
    );
    if (n === null) note(kept, entry.table, 1);
    else note(anonymised, entry.table, n);
  }

  // The person's own rows, children first.
  const deletable = PERSONAL_DATA_INVENTORY.filter(
    (entry) =>
      entry.class === "DELETE" &&
      entry.person !== undefined &&
      (entry.special === undefined || entry.special === "EXPORTS"),
  );
  const byTable = new Map(deletable.map((entry) => [entry.table, entry]));
  for (const table of await deleteOrder(sql, [...byTable.keys()])) {
    const entry = byTable.get(table);
    if (entry === undefined || entry.person === undefined) continue;
    if (!(await present(sql, table))) continue;
    const where = entry.person;
    const removed = await attempt(
      sql,
      (inner) =>
        inner`delete from ${tableIdentifier(inner, table)} where ${where.build(inner, person)}`,
    );
    if (removed !== null) {
      note(deleted, table, removed);
      continue;
    }
    // Some rows are still referenced by another record: remove the rest one
    // by one, then keep the referenced ones with their content emptied.
    note(
      deleted,
      table,
      await deleteRowByRow(sql, { ...entry, person: where }, person),
    );
    await attempt(sql, (inner) => scrubStatement(inner, entry, person));
    const remaining = await sql<{ n: number }[]>`
      select count(*)::int as n from ${tableIdentifier(sql, table)}
       where ${where.build(sql, person)}`;
    note(kept, table, remaining[0]?.n ?? 0);
  }

  await closeProfile(sql, userId);
  return {
    deleted,
    anonymised,
    keptReferenced: kept,
    organisationsClosed: memberships.closed,
    membershipsEnded: memberships.ended,
  };
}

/**
 * Runs one due deletion end to end. `NOT_DUE` when the request is not
 * claimable (cancelled, not yet due, or another worker holds it).
 */
export async function executeAccountDeletion(options: {
  readonly transactions: TransactionManager;
  readonly storage: DataRightsStorage;
  readonly auth: AuthAccountRemover;
  readonly requestId: string;
}): Promise<DeletionOutcome> {
  const claimed = await claim(options.transactions, options.requestId);
  if (claimed === null) return { kind: "NOT_DUE" };
  const userId = claimed.user_id;

  const context = await options.transactions.run(async (tx) => {
    const [profile] = await tx.sql<
      { auth_user_id: string | null; email: string | null }[]
    >`
      select p.auth_user_id, lower(u.email) as email
        from identity.user_profiles p
        left join auth.users u on u.id = p.auth_user_id
       where p.id = ${userId}`;
    const organisations = await organisationsForDeletion(tx.sql, userId);
    const objects = await storageObjectsForDeletion(
      tx.sql,
      userId,
      claimed.organisations_to_close,
    );
    return { profile, organisations, objects };
  });
  if (context.profile === undefined) {
    await block(options.transactions, claimed.id, "PROFILE_MISSING");
    return { kind: "BLOCKED", reason: "PROFILE_MISSING" };
  }
  // The world may have moved during the grace period: a new teammate, a
  // co-owner who left. The person's confirmation binds to what they saw.
  const agreed = new Set(claimed.organisations_to_close);
  for (const organisation of context.organisations) {
    if (organisation.outcome === "TRANSFER_REQUIRED") {
      await block(options.transactions, claimed.id, "LAST_OWNER");
      return { kind: "BLOCKED", reason: "LAST_OWNER" };
    }
    if (
      organisation.outcome === "CLOSES_WITH_ACCOUNT" &&
      !agreed.has(organisation.organisationId)
    ) {
      await block(
        options.transactions,
        claimed.id,
        "ORGANISATION_NOT_CONFIRMED",
      );
      return { kind: "BLOCKED", reason: "ORGANISATION_NOT_CONFIRMED" };
    }
  }
  const stillAlone = new Set(
    context.organisations
      .filter((organisation) => organisation.outcome === "CLOSES_WITH_ACCOUNT")
      .map((organisation) => organisation.organisationId),
  );
  // An organisation someone else joined since is not closed; it continues.
  const toClose = claimed.organisations_to_close.filter((id) =>
    stillAlone.has(id),
  );

  for (const object of context.objects)
    await options.storage.deleteObject(object);

  const email = context.profile.email ?? "";
  const partial = await options.transactions.run(async (tx) => {
    const report = await eraseInDatabase(tx.sql, {
      userId,
      email,
      organisationsToClose: toClose,
    });
    const full: DeletionReport = {
      ...report,
      storageObjects: context.objects.length,
    };
    await tx.sql`
      update identity.account_deletion_requests
         set report = ${jsonbParam(tx.sql, full)}
       where id = ${claimed.id}`;
    return full;
  });

  // Ends every session with the account. Retried on the next pass if the
  // Auth server is unavailable; the database work above is already done.
  if (context.profile.auth_user_id !== null) {
    await options.auth.removeAuthAccount(context.profile.auth_user_id);
  }

  await options.transactions.run(async (tx) => {
    await tx.sql`
      update identity.user_profiles set auth_user_id = null
       where id = ${userId} and status = 'closed'`;
    const updated = await tx.sql`
      update identity.account_deletion_requests
         set status = 'COMPLETED', completed_at = clock_timestamp(), lease_until = null
       where id = ${claimed.id} and status = 'PROCESSING'`;
    if (updated.count > 0) {
      await tx.sql`
        insert into audit.security_events (event_id, occurred_at, user_id, event_type, severity, resource_type, resource_id, metadata)
        values (gen_random_uuid(), clock_timestamp(), ${userId}, 'account_deleted', 'INFO', 'account_deletion_request', ${claimed.id},
                ${jsonbParam(tx.sql, {
                  deletedTables: Object.keys(partial.deleted).length,
                  anonymisedTables: Object.keys(partial.anonymised).length,
                  keptReferencedTables: Object.keys(partial.keptReferenced)
                    .length,
                  storageObjects: partial.storageObjects,
                  organisationsClosed: partial.organisationsClosed,
                })})`;
    }
  });
  return { kind: "COMPLETED", report: partial };
}
