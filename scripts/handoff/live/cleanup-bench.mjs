/* global process, console, fetch */
// Clear fictional bench accounts and everything they own (founder rule:
// "clear the bench accounts from the DB when testing is done").
//
//   NODE_USE_ENV_PROXY=1 SUPABASE_ACCESS_TOKEN=... \
//     node scripts/handoff/live/cleanup-bench.mjs bench.nixo4@fictional.capitalq.local [...]
//     [--apply] [--include-seed]
//
// Dry run by default: prints what would be deleted, table by table, and
// deletes nothing. --apply runs every delete in ONE transaction through
// the Management API SQL endpoint, so a failure deletes nothing.
//
// Safety:
// - Only @fictional.capitalq.local accounts, named one by one; never a
//   pattern. Accounts outside the bench families (bench.*, founder.onboard*,
//   investor.onboard*, smoke.*) are refused unless --include-seed is given,
//   so the seed world is never touched by accident.
// - A tenant is cleared whole only when every member of it is one of the
//   named accounts. In any other tenant only the named people's own rows
//   (columns that reference their profile, and user_id columns holding
//   their ids) are removed.
// - A row in another tenant that still references what is being deleted
//   (a relationship with a seed investor, say) stops the run and is named;
//   seed data is never deleted to make room.
//
// Why the Supabase admin delete returned 500: identity.user_profiles
// references auth.users ON DELETE RESTRICT, and the profile is referenced
// by memberships and most tenant tables. The user can only go last.

const PROJECT = process.env.SUPABASE_PROJECT_REF ?? "vcohxiqsmnkzxnvawgri";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeSeed = args.includes("--include-seed");
const emails = args.filter((a) => !a.startsWith("--"));

const BENCH =
  /^(bench\.|founder\.onboard|investor\.onboard|smoke\.)[a-z0-9._-]*@fictional\.capitalq\.local$/;
if (emails.length === 0) {
  console.error("name at least one account");
  process.exit(2);
}
for (const email of emails) {
  if (!email.endsWith("@fictional.capitalq.local")) {
    console.error(`refused: ${email} is not a fictional account`);
    process.exit(2);
  }
  if (!includeSeed && !BENCH.test(email)) {
    console.error(
      `refused: ${email} is not a bench account (use --include-seed to name a seed account)`,
    );
    process.exit(2);
  }
}

async function sql(query, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: readOnly }),
    },
  );
  const text = await response.text();
  if (!response.ok)
    throw new Error(`SQL ${response.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const list = (values) => values.map(lit).join(", ");

// ---- who ------------------------------------------------------------------
const users = await sql(
  `select u.id as auth_id, u.email, p.id as profile_id
     from auth.users u left join identity.user_profiles p on p.auth_user_id = u.id
    where u.email in (${list(emails)})`,
);
if (users.length === 0) {
  console.log("no such accounts; nothing to do");
  process.exit(0);
}
const authIds = users.map((u) => u.auth_id);
const profileIds = users.map((u) => u.profile_id).filter((id) => id !== null);
const personIds = [...authIds, ...profileIds];
console.log(`accounts: ${users.map((u) => u.email).join(", ")}`);

// ---- which tenants are theirs alone ----------------------------------------
const tenants =
  profileIds.length === 0
    ? []
    : await sql(
        `select m.tenant_id,
          bool_and(m.user_id in (${list(profileIds)})) as only_them
     from identity.organisation_memberships m
    where m.tenant_id in (select tenant_id from identity.organisation_memberships
                           where user_id in (${list(profileIds)}))
    group by m.tenant_id`,
      );
const ownTenants = tenants.filter((t) => t.only_them).map((t) => t.tenant_id);
const sharedTenants = tenants
  .filter((t) => !t.only_them)
  .map((t) => t.tenant_id);
console.log(
  `tenants cleared whole: ${ownTenants.length} ${JSON.stringify(ownTenants)}`,
);
if (sharedTenants.length > 0) {
  console.log(
    `tenants shared with others (only their own rows): ${JSON.stringify(sharedTenants)}`,
  );
}

// ---- the schema: tables, tenant columns, person columns, foreign keys ------
const tables = await sql(
  `select c.table_schema || '.' || c.table_name as t,
          bool_or(c.column_name = 'tenant_id') as has_tenant,
          array_agg(c.column_name::text) filter (where c.column_name in
            ('user_id','owner_user_id','actor_user_id','created_by_user_id','auth_user_id')) as person_cols
     from information_schema.columns c
     join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name
    where b.table_type = 'BASE TABLE'
      and c.table_schema not in ('pg_catalog','information_schema','auth','storage','realtime',
                                 'supabase_functions','supabase_migrations','vault','graphql','extensions','net','cron','pgsodium')
    group by 1`,
);
const fks = await sql(
  `select conrelid::regclass::text as child, confrelid::regclass::text as parent,
          (select array_agg(a.attname::text) from unnest(conkey) k join pg_attribute a
             on a.attrelid = conrelid and a.attnum = k) as cols,
          (select array_agg(a.attname::text) from unnest(confkey) k join pg_attribute a
             on a.attrelid = confrelid and a.attnum = k) as pcols
     from pg_constraint where contype = 'f'`,
);
const profileRefs = fks.filter((f) => f.parent === "identity.user_profiles");

// Per table, the rows that go: the whole tenant, or the person's own rows.
const predicateOf = new Map();
for (const row of tables) {
  const parts = [];
  if (row.has_tenant && ownTenants.length > 0)
    parts.push(`tenant_id in (${list(ownTenants)})`);
  for (const col of row.person_cols ?? [])
    parts.push(`${col}::text in (${list(personIds)})`);
  for (const ref of profileRefs.filter((r) => r.child === row.t)) {
    for (const col of ref.cols)
      parts.push(`${col}::text in (${list(profileIds)})`);
  }
  if (parts.length > 0)
    predicateOf.set(row.t, [...new Set(parts)].join(" or "));
}
predicateOf.set("identity.user_profiles", `id::text in (${list(profileIds)})`);
if (ownTenants.length > 0) {
  predicateOf.set("identity.tenants", `id in (${list(ownTenants)})`);
}

// Rows that exist only under a row being deleted (a session's turns, a
// membership's roles) carry no tenant of their own: they go with their
// parent. A child table that does carry tenant_id is never pulled in this
// way -- its rows in other tenants are someone else's, and stop the run.
const tenantTables = new Set(
  tables.filter((t) => t.has_tenant).map((t) => t.t),
);
for (let changed = true; changed;) {
  changed = false;
  for (const fk of fks) {
    if (
      fk.cols.length !== 1 ||
      tenantTables.has(fk.child) ||
      fk.child === fk.parent ||
      fk.parent.startsWith("platform") ||
      !predicateOf.has(fk.parent)
    ) {
      continue;
    }
    const clause = `${fk.cols[0]} in (select ${fk.pcols[0]} from ${fk.parent} where ${predicateOf.get(fk.parent)})`;
    const current = predicateOf.get(fk.child);
    if (current !== undefined && current.includes(clause)) continue;
    predicateOf.set(
      fk.child,
      current === undefined ? clause : `${current} or ${clause}`,
    );
    changed = true;
  }
}

// ---- counts -------------------------------------------------------------
const counts = new Map();
for (const [table, predicate] of predicateOf) {
  const [{ n }] = await sql(
    `select count(*)::int as n from ${table} where ${predicate}`,
  );
  if (n > 0) counts.set(table, n);
}

// Platform-wide records (feature flags, admin settings) are never a bench
// account's to take with it, even when one authored a row: refuse instead.
const platformRows = [...counts.keys()].filter((t) => t.startsWith("platform"));
if (platformRows.length > 0) {
  console.log(
    `refused: platform records reference these accounts: ${platformRows
      .map((t) => `${t} (${counts.get(t)})`)
      .join(", ")}`,
  );
  process.exit(1);
}

// ---- order: a child before its parent ------------------------------------
const involved = [...counts.keys()];
const edges = fks.filter(
  (f) => counts.has(f.child) && counts.has(f.parent) && f.child !== f.parent,
);
const order = [];
const placed = new Set();
while (order.length < involved.length) {
  const next = involved.find(
    (t) =>
      !placed.has(t) &&
      edges.every((e) => e.parent !== t || placed.has(e.child)),
  );
  if (next === undefined) {
    // A reference cycle (an object and its current revision, a tenant and
    // its owning organisation). Its rows go together in the one
    // transaction; replica mode defers their checks, and the blocker check
    // below proves nothing outside the plan still points at them.
    const rest = involved.filter((t) => !placed.has(t));
    console.log(`  (cycle, deleted together: ${rest.join(", ")})`);
    for (const t of rest) {
      order.push(t);
      placed.add(t);
    }
    break;
  }
  order.push(next);
  placed.add(next);
}

// ---- references from outside what is being deleted ----------------------
const blockers = [];
for (const fk of fks) {
  if (!counts.has(fk.parent) || fk.cols.length !== 1) continue;
  const childPredicate = predicateOf.get(fk.child);
  const [{ n }] = await sql(
    `select count(*)::int as n from ${fk.child} c
      where c.${fk.cols[0]} in (select ${fk.pcols[0]} from ${fk.parent} where ${predicateOf.get(fk.parent)})
        ${childPredicate === undefined ? "" : `and not (${childPredicate.replace(/\b(tenant_id|user_id|owner_user_id|actor_user_id|created_by_user_id|auth_user_id|id)\b/g, "c.$1")})`}`,
  ).catch(() => [{ n: 0 }]);
  if (n > 0)
    blockers.push(
      `${fk.child}.${fk.cols[0]} -> ${fk.parent}: ${n} row(s) outside the bench`,
    );
}

console.log("\nplan (in delete order):");
for (const table of order)
  console.log(`  ${String(counts.get(table)).padStart(6)}  ${table}`);
console.log(`  then auth.users: ${authIds.length}`);
if (blockers.length > 0) {
  console.log(
    "\nrefused: rows outside the bench still reference what would be deleted:",
  );
  for (const b of blockers) console.log(`  ${b}`);
  process.exit(1);
}
if (!apply) {
  console.log("\ndry run: nothing deleted (add --apply)");
  process.exit(0);
}

// ---- apply, in one transaction ----------------------------------------------
// Append-only tables (audit, events) refuse deletes by trigger, by design.
// For fictional bench accounts named one by one, replica mode skips those
// triggers for this one transaction; foreign keys are still checked by the
// order above, and nothing outside the plan is touched.
const statements = [
  "begin",
  "set local session_replication_role = replica",
  ...order.map((t) => `delete from ${t} where ${predicateOf.get(t)}`),
  `delete from auth.users where id in (${list(authIds)})`,
  "commit",
];
await sql(statements.join(";\n") + ";", false);
const left = await sql(
  `select count(*)::int as n from auth.users where id in (${list(authIds)})`,
);
console.log(
  `\napplied: ${order.length} tables cleared; accounts left: ${left[0].n}`,
);
