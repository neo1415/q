// Phase 5 of the owner directive of 16 Nov 2026
// (docs/ai-handoff/directives/2026-11-16-demo-evidence-data-room-seeding.md):
// upload the synthetic evidence pack for Tensorgate (`tg-*`), Halyard
// Security (`hs-*`) and Nixo (`nx-*`), and the compact packs for MedTrail
// (`mt-*`), Mizan (`mz-*`), Ajopot (`aj-*`), Watchly (`wl-*`) and Maji Loop
// (`ml-*`), through the product's normal founder
// document API, as each company's own founder, and verify ingestion.
//
// Nixo (decision 99, 2026-11-16): the owner confirmed the Nixo founder
// account is theirs and asked for it to be seeded like the fictional
// companies. That account carries no fictional_demo/synthetic markers, so it
// is admitted by an explicit allow-list of exactly one company id
// (UNMARKED_FOUNDER_ALLOW_LIST below); every other company still requires a
// marked founder, and the signed-in account must be that company's resolved
// founder.
//
// Nixo sign-in (decision 99, amended 2026-11-16): there is no seed password
// for this account, and its password is never read or changed. The script
// fetches the Supabase secret key with SUPABASE_ACCESS_TOKEN (management API
// `api-keys`, as decision 78 allows), keeps it in memory only, asks the auth
// admin API for a one-time magic-link token hash (`generate_link`, type
// magiclink: no email is sent) for the resolved founder's email, and
// exchanges that hash at `/auth/v1/verify` for a normal user session. Seeding
// only; the key is never printed, logged, written or committed.
//
// FOUNDER-PRIVATE ONLY. This script never shares, grants, changes a data-room
// level or a download audience, deletes, or archives anything. Documents stay
// at their default visibility (organisation_private) until the owner decides
// on sharing.
//
//   node scripts/seed/evidence/generate.mjs              # build out/ first
//   node scripts/seed/evidence/upload.mjs upload [<company key>]
//   node scripts/seed/evidence/upload.mjs verify [<company key>]
//   node scripts/seed/evidence/upload.mjs negative       # investor cannot see them
//
// Environment (names only; never printed): SUPABASE_ACCESS_TOKEN (read-only
// SQL through the management API; for Nixo also the api-keys read above),
// CQ_SEED_ACCOUNT_PASSWORD (fictional accounts), and the public
// Supabase config as CQ_SB_URL/CQ_SB_PUBLISHABLE or CQ_PUBLIC_JSON (a file with
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; keep it out
// of the repository and shred it after use). NODE_USE_ENV_PROXY=1 in the
// cloud sandbox. Optional CQ_API_URL, CQ_EVIDENCE_REPORT (JSON report path).
//
// Idempotent: before uploading, the founder's own document list (same API) is
// read and a manifest document is skipped when a document with the same file
// name (the stable seed id, e.g. `tg-cap-table.pdf`) or the same sha256 is
// already there. Idempotency-Key headers are derived from the seed id and the
// file's hash, so a retried request replays rather than duplicates.
//
// Model calls: every document declares its manifest documentType (no kind
// classification) and PDFs carry a text layer (no page transcription). For
// Tensorgate and Halyard none is a PITCH_DECK or COMPANY_PROFILE, so no model
// call is expected. Nixo's pack includes a generated PITCH_DECK
// (`nx-pitch-deck`), so its upload triggers deck reading, about 4 model calls,
// which the owner approved (decision 99, paid calls). The compact packs hold
// no PITCH_DECK or COMPANY_PROFILE, so they too expect zero model calls. `verify` reports
// ai_ops.model_usage rows for the founders' tenants since the upload began,
// so any call is visible.
//
// Logs only short id prefixes: never an email, password, key or token.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const API =
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app";
const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const HERE = new URL("./", import.meta.url).pathname;
const COMPANIES = {
  tensorgate: { name: "Tensorgate", slug: "tensorgate" },
  halyard: { name: "Halyard Security", slug: "halyard-security" },
  nixo: {
    name: "Nixo",
    slug: "nixo",
    id: "d48c26d2-5aca-4788-9033-073b0f9d08ec",
  },
  // Compact packs (compact.mjs, 17 Nov 2026): fictional companies with
  // marked founders; the marker check applies unchanged.
  medtrail: {
    name: "MedTrail",
    slug: "medtrail",
    id: "b5280fd1-c2ee-4824-8658-09529453f7be",
  },
  mizan: {
    name: "Mizan",
    slug: "mizan",
    id: "d9c03bb4-fa9b-4c55-8924-038d386cc8a8",
  },
  ajopot: {
    name: "Ajopot",
    slug: "ajopot",
    id: "91de2a77-fe47-4af0-8534-d9abf9c55949",
  },
  watchly: {
    name: "Watchly",
    slug: "watchly",
    id: "526c2d72-9142-4e48-b106-ee4910f19318",
  },
  "maji-loop": {
    name: "Maji Loop",
    slug: "maji-loop",
    id: "01c554bf-8bf1-4eb7-b460-5d841764c40b",
  },
};

/**
 * Companies whose founder account may lack the fictional_demo/synthetic
 * markers. Exactly one entry, by company id, never by name: Nixo, under
 * decision 99 (docs/ai-handoff/DECISIONS.md, owner, 2026-11-16). Do not add
 * to this list without a recorded owner decision.
 */
const UNMARKED_FOUNDER_ALLOW_LIST = new Map([
  [
    "d48c26d2-5aca-4788-9033-073b0f9d08ec",
    "decision 99 (2026-11-16): owner confirmed the Nixo founder account is theirs; session by one-time admin sign-in link, no password change",
  ],
]);
// The fictional investor used for the negative check (dev-world seed).
const NEGATIVE_INVESTOR = "investor.savanna-seed@fictional.capitalq.local";
const REPORT =
  process.env.CQ_EVIDENCE_REPORT ?? `${HERE}out/upload-report.json`;

const short = (id) => String(id ?? "").slice(0, 8);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// --- read-only SQL -----------------------------------------------------------

async function sql(query) {
  if (!/^\s*select\b/i.test(query)) throw new Error("select only");
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("missing SUPABASE_ACCESS_TOKEN");
  // The management API intermittently answers 401 for a valid token; retry.
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, read_only: true }),
      },
    );
    const text = await r.text();
    if (r.ok) return JSON.parse(text);
    if (attempt >= 4 || (r.status !== 401 && r.status < 500))
      throw new Error(`sql HTTP ${r.status}: ${text.slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

const uuid = (v) => {
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error("not a uuid");
  return `'${v}'::uuid`;
};

// --- sign-in -------------------------------------------------------------------

function publicConfig() {
  if (process.env.CQ_SB_URL && process.env.CQ_SB_PUBLISHABLE)
    return { url: process.env.CQ_SB_URL, key: process.env.CQ_SB_PUBLISHABLE };
  const file = process.env.CQ_PUBLIC_JSON;
  if (!file)
    throw new Error("set CQ_SB_URL/CQ_SB_PUBLISHABLE or CQ_PUBLIC_JSON");
  const json = JSON.parse(readFileSync(file, "utf8"));
  return {
    url: json.NEXT_PUBLIC_SUPABASE_URL,
    key: json.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

let adminKeys = null;
/**
 * Supabase secret and publishable keys from the management API, in memory
 * only (decision 78; decision 99 for Nixo). Never printed or persisted.
 */
async function supabaseAdminKeys() {
  if (adminKeys) return adminKeys;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("missing SUPABASE_ACCESS_TOKEN");
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`api-keys: HTTP ${r.status}`);
  const list = await r.json();
  const pick = (type, name) =>
    list.find((k) => k.type === type)?.api_key ??
    list.find((k) => k.name === name)?.api_key;
  const secret = pick("secret", "service_role");
  const publishable = pick("publishable", "anon");
  if (!secret || !publishable) throw new Error("api-keys: keys missing");
  adminKeys = { secret, publishable };
  return adminKeys;
}

/**
 * Session for an allow-listed founder without touching their password: a
 * one-time magic-link token hash from the auth admin API (generate_link
 * sends no email), exchanged at /auth/v1/verify. Returns the verify body.
 */
async function adminLinkSession(email) {
  const { url } = publicConfig();
  const { secret, publishable } = await supabaseAdminKeys();
  const link = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const linkBody = await link.json().catch(() => ({}));
  if (!link.ok) throw new Error(`generate_link: HTTP ${link.status}`);
  const tokenHash =
    linkBody.hashed_token ?? linkBody.properties?.hashed_token ?? null;
  if (!tokenHash) throw new Error("generate_link: no token hash");
  const verified = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/json" },
    body: JSON.stringify({ type: "email", token_hash: tokenHash }),
  });
  const body = await verified.json().catch(() => ({}));
  if (!verified.ok || !body.access_token)
    throw new Error(`verify: HTTP ${verified.status}`);
  return body;
}

/**
 * Sign-in; returns { token, authUserId }. Never logs the email.
 * `company` is the resolved company. A company on the allow-list (Nixo
 * only) signs in through a one-time admin sign-in link and must resolve to
 * exactly its founder; every other account signs in with the shared seed
 * password and must carry the fictional marker.
 */
async function signIn(email, company) {
  const allowUnmarked =
    company !== undefined && UNMARKED_FOUNDER_ALLOW_LIST.has(company.id);
  let body;
  if (allowUnmarked) {
    body = await adminLinkSession(email);
  } else {
    const password = process.env.CQ_SEED_ACCOUNT_PASSWORD;
    if (!password) throw new Error("missing CQ_SEED_ACCOUNT_PASSWORD");
    const { url, key } = publicConfig();
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`sign-in refused: HTTP ${r.status}`);
    body = await r.json();
  }
  // Belt and braces: the account must carry the service-role fictional
  // marker the seeds set (app_metadata cannot be set by the user), unless
  // the company is on the allow-list and the account is that company's
  // resolved founder.
  if (allowUnmarked) {
    if (body.user?.id !== company.founder.auth_id)
      throw new Error("signed-in account is not the allow-listed founder");
  } else if (body.user?.app_metadata?.fictional_demo !== true) {
    throw new Error("signed-in account is not a seeded fictional account");
  }
  return { token: body.access_token, authUserId: body.user.id };
}

async function call(token, method, path, body, idempotencyKey) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { status: r.status, body: parsed };
}

// --- company and founder (read-only) ----------------------------------------

/**
 * The company row, and its seeded founder: a current founder member whose
 * auth account carries the fictional markers, preferring the one who ran the
 * company's onboarding journey (the owner). The email stays in memory only.
 */
async function resolveCompany(key) {
  const spec = COMPANIES[key];
  const [company] = await sql(
    `select id, tenant_id, organisation_id from core.companies
      where canonical_name = '${spec.name.replace(/'/g, "''")}'
        and slug = '${spec.slug}'
        ${spec.id ? `and id = ${uuid(spec.id)}` : ""}`,
  );
  if (!company) throw new Error(`${key}: company not found`);
  // Only an allow-listed company id may resolve an unmarked founder; the
  // marker filter stays in place for every other company.
  const unmarkedAllowed = UNMARKED_FOUNDER_ALLOW_LIST.has(company.id);
  const founders = await sql(
    `select p.id as profile_id, u.id as auth_id, u.email,
            exists (select 1 from onboarding.sessions s
                     where s.user_id = p.id and s.subject_id = c.id) as onboarded
       from core.companies c
       join core.company_members m on m.company_id = c.id
                                  and m.is_founder and m.is_current
       join identity.user_profiles p on p.id = m.user_id
       join auth.users u on u.id = p.auth_user_id
      where c.id = ${uuid(company.id)}
        ${
          unmarkedAllowed
            ? ""
            : `and u.raw_app_meta_data->>'fictional_demo' = 'true'
        and u.raw_app_meta_data->>'synthetic' = 'true'`
        }
      order by onboarded desc, m.started_at nulls last, p.id`,
  );
  if (founders.length === 0)
    throw new Error(
      `${key}: no ${unmarkedAllowed ? "current" : "seeded fictional"} founder`,
    );
  return { ...company, key, founder: founders[0] };
}

function manifestFor(key) {
  const path = `${HERE}out/${key}/manifest.json`;
  if (!existsSync(path))
    throw new Error(`${key}: run generate.mjs first (no ${path})`);
  return JSON.parse(readFileSync(path, "utf8"));
}

async function listCompanyDocuments(token, companyId) {
  const r = await call(
    token,
    "GET",
    `/v1/documents?companyId=${encodeURIComponent(companyId)}`,
  );
  if (r.status !== 200)
    throw new Error(
      `list documents: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  return r.body.documents;
}

// --- upload -------------------------------------------------------------------

async function uploadCompany(key) {
  const company = await resolveCompany(key);
  const manifest = manifestFor(key);
  const session = await signIn(company.founder.email, company);
  if (session.authUserId !== company.founder.auth_id)
    throw new Error("signed in as a different account than resolved");
  console.log(
    `${key}: company ${short(company.id)} founder ${short(company.founder.profile_id)}`,
  );
  const existing = await listCompanyDocuments(session.token, company.id);
  const byName = new Map(
    existing
      .filter((d) => d.currentVersion)
      .map((d) => [d.currentVersion.originalFilename, d]),
  );
  const byHash = new Map(
    existing
      .filter((d) => d.currentVersion)
      .map((d) => [d.currentVersion.sha256, d]),
  );
  const results = [];
  for (const doc of manifest.documents) {
    const bytes = readFileSync(`${HERE}out/${key}/${doc.fileName}`);
    const hash = sha256(bytes);
    const found = byName.get(doc.fileName) ?? byHash.get(hash);
    if (found) {
      console.log(`  ${doc.id}: present (${short(found.id)}), skipped`);
      results.push({ id: doc.id, documentId: found.id, action: "skipped" });
      continue;
    }
    const idem = `cq-evidence-seed-${doc.id}-${hash.slice(0, 16)}`;
    const created = await call(
      session.token,
      "POST",
      "/v1/documents/upload-sessions",
      {
        companyId: company.id,
        documentType: doc.documentType,
        title: doc.title,
        filename: doc.fileName,
        declaredMimeType: doc.mimeType,
        declaredSizeBytes: bytes.length,
      },
      idem,
    );
    if (created.status !== 201 && created.status !== 200) {
      const error = `start HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`;
      console.log(`  ${doc.id}: FAILED ${error}`);
      results.push({ id: doc.id, action: "failed", error });
      continue;
    }
    const { uploadSession, upload, document } = created.body;
    if (upload) {
      const put = await fetch(upload.url, {
        method: upload.method,
        headers: upload.headers,
        body: bytes,
      });
      if (!put.ok) {
        const error = `storage PUT HTTP ${put.status}`;
        console.log(`  ${doc.id}: FAILED ${error}`);
        results.push({
          id: doc.id,
          documentId: document.id,
          action: "failed",
          error,
        });
        continue;
      }
    }
    let status = uploadSession.status;
    if (["PENDING_AUTHORIZATION", "AUTHORIZED"].includes(status)) {
      const done = await call(
        session.token,
        "POST",
        `/v1/documents/upload-sessions/${uploadSession.id}/complete`,
        { clientSha256: hash },
        `${idem}-complete`,
      );
      if (done.status !== 200 && done.status !== 201) {
        const error = `complete HTTP ${done.status} ${JSON.stringify(done.body).slice(0, 300)}`;
        console.log(`  ${doc.id}: FAILED ${error}`);
        results.push({
          id: doc.id,
          documentId: document.id,
          action: "failed",
          error,
        });
        continue;
      }
      status = done.body.uploadSession.status;
    }
    console.log(
      `  ${doc.id}: uploaded ${short(document.id)} session ${status}`,
    );
    results.push({
      id: doc.id,
      documentId: document.id,
      action: "uploaded",
      sessionStatus: status,
    });
  }
  return { key, companyId: company.id, results };
}

// --- verify -------------------------------------------------------------------

const TERMINAL = new Set(["COMPLETED", "FAILED"]);

async function verifyRows(companyId, fileNames) {
  const names = fileNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  return sql(
    `select d.id, v.original_filename as file, d.title, d.document_type,
            d.sensitivity_class, d.visibility_scope, d.status, d.download_audience,
            d.company_id = c.id as company_ok,
            d.tenant_id = c.tenant_id as tenant_ok,
            d.owner_organisation_id = c.organisation_id as org_ok,
            v.storage_bucket, v.storage_key like 'raw/' || d.tenant_id::text || '/%' as key_tenant_scoped,
            v.sha256, v.processing_status, v.malware_scan_status, v.text_extraction_status,
            (select r.status || coalesce(':' || r.error_code, '')
               from evidence.document_processing_runs r
              where r.document_version_id = v.id
              order by r.created_at desc limit 1) as run,
            (select e.block_count from evidence.document_extractions e
              where e.document_version_id = v.id order by e.created_at desc limit 1) as blocks,
            (select e.page_count from evidence.document_extractions e
              where e.document_version_id = v.id order by e.created_at desc limit 1) as pages,
            (select e.artifact_bucket from evidence.document_extractions e
              where e.document_version_id = v.id order by e.created_at desc limit 1) as extraction_bucket,
            (select cs.status || '/' || cs.chunk_count || '/' || cs.visibility_scope
               from q_knowledge.chunk_sets cs
              where cs.document_version_id = v.id order by cs.created_at desc limit 1) as chunk_set,
            (select count(*) from q_knowledge.chunks k
              where k.document_version_id = v.id and k.status = 'ACTIVE') as chunks,
            (select coalesce(sum(length(k.content)), 0) from q_knowledge.chunks k
              where k.document_version_id = v.id and k.status = 'ACTIVE'
                and k.parent_chunk_id is null) as text_chars,
            (select count(*) from evidence.document_pages pg
              where pg.document_version_id = v.id) as page_rows,
            (select coalesce(sum(length(pg.text)), 0) from evidence.document_pages pg
              where pg.document_version_id = v.id) as extracted_chars,
            (select count(*) from evidence.document_claim_readings cr
              where cr.document_version_id = v.id) as claim_readings,
            (select count(*) from evidence.data_room_entries de
              where de.document_id = d.id) as data_room_entries,
            (select count(*) from permissions.disclosure_policies dp
              where dp.resource_id = d.id) as disclosure_policies
       from evidence.documents d
       join core.companies c on c.id = ${uuid(companyId)}
       join evidence.document_versions v on v.id = d.current_version_id
      where d.company_id = c.id and v.original_filename in (${names})
      order by v.original_filename`,
  );
}

async function verifyCompany(key, sinceIso) {
  const company = await resolveCompany(key);
  const manifest = manifestFor(key);
  const fileNames = manifest.documents.map((d) => d.fileName);
  const deadline = Date.now() + 10 * 60_000;
  let rows;
  for (;;) {
    rows = await verifyRows(company.id, fileNames);
    const pending = rows.filter((r) => !TERMINAL.has(r.processing_status));
    // Documents never uploaded are reported as missing, not waited for.
    if (pending.length === 0 || Date.now() > deadline) break;
    console.log(`${key}: ${pending.length} still processing; waiting 20s`);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  // Facts and claims tied to these documents (evidence items from the
  // extraction's source or whose locator names the document), and onboarding
  // suggestions offered from them.
  const ids = rows.map((r) => uuid(r.id)).join(",") || "null";
  const facts = rows.length
    ? await sql(
        `select d.id as document_id, ei.evidence_status,
                cl.truth_class, cl.evidence_status as claim_evidence_status,
                count(distinct ei.id) as evidence_items, count(distinct cl.id) as claims
           from evidence.documents d
           join evidence.evidence_items ei
             on ei.source_id in (select e.source_id from evidence.document_extractions e
                                  where e.document_id = d.id)
             or ei.locator::text like '%' || d.id::text || '%'
           left join evidence.claim_evidence ce on ce.evidence_item_id = ei.id
           left join evidence.claims cl on cl.id = ce.claim_id
          where d.id in (${ids})
          group by 1, 2, 3, 4`,
      )
    : [];
  const suggestions = rows.length
    ? await sql(
        `select count(*) as n from onboarding.suggestions g
          where exists (select 1 from evidence.documents d
                         where d.id in (${ids})
                           and g.source_refs::text like '%' || d.current_version_id::text || '%')`,
      )
    : [{ n: 0 }];
  const usage = await sql(
    `select task_class, purpose, count(*) as calls, coalesce(sum(cost_usd), 0) as usd
       from ai_ops.model_usage
      where occurred_at >= '${sinceIso}'::timestamptz
        and (tenant_id = ${uuid(company.tenant_id)}
             or user_id in (${uuid(company.founder.profile_id)}, ${uuid(company.founder.auth_id)}))
      group by 1, 2`,
  );
  // The founder's own listing through the API: documents and data room.
  const session = await signIn(company.founder.email, company);
  const listed = await listCompanyDocuments(session.token, company.id);
  const listedIds = new Set(listed.map((d) => d.id));
  const outline = await call(
    session.token,
    "GET",
    `/v1/companies/${company.id}/data-room`,
  );
  const outlineText = JSON.stringify(outline.body);
  const out = rows.map((r) => ({
    ...r,
    seedId: r.file.replace(/\.(pdf|csv)$/, ""),
    inFounderApiList: listedIds.has(r.id),
    inFounderDataRoomOutline: outlineText.includes(r.id),
  }));
  return {
    key,
    companyId: company.id,
    expected: fileNames.length,
    found: rows.length,
    outlineStatus: outline.status,
    facts,
    suggestions: Number(suggestions[0]?.n ?? 0),
    modelUsage: usage,
    documents: out,
  };
}

// --- negative ------------------------------------------------------------------

async function negative() {
  const docs = [];
  for (const key of Object.keys(COMPANIES)) {
    const company = await resolveCompany(key);
    const manifest = manifestFor(key);
    const rows = await verifyRows(
      company.id,
      manifest.documents.map((d) => d.fileName),
    );
    docs.push({ key, companyId: company.id, rows });
  }
  const session = await signIn(NEGATIVE_INVESTOR);
  const checks = [];
  for (const { key, companyId, rows } of docs) {
    const list = await call(
      session.token,
      "GET",
      `/v1/documents?companyId=${companyId}`,
    );
    const listIds = JSON.stringify(list.body);
    const room = await call(
      session.token,
      "GET",
      `/v1/companies/${companyId}/data-room`,
    );
    const roomText = JSON.stringify(room.body);
    for (const r of rows) {
      const one = await call(session.token, "GET", `/v1/documents/${r.id}`);
      const file = await call(
        session.token,
        "GET",
        `/v1/documents/${r.id}/file`,
      );
      const open = await call(
        session.token,
        "GET",
        `/v1/companies/${companyId}/data-room/documents/${r.id}/open`,
      );
      const access = await call(
        session.token,
        "GET",
        `/v1/data-room/documents/${r.id}/access`,
      );
      checks.push({
        key,
        seedId: r.file.replace(/\.(pdf|csv)$/, ""),
        documentId: r.id,
        listStatus: list.status,
        inInvestorList: listIds.includes(r.id),
        dataRoomStatus: room.status,
        inInvestorDataRoom:
          roomText.includes(r.id) || roomText.includes(r.title),
        get: one.status,
        file: file.status,
        open: open.status,
        access: access.status,
      });
    }
  }
  return checks;
}

// --- main --------------------------------------------------------------------

const [mode = "verify", only] = process.argv.slice(2);
const keys = only ? [only] : Object.keys(COMPANIES);
for (const k of keys)
  if (!COMPANIES[k]) throw new Error(`unknown company ${k}`);
const report = existsSync(REPORT)
  ? JSON.parse(readFileSync(REPORT, "utf8"))
  : {};

if (mode === "upload") {
  report.uploadStartedAt ??= new Date().toISOString();
  report.uploads ??= {};
  for (const key of keys) report.uploads[key] = await uploadCompany(key);
} else if (mode === "verify") {
  const since =
    report.uploadStartedAt ?? new Date(Date.now() - 3600_000).toISOString();
  report.verify ??= {};
  for (const key of keys) {
    const v = await verifyCompany(key, since);
    report.verify[key] = v;
    console.log(
      `${key}: ${v.found}/${v.expected} found; statuses ${[
        ...new Set(
          v.documents.map(
            (d) => `${d.processing_status}/${d.text_extraction_status}`,
          ),
        ),
      ].join(
        ",",
      )}; model calls ${v.modelUsage.reduce((n, u) => n + Number(u.calls), 0)}`,
    );
  }
} else if (mode === "negative") {
  report.negative = await negative();
  const leaks = report.negative.filter(
    (c) =>
      c.inInvestorList ||
      c.inInvestorDataRoom ||
      [c.get, c.file, c.open, c.access].some((s) => s >= 200 && s < 300),
  );
  console.log(
    `negative: ${report.negative.length} documents checked, ${leaks.length} visible`,
  );
} else {
  throw new Error("mode: upload | verify | negative");
}
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`report: ${REPORT}`);
