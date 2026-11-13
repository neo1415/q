#!/usr/bin/env node
/**
 * Fictional demo figures (A8 demo prep; owner direction 13 Nov 2026).
 * Publishes, as network-visible USER_CLAIM / SELF_REPORTED claims, the
 * figures each FICTIONAL demo company's own seed source already states, so
 * investor chart journeys ("show me Ledgerline's revenue growth") have
 * structured, dated figures to draw. Rules: demo-figures-plan.mjs.
 *
 *   node scripts/seed/demo-figures.mjs                 # dry run (default): read-only SQL, prints the plan
 *   node scripts/seed/demo-figures.mjs --only <companyId> [--only …]
 *   node scripts/seed/demo-figures.mjs --apply         # writes; a separate step the owner approves
 *
 * Sources (checked in, never a query): the tavus-20 seed's dated metric
 * points (docs/seed/tavus-20/companies-full.json, ids from seed-state.json)
 * and the dev fictional world's claims (apps/q-api/src/dev/fictional-world/
 * companies.ts, ids from docs/seed/demo-activation-manifest.json). Each
 * company is re-checked at run time and refused unless it passes the
 * demo-activate fictional-account check.
 *
 * Environment: SUPABASE_ACCESS_TOKEN (management API; NODE_USE_ENV_PROXY=1
 * in the cloud sandbox). Never printed. Idempotent: deterministic ids, and
 * a second run plans nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  devWorldFigures,
  planCompanyFigures,
  renderFiguresPlan,
  renderFiguresSql,
  tavusFigures,
} from "./demo-figures-plan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const only = argv.flatMap((a, i) => (a === "--only" ? [argv[i + 1]] : []));

async function query(text, readOnly) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: text, read_only: readOnly }),
    },
  );
  const body = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error(
      `sql: HTTP ${r.status} ${JSON.stringify(body).slice(0, 300)}`,
    );
  return body;
}
const read = (text) => query(text, true);

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

/** The intended companies and what their own sources state. */
async function sources() {
  const manifest = readJson("docs/seed/demo-activation-manifest.json");
  const inManifest = new Map(manifest.companies.map((c) => [c.companyId, c]));
  const out = [];
  const tavusState = readJson("docs/seed/tavus-20/seed-state.json");
  for (const company of readJson("docs/seed/tavus-20/companies-full.json")) {
    const state =
      tavusState.companies[String(company.n).padStart(2, "0")] ??
      tavusState.companies[String(company.n)];
    const entry = inManifest.get(state?.companyId);
    if (entry === undefined) continue;
    out.push({
      entry: {
        ...entry,
        name: company.company,
        source: `tavus-20 #${company.n}`,
      },
      sourced: tavusFigures(company),
    });
  }
  const { FICTIONAL_COMPANIES } = await import(
    pathToFileURL(join(ROOT, "apps/q-api/src/dev/fictional-world/companies.ts"))
      .href
  );
  for (const company of FICTIONAL_COMPANIES) {
    const entry = manifest.companies.find((c) =>
      c.why.includes(`dev fictional world ${company.key}`),
    );
    if (entry === undefined) continue;
    out.push({
      entry: {
        ...entry,
        name: company.name,
        source: `dev world ${company.key}`,
      },
      sourced: devWorldFigures(company),
    });
  }
  return only.length === 0
    ? out
    : out.filter((s) => only.includes(s.entry.companyId));
}

const SNAPSHOT_SQL = (ids) => `
select c.id,
  json_build_object(
    'id', c.id, 'canonical_name', c.canonical_name, 'tenant_id', c.tenant_id,
    'organisation_id', c.organisation_id, 'demonstration_data', c.demonstration_data,
    'company_status', c.company_status
  ) as company,
  (select coalesce(json_agg(x), '[]'::json) from (
     select p.id as "profileId", u.email,
            coalesce(u.raw_user_meta_data ->> 'fictional_demo', '') = 'true' as "userFictionalDemo",
            bool_or(a.cur) as current
       from (
         select m.user_id, (m.membership_status = 'active' and m.left_at is null) as cur
           from identity.organisation_memberships m where m.tenant_id = c.tenant_id
         union all
         select cm.user_id, cm.is_current from core.company_members cm where cm.company_id = c.id
       ) a
       join identity.user_profiles p on p.id = a.user_id
       left join auth.users u on u.id = p.auth_user_id
      group by p.id, u.email, u.raw_user_meta_data) x) as people,
  (select coalesce(json_agg(y), '[]'::json) from (
     select cl.id, cl.claim_key, cl.structured_value, cl.valid_from,
            cl.visibility_scope, cl.lifecycle_status
       from evidence.claims cl
      where cl.tenant_id = c.tenant_id and cl.subject_type = 'COMPANY' and cl.subject_id = c.id) y) as claims
from core.companies c
where c.id = any(array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[])`;

async function snapshots(ids) {
  for (const id of ids) if (!UUID.test(id)) throw new Error(`bad id ${id}`);
  const out = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const rows = await read(SNAPSHOT_SQL(ids.slice(i, i + 40)));
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

async function main() {
  const wanted = await sources();
  const snaps = await snapshots(wanted.map((w) => w.entry.companyId));
  const plans = wanted.map((w) =>
    planCompanyFigures(
      w.entry,
      snaps.get(w.entry.companyId) ?? null,
      w.sourced,
    ),
  );
  console.log(renderFiguresPlan(plans));
  if (!APPLY) {
    console.log(
      "\nDry run: nothing written. --apply writes (owner-approved step).",
    );
    return;
  }
  const now = new Date().toISOString();
  for (const plan of plans) {
    const sql = renderFiguresSql(plan, { now });
    if (sql === null) continue;
    await query(sql, false);
    console.log(`applied ${plan.name}: ${plan.claims.length} claims`);
  }
  console.log("\nApplied. Re-run the dry run: it should plan nothing.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
