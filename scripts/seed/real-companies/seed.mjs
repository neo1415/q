#!/usr/bin/env node
/* global console, fetch, process */
// P13: seed the 10 real companies as unclaimed public profiles.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/seed/real-companies/seed.mjs           dry run
//   SUPABASE_ACCESS_TOKEN=... node scripts/seed/real-companies/seed.mjs --apply   write
//
// Admin-only: runs under the founder's Supabase management token, one
// transaction per company, attributed in audit to capital_q_system under the
// platform owner's authority. The token stays in process memory; nothing here
// prints or writes it. Idempotent: ids are deterministic and a company that
// already exists is skipped. A company whose name or website is already on
// the platform is never duplicated (one canonical company).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { planCompany, renderCompanySql, SEED_KEY } from "./plan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = join(ROOT, "docs/seed/real-companies/companies.json");
const STATE = join(ROOT, "docs/seed/real-companies/seed-state.json");
const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const apply = process.argv.includes("--apply");

async function query(sql, readOnly) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`sql: HTTP ${r.status} ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
const read = (sql) => query(sql, true);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const companies = JSON.parse(readFileSync(DATA, "utf8"));
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { seedKey: SEED_KEY, companies: {} };

const owner = (await read("select user_id from identity.platform_admins where role = 'platform_owner' order by granted_at limit 1"))[0]?.user_id;
if (!owner) throw new Error("no platform owner");
const nodes = await read(
  "select v.code || ':' || n.canonical_code as k, n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where n.status = 'ACTIVE'",
);
const nodeIds = Object.fromEntries(nodes.map((r) => [r.k, r.id]));
const now = new Date().toISOString();

for (const c of companies) {
  const p = planCompany(c, { nodeIds, authorityUserId: owner, now });
  const host = c.website ? new URL(c.website).hostname.replace(/^www\./, "") : null;
  const [existing] = await read(
    `select c.id, c.id = ${q(p.company.id)} as ours from core.companies c
      where c.id = ${q(p.company.id)} or lower(c.canonical_name) = lower(${q(c.name)})
         ${host ? `or c.website_url ilike ${q(`%://${host}%`)} or c.website_url ilike ${q(`%://www.${host}%`)}` : ""}
      order by (c.id = ${q(p.company.id)}) desc limit 1`,
  );
  const summary = {
    tenantId: p.ids.tenant,
    organisationId: p.ids.organisation,
    companyId: p.company.id,
    sources: p.sources.length,
    claims: p.claims.map((cl) => `${cl.key}:${cl.truthClass}/${cl.evidenceStatus}`),
    taxonomy: p.taxonomy.length,
  };
  if (existing?.ours) {
    console.log(`= ${c.name} already seeded (${p.company.id})`);
    state.companies[c.name] = { ...summary, ...(state.companies[c.name] ?? {}), companyId: p.company.id };
    continue;
  }
  if (existing) {
    console.log(`! ${c.name} skipped: a company with this name or website already exists (${existing.id})`);
    state.companies[c.name] = { skipped: "EXISTING_CANONICAL_COMPANY", existingCompanyId: existing.id };
    continue;
  }
  if (!apply) {
    console.log(`~ ${c.name}: would create ${p.sources.length} sources, ${p.claims.length} claims, ${p.taxonomy.length} taxonomy`);
    continue;
  }
  await query(renderCompanySql(p), false);
  console.log(`+ ${c.name} seeded (${p.company.id})`);
  state.companies[c.name] = { ...summary, seededAt: now };
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
}

if (apply) {
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  console.log(`state: ${STATE}`);
}
