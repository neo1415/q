// Phase 5 of the owner directive of 16 Nov 2026
// (docs/ai-handoff/directives/2026-11-16-demo-evidence-data-room-seeding.md):
// upload the synthetic evidence pack for Tensorgate (`tg-*`) and Halyard
// Security (`hs-*`) through the product's normal founder document API, as
// each company's own seeded fictional founder, and verify ingestion.
//
// FOUNDER-PRIVATE ONLY. This script never shares, grants, changes a data-room
// level or a download audience, deletes, or archives anything. Documents stay
// at their default visibility (organisation_private) until the owner decides
// on sharing.
//
//   node scripts/seed/evidence/generate.mjs              # build out/ first
//   node scripts/seed/evidence/upload.mjs upload [tensorgate|halyard]
//   node scripts/seed/evidence/upload.mjs verify [tensorgate|halyard]
//   node scripts/seed/evidence/upload.mjs negative       # investor cannot see them
//
// Environment (names only; never printed): SUPABASE_ACCESS_TOKEN (read-only
// SQL through the management API), CQ_SEED_ACCOUNT_PASSWORD, and the public
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
// No model call is expected: every document declares its manifest
// documentType (no kind classification), PDFs carry a text layer (no page
// transcription), and none is a PITCH_DECK or COMPANY_PROFILE (no deck
// reading or claim cards). `verify` reports ai_ops.model_usage rows for the
// founders' tenants since the upload began, so a surprise call is visible.
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
};
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

/** Password sign-in; returns { token, authUserId }. Never logs the email. */
async function signIn(email) {
  const password = process.env.CQ_SEED_ACCOUNT_PASSWORD;
  if (!password) throw new Error("missing CQ_SEED_ACCOUNT_PASSWORD");
  const { url, key } = publicConfig();
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in refused: HTTP ${r.status}`);
  const body = await r.json();
  // Belt and braces: the account must carry the service-role fictional
  // marker the seeds set (app_metadata cannot be set by the user).
  if (body.user?.app_metadata?.fictional_demo !== true)
    throw new Error("signed-in account is not a seeded fictional account");
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
        and slug = '${spec.slug}'`,
  );
  if (!company) throw new Error(`${key}: company not found`);
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
        and u.raw_app_meta_data->>'fictional_demo' = 'true'
        and u.raw_app_meta_data->>'synthetic' = 'true'
      order by onboarded desc, m.started_at nulls last, p.id`,
  );
  if (founders.length === 0)
    throw new Error(`${key}: no seeded fictional founder`);
  return { ...company, founder: founders[0] };
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
  const session = await signIn(company.founder.email);
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
  const session = await signIn(company.founder.email);
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
