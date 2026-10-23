// node --test scripts/seed/demo-companies/seed.local.test.mjs
//
// Against a real, migrated Postgres (CQ_SEED_TEST_DATABASE_URL, e.g.
// postgresql://postgres@127.0.0.1:54329/cq). Each run clones that database
// as a template, so it starts clean and leaves nothing behind. Skipped when
// the variable is unset.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { DEMO_STATEMENT_SUFFIX } from "./plan.mjs";
import { applyAll, FIXTURE_PATH, localDatabase, planAll } from "./seed.mjs";
const MANIFEST = JSON.parse(
  readFileSync(
    new URL(
      "../../../supabase/seed-assets/capital-q-documents/manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const TEMPLATE_URL = process.env.CQ_SEED_TEST_DATABASE_URL;
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const CAPITAL_Q_ORG = "f95c3469-ef29-4574-a508-c1ba1131d842";
const TEST_DB = `cq_seed_test_${process.pid}`;

let admin;
let db;
/** Stand-in for the private bucket: what the seed uploaded, by key. */
const stored = new Map();
const storage = {
  putObject: async ({ bucket, key, body, contentType }) => {
    stored.set(key, { bucket, bytes: body.byteLength, contentType });
  },
};
const PERSONS = {
  david: "david@example.invalid",
  zino: "zino@example.invalid",
  daniel: "daniel@example.invalid",
};
const PHOTOS = {
  david: "supabase/seed-assets/capital-q-team/david-founder.jpg",
};

const ids = {
  ownerAuth: "00000000-0000-4000-8000-00000000a001",
  davidAuth: "00000000-0000-4000-8000-00000000a002",
  cqTenant: "00000000-0000-4000-8000-00000000b001",
  cqCompany: "00000000-0000-4000-8000-00000000c001",
  kTenant: "00000000-0000-4000-8000-00000000b002",
  kOrg: "00000000-0000-4000-8000-00000000d002",
  kCompany: "00000000-0000-4000-8000-00000000c002",
  sTenant: "00000000-0000-4000-8000-00000000b003",
  sOrg: "00000000-0000-4000-8000-00000000d003",
  sCompany: "00000000-0000-4000-8000-00000000c003",
  davidMembership: "00000000-0000-4000-8000-00000000e001",
};

/** A platform with a WRONG Capital Q, and KUUZA AI and SongScribe AI as their founders entered them. */
const SETUP = `
insert into auth.users (id, email) values
  ('${ids.ownerAuth}', 'owner@example.invalid'),
  ('${ids.davidAuth}', 'david@example.invalid'),
  ('00000000-0000-4000-8000-00000000a003', 'zino@example.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'daniel@example.invalid');
insert into identity.platform_admins (user_id, role)
  select id, 'platform_owner' from identity.user_profiles where auth_user_id = '${ids.ownerAuth}';

insert into identity.tenants (id, name) values ('${ids.cqTenant}', 'Capital Q'), ('${ids.kTenant}', 'KUUZA AI'), ('${ids.sTenant}', 'SongScribe AI');
insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
  values ('${CAPITAL_Q_ORG}', '${ids.cqTenant}', 'company', 'Capital Q', 'capital-q-org'),
         ('${ids.kOrg}', '${ids.kTenant}', 'company', 'KUUZA AI', 'kuuza-ai-org'),
         ('${ids.sOrg}', '${ids.sTenant}', 'company', 'SongScribe AI', 'songscribe-ai-org');
insert into identity.tenant_organisations (tenant_id, organisation_id)
  values ('${ids.cqTenant}', '${CAPITAL_Q_ORG}'), ('${ids.kTenant}', '${ids.kOrg}'), ('${ids.sTenant}', '${ids.sOrg}');

-- Capital Q exists with WRONG data: wrong stage, wrong country, private.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, headquarters_country, current_stage_code, short_description, marketplace_visibility)
  values ('${ids.cqCompany}', '${ids.cqTenant}', '${CAPITAL_Q_ORG}', 'Capital Q', 'capital-q', 'US', 'series_b', 'A CRM for deal flow.', 'organisation_private');

-- KUUZA AI as its founder entered it, with a figure of their own.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, short_description, marketplace_visibility)
  values ('${ids.kCompany}', '${ids.kTenant}', '${ids.kOrg}', 'KUUZA AI', 'kuuza-ai', 'AI simulator and coach for practising sales, customer-service and other workplace conversations.', 'organisation_private');

-- SongScribe AI as its founder onboarded it (live since 2026-10-19).
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url, short_description, marketplace_visibility)
  values ('${ids.sCompany}', '${ids.sTenant}', '${ids.sOrg}', 'SongScribe AI', 'songscribe-ai', 'https://www.songscribe.ai', 'AI music studio that turns your story into a finished custom song in about a minute.', 'organisation_private');

-- David: an account and a current membership at Capital Q.
insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id, membership_status, joined_at)
  select '${ids.davidMembership}', '${ids.cqTenant}', '${CAPITAL_Q_ORG}', id, 'active', now()
    from identity.user_profiles where auth_user_id = '${ids.davidAuth}';
insert into identity.user_active_contexts (user_id, membership_id)
  select id, '${ids.davidMembership}' from identity.user_profiles where auth_user_id = '${ids.davidAuth}';
update identity.user_profiles set display_name = 'David Nwankwo' where auth_user_id = '${ids.davidAuth}';
update identity.user_profiles set display_name = 'Captain Zino Mario' where auth_user_id = '00000000-0000-4000-8000-00000000a003';
-- Daniel has no name yet: the seed sets it from the fixture.
`;

/** The founder's own KUUZA AI figure, written the way the product writes one. */
const KUUZA_OWN_CLAIM = `
insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, title, visibility_scope, sensitivity_class)
  values ('00000000-0000-4000-8000-00000000f001', '${ids.kTenant}', 'USER_STATEMENT', 'COMPANY', '${ids.kCompany}', 'Founder', 'network_visible', 'PUBLIC');
insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class, evidence_status, lifecycle_status, changed_by_type, changed_by_id, source_id)
  values ('00000000-0000-4000-8000-00000000f003', '${ids.kTenant}', '00000000-0000-4000-8000-00000000f002', 1, 'Our own MRR.', '{"kind":"MONEY","amount":"9100","currency":"USD"}', 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'SOURCE', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000f001');
insert into evidence.claims (id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, structured_value, asserted_by_type, asserted_by_id, asserted_at, truth_class, evidence_status, lifecycle_status, visibility_scope, sensitivity_class, current_revision_id, current_revision_number)
  values ('00000000-0000-4000-8000-00000000f002', '${ids.kTenant}', 'COMPANY', '${ids.kCompany}', 'financial', 'financial.monthly_revenue', 'Our own MRR.', '{"kind":"MONEY","amount":"9100","currency":"USD"}', 'SOURCE', '00000000-0000-4000-8000-00000000f001', now(), 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'organisation_private', 'INTERNAL', '00000000-0000-4000-8000-00000000f003', 1);
`;

/** Capital Q's WRONG figure and WRONG raise, as they might be on the platform. */
const CAPITAL_Q_WRONG = `
insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, title, visibility_scope, sensitivity_class)
  values ('00000000-0000-4000-8000-00000000f101', '${ids.cqTenant}', 'USER_STATEMENT', 'COMPANY', '${ids.cqCompany}', 'Old', 'network_visible', 'PUBLIC');
insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class, evidence_status, lifecycle_status, changed_by_type, changed_by_id, source_id)
  values ('00000000-0000-4000-8000-00000000f103', '${ids.cqTenant}', '00000000-0000-4000-8000-00000000f102', 1, 'MRR is USD 999,999.', '{"kind":"MONEY","amount":"999999","currency":"USD"}', 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'SOURCE', '00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-00000000f101');
insert into evidence.claims (id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, structured_value, asserted_by_type, asserted_by_id, asserted_at, truth_class, evidence_status, lifecycle_status, visibility_scope, sensitivity_class, current_revision_id, current_revision_number)
  values ('00000000-0000-4000-8000-00000000f102', '${ids.cqTenant}', 'COMPANY', '${ids.cqCompany}', 'financial', 'financial.monthly_revenue', 'MRR is USD 999,999.', '{"kind":"MONEY","amount":"999999","currency":"USD"}', 'SOURCE', '00000000-0000-4000-8000-00000000f101', now(), 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'network_visible', 'PUBLIC', '00000000-0000-4000-8000-00000000f103', 1);
insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, target_stage, created_by_user_id)
  select '00000000-0000-4000-8000-00000000f104', '${ids.cqTenant}', '${ids.cqCompany}', 20000000, 'USD', 'series_b', id
    from identity.user_profiles where auth_user_id = '${ids.ownerAuth}';
`;

before(async () => {
  if (!TEMPLATE_URL) return;
  admin = localDatabase(TEMPLATE_URL.replace(/\/[^/]*$/, "/postgres"));
  const template = new URL(TEMPLATE_URL).pathname.slice(1);
  await admin.run(`create database ${TEST_DB} template ${template}`);
  db = localDatabase(TEMPLATE_URL.replace(/\/[^/]*$/, `/${TEST_DB}`));
  await db.run(SETUP);
  await db.run(KUUZA_OWN_CLAIM);
  await db.run(CAPITAL_Q_WRONG);
  const planned = await planAll(db, fixture, {
    persons: PERSONS,
    photos: PHOTOS,
    documents: true,
    fixtureReading: true,
    now: "2026-10-22T10:00:00.000Z",
  });
  await applyAll(db, planned, { storage });
  // Later, once a reading exists: the founder's confirmation.
  const confirm = await planAll(db, fixture, {
    persons: PERSONS,
    confirmDeck: true,
    now: "2026-10-22T10:30:00.000Z",
  });
  await applyAll(db, confirm, { storage });
});

after(async () => {
  if (!TEMPLATE_URL) return;
  await db.close();
  await admin.run(`drop database if exists ${TEST_DB} with (force)`);
  await admin.close();
});

const skip = TEMPLATE_URL ? false : "CQ_SEED_TEST_DATABASE_URL is not set";

test(
  "Capital Q is corrected in place: one canonical company, never a second",
  { skip },
  async () => {
    const rows = await db.read(
      "select * from core.companies where lower(canonical_name) in ('capital q','capitalq','capital-q')",
    );
    assert.equal(rows.length, 1);
    const c = rows[0];
    assert.equal(c.id, ids.cqCompany);
    assert.equal(c.organisation_id, CAPITAL_Q_ORG);
    assert.equal(c.current_stage_code, "pre_seed");
    assert.equal(c.headquarters_country, "NG");
    assert.equal(c.headquarters_city, "Lagos");
    assert.equal(c.marketplace_visibility, "network_visible");
    assert.equal(c.demonstration_data, true);
    assert.match(c.primary_description, /demonstration data/);
  },
);

test(
  "every seeded figure is self-reported demonstration data, never verified",
  { skip },
  async () => {
    const claims = await db.read(
      `select claim_key, statement, truth_class, evidence_status, visibility_scope from evidence.claims where subject_id = '${ids.cqCompany}' and lifecycle_status = 'CURRENT'`,
    );
    assert.ok(claims.length >= 9);
    for (const c of claims) {
      assert.equal(c.evidence_status, "SELF_REPORTED");
      assert.ok(["USER_CLAIM", "ESTIMATE"].includes(c.truth_class));
      assert.ok(c.statement.endsWith(DEMO_STATEMENT_SUFFIX));
      assert.equal(c.visibility_scope, "network_visible");
    }
    const verified = await db.read(
      "select count(*)::int as n from evidence.claims where evidence_status in ('EXTERNALLY_VERIFIED','PLATFORM_VERIFIED') or truth_class = 'VERIFIED'",
    );
    assert.equal(verified[0].n, 0);
    const attestations = await db.read(
      "select count(*)::int as n from evidence.verification_claims",
    );
    assert.equal(attestations[0].n, 0, "the seed never writes a verification");
  },
);

test(
  "Capital Q's wrong figure and raise are superseded, never deleted",
  { skip },
  async () => {
    const [old] = await db.read(
      "select lifecycle_status, current_revision_number from evidence.claims where id = '00000000-0000-4000-8000-00000000f102'",
    );
    assert.equal(old.lifecycle_status, "SUPERSEDED");
    assert.equal(old.current_revision_number, 2);
    const revisions = await db.read(
      "select revision_number, lifecycle_status from evidence.claim_revisions where claim_id = '00000000-0000-4000-8000-00000000f102' order by 1",
    );
    assert.deepEqual(
      revisions.map((r) => r.lifecycle_status),
      ["CURRENT", "SUPERSEDED"],
    );
    const current = await db.read(
      `select structured_value from evidence.claims where subject_id = '${ids.cqCompany}' and claim_key = 'financial.monthly_revenue' and lifecycle_status = 'CURRENT'`,
    );
    assert.equal(current.length, 1);
    assert.equal(current[0].structured_value.amount, "4800");
    const raises = await db.read(
      `select status, target_amount::text as amount from core.capital_objectives where company_id = '${ids.cqCompany}' order by created_at, status`,
    );
    assert.deepEqual(raises.map((r) => `${r.status}:${r.amount}`).sort(), [
      "ACTIVE:1500000",
      "REPLACED:20000000",
    ]);
  },
);

test(
  "KUUZA AI keeps everything its founder entered; only gaps are filled",
  { skip },
  async () => {
    const [k] = await db.read(
      `select * from core.companies where id = '${ids.kCompany}'`,
    );
    assert.equal(
      k.short_description,
      "AI simulator and coach for practising sales, customer-service and other workplace conversations.",
    );
    // Owner 2026-10-23: discoverable, though everything else stays theirs.
    assert.equal(k.marketplace_visibility, "network_visible");
    // Every core.company.updated the seed writes names a field (the v1
    // schema rejects an empty list, and the event would never publish).
    const updates = await db.read(
      `select payload->'data'->'changedFields' as fields from events.outbox where event_type = 'core.company.updated'`,
    );
    assert.ok(updates.length > 0);
    for (const u of updates) assert.ok(u.fields.length > 0);
    assert.equal(k.current_stage_code, null);
    assert.equal(k.headquarters_country, null);
    const mrr = await db.read(
      `select structured_value, lifecycle_status from evidence.claims where subject_id = '${ids.kCompany}' and claim_key = 'financial.monthly_revenue'`,
    );
    assert.equal(
      mrr.length,
      1,
      "the founder's own figure is not superseded or duplicated",
    );
    assert.equal(mrr[0].structured_value.amount, "9100");
    assert.equal(mrr[0].lifecycle_status, "CURRENT");
    const added = await db.read(
      `select claim_key from evidence.claims where subject_id = '${ids.kCompany}' and claim_key <> 'financial.monthly_revenue' order by 1`,
    );
    assert.deepEqual(
      added.map((r) => r.claim_key),
      ["customers.employers", "financial.gross_margin", "traction.growth"],
    );
    assert.equal(k.demonstration_data, true);
  },
);

test(
  "SongScribe AI keeps everything its founder entered; only fitting gaps are filled",
  { skip },
  async () => {
    const rows = await db.read(
      "select * from core.companies where lower(canonical_name) like 'song%scribe%'",
    );
    assert.equal(rows.length, 1, "never a second Songscribe");
    const [s] = rows;
    assert.equal(s.id, ids.sCompany);
    assert.equal(s.canonical_name, "SongScribe AI");
    assert.equal(s.website_url, "https://www.songscribe.ai");
    assert.match(s.short_description, /^AI music studio/);
    assert.equal(s.marketplace_visibility, "network_visible");
    assert.equal(s.demonstration_data, true);
    const claims = await db.read(
      `select claim_key, truth_class, evidence_status from evidence.claims where subject_id = '${ids.sCompany}' and lifecycle_status = 'CURRENT' order by claim_key`,
    );
    assert.deepEqual(
      claims.map((c) => c.claim_key),
      [
        "capital.raise_target",
        "financial.gross_margin",
        "financial.monthly_revenue",
        "team.employee_count",
      ],
    );
    assert.ok(claims.every((c) => c.evidence_status === "SELF_REPORTED"));
    // No raise record, no public card, no handle, no team on a founder's
    // private company: the seed only adds figures.
    for (const query of [
      `select 1 from core.capital_objectives where company_id = '${ids.sCompany}'`,
      `select 1 from core.shareable_identities where subject_id = '${ids.sCompany}'`,
      `select 1 from core.handles where subject_id = '${ids.sCompany}'`,
      `select 1 from identity.organisation_memberships where organisation_id = '${ids.sOrg}'`,
    ]) {
      assert.equal((await db.read(query)).length, 0, query);
    }
  },
);

test(
  "discoverable to Q: listed and eligible in the knowledge projection",
  { skip },
  async () => {
    const listed = await db.read(
      `select p.canonical_name, p.listed, p.discovery_eligible from knowledge.company_profiles p join core.companies c on c.id = p.company_id where c.demonstration_data order by 1`,
    );
    const byName = Object.fromEntries(listed.map((r) => [r.canonical_name, r]));
    assert.equal(byName["Capital Q"]?.listed, true);
    assert.equal(byName["Capital Q"]?.discovery_eligible, true);
    // Owner 2026-10-23: KUUZA AI and SongScribe AI are discoverable too.
    assert.equal(byName["KUUZA AI"]?.listed, true);
    assert.equal(byName["SongScribe AI"]?.listed, true);
  },
);

test(
  "Q Cards: Capital Q's company card and David's own card",
  { skip },
  async () => {
    const [card] = await db.read(
      `select field_scopes from core.shareable_identities where subject_type = 'COMPANY' and subject_id = '${ids.cqCompany}'`,
    );
    // Figures are network_visible claims, so the card shows them to
    // members; a public_external scope would read "Not shared yet".
    assert.equal(card.field_scopes.tractionMetrics, "network_visible");
    assert.equal(card.field_scopes.investabilitySummary, "network_visible");
    const [handle] = await db.read(
      `select handle from core.handles where subject_id = '${ids.cqCompany}' and status = 'ACTIVE'`,
    );
    assert.equal(handle.handle, "capital-q-hq");
    const person = await db.read(
      "select h.handle, h.organisation_id, s.created_by_user_id = s.subject_id as own from core.handles h join core.shareable_identities s on s.subject_type = h.subject_type and s.subject_id = h.subject_id where h.subject_type = 'PERSON' order by h.handle",
    );
    assert.deepEqual(
      [...person].map((row) => ({ ...row })),
      [
        { handle: "daniel-oyeniyi", organisation_id: null, own: true },
        { handle: "david-nwankwo", organisation_id: null, own: true },
        { handle: "zino-mario", organisation_id: null, own: true },
      ],
      "everyone on the team has their own card, owned by them",
    );
  },
);

test(
  "David's own photo: re-encoded, uploaded first, owned by him",
  { skip },
  async () => {
    const rows = await db.read(
      "select i.status, i.object_key, i.width, i.height, i.organisation_id, i.created_by_user_id = i.subject_id as own from core.profile_images i where i.subject_type = 'PERSON' and i.kind = 'AVATAR'",
    );
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.status, "READY");
    assert.equal(row.own, true);
    assert.equal(row.organisation_id, null);
    assert.equal(row.width, row.height, "a square avatar");
    assert.match(row.object_key, /^img\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/);
    const object = stored.get(row.object_key);
    assert.equal(object?.contentType, "image/webp");
    assert.ok(object.bytes > 1000);
  },
);

test(
  "the team: member role only, titles, no invitations, roles-only backgrounds",
  { skip },
  async () => {
    const members = await db.read(
      `select p.display_name, m.business_title, m.is_founder from core.company_members m join identity.user_profiles p on p.id = m.user_id where m.company_id = '${ids.cqCompany}' and m.is_current order by m.is_founder desc, p.display_name`,
    );
    assert.deepEqual(
      [...members].map((r) => ({ ...r })),
      [
        {
          display_name: "Captain Zino Mario",
          business_title: "Co-founder",
          is_founder: true,
        },
        {
          display_name: "David Nwankwo",
          business_title: "Founder & CEO",
          is_founder: true,
        },
        {
          display_name: "Daniel Oyeniyi",
          business_title: "Engineering",
          is_founder: false,
        },
      ],
    );
    const roles = await db.read(
      `select distinct r.code from identity.organisation_memberships om join identity.membership_roles mr on mr.membership_id = om.id join permissions.roles r on r.id = mr.role_id where om.organisation_id = '${CAPITAL_Q_ORG}'`,
    );
    assert.deepEqual(
      [...roles].map((r) => r.code),
      ["organisation_member"],
      "a seed never grants owner or admin",
    );
    const invitations = await db.read(
      "select count(*)::int as n from identity.organisation_invitations",
    );
    assert.equal(invitations[0].n, 0, "no invitation is created or sent");
    const backgrounds = await db.read(
      "select p.display_name, b.title, b.from_year, b.detail, b.visibility_scope from core.founder_background_entries b join identity.user_profiles p on p.id = b.user_id order by 1, 2",
    );
    assert.deepEqual(
      [...backgrounds].map(
        (r) =>
          `${r.display_name}: ${r.title} | ${r.from_year} | ${r.detail} | ${r.visibility_scope}`,
      ),
      [
        "Captain Zino Mario: Co-founder, Capital Q | null | null | network_visible",
        "Captain Zino Mario: Co-founder, Songscribe | null | null | network_visible",
        "David Nwankwo: Founder & CEO, Capital Q | null | null | network_visible",
      ],
    );
  },
);

test(
  "the data room: every manifest document, as an upload registers it",
  { skip },
  async () => {
    const docs = await db.read(
      `select d.title, d.document_type, d.download_audience, e.level, e.visibility_scope, e.folder_code, v.storage_bucket, v.uploaded_by_user_id = d.created_by_user_id as same_uploader from evidence.documents d join evidence.data_room_entries e on e.document_id = d.id join evidence.document_versions v on v.id = d.current_version_id where d.company_id = '${ids.cqCompany}' order by d.title`,
    );
    // Owner 2026-10-22 ("upload everything"): all six, at the manifest's
    // levels. Only the deck is downloadable by investors.
    const expected = MANIFEST.documents
      .map((d) => ({
        title: d.title,
        document_type: d.documentType,
        download_audience:
          d.documentType === "PITCH_DECK" ? "INVESTORS" : "ORGANISATION",
        level: d.dataRoomLevel,
        visibility_scope:
          d.dataRoomLevel === "PUBLIC"
            ? "network_visible"
            : "specifically_shared",
        folder_code: d.folderCode,
        storage_bucket: "cq-documents-private",
        same_uploader: true,
      }))
      .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    assert.equal(expected.length, 6);
    assert.deepEqual(
      [...docs].map((r) => ({ ...r })),
      expected,
    );
    assert.deepEqual(
      [...docs].filter((r) => r.level === "PUBLIC").map((r) => r.document_type),
      ["PITCH_DECK"],
      "only the deck is open to investors",
    );
    const uploads = [...stored.values()].filter(
      (o) => o.bucket === "cq-documents-private",
    );
    assert.equal(uploads.length, 6, "the bytes are stored before the rows");
    const events = await db.read(
      "select count(*)::int as n from events.outbox where event_type = 'evidence.document.version_created'",
    );
    assert.equal(events[0].n, 6, "the real pipeline is told, as for an upload");
    const [confirmed] = await db.read(
      "select p.display_name from evidence.deck_extraction_confirmations c join identity.user_profiles p on p.id = c.confirmed_by_user_id",
    );
    assert.equal(confirmed.display_name, "David Nwankwo");
  },
);

test("idempotent: a second run plans nothing", { skip }, async () => {
  const again = await planAll(db, fixture, {
    persons: PERSONS,
    photos: PHOTOS,
    documents: true,
    confirmDeck: true,
    now: "2026-10-22T11:00:00.000Z",
  });
  assert.deepEqual(again.documents.planned, []);
  assert.equal(again.confirmation.sql, null);
  for (const photo of again.photos) assert.equal(photo.sql, null);
  for (const team of again.teams) assert.equal(team.sql, null);
  for (const { plan, sql } of again.companies) {
    assert.equal(sql, null, `${plan.key} would change again`);
  }
  for (const p of again.people) {
    assert.equal(p.sql, null);
    assert.equal(p.nameSql ?? null, null, `${p.person}'s name planned again`);
  }
});

test(
  "a duplicate Capital Q stops the seed rather than picking one",
  { skip },
  async () => {
    await db.run(`
    insert into identity.tenants (id, name) values ('00000000-0000-4000-8000-00000000b009', 'Copy');
    insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values ('00000000-0000-4000-8000-00000000d009', '00000000-0000-4000-8000-00000000b009', 'company', 'Songscribe copy', 'song-copy');
    insert into identity.tenant_organisations (tenant_id, organisation_id) values ('00000000-0000-4000-8000-00000000b009', '00000000-0000-4000-8000-00000000d009');
    insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values ('00000000-0000-4000-8000-00000000c009', '00000000-0000-4000-8000-00000000b009', '00000000-0000-4000-8000-00000000d009', 'SongScribe', 'songscribe');
  `);
    await assert.rejects(
      planAll(db, fixture, { now: "2026-10-22T12:00:00.000Z" }),
      /one canonical company is required/,
    );
  },
);
