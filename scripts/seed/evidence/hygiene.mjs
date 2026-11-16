// Demo evidence hygiene (owner directive of 16 Nov 2026, Phase 3 rules;
// defects from docs/ai-handoff/audits/2026-11-16-demo-evidence-inventory.md):
//
//   1. Documents that imitate an official certificate or registry record
//      ("This is to certify that ... Issued by the Delaware Division of
//      Corporations / Companies House (Scotland) / ...") are withdrawn.
//   2. QA leftovers (Maji Loop's "deck QA 14 Nov" decks and "note"; Ajopot's
//      two "acceptance-note" uploads from the founder acceptance run) are
//      withdrawn.
//   3. "(fictional)" is taken out of document titles and company legal
//      names: the synthetic marking lives on the documents themselves, not in
//      names investors read (directive: no repeated "fictional" warnings).
//
// Everything goes through the product's own HTTP API as the company's own
// seeded founder (no SQL writes):
//   withdraw     POST  /v1/documents/:id/archive  { archived: true }
//                (the documents page's Delete: a soft archive that can be
//                undone with { archived: false }; file and versions untouched)
//   rename       PATCH /v1/documents/:id          { title, expectedVersion }
//   legal name   PATCH /v1/companies/:id          { legalName, expectedVersion }
//
//   node scripts/seed/evidence/hygiene.mjs plan     # read-only: what would change
//   node scripts/seed/evidence/hygiene.mjs apply    # make the changes
//   node scripts/seed/evidence/hygiene.mjs restore <documentId>  # undo one withdrawal
//
// Safety: only the companies named in TARGETS. Each must have only current
// members whose auth accounts carry app_metadata.fictional_demo = synthetic =
// true (the product may notify them), and the founder's sign-in re-checks
// the marker. Nixo, Ledgerline, Baridi and non-fictional tenants are never
// written here. Withdrawals are by exact document id, chosen after reading
// each document's text (see the audit), never by pattern. Nothing is
// hard-deleted.
//
// Idempotent: the founder's own document list and company record are read
// before every write; a document already ARCHIVED, a title or legal name
// already clean, is skipped. Every write carries a stable Idempotency-Key.
//
// Environment (names only; never printed): SUPABASE_ACCESS_TOKEN (read-only
// SQL and the publishable key, in memory), CQ_SEED_ACCOUNT_PASSWORD,
// NODE_USE_ENV_PROXY=1. Optional CQ_API_URL, CQ_HYGIENE_REPORT. No model call.
import { writeFileSync } from "node:fs";

const API =
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app";
const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const HERE = new URL("./", import.meta.url).pathname;
const REPORT =
  process.env.CQ_HYGIENE_REPORT ?? `${HERE}out/hygiene-report.json`;

const CERTIFICATE = "imitates an official certificate or registry record";
const QA = "QA leftover from a test run";

/** Company -> documents to withdraw (exact ids, read and judged first). */
const TARGETS = {
  tensorgate: {
    name: "Tensorgate",
    slug: "tensorgate",
    withdraw: {
      "b938175b-0ac4-42a4-9d6a-2f7f2196a72c": CERTIFICATE, // Delaware Division of Corporations
    },
  },
  halyard: {
    name: "Halyard Security",
    slug: "halyard-security",
    withdraw: {
      "6986f460-585f-40e9-b2bc-f9fef2a12a44": CERTIFICATE, // Companies House (Scotland)
    },
  },
  medtrail: {
    name: "MedTrail",
    slug: "medtrail",
    withdraw: {
      "0e5b27c6-fb74-4000-b1ff-400d3a2b8e91": CERTIFICATE, // Corporate Affairs Commission
      "fe90f381-fee7-4b4f-a6a5-a4d37fdf482f": CERTIFICATE, // FIRS tax clearance
    },
  },
  mizan: {
    name: "Mizan",
    slug: "mizan",
    withdraw: {
      "36821319-247f-4434-a1d4-b49e702896ee": CERTIFICATE, // Commercial Registry, Cairo
      "da6ceaed-25e3-4b51-b853-1166f8134358": CERTIFICATE, // Egyptian Tax Authority
    },
  },
  "maji-loop": {
    name: "Maji Loop",
    slug: "maji-loop",
    withdraw: {
      "20cb4981-7621-4807-9034-c4650a1cbd4c": QA, // "Maji Loop deck QA 14 Nov"
      "fa3a911e-0bc4-4b35-a8fb-670253054e82": QA, // "Maji Loop deck QA 14 Nov b"
      "79f4fc66-8be9-42d7-bcbc-7c1743ac868e": QA, // "note": "Capital Q demo note"
    },
  },
  ajopot: {
    name: "Ajopot",
    slug: "ajopot",
    withdraw: {
      "6bbd1352-dc9e-49ec-9376-25da1597e1e9": QA, // "acceptance-note"
      "1facf3e3-96ed-4b69-ab3a-db5903df0d60": QA, // "acceptance-note"
    },
  },
  watchly: { name: "Watchly", slug: "watchly", withdraw: {} },
};

const FICTIONAL = /\s*\((?:fictional|Fictional)\)/g;
const clean = (s) =>
  s
    .replace(FICTIONAL, "")
    .replace(/\s{2,}/g, " ")
    .trim();
const short = (id) => String(id ?? "").slice(0, 8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- read-only SQL ---------------------------------------------------------------

async function sql(query) {
  if (!/^\s*select\b/i.test(query)) throw new Error("select only");
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("missing SUPABASE_ACCESS_TOKEN");
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
    await sleep(2000 * attempt);
  }
}
const uuid = (v) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(v))) throw new Error("not a uuid");
  return `'${v}'::uuid`;
};
const text = (v) => `'${String(v).replace(/'/g, "''")}'`;

// --- sign-in ---------------------------------------------------------------------

let publishable = null;
async function publicConfig() {
  if (publishable) return publishable;
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=false`,
    {
      headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    },
  );
  if (!r.ok) throw new Error(`api-keys HTTP ${r.status}`);
  const key = (await r.json()).find((k) => k.type === "publishable")?.api_key;
  if (!key) throw new Error("no publishable key");
  publishable = { url: `https://${PROJECT_REF}.supabase.co`, key };
  return publishable;
}

/** Password sign-in of a seeded fictional account. Never logs the email. */
async function signIn(email) {
  const password = process.env.CQ_SEED_ACCOUNT_PASSWORD;
  if (!password) throw new Error("missing CQ_SEED_ACCOUNT_PASSWORD");
  const { url, key } = await publicConfig();
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in refused: HTTP ${r.status}`);
  const body = await r.json();
  if (
    body.user?.app_metadata?.fictional_demo !== true ||
    body.user?.app_metadata?.synthetic !== true
  )
    throw new Error("signed-in account is not a seeded fictional account");
  return { token: body.access_token, authUserId: body.user.id };
}

async function call(token, method, path, body, idempotencyKey) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await r.text();
    let parsed = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep raw text
    }
    if (r.status >= 502 && r.status <= 504 && attempt < 3) {
      await sleep(3000 * attempt);
      continue;
    }
    return { status: r.status, body: parsed };
  }
}
const ok = (r) => r.status >= 200 && r.status < 300;
const brief = (r) => `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`;

// --- company and founder (read-only) -------------------------------------------

const MARKED = `u.raw_app_meta_data->>'fictional_demo' = 'true'
                and u.raw_app_meta_data->>'synthetic' = 'true'`;

async function resolveCompany(spec) {
  const [company] = await sql(
    `select id from core.companies
      where canonical_name = ${text(spec.name)} and slug = ${text(spec.slug)}`,
  );
  if (!company) throw new Error(`${spec.name}: company not found`);
  const [members] = await sql(
    `select count(*) filter (where not coalesce(${MARKED}, false)) as unmarked, count(*) as n
       from core.company_members m
       join identity.user_profiles p on p.id = m.user_id
       join auth.users u on u.id = p.auth_user_id
      where m.company_id = ${uuid(company.id)} and m.is_current`,
  );
  if (Number(members.unmarked) !== 0 || Number(members.n) === 0)
    throw new Error(`${spec.name}: a current member is not a fictional seed`);
  const founders = await sql(
    `select p.id as profile_id, u.id as auth_id, u.email
       from core.company_members m
       join identity.user_profiles p on p.id = m.user_id
       join auth.users u on u.id = p.auth_user_id
      where m.company_id = ${uuid(company.id)} and m.is_founder
        and m.is_current and ${MARKED}
      order by m.started_at nulls last, p.id`,
  );
  if (founders.length === 0)
    throw new Error(`${spec.name}: no seeded fictional founder`);
  return { id: company.id, founder: founders[0] };
}

async function ownDocuments(token, companyId) {
  const all = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ companyId, limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const r = await call(token, "GET", `/v1/documents?${q}`);
    if (r.status !== 200) throw new Error(`list documents: ${brief(r)}`);
    all.push(...r.body.documents);
    cursor = r.body.nextCursor;
    if (!cursor) break;
  }
  return all;
}

/** Archived documents drop out of the owner's list; read their state here. */
async function documentRows(ids) {
  if (ids.length === 0) return [];
  return sql(
    `select id, title, status, version from evidence.documents
      where id in (${ids.map(uuid).join(",")})`,
  );
}

// --- plan and apply ------------------------------------------------------------

async function runCompany(key, apply) {
  const spec = TARGETS[key];
  const company = await resolveCompany(spec);
  const session = await signIn(company.founder.email);
  if (session.authUserId !== company.founder.auth_id)
    throw new Error("signed in as a different account than resolved");
  const out = {
    key,
    companyId: company.id,
    withdraw: [],
    rename: [],
    legalName: null,
  };

  // Company legal name.
  const got = await call(session.token, "GET", `/v1/companies/${company.id}`);
  if (!ok(got)) throw new Error(`${key}: company ${brief(got)}`);
  const before = got.body.legalName;
  if (before && clean(before) !== before) {
    const change = { before, after: clean(before), action: "planned" };
    if (apply) {
      const r = await call(
        session.token,
        "PATCH",
        `/v1/companies/${company.id}`,
        { legalName: change.after, expectedVersion: got.body.version },
        `cq-evidence-hygiene-${key}-legal-name`,
      );
      change.action = ok(r) ? "updated" : "failed";
      change.status = r.status;
      if (!ok(r)) change.error = brief(r);
      else change.after = r.body.legalName ?? change.after;
    }
    out.legalName = change;
  } else {
    out.legalName = { before, after: before, action: "clean" };
  }

  // Documents: withdrawals by id, then "(fictional)" titles.
  const listed = await ownDocuments(session.token, company.id);
  const withdrawIds = Object.keys(spec.withdraw);
  const rows = await documentRows(withdrawIds);
  for (const id of withdrawIds) {
    const row = rows.find((r) => r.id === id);
    const entry = {
      documentId: id,
      title: row?.title ?? null,
      reason: spec.withdraw[id],
      statusBefore: row?.status ?? "MISSING",
    };
    if (!row) {
      entry.action = "missing";
    } else if (row.status === "ARCHIVED") {
      entry.action = "already-withdrawn";
      entry.statusAfter = "ARCHIVED";
    } else if (!apply) {
      entry.action = "planned";
    } else {
      const r = await call(
        session.token,
        "POST",
        `/v1/documents/${id}/archive`,
        { archived: true, expectedVersion: Number(row.version) },
        `cq-evidence-hygiene-withdraw-${id}`,
      );
      entry.action = ok(r) ? "withdrawn" : "failed";
      entry.status = r.status;
      entry.statusAfter = ok(r) ? r.body.status : row.status;
      if (!ok(r)) entry.error = brief(r);
    }
    out.withdraw.push(entry);
  }
  for (const doc of listed) {
    if (withdrawIds.includes(doc.id) || doc.status === "ARCHIVED") continue;
    if (clean(doc.title) === doc.title) continue;
    const entry = {
      documentId: doc.id,
      before: doc.title,
      after: clean(doc.title),
    };
    if (!apply) {
      entry.action = "planned";
    } else {
      const r = await call(
        session.token,
        "PATCH",
        `/v1/documents/${doc.id}`,
        { title: entry.after, expectedVersion: doc.version },
        `cq-evidence-hygiene-rename-${doc.id}`,
      );
      entry.action = ok(r) ? "renamed" : "failed";
      entry.status = r.status;
      if (ok(r)) entry.after = r.body.title;
      else entry.error = brief(r);
    }
    out.rename.push(entry);
  }
  return out;
}

async function restore(documentId) {
  const key = Object.keys(TARGETS).find(
    (k) => TARGETS[k].withdraw[documentId] !== undefined,
  );
  if (!key) throw new Error("not a document this script withdrew");
  const company = await resolveCompany(TARGETS[key]);
  const session = await signIn(company.founder.email);
  const [row] = await documentRows([documentId]);
  const r = await call(
    session.token,
    "POST",
    `/v1/documents/${documentId}/archive`,
    { archived: false, expectedVersion: Number(row.version) },
    `cq-evidence-hygiene-restore-${documentId}-${row.version}`,
  );
  console.log(`restore ${short(documentId)}: ${brief(r)}`);
}

/**
 * A fictional investor's view after withdrawal: each withdrawn document is
 * absent from the company's data room and does not open. Read-only.
 */
async function investorCheck() {
  const [rep] = await sql(
    `select u.id as auth_id, u.email from core.investor_representatives r
       join identity.user_profiles p on p.id = r.user_id
       join auth.users u on u.id = p.auth_user_id
      where r.investor_organisation_id = '1c4b9266-350c-409d-9582-04a0f771b8a8'
        and r.is_current and ${MARKED}
        and split_part(u.email, '@', 2) = 'fictional.capitalq.local'
      order by (u.email like 'investor.%') desc limit 1`,
  );
  const session = await signIn(rep.email);
  const results = [];
  for (const key of Object.keys(TARGETS)) {
    const company = await resolveCompany(TARGETS[key]);
    const room = await call(
      session.token,
      "GET",
      `/v1/companies/${company.id}/data-room`,
    );
    const roomText = JSON.stringify(room.body);
    for (const id of Object.keys(TARGETS[key].withdraw)) {
      const open = await call(
        session.token,
        "GET",
        `/v1/companies/${company.id}/data-room/documents/${id}/open`,
      );
      results.push({
        key,
        documentId: id,
        roomStatus: room.status,
        listed: roomText.includes(id),
        open: open.status,
      });
      console.log(
        `${key} ${short(id)}: room ${room.status} listed=${roomText.includes(id)} open=${open.status}`,
      );
    }
  }
  return results;
}

const [mode = "plan", arg] = process.argv.slice(2);
if (mode === "restore") {
  await restore(arg);
} else if (mode === "investor-check") {
  writeFileSync(
    `${HERE}out/hygiene-investor-check.json`,
    JSON.stringify(await investorCheck(), null, 2),
  );
} else if (mode === "plan" || mode === "apply") {
  const results = [];
  for (const key of Object.keys(TARGETS)) {
    const r = await runCompany(key, mode === "apply");
    results.push(r);
    console.log(
      `${key}: legal name ${r.legalName.action}; withdraw ${r.withdraw
        .map((w) => `${short(w.documentId)}:${w.action}`)
        .join(" ")}; rename ${r.rename.length} (${[
        ...new Set(r.rename.map((x) => x.action)),
      ].join(",")})`,
    );
  }
  writeFileSync(
    REPORT,
    JSON.stringify({ mode, at: new Date().toISOString(), results }, null, 2),
  );
  const failed = results.flatMap((r) =>
    [...r.withdraw, ...r.rename, r.legalName].filter(
      (x) => x.action === "failed",
    ),
  );
  if (failed.length) {
    console.log(`FAILED ${failed.length}`);
    process.exitCode = 1;
  }
} else {
  throw new Error("mode: plan | apply | restore <documentId>");
}
