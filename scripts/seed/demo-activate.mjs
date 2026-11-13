#!/usr/bin/env node
/**
 * Demo seed activation (owner direction, 13 Nov 2026): prepare every
 * intended FICTIONAL demo company for marketplace participation through
 * the product's own path, with synthetic provenance, never touching a
 * genuine account and never resetting working data.
 *
 *   node scripts/seed/demo-activate.mjs                  # dry run (default): read-only SQL, prints the plan
 *   node scripts/seed/demo-activate.mjs --apply          # acts (see below)
 *   node scripts/seed/demo-activate.mjs --only <companyId> [--only …]
 *   node scripts/seed/demo-activate.mjs --write-manifest # rebuild docs/seed/demo-activation-manifest.json
 *
 * Selection is the checked-in manifest, never a query. Each company is
 * re-checked at run time (read-only SQL) and refused unless it is not a
 * real demonstration company and every attached person, in every
 * membership table and status, is a fictional account (see
 * demo-activate-plan.mjs). Only what is missing is planned:
 *
 *   (a) mark-synthetic: app_metadata.synthetic = true (+ fictional_demo and
 *       who marked it) through the Supabase admin API. That marker is what
 *       the attested synthetic decider requires; it then records
 *       SYNTHETIC_DEMO_ATTESTATION / CAPITAL_Q_SYNTHETIC_DEMO, shown as
 *       "Demo verified (synthetic)". Nothing here writes a claim.
 *   (b) set-stage: PATCH /v1/companies/:id as the founder, only with the
 *       seed world's own value; an undefined stage is reported, not invented.
 *   (c) request-verification: POST /v1/companies/:id/verification/requests
 *       as the founder, only when no claim exists; PENDING claims are left
 *       to the workers' sweep; decided claims are never overridden.
 *   (d) assess: POST /v1/companies/:id/marketplace-readiness/assess as the
 *       founder, once every requirement is met.
 *
 * --apply needs, from the environment only (never printed):
 *   CQ_DEMO_ACTIVATE_SERVICE_KEY   Supabase secret (service-role) key
 *   CQ_DEMO_ACTIVATE_PUBLISHABLE_KEY  Supabase publishable key (founder sign-in)
 * and SUPABASE_ACCESS_TOKEN for the read-only SQL (also in a dry run).
 * Companies are paced 1.5 s apart. Re-running after success plans nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as lib from "./tavus20/lib.mjs";
import {
  buildManifest,
  planCompany,
  renderPlan,
  STEP,
  summarise,
} from "./demo-activate-plan.mjs";

const MANIFEST_FILE = join(lib.ROOT, "docs/seed/demo-activation-manifest.json");
const MARKED_BY = "demo-activate.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const only = argv.flatMap((a, i) => (a === "--only" ? [argv[i + 1]] : []));

// ------------------------------------------------------------ read-only SQL

const SNAPSHOT_SQL = (ids) => `
select c.id,
  json_build_object(
    'id', c.id, 'canonical_name', c.canonical_name, 'tenant_id', c.tenant_id,
    'organisation_id', c.organisation_id, 'demonstration_data', c.demonstration_data,
    'company_status', c.company_status, 'marketplace_visibility', c.marketplace_visibility,
    'marketplace_readiness_state', c.marketplace_readiness_state,
    'current_stage_code', c.current_stage_code, 'headquarters_country', c.headquarters_country,
    'short_description', c.short_description, 'primary_description', c.primary_description
  ) as company,
  (select coalesce(json_agg(x), '[]'::json) from (
     select p.id as "profileId", u.id as "authUserId", u.email,
            coalesce(u.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false) as "appSynthetic",
            coalesce(u.raw_user_meta_data ->> 'fictional_demo', '') = 'true' as "userFictionalDemo",
            bool_or(a.cur) as current, bool_or(a.counted) as counted, bool_or(a.founder) as "isFounder"
       from (
         select m.user_id, (m.membership_status = 'active' and m.left_at is null) as cur,
                (m.left_at is null) as counted, false as founder
           from identity.organisation_memberships m where m.tenant_id = c.tenant_id
         union all
         select cm.user_id, cm.is_current, false, (cm.is_founder and cm.is_current)
           from core.company_members cm where cm.company_id = c.id
       ) a
       join identity.user_profiles p on p.id = a.user_id
       left join auth.users u on u.id = p.auth_user_id
      group by p.id, u.id, u.email, u.raw_app_meta_data, u.raw_user_meta_data) x) as people,
  (select coalesce(json_agg(y), '[]'::json) from (
     select distinct on (v.claim_type, v.subject_key)
            v.claim_type, v.subject_id, v.status, v.expires_at, v.revoked_at,
            rp.auth_user_id as requester_auth_user_id
       from evidence.verification_claims v
       left join identity.user_profiles rp on rp.id = v.requested_by_user_id
      where v.tenant_id = c.tenant_id
        and v.claim_type in ('FOUNDER_IDENTITY', 'ORGANISATION')
      order by v.claim_type, v.subject_key, v.revision desc) y) as claims
from core.companies c
where c.id = any(array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[])`;

/** id → {company, people, claims}; read-only, in batches. */
async function snapshots(ids) {
  for (const id of ids) if (!UUID.test(id)) throw new Error(`bad id ${id}`);
  const out = new Map();
  for (let i = 0; i < ids.length; i += 60) {
    const rows = await lib.sql(SNAPSHOT_SQL(ids.slice(i, i + 60)));
    for (const r of rows)
      out.set(r.id, { company: r.company, people: r.people, claims: r.claims });
  }
  return out;
}

// ------------------------------------------------------------ manifest

function readJson(rel) {
  return JSON.parse(readFileSync(join(lib.ROOT, rel), "utf8"));
}

async function writeManifest() {
  const { buildWorld } = await import("./fictional-bulk/world.mjs");
  const world = buildWorld({ count: 400 });
  const bulkState = readJson("docs/seed/fictional-bulk/seed-state.json");
  const fictionalBulk = world.companies
    .filter((c) => bulkState.companies[c.key]?.companyId)
    .map((c) => ({
      key: c.key,
      name: bulkState.companies[c.key].name ?? c.name,
      companyId: bulkState.companies[c.key].companyId,
      stage: c.stageOption === "unsure" ? null : c.stageOption,
    }));
  const tavusState = readJson("docs/seed/tavus-20/seed-state.json");
  const tavusFull = readJson("docs/seed/tavus-20/companies-full.json");
  const tavus20 = Object.entries(tavusState.companies).map(([n, s]) => ({
    n,
    name: s.company,
    companyId: s.companyId,
    stage:
      tavusFull.find((c) => Number(c.n) === Number(n))?.currentStageCode ??
      null,
  }));
  // The dev world is TypeScript; its keys and stages are read as text.
  const devSrc = readFileSync(
    join(lib.ROOT, "apps/q-api/src/dev/fictional-world/companies.ts"),
    "utf8",
  );
  const devWorld = [
    ...devSrc.matchAll(
      /key: "([a-z-]+)",\s*\n\s*name: "([^"]+)",[\s\S]*?stageOption: "([a-z_]+)"/g,
    ),
  ].map(([, key, name, stage]) => ({
    key,
    name,
    stage: stage === "unsure" ? null : stage,
  }));
  const emails = devWorld.map(
    (c) => `founder.${c.key}@fictional.capitalq.local`,
  );
  const devRows = await lib.sql(`
    select distinct on (u.email) c.id, u.email
      from core.companies c
      join identity.organisation_memberships m on m.organisation_id = c.organisation_id
      join identity.user_profiles p on p.id = m.user_id
      join auth.users u on u.id = p.auth_user_id
     where lower(u.email) = any(array[${emails.map((e) => `'${e}'`).join(",")}])
       and c.demonstration_data = false
     order by u.email, c.created_at`);
  const devWorldIds = Object.fromEntries(
    devRows.map((r) => [r.email.split("@")[0].slice("founder.".length), r.id]),
  );
  const pitchSrc = readFileSync(
    join(lib.ROOT, "packages/q-pitch/src/demo-companies.ts"),
    "utf8",
  );
  const demoCompanies = [
    ...pitchSrc.matchAll(
      /"?([a-z-]+)"?: \{\s*companyId: "([0-9a-f-]{36})",\s*name: "([^"]+)"/g,
    ),
  ].map(([, key, companyId, name]) => ({ key, companyId, name }));
  const { stageCode } = await import("./real-companies/plan.mjs");
  const realCompanies = readJson("docs/seed/real-companies/companies.json");
  const realSeed = [
    ["8b1c25b2-7e8b-5e78-9f51-c307e6b869e8", "MoneyHash"],
    ["20752c5e-419c-543f-a5c1-fc0ddc5180f0", "ekko"],
  ].map(([companyId, name]) => ({
    companyId,
    name,
    stage: realCompanies.find((c) => c.name === name)?.stage,
  }));
  const manifest = buildManifest({
    fictionalBulk,
    tavus20,
    devWorld,
    devWorldIds,
    demoCompanies,
    curated: [
      {
        companyId: "31633da0-87f9-4c5f-bd9a-a892a9251207",
        name: "LedgerBridge",
        why: "ACCEPTANCE-MATRIX-2026-11-13 A3: curated, network-visible, not assessed",
      },
      // Owner decision 13 Nov: MoneyHash and ekko stay network-visible and
      // are ordinary in-scope demo companies when their members pass the
      // fictional-account check. Their stage comes only from the seed's own
      // vocabulary mapping (an unmapped stage stays unknown).
      ...realSeed.map((c) => ({
        companyId: c.companyId,
        name: c.name,
        why: "real-companies seed demo company (owner decision 13 Nov)",
        stage: stageCode(c.stage ?? null),
        stageSource: `docs/seed/real-companies/companies.json ${c.name} stage ${JSON.stringify(c.stage ?? null)}`,
      })),
    ],
    holds: [],
  });
  writeFileSync(
    MANIFEST_FILE,
    JSON.stringify(
      {
        description:
          "Intended fictional demo companies for scripts/seed/demo-activate.mjs. Built by --write-manifest from repo sources (fictional-bulk seed-state + world, tavus-20 seed-state, dev fictional world, packages/q-pitch demo companies, the 13 Nov acceptance matrix) plus a read-only lookup of the dev world's founder companies. Membership here is intent only: every company is re-checked at run time and refused unless every attached person is fictional. Excluded on purpose: real demonstration companies (demonstration_data = true; owner 13 Nov: they stay as they are), the rest of the real-companies seed (MoneyHash and ekko are in by owner decision 13 Nov), and the live e2e release-test companies (e.g. Ledgerline UIFK (fictional), kept for the human four-eyes verification test).",
        version: 1,
        companies: manifest,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${manifest.length} companies to ${MANIFEST_FILE}`);
}

// ------------------------------------------------------------ apply path

/** A stable idempotency key per company and step, so a retry is the same request. */
const idem = (...parts) => {
  const h = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function applyKeys() {
  const secret = process.env.CQ_DEMO_ACTIVATE_SERVICE_KEY ?? "";
  const publishable = process.env.CQ_DEMO_ACTIVATE_PUBLISHABLE_KEY ?? "";
  if (secret.length < 20 || publishable.length < 20)
    throw new Error(
      "--apply needs CQ_DEMO_ACTIVATE_SERVICE_KEY and CQ_DEMO_ACTIVATE_PUBLISHABLE_KEY in the environment",
    );
  return { secret, publishable };
}

function admin(keys, path, init = {}) {
  return fetch(`${lib.SB_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: keys.secret,
      authorization: `Bearer ${keys.secret}`,
      "content-type": "application/json",
    },
  });
}

/** Merge the synthetic marker into the account's existing app_metadata. */
async function markSynthetic(keys, authUserId) {
  const got = await admin(keys, `/users/${authUserId}`);
  if (!got.ok) throw new Error(`admin read user: HTTP ${got.status}`);
  const user = await got.json();
  if (user.app_metadata?.synthetic === true) return "already";
  const put = await admin(keys, `/users/${authUserId}`, {
    method: "PUT",
    body: JSON.stringify({
      app_metadata: {
        ...(user.app_metadata ?? {}),
        synthetic: true,
        fictional_demo: true,
        synthetic_marked_by: MARKED_BY,
      },
    }),
  });
  if (!put.ok) throw new Error(`admin update user: HTTP ${put.status}`);
  const body = await put.json();
  if (body.app_metadata?.synthetic !== true)
    throw new Error("admin update user: marker did not take");
  return "marked";
}

const sessions = new Map();
/** The founder's own session: admin magic-link token exchanged; no password, no email sent. */
async function founderToken(keys, email) {
  const hit = sessions.get(email);
  if (hit) return hit;
  const link = await admin(keys, "/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!link.ok) throw new Error(`generate_link: HTTP ${link.status}`);
  const lb = await link.json();
  const r = await fetch(`${lib.SB_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: keys.publishable, "content-type": "application/json" },
    body: JSON.stringify({
      type: "email",
      token_hash: lb.hashed_token ?? lb.properties?.hashed_token,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`verify: HTTP ${r.status}`);
  sessions.set(email, j.access_token);
  return j.access_token;
}

async function asFounder(keys, email, method, path, body, key) {
  const r = await lib.call(
    lib.API,
    await founderToken(keys, email),
    method,
    path,
    body,
    key,
  );
  if (r.status < 200 || r.status >= 300)
    throw new Error(
      `${method} ${path}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  return r.body;
}

async function applyPlan(keys, plan) {
  const base = `/v1/companies/${plan.companyId}`;
  for (const step of plan.steps) {
    if (step.kind === STEP.MARK_SYNTHETIC) {
      const out = await markSynthetic(keys, step.authUserId);
      console.log(`  done     ${step.kind} ${step.email}: ${out}`);
    } else if (step.kind === STEP.SET_STAGE) {
      const cur = await asFounder(keys, plan.founderEmail, "GET", base);
      if (cur.currentStageCode) {
        console.log(`  skip     ${step.kind}: now ${cur.currentStageCode}`);
        continue;
      }
      await asFounder(
        keys,
        plan.founderEmail,
        "PATCH",
        base,
        { expectedVersion: cur.version, currentStageCode: step.value },
        idem(plan.companyId, step.kind, step.value),
      );
      console.log(`  done     ${step.kind} ${step.value}`);
    } else if (step.kind === STEP.REQUEST_VERIFICATION) {
      const standing = await asFounder(
        keys,
        plan.founderEmail,
        "GET",
        `${base}/verification`,
      );
      if (!standing.requestable) {
        console.log(`  skip     ${step.kind}: not requestable now`);
        continue;
      }
      await asFounder(
        keys,
        plan.founderEmail,
        "POST",
        `${base}/verification/requests`,
        undefined,
        idem(plan.companyId, step.kind),
      );
      console.log(
        `  done     ${step.kind}: requested; the workers' sweep decides`,
      );
    } else if (step.kind === STEP.ASSESS) {
      const r = await asFounder(
        keys,
        plan.founderEmail,
        "POST",
        `${base}/marketplace-readiness/assess`,
        {},
      );
      console.log(`  done     ${step.kind}: ${r?.state ?? "?"}`);
    }
  }
}

// ------------------------------------------------------------ main

async function main() {
  if (argv.includes("--write-manifest")) return writeManifest();
  const manifest = readJson("docs/seed/demo-activation-manifest.json");
  let entries = manifest.companies;
  if (only.length > 0)
    entries = entries.filter((e) => only.includes(e.companyId));
  const keys = APPLY ? applyKeys() : null;
  console.log(
    `demo-activate: ${APPLY ? "APPLY" : "dry run (pass --apply to act)"}; ${entries.length} manifest companies; api ${lib.API}`,
  );
  const snaps = await snapshots(entries.map((e) => e.companyId));
  const plans = entries.map((e) =>
    planCompany(e, snaps.get(e.companyId) ?? null),
  );
  console.log(renderPlan(plans));
  console.log(JSON.stringify(summarise(plans), null, 2));
  if (!APPLY) return;

  let failed = 0;
  for (const plan of plans) {
    if (plan.refused || plan.steps.length === 0) continue;
    // Re-check immediately before acting: the plan may be minutes old.
    const fresh = planCompany(
      entries.find((e) => e.companyId === plan.companyId),
      (await snapshots([plan.companyId])).get(plan.companyId) ?? null,
    );
    console.log(`${fresh.name} (${fresh.companyId})`);
    if (fresh.refused) {
      console.log(`  REFUSED  ${fresh.refused.join("; ")}`);
      continue;
    }
    try {
      await applyPlan(keys, fresh);
    } catch (error) {
      failed += 1;
      console.log(
        `  FAILED   ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await lib.sleep(1500);
  }
  console.log(
    `apply finished; ${failed} failed. Re-run (dry) after the workers' sweep: pending claims are decided asynchronously, then assess is planned.`,
  );
  if (failed > 0) process.exitCode = 1;
}

await main();
