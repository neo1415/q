#!/usr/bin/env node
/**
 * Revenue claims for the evidence-fixture demo companies (17 Nov 2026).
 * Plans, per company, the revenue figure its own fixture states, linked to
 * the uploaded document version that states it, and writes it as a
 * network-visible DOCUMENT_SUPPORTED claim ONLY where that document is
 * itself network-readable. Rules and the Context Firewall gate:
 * revenue-claims-plan.mjs.
 *
 *   node scripts/seed/evidence/revenue-claims.mjs                # dry run (default): read-only SQL, prints the plan
 *   node scripts/seed/evidence/revenue-claims.mjs --only ajopot  # one fixture key (repeatable)
 *   node scripts/seed/evidence/revenue-claims.mjs --apply        # writes; a separate step the lead approves
 *
 * Only companies with a fixture AND a manifest in this folder are
 * considered; any other --only key is refused. Environment:
 * SUPABASE_ACCESS_TOKEN (management API; NODE_USE_ENV_PROXY=1 in the cloud
 * sandbox). Never printed. Idempotent: a second apply plans nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planRevenueClaim,
  renderRevenuePlan,
  renderRevenueSql,
} from "./revenue-claims-plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
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

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The fixture set is the allow-list: nothing outside it is touched. */
function sources() {
  const keys = readdirSync(join(HERE, "fixtures"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .filter((k) => existsSync(join(HERE, "manifests", `${k}.json`)))
    .toSorted();
  const unknown = only.filter((k) => !keys.includes(k));
  if (unknown.length > 0)
    throw new Error(`refused: not an evidence-fixture company: ${unknown}`);
  return keys
    .filter((k) => only.length === 0 || only.includes(k))
    .map((key) => ({
      key,
      fixture: JSON.parse(
        readFileSync(join(HERE, "fixtures", `${key}.json`), "utf8"),
      ),
      manifest: JSON.parse(
        readFileSync(join(HERE, "manifests", `${key}.json`), "utf8"),
      ),
    }));
}

async function snapshotOf(source) {
  const id = source.manifest.companyId;
  if (id !== undefined && !UUID.test(id)) throw new Error(`bad id ${id}`);
  const companies = await query(
    `select id, tenant_id, organisation_id, canonical_name, company_status
       from core.companies
      where canonical_name = ${q(source.fixture.company.name)}
        ${id ? `and id = ${q(id)}` : ""}`,
    true,
  );
  if (companies.length !== 1) return null;
  const company = companies[0];
  const files = source.manifest.documents.map((d) => q(d.fileName)).join(",");
  const [documents, claims] = await Promise.all([
    query(
      `select distinct on (d.id) d.id as document_id, v.id as version_id,
              v.original_filename as file, d.title, d.visibility_scope,
              d.sensitivity_class, d.status,
              (select de.level from evidence.data_room_entries de
                where de.document_id = d.id limit 1) as level
         from evidence.documents d
         join evidence.document_versions v on v.document_id = d.id
        where d.company_id = ${q(company.id)} and d.tenant_id = ${q(company.tenant_id)}
          and v.original_filename in (${files})
        order by d.id, v.version_number desc`,
      true,
    ),
    query(
      `select id, claim_key, structured_value, valid_from, visibility_scope,
              lifecycle_status
         from evidence.claims
        where tenant_id = ${q(company.tenant_id)} and subject_type = 'COMPANY'
          and subject_id = ${q(company.id)}`,
      true,
    ),
  ]);
  return { company, documents, claims };
}

async function main() {
  const plans = [];
  for (const source of sources())
    plans.push(planRevenueClaim(source, await snapshotOf(source)));
  console.log(renderRevenuePlan(plans));
  if (!APPLY) {
    console.log("\nDry run: nothing written. --apply writes (lead-approved).");
    return;
  }
  const now = new Date().toISOString();
  for (const plan of plans) {
    const sql = renderRevenueSql(plan, { now });
    if (sql === null) continue;
    await query(sql, false);
    console.log(`applied ${plan.name}: ${plan.claim.key}`);
  }
  console.log("\nApplied. Re-run the dry run: it should plan nothing.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
