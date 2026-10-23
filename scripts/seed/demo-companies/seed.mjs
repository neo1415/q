#!/usr/bin/env node
// Demonstration companies (owner direction 2026-10-22): Capital Q, KUUZA AI
// and Songscribe. See plan.mjs for the rules; this file reads the current
// state, plans, prints what would change and, only with --apply, runs it.
//
//   Local (tests, rehearsal):
//     node scripts/seed/demo-companies/seed.mjs --database-url postgresql://postgres@127.0.0.1:54329/cq [--apply]
//
//   Hosted (production): a separate, explicit step the owner approves at
//   deploy time. Dry run first, read the plan, then --apply:
//     SUPABASE_ACCESS_TOKEN=... node scripts/seed/demo-companies/seed.mjs --hosted [--apply]
//
//   Person Q Cards for people who already have accounts and agreed:
//     --person david=<email> --person zino=<email>
//   Leave a company out of the run: --skip songscribe
//   Capital Q's data room (business documents only), uploaded by its founder;
//   then, once Q has read the deck, his confirmation (owner-approved):
//     --documents        (local rehearsal: add --local-fixture-reading)
//     --confirm-deck     (a later run, after the reading exists)
//   Local runs with files need --storage-dir <dir>.
//   Their own profile photo (owner-supplied, with permission), for a person
//   also named with --person; hosted uploads need SUPABASE_URL and
//   SUPABASE_SECRET_KEY:
//     --photo david=supabase/seed-assets/capital-q-team/david-founder.jpg
//
// The token stays in process memory; nothing here prints or writes it.
// Idempotent: deterministic ids, and a second run plans nothing.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHash } from "node:crypto";

import {
  directoryStorage,
  PROFILE_IMAGE_BUCKET,
  planPersonPhoto,
  supabaseStorage,
} from "./photo.mjs";

import {
  planCompany,
  renderCompanySql,
  renderPersonCardSql,
  renderTeamSql,
  DOCUMENT_BUCKET,
  planDocuments,
  renderDeckConfirmationSql,
  renderDocumentsSql,
  renderFixtureReadingSql,
  seedUuid,
} from "./plan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURE_PATH = join(
  ROOT,
  "supabase/seed-assets/demo-companies/companies.json",
);
const HOSTED_PROJECT_REF = "vcohxiqsmnkzxnvawgri";
export const DOCUMENTS_MANIFEST = join(
  ROOT,
  "supabase/seed-assets/capital-q-documents/manifest.json",
);
const FIXTURE_READING = join(
  dirname(fileURLToPath(import.meta.url)),
  "local-deck-reading.fixture.json",
);

/** A database the seed can read from and write to. */
export function localDatabase(url) {
  const require = createRequire(join(ROOT, "packages/database/package.json"));
  const postgres = require("postgres");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  return {
    read: (text) => sql.unsafe(text),
    run: (text) => sql.unsafe(text).simple(),
    close: () => sql.end(),
  };
}

export function hostedDatabase() {
  const query = async (text, readOnly) => {
    const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
    if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${HOSTED_PROJECT_REF}/database/query`,
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
    if (!r.ok) {
      throw new Error(
        `sql: HTTP ${r.status} ${JSON.stringify(body).slice(0, 400)}`,
      );
    }
    return body;
  };
  return {
    read: (text) => query(text, true),
    run: (text) => query(text, false),
    close: async () => {},
  };
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Everything planCompany needs to know about one company now. */
export async function readCompanyState(db, spec) {
  const byOrg = spec.match.organisationId
    ? await db.read(
        `select * from core.companies where organisation_id = ${q(spec.match.organisationId)} and company_status = 'active'`,
      )
    : [];
  const byName =
    byOrg.length > 0
      ? []
      : await db.read(
          `select * from core.companies where company_status = 'active' and lower(btrim(canonical_name)) = any(array[${spec.match.names.map((n) => q(n.toLowerCase())).join(",")}])`,
        );
  const found = [...byOrg, ...byName];
  if (found.length > 1) {
    throw new Error(
      `${spec.canonicalName}: ${found.length} active companies match; one canonical company is required, so nothing was changed`,
    );
  }
  const company = found[0] ?? null;
  if (company === null) {
    return {
      company: null,
      claims: [],
      objective: null,
      taxonomyNodeIds: new Set(),
      taxonomyVocabsUsed: new Set(),
      memberCount: 0,
      handle: null,
      card: null,
    };
  }
  const id = q(company.id);
  const [claims, objectives, assigned, members, handles, cards] =
    await Promise.all([
      db.read(
        `select id, claim_key, structured_value, current_revision_number, statement, truth_class, evidence_status, valid_from from evidence.claims where subject_type = 'COMPANY' and subject_id = ${id} and lifecycle_status = 'CURRENT'`,
      ),
      db.read(
        `select id, target_amount::text as target_amount, currency_code, target_stage, instrument_code, target_close_date::text as target_close_date, use_of_funds_summary from core.capital_objectives where company_id = ${id} and status = 'ACTIVE'`,
      ),
      db.read(
        `select a.node_id, v.code as vocab from taxonomy.entity_assignments a join taxonomy.nodes n on n.id = a.node_id join taxonomy.vocabularies v on v.id = n.vocabulary_id where a.entity_type = 'COMPANY' and a.entity_id = ${id} and a.status = 'ACTIVE'`,
      ),
      db.read(
        `select count(*)::int as n from core.company_members where company_id = ${id} and is_current`,
      ),
      db.read(
        `select handle from core.handles where subject_type = 'COMPANY' and subject_id = ${id} and status = 'ACTIVE'`,
      ),
      db.read(
        `select id, field_scopes, version from core.shareable_identities where subject_type = 'COMPANY' and subject_id = ${id}`,
      ),
    ]);
  return {
    company,
    claims,
    objective: objectives[0] ?? null,
    taxonomyNodeIds: new Set(assigned.map((a) => a.node_id)),
    taxonomyVocabsUsed: new Set(assigned.map((a) => a.vocab)),
    memberCount: members[0]?.n ?? 0,
    handle: handles[0]?.handle ?? null,
    card: cards[0] ?? null,
  };
}

async function readNodes(db) {
  const rows = await db.read(
    `select n.id, n.display_name, v.code as vocab from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id`,
  );
  return new Map(rows.map((r) => [`${r.vocab}|${r.display_name}`, r.id]));
}

/** The product's own re-encoder, so a seeded photo is exactly an upload's. */
async function processAvatar(bytes) {
  const identity = await import(
    pathToFileURL(join(ROOT, "packages/public-identity/dist/index.js")).href
  );
  const contracts = await import(
    pathToFileURL(join(ROOT, "packages/contracts/dist/index.js")).href
  );
  const rendition = await identity
    .createSharpImageProcessor()
    .process(bytes, contracts.PROFILE_IMAGE_DIMENSIONS.AVATAR);
  if (rendition === null) throw new Error("the photo is not a usable image");
  return rendition;
}

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Plan every company (and person card) without writing anything. */
export async function planAll(
  db,
  fixture,
  {
    persons = {},
    photos = {},
    documents = false,
    confirmDeck = false,
    fixtureReading = false,
    now,
  } = {},
) {
  const owner = (
    await db.read(
      "select user_id from identity.platform_admins where role = 'platform_owner' order by granted_at limit 1",
    )
  )[0]?.user_id;
  if (!owner) throw new Error("no platform owner to attribute the seed to");
  const nodes = await readNodes(db);
  const at = now ?? new Date().toISOString();
  const companies = [];
  for (const spec of fixture.companies) {
    const state = await readCompanyState(db, spec);
    const plan = planCompany(fixture, spec, { ...state, nodes });
    companies.push({
      plan,
      sql: renderCompanySql(plan, {
        seedKey: fixture.seedKey,
        authorityUserId: owner,
        now: at,
      }),
    });
  }
  const people = [];
  for (const [person, email] of Object.entries(persons)) {
    if (fixture.people[person] === undefined) {
      throw new Error(`unknown person "${person}" in the fixture`);
    }
    const users = await db.read(
      `select p.id, ac.tenant_id from identity.user_profiles p join auth.users u on u.id = p.auth_user_id left join identity.user_active_contexts c on c.user_id = p.id left join identity.organisation_memberships ac on ac.id = c.membership_id where lower(u.email) = lower(${q(email)}) and p.status = 'active'`,
    );
    if (users.length !== 1) {
      people.push({
        person,
        skip: "no single active account for that email",
      });
      continue;
    }
    const userId = users[0].id;
    // The company they found or join here gives a tenant when they have no
    // organisation of their own yet.
    const home = companies.find(({ plan }) => {
      const spec = fixture.companies.find((c) => c.key === plan.key);
      return (
        !plan.skip &&
        [...spec.founders, ...spec.team].some((m) => m.person === person)
      );
    });
    const tenantId = users[0].tenant_id ?? home?.plan.ids.tenant ?? null;
    // A personal Q Card only for a founder the fixture names (David, Zino).
    const founder = fixture.companies.some((c) =>
      c.founders.some((f) => f.person === person),
    );
    if (!founder || tenantId === null) {
      people.push({
        person,
        userId,
        tenantId,
        handle: null,
        sql: null,
        noCard: true,
      });
      continue;
    }
    const [handles, cards] = await Promise.all([
      db.read(
        `select handle from core.handles where subject_type = 'PERSON' and subject_id = ${q(userId)} and status = 'ACTIVE'`,
      ),
      db.read(
        `select id from core.shareable_identities where subject_type = 'PERSON' and subject_id = ${q(userId)}`,
      ),
    ]);
    const handle = personHandle(fixture.people[person]);
    people.push({
      person,
      userId,
      tenantId,
      handle: handles[0]?.handle ?? handle,
      sql: renderPersonCardSql({
        seedKey: fixture.seedKey,
        userId,
        handle,
        tenantId,
        existingHandle: handles[0]?.handle ?? null,
        existingCard: cards[0] ?? null,
      }),
    });
  }
  // The team: founders and team the fixture names, for people named here.
  const memberRole = (
    await db.read(
      "select id from permissions.roles where code = 'organisation_member'",
    )
  )[0]?.id;
  const teams = [];
  for (const { plan } of companies) {
    if (plan.skip) continue;
    const spec = fixture.companies.find((c) => c.key === plan.key);
    const wanted = [
      ...spec.founders.map((f) => ({ ...f, isFounder: true })),
      ...spec.team.map((t) => ({ ...t, isFounder: false })),
    ].filter((m) => people.some((p) => p.person === m.person && !p.skip));
    if (wanted.length === 0) continue;
    const members = [];
    for (const m of wanted) {
      const userId = people.find((p) => p.person === m.person).userId;
      const [membership, member, context, backgrounds] = await Promise.all([
        db.read(
          `select 1 from identity.organisation_memberships where organisation_id = ${q(plan.ids.organisation)} and user_id = ${q(userId)} and membership_status = 'active'`,
        ),
        db.read(
          `select 1 from core.company_members where company_id = ${q(plan.ids.company)} and user_id = ${q(userId)} and is_current`,
        ),
        db.read(
          `select 1 from identity.user_active_contexts where user_id = ${q(userId)}`,
        ),
        db.read(
          `select title from core.founder_background_entries where user_id = ${q(userId)}`,
        ),
      ]);
      members.push({
        userId,
        title: m.title,
        isFounder: m.isFounder,
        backgrounds: m.isFounder
          ? (fixture.people[m.person].backgrounds ?? [])
          : [],
        hasMembership: membership.length > 0,
        hasCompanyMember: member.length > 0,
        hasActiveContext: context.length > 0,
        existingBackgroundTitles: backgrounds.map((b) => b.title),
      });
    }
    teams.push({
      company: plan.name,
      people: wanted.map((m) => m.person),
      sql: renderTeamSql({
        seedKey: fixture.seedKey,
        company: {
          id: plan.ids.company,
          tenant: plan.ids.tenant,
          organisation: plan.ids.organisation,
        },
        memberRoleId: memberRole,
        authorityUserId: owner,
        now: at,
        members,
      }),
    });
  }

  const planned = [];
  for (const [person, path] of Object.entries(photos)) {
    const who = people.find((p) => p.person === person && !p.skip);
    if (who === undefined) {
      planned.push({ person, skip: "name the person with --person first" });
      continue;
    }
    const contentType = CONTENT_TYPES[extname(path).toLowerCase()];
    if (contentType === undefined) throw new Error(`unsupported image ${path}`);
    const bytes = new Uint8Array(readFileSync(join(ROOT, path)));
    const rendition = await processAvatar(bytes);
    const current = await db.read(
      `select id from core.profile_images where subject_type = 'PERSON' and subject_id = ${q(who.userId)} and kind = 'AVATAR' and status = 'READY'`,
    );
    if (who.tenantId === null) {
      planned.push({ person, skip: "no organisation to file the photo under" });
      continue;
    }
    const plan = planPersonPhoto({
      seedKey: fixture.seedKey,
      userId: who.userId,
      tenantId: who.tenantId,
      source: { bytes, contentType },
      rendition,
      currentReadyId: current[0]?.id ?? null,
    });
    planned.push(
      plan === null ? { person, sql: null } : { person, ...plan, rendition },
    );
  }
  // The data room (owner 2026-10-22: "upload everything"), uploaded by
  // the founder named for it; and, later, his confirmation of Q's reading.
  let docs = null;
  let confirmation = null;
  if (documents || confirmDeck) {
    const manifest = JSON.parse(readFileSync(DOCUMENTS_MANIFEST, "utf8"));
    const target = companies.find(({ plan }) => plan.key === manifest.company);
    const spec = fixture.companies.find((c) => c.key === manifest.company);
    const uploader = people.find(
      (p) => p.person === spec.founders[0]?.person && !p.skip,
    );
    if (target === undefined || target.plan.skip || uploader === undefined) {
      docs = { skip: "the company and its founder (--person) are both needed" };
    } else {
      const company = {
        id: target.plan.ids.company,
        tenant: target.plan.ids.tenant,
        organisation: target.plan.ids.organisation,
      };
      if (documents) {
        const existing = await db.read(
          `select title from evidence.documents where company_id = ${q(company.id)} and status = 'ACTIVE'`,
        );
        const files = manifest.documents.map((d) => {
          const bytes = new Uint8Array(
            readFileSync(join(dirname(DOCUMENTS_MANIFEST), d.file)),
          );
          const sha = createHash("sha256").update(bytes).digest("hex");
          if (sha !== d.sha256) {
            throw new Error(`${d.file}: sha256 does not match the manifest`);
          }
          return { ...d, bytes, sizeBytes: bytes.byteLength };
        });
        const planned = planDocuments({
          seedKey: fixture.seedKey,
          company,
          uploaderUserId: uploader.userId,
          documents: files,
          existingTitles: existing.map((r) => r.title),
        });
        // The pitch video is not seeded: a pitch needs the founder's session
        // and the stream provider, so it is uploaded at /pitch/new. The seed
        // only checks the file is the one the manifest names.
        const video = manifest.pitchVideo;
        const videoSha = createHash("sha256")
          .update(readFileSync(join(dirname(DOCUMENTS_MANIFEST), video.file)))
          .digest("hex");
        if (videoSha !== video.sha256) {
          throw new Error(`${video.file}: sha256 does not match the manifest`);
        }
        docs = {
          company,
          planned,
          pitchVideo: {
            file: video.file,
            audience: video.audience,
            uploadPath: video.uploadPath,
          },
          sql: renderDocumentsSql({
            seedKey: fixture.seedKey,
            company,
            planned,
            authorityUserId: owner,
            now: at,
          }),
          fixtureReading: fixtureReading
            ? (() => {
                const reading = JSON.parse(
                  readFileSync(FIXTURE_READING, "utf8"),
                );
                const deck = planned.find(
                  (d) => d.documentType === "PITCH_DECK",
                );
                return deck === undefined
                  ? null
                  : renderFixtureReadingSql({
                      seedKey: fixture.seedKey,
                      company,
                      document: deck,
                      fixture: reading,
                    });
              })()
            : null,
        };
      }
      if (confirmDeck) {
        const [reading] = await db.read(
          `select x.id as extraction_id, d.id as document_id, (c.extraction_id is not null) as confirmed from evidence.documents d join evidence.deck_extractions x on x.document_version_id = d.current_version_id left join evidence.deck_extraction_confirmations c on c.extraction_id = x.id where d.company_id = ${q(company.id)} and d.document_type = 'PITCH_DECK' and d.status = 'ACTIVE' order by x.reading_number desc, x.created_at desc limit 1`,
        );
        confirmation =
          reading === undefined
            ? {
                skip: "no reading of the deck yet: run again once Q has read it",
              }
            : reading.confirmed
              ? { sql: null }
              : {
                  sql: renderDeckConfirmationSql({
                    seedKey: fixture.seedKey,
                    company,
                    extractionId: reading.extraction_id,
                    documentId: reading.document_id,
                    userId: uploader.userId,
                    authorityUserId: owner,
                    now: at,
                  }),
                };
      }
    }
  }
  return {
    owner,
    companies,
    people,
    teams,
    photos: planned,
    documents: docs,
    confirmation,
  };
}

export function personHandle(person) {
  const name =
    person.displayName?.replace(/^captain\s+/i, "") ??
    `${person.givenName} ${person.familyName}`;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export async function applyAll(db, planned, { storage } = {}) {
  for (const c of planned.companies) if (c.sql !== null) await db.run(c.sql);
  for (const p of planned.people) if (p.sql) await db.run(p.sql);
  for (const t of planned.teams ?? []) if (t.sql) await db.run(t.sql);
  for (const photo of planned.photos ?? []) {
    if (!photo.sql) continue;
    if (storage === undefined) {
      throw new Error("a photo needs storage to upload to");
    }
    // The bytes first: a READY row never points at a missing object.
    await storage.putObject({
      bucket: PROFILE_IMAGE_BUCKET,
      key: photo.objectKey,
      body: photo.rendition.bytes,
      contentType: photo.rendition.contentType,
    });
    await db.run(photo.sql);
  }
  const docs = planned.documents;
  if (docs?.sql) {
    if (storage === undefined) throw new Error("documents need storage");
    for (const d of docs.planned) {
      await storage.putObject({
        bucket: DOCUMENT_BUCKET,
        key: d.storageKey,
        body: d.bytes,
        contentType: d.mime,
      });
    }
    await db.run(docs.sql);
  }
  if (docs?.fixtureReading) await db.run(docs.fixtureReading);
  if (planned.confirmation?.sql) await db.run(planned.confirmation.sql);
}

export function describe(planned) {
  const lines = [];
  for (const { plan } of planned.companies) {
    if (plan.skip) {
      lines.push(`- ${plan.key}: SKIP (${plan.skip})`);
      continue;
    }
    if (plan.noop) {
      lines.push(`- ${plan.name}: nothing to change`);
      continue;
    }
    lines.push(
      `- ${plan.name} [${plan.mode}] ${plan.create ? "CREATE" : `company ${plan.ids.company}`}`,
      `    fields: ${Object.keys(plan.changes).join(", ") || "none"}${plan.label ? "; + demonstration label" : ""}`,
      `    claims: +${plan.claims.length} (${plan.claims.map((c) => c.claim.key).join(", ") || "none"}); superseded ${plan.claims.reduce((n, c) => n + c.supersede.length, 0)}`,
      `    taxonomy: +${plan.taxonomy.length}; raise: ${plan.raise === null ? "unchanged" : plan.raise.replace === null ? "create" : "replace"}; card: ${plan.card === null ? "unchanged" : plan.card.create ? "create" : "update scopes"}; handle: ${plan.handle?.handle ?? "unchanged"}`,
    );
  }
  for (const t of planned.teams ?? []) {
    lines.push(
      `- team ${t.company}: ${t.sql === null ? "already there" : `memberships (member role only, no invitations) and titles for ${t.people.join(", ")}`}`,
    );
  }
  for (const photo of planned.photos ?? []) {
    lines.push(
      photo.skip
        ? `- photo ${photo.person}: SKIP (${photo.skip})`
        : `- photo ${photo.person}: ${photo.sql === null ? "already this photo" : `upload ${photo.rendition.width}x${photo.rendition.height} WebP and set as their avatar`}`,
    );
  }
  if (planned.documents) {
    const d = planned.documents;
    lines.push(
      d.skip
        ? `- data room: SKIP (${d.skip})`
        : `- data room: ${d.planned.length === 0 ? "documents already there" : d.planned.map((x) => `${x.title} (${x.dataRoomLevel})`).join(", ")}${d.fixtureReading ? " + LOCAL FIXTURE READING" : ""}${d.pitchVideo ? `\n- pitch video (OWNER STEP, not seeded): upload supabase/seed-assets/capital-q-documents/${d.pitchVideo.file} at ${d.pitchVideo.uploadPath}, audience "${d.pitchVideo.audience}"` : ""}`,
    );
  }
  if (planned.confirmation) {
    lines.push(
      planned.confirmation.skip
        ? `- deck confirmation: SKIP (${planned.confirmation.skip})`
        : `- deck confirmation: ${planned.confirmation.sql === null ? "already confirmed" : "confirm Q's reading as the founder (owner-approved)"}`,
    );
  }
  for (const p of planned.people) {
    lines.push(
      p.skip
        ? `- person ${p.person}: SKIP (${p.skip})`
        : `- person ${p.person}: ${p.noCard ? "team only (no personal card)" : p.sql === null ? "card already there" : `card @${p.handle}`}`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const url = args[args.indexOf("--database-url") + 1];
  const hosted = args.includes("--hosted");
  if (hosted === args.includes("--database-url")) {
    throw new Error("choose one target: --database-url <url> or --hosted");
  }
  const persons = {};
  args.forEach((arg, i) => {
    if (arg === "--person") {
      const [name, email] = String(args[i + 1]).split("=");
      if (!name || !email) throw new Error("--person name=email");
      persons[name] = email;
    }
  });
  const photos = {};
  args.forEach((arg, i) => {
    if (arg === "--photo") {
      const [name, path] = String(args[i + 1]).split("=");
      if (!name || !path) throw new Error("--photo name=path");
      photos[name] = path;
    }
  });
  const documents = args.includes("--documents");
  const confirmDeck = args.includes("--confirm-deck");
  const fixtureReading = args.includes("--local-fixture-reading");
  if (fixtureReading && hosted) {
    throw new Error(
      "--local-fixture-reading is for local rehearsal only; the hosted reading comes from Q's deck reader",
    );
  }
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  // --skip <key> leaves a company out of this run entirely, e.g. one whose
  // live record a founder has since onboarded and that needs an owner call.
  const skipped = args.flatMap((arg, i) =>
    arg === "--skip" ? [String(args[i + 1])] : [],
  );
  for (const key of skipped) {
    if (!fixture.companies.some((c) => c.key === key)) {
      throw new Error(`--skip ${key}: no such company in the fixture`);
    }
  }
  fixture.companies = fixture.companies.filter((c) => !skipped.includes(c.key));
  const db = hosted ? hostedDatabase() : localDatabase(url);
  try {
    const planned = await planAll(db, fixture, {
      persons,
      photos,
      documents,
      confirmDeck,
      fixtureReading,
    });
    console.log(describe(planned));
    if (!apply) {
      console.log("\nDry run: nothing written. Add --apply to write.");
      return;
    }
    await applyAll(db, planned, {
      storage:
        Object.keys(photos).length === 0 && !documents
          ? undefined
          : hosted
            ? supabaseStorage()
            : args.includes("--storage-dir")
              ? directoryStorage(args[args.indexOf("--storage-dir") + 1])
              : undefined,
    });
    console.log("\nApplied.");
  } finally {
    await db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { seedUuid };
