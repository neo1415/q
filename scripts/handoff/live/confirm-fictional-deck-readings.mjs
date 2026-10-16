#!/usr/bin/env node
/**
 * Demo-only exception (owner, via the lead, 2026-10-16): confirm Q's pending
 * deck-section readings on behalf of FICTIONAL demo founders, so their
 * companies can carry an Investability score. Never a real company.
 *
 *   /root/sb node scripts/handoff/live/confirm-fictional-deck-readings.mjs           # dry run (default)
 *   /root/sb node scripts/handoff/live/confirm-fictional-deck-readings.mjs --apply   # confirms
 *     [--max-companies N] [--receipt <file outside the repo>]
 *
 * Scope, checked over the WHOLE membership (every status, both
 * identity.organisation_memberships and core.company_members): a company
 * is in scope only if every person attached to it is a fictional account
 * (email *@fictional.capitalq.local, or app_metadata.cq_seed set). One
 * real or unmarked person anywhere excludes the company.
 *
 * Path: the same POST the founder's "Looks right" button uses
 * (DECK_SECTION_REVIEW_PATH, action CONFIRM), signed in AS the fictional
 * founder, so the Write Gate, the per-section review row, the audit record
 * and any events are the product's own. Only sections Q read as PRESENT
 * and still PENDING (never reviewed, never dismissed, reading not already
 * confirmed) are confirmed.
 *
 * seed_reason: the API sets its own audit metadata and correlation id, so
 * the reason cannot travel in the audit row. Every confirmation is written
 * to the receipt (JSON lines: seed_reason, company, extraction, section,
 * time), and the audit rows are matched to it afterwards by resource and
 * time. Ids only; never a company name or deck text.
 *
 * Throttled for the small database: batches of 10 confirmations with 2 s
 * between batches; on any 5xx, wait 5 minutes and retry (3 times), then
 * stop. Recompute: the investability worker's 30-minute changed-input
 * sweep picks these companies up (deck reviews have no outbox event); a
 * full sweep is `node apps/workers/dist/backfill-investability.js --apply`
 * from the worker's environment.
 */
import { appendFileSync } from "node:fs";

import * as lib from "../../seed/tavus20/lib.mjs";
import { API, signIn } from "./fictional-session.mjs";

const SEED_REASON = "demo-confirmation-2026-10-16";
const FICTIONAL_DOMAIN = "@fictional.capitalq.local";
const BATCH = 10;
const PAUSE_MS = 2000;
const BACKOFF_MS = 5 * 60 * 1000;

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const maxCompanies = Number(flag("--max-companies") ?? "10000");
const receipt = flag("--receipt") ?? null;
if (apply && receipt === null) {
  throw new Error("--apply needs --receipt <file outside the repository>");
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every company with a pending, PRESENT section in its current deck reading. */
const CANDIDATES = `
with people as (
  select p.id as user_id,
         (lower(u.email) like '%${FICTIONAL_DOMAIN}' or (u.raw_app_meta_data ? 'cq_seed')) as fictional,
         lower(u.email) as email
    from identity.user_profiles p
    join auth.users u on u.id = p.auth_user_id
),
attached as (
  select c.id as company_id, m.user_id
    from core.companies c join identity.organisation_memberships m on m.organisation_id = c.organisation_id
  union
  select cm.company_id, cm.user_id from core.company_members cm
),
scope as (
  select a.company_id,
         count(*) as people,
         bool_and(coalesce(pe.fictional, false)) as all_fictional
    from attached a left join people pe on pe.user_id = a.user_id
   group by a.company_id
),
deck as (
  select distinct on (d.company_id) d.company_id, d.id as document_id, x.id as extraction_id, x.sections,
         exists (select 1 from evidence.deck_extraction_confirmations c where c.extraction_id = x.id) as confirmed
    from evidence.documents d
    join evidence.deck_extractions x on x.document_version_id = d.current_version_id
   where d.document_type = 'PITCH_DECK' and d.status = 'ACTIVE' and d.owner_kind = 'ORGANISATION'
   order by d.company_id, x.created_at desc
),
pending as (
  select dk.company_id, dk.document_id, dk.extraction_id, s->>'section' as section
    from deck dk, jsonb_array_elements(dk.sections) s
   where not dk.confirmed
     and s->>'status' = 'PRESENT'
     and not exists (select 1 from evidence.deck_section_reviews r
                      where r.extraction_id = dk.extraction_id and r.section = s->>'section')
)
select p.company_id, p.document_id, p.extraction_id, c.organisation_id,
       coalesce(sc.all_fictional, false) and coalesce(sc.people, 0) > 0 as in_scope,
       array_agg(p.section order by p.section) as sections,
       (select pe.email
          from core.company_members cm join people pe on pe.user_id = cm.user_id
          join identity.organisation_memberships om
            on om.user_id = cm.user_id and om.organisation_id = c.organisation_id and om.membership_status = 'active'
         where cm.company_id = p.company_id and cm.is_founder and cm.is_current and pe.fictional
           and pe.email like '%${FICTIONAL_DOMAIN}'
         order by pe.email limit 1) as founder_email
  from pending p
  join core.companies c on c.id = p.company_id
  left join scope sc on sc.company_id = p.company_id
 group by p.company_id, p.document_id, p.extraction_id, c.organisation_id, sc.all_fictional, sc.people
 order by p.company_id`;

const rows = await lib.sql(CANDIDATES);
const inScope = rows.filter((r) => r.in_scope && r.founder_email !== null);
const excluded = rows.filter((r) => !r.in_scope);
const noFounder = rows.filter((r) => r.in_scope && r.founder_email === null);
const targets = inScope.slice(0, maxCompanies);
const sections = targets.reduce((n, r) => n + r.sections.length, 0);

// The guard, asserted again on what will be touched.
for (const t of targets) {
  if (!t.in_scope || !String(t.founder_email).endsWith(FICTIONAL_DOMAIN)) {
    throw new Error(`refused: ${t.company_id} is not wholly fictional`);
  }
}

console.log(
  JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    seedReason: SEED_REASON,
    companiesWithPendingSections: rows.length,
    inScopeCompanies: targets.length,
    pendingSectionsToConfirm: sections,
    excludedNonFictionalCompanies: excluded.length,
    excludedNonFictionalSections: excluded.reduce(
      (n, r) => n + r.sections.length,
      0,
    ),
    nonFictionalCompaniesTouched: 0,
    inScopeWithoutActiveFictionalFounder: noFounder.length,
  }),
);
if (!apply) process.exit(0);

const write = (line) => appendFileSync(receipt, `${JSON.stringify(line)}\n`);
let confirmed = 0;
let refused = 0;
let inBatch = 0;
for (const t of targets) {
  const session = await signIn(t.founder_email, API);
  for (const section of t.sections) {
    let attempt = 0;
    for (;;) {
      const response = await fetch(
        `${API}/v1/documents/${encodeURIComponent(t.document_id)}/deck-extractions/${encodeURIComponent(t.extraction_id)}/sections/${encodeURIComponent(section)}/review`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            "x-organisation-id": t.organisation_id,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            companyId: t.company_id,
            action: "CONFIRM",
            correction: null,
          }),
        },
      );
      if (response.status >= 500 && attempt < 3) {
        attempt += 1;
        console.log(JSON.stringify({ backoff: response.status, attempt }));
        await sleep(BACKOFF_MS);
        continue;
      }
      if (response.status >= 500) {
        console.log(
          JSON.stringify({ stopped: response.status, confirmed, refused }),
        );
        process.exit(1);
      }
      const ok = response.ok;
      if (ok) confirmed += 1;
      else refused += 1;
      write({
        seed_reason: SEED_REASON,
        companyId: t.company_id,
        extractionId: t.extraction_id,
        section,
        outcome: ok ? "CONFIRMED" : `HTTP_${response.status}`,
        at: new Date().toISOString(),
      });
      break;
    }
    inBatch += 1;
    if (inBatch >= BATCH) {
      inBatch = 0;
      await sleep(PAUSE_MS);
    }
  }
}
console.log(JSON.stringify({ confirmed, refused, receipt }));
