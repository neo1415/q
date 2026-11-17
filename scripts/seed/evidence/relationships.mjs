// Phases 4, 5 and 8 of the owner directive of 16 Nov 2026
// (docs/ai-handoff/directives/2026-11-16-demo-evidence-data-room-seeding.md):
// the relationship, sharing, diligence, GateQ and mandate context for the
// synthetic evidence packs uploaded by upload.mjs, written ONLY through the
// product's own HTTP API, each step as the seeded fictional person whose
// action it is (investor or founder). Nothing here writes SQL.
//
//   node scripts/seed/evidence/relationships.mjs seed     [halyard|tensorgate|nixo|ajopot|watchly|maji-loop]
//   node scripts/seed/evidence/relationships.mjs mandates
//   node scripts/seed/evidence/relationships.mjs gateq-form       # no model call
//   node scripts/seed/evidence/relationships.mjs gateq-interview  # paid: 3 turns
//   node scripts/seed/evidence/relationships.mjs gateq-correct    # paid: 1 turn
//   node scripts/seed/evidence/relationships.mjs gateq-submit     # paid: synthesis
//   node scripts/seed/evidence/relationships.mjs verify   [halyard|tensorgate|nixo|ajopot|watchly|maji-loop]
//
// Pairs (scripts/seed/evidence/manifests/*.json `plannedShareWith`):
//   Halyard Security <-> Thames Arc Capital: the investor expresses interest,
//     the founder accepts, the investor records that diligence started.
//   Tensorgate <-> Savanna Seed Partners: the same, from DISCOVERED.
//   Nixo <-> Savanna Seed Partners: the same, from no relationship
//     (decision 99: Nixo is the owner's own account, seeded like the
//     fictional companies; see "Nixo" below).
// Then, per pair: the investor asks for one diligence document and the
// founder answers it with one of the planned documents; the investor asks for
// the bank statement, which stays OPEN (scenario D: the founder shares it
// live); and the founder shares each remaining planned document with that
// relationship through the data-room share (view only, watermarked, 90
// days, filed SHARED_ONLY in the manifest's folder). Every share is the
// founder's own request with its exact payload (document, relationship,
// access level, days); nothing widens a level for anyone else. Unplanned
// documents are not touched and stay founder-private.
//
// Safety: every account is resolved read-only and must carry the
// service-role markers app_metadata.fictional_demo = synthetic = true (the
// sign-in re-checks fictional_demo on the returned user). Every current
// member of both companies and every current representative of the investor
// must carry them too, or the pair is refused before any write, because the
// product notifies those people. Ledgerline, Baridi and non-fictional
// tenants are never named here. No meeting or calendar invite is created.
//
// Nixo (decision 99, 2026-11-16): the owner confirmed the Nixo founder
// account is theirs and asked for it to be seeded like the fictional
// companies. It carries no markers, so it is admitted by an allow-list of
// exactly one company id (UNMARKED_FOUNDER_ALLOW_LIST, as in upload.mjs):
// its current members may be unmarked, the founder signs in through a
// one-time admin sign-in link (generate_link type magiclink, no email sent,
// no password read or changed; the Supabase secret key is fetched with
// SUPABASE_ACCESS_TOKEN and kept in memory only), and the session must
// resolve to exactly that company's current founder. The investor side keeps
// every marker check.
//
// Idempotent: state is read before every write (relationship state through
// read-only SQL, diligence and access through the API), requests are keyed
// by their title, and every POST carries a stable Idempotency-Key
// (`cq-evidence-rel-<pair>-<step>`).
//
// Environment (names only; never printed): SUPABASE_ACCESS_TOKEN (read-only
// SQL and the publishable key, which is kept in memory), CQ_SEED_ACCOUNT_
// PASSWORD, NODE_USE_ENV_PROXY=1. Optional CQ_PUBLIC_JSON, CQ_API_URL,
// CQ_EVIDENCE_REL_REPORT. Logs only 8-character id prefixes.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const API =
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app";
const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const HERE = new URL("./", import.meta.url).pathname;
const REPORT =
  process.env.CQ_EVIDENCE_REL_REPORT ?? `${HERE}out/relationships-report.json`;

const THAMES_ARC = "cfbc217a-5ba2-407f-a684-084a96d892f7";
const SAVANNA = "1c4b9266-350c-409d-9582-04a0f771b8a8";
const NIXO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";

/**
 * Companies whose members may lack the fictional markers. Exactly one entry,
 * by company id: Nixo, under decision 99 (docs/ai-handoff/DECISIONS.md,
 * owner, 2026-11-16). Do not add to this list without a recorded owner
 * decision.
 */
const UNMARKED_FOUNDER_ALLOW_LIST = new Map([
  [
    NIXO,
    "decision 99 (2026-11-16): owner confirmed the Nixo founder account is theirs; session by one-time admin sign-in link, no password change",
  ],
]);

// The planned shares come from the committed manifests; this table names
// only the requests and the relationship each pair uses.
const PAIRS = {
  halyard: {
    company: { name: "Halyard Security", slug: "halyard-security" },
    investorId: THAMES_ARC,
    interestNote:
      "Passkeys for NHS trusts fits our UK security seed focus. We'd like to understand deployment margins and runway before the round closes.",
    answered: {
      title: "Capitalisation table and ownership",
      note: "Current cap table, plus how the July 2025 advance subscription converts at the seed.",
      documentId: "hs-cap-table",
      about: null,
    },
    pending: {
      title: "Business bank statements, Aug to Oct 2026",
      note: "To tie the 31 Oct 2026 cash in the management accounts to the bank.",
      about: {
        statement:
          "Cash of 388,070 at 31 Oct 2026 and runway of 4.2 months, as the management accounts state",
        standing: "REPORTED",
      },
    },
    // Scenario D: kept unshared and unrequested-to-fulfil.
    mustStayPrivate: ["hs-bank-statement"],
  },
  tensorgate: {
    company: { name: "Tensorgate", slug: "tensorgate" },
    investorId: SAVANNA,
    interestNote:
      "Inference cost control is squarely in our seed thesis. We'd like to look at contracted against billed revenue and the burn path.",
    answered: {
      title: "Customer contract summary",
      note: "Both paid contracts: start dates, billing start and annual value.",
      documentId: "tg-customer-contracts",
      about: {
        statement:
          "Contracted ARR of $360k against revenue billed from one customer until October 2026",
        standing: "REPORTED",
      },
    },
    pending: {
      title: "Business bank statements, Aug to Oct 2026",
      note: "To tie the October cash and burn to the bank.",
      about: null,
    },
    mustStayPrivate: ["tg-bank-statement"],
  },
  nixo: {
    company: { name: "Nixo", slug: "nixo", id: NIXO },
    investorId: SAVANNA,
    interestNote:
      "Tooling for forward-deployed engineering teams fits our seed thesis. We'd like to understand contracted against billed revenue and the team plan before the round closes.",
    answered: {
      title: "Customer contract summary",
      note: "Every paid contract: segment, start date, billing start, seats and annual value.",
      documentId: "nx-customer-contracts",
      about: {
        statement:
          "Contracted ARR of $1.08m against $864k of annualised billed subscriptions",
        standing: "REPORTED",
      },
    },
    pending: {
      title: "Business bank statements, Aug to Oct 2026",
      note: "To tie the 31 Oct 2026 cash and the burn in the management accounts to the bank.",
      about: null,
    },
    mustStayPrivate: ["nx-bank-statement"],
  },
  // The compact packs (compact.mjs, 17 Nov 2026): each manifest plans its
  // shares for Savanna; MedTrail and Mizan plan none and are not listed.
  // Ajopot is already IN_DILIGENCE; Watchly and Maji Loop are CONNECTED, so
  // Savanna records that diligence started (document requests need it).
  // The packs hold no bank statement: the pending request asks for one and
  // stays OPEN. Unplanned documents stay founder-private.
  ajopot: {
    company: {
      name: "Ajopot",
      slug: "ajopot",
      id: "91de2a77-fe47-4af0-8534-d9abf9c55949",
    },
    investorId: SAVANNA,
    interestNote:
      "Digitised rotating savings circles fit our seed thesis. We'd like to understand the fee take and the payouts before the round closes.",
    answered: {
      title: "Capitalisation table and ownership",
      note: "The current cap table and the option pool before the seed.",
      documentId: "aj-cap-table",
      about: null,
    },
    pending: {
      title: "Business bank statements, Aug to Oct 2026",
      note: "To tie the 31 Oct 2026 cash in the management accounts to the bank.",
      about: null,
    },
    mustStayPrivate: ["aj-payout-ledger"],
  },
  watchly: {
    company: {
      name: "Watchly",
      slug: "watchly",
      id: "526c2d72-9142-4e48-b106-ee4910f19318",
    },
    investorId: SAVANNA,
    interestNote:
      "Watchly fits our seed thesis. We'd like to understand the pilots and letters of intent against billed revenue.",
    answered: {
      title: "Customer, pilot and letter-of-intent summary",
      note: "Each paying customer, pilot and letter of intent, with start dates and value.",
      documentId: "wl-customer-contracts",
      about: null,
    },
    pending: {
      title: "Business bank statements, Aug to Oct 2026",
      note: "To tie the October cash and burn in the management accounts to the bank.",
      about: null,
    },
    mustStayPrivate: ["wl-invoice-register"],
  },
  "maji-loop": {
    company: {
      name: "Maji Loop",
      slug: "maji-loop",
      id: "01c554bf-8bf1-4eb7-b460-5d841764c40b",
    },
    investorId: SAVANNA,
    interestNote:
      "Maji Loop fits our seed thesis. We'd like to understand the utility contract and the kiosk economics.",
    answered: {
      title: "Utility service contract and kiosk sites summary",
      note: "The utility contract terms and the live kiosk sites.",
      documentId: "ml-customer-contracts",
      about: null,
    },
    pending: {
      title: "Business bank statements, Aug to Oct 2026",
      note: "To tie the 31 Oct 2026 cash in the management accounts to the bank.",
      about: null,
    },
    mustStayPrivate: [],
  },
};

const short = (id) => String(id ?? "").slice(0, 8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- read-only SQL (management API) -------------------------------------------

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

// --- sign-in --------------------------------------------------------------------

let publicConfigCache = null;
/** The public Supabase URL and publishable key, kept in memory only. */
async function publicConfig() {
  if (publicConfigCache) return publicConfigCache;
  if (process.env.CQ_PUBLIC_JSON) {
    const json = JSON.parse(readFileSync(process.env.CQ_PUBLIC_JSON, "utf8"));
    publicConfigCache = {
      url: json.NEXT_PUBLIC_SUPABASE_URL,
      key: json.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
    return publicConfigCache;
  }
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=false`,
    {
      headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    },
  );
  if (!r.ok) throw new Error(`api-keys HTTP ${r.status}`);
  const keys = await r.json();
  // The publishable key only; nothing else from that answer is kept.
  const publishable = keys.find((k) => k.type === "publishable");
  if (!publishable?.api_key) throw new Error("no publishable key");
  publicConfigCache = {
    url: `https://${PROJECT_REF}.supabase.co`,
    key: publishable.api_key,
  };
  return publicConfigCache;
}

const sessions = new Map();
/** Password sign-in, cached per account. Never logs the email. */
async function signIn(email) {
  if (sessions.has(email)) return sessions.get(email);
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
  const session = { token: body.access_token, authUserId: body.user.id };
  sessions.set(email, session);
  return session;
}

let adminKeys = null;
/**
 * Supabase secret and publishable keys from the management API, in memory
 * only (decision 78; decision 99 for Nixo). Never printed or persisted.
 */
async function supabaseAdminKeys() {
  if (adminKeys) return adminKeys;
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,
    {
      headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    },
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
 * The founder's session. An allow-listed company (Nixo only) signs in
 * through a one-time admin sign-in link (generate_link sends no email; no
 * password is read or changed) and must resolve to exactly its founder;
 * every other founder uses the marked password sign-in.
 */
async function founderSession(company) {
  if (!UNMARKED_FOUNDER_ALLOW_LIST.has(company.id))
    return signIn(company.founder.email);
  const cacheKey = `admin-link:${company.id}`;
  if (sessions.has(cacheKey)) return sessions.get(cacheKey);
  const { url } = await publicConfig();
  const { secret, publishable } = await supabaseAdminKeys();
  const link = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: company.founder.email }),
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
  if (body.user?.id !== company.founder.auth_id)
    throw new Error("signed-in account is not the allow-listed founder");
  const session = { token: body.access_token, authUserId: body.user.id };
  sessions.set(cacheKey, session);
  return session;
}

async function call(token, method, path, body, idempotencyKey, extra = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...extra,
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
    // A transient gateway error is retried with the same key (replay-safe).
    if (r.status >= 502 && r.status <= 504 && attempt < 3) {
      await sleep(3000 * attempt);
      continue;
    }
    return { status: r.status, body: parsed };
  }
}

const ok = (r) => r.status >= 200 && r.status < 300;
const brief = (r) => `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`;

// --- people (read-only) ---------------------------------------------------------

const MARKED = `u.raw_app_meta_data->>'fictional_demo' = 'true'
                and u.raw_app_meta_data->>'synthetic' = 'true'`;

async function resolveCompany(spec) {
  const [company] = await sql(
    `select id, tenant_id, organisation_id from core.companies
      where canonical_name = ${text(spec.name)} and slug = ${text(spec.slug)}
        ${spec.id ? `and id = ${uuid(spec.id)}` : ""}`,
  );
  if (!company) throw new Error(`${spec.name}: company not found`);
  // Only an allow-listed company id (Nixo, decision 99) skips the marker
  // checks below; it must still have exactly one current founder.
  if (UNMARKED_FOUNDER_ALLOW_LIST.has(company.id)) {
    const founders = await sql(
      `select p.id as profile_id, u.id as auth_id, u.email
         from core.company_members m
         join identity.user_profiles p on p.id = m.user_id
         join auth.users u on u.id = p.auth_user_id
        where m.company_id = ${uuid(company.id)}
          and m.is_founder and m.is_current`,
    );
    if (founders.length !== 1)
      throw new Error(`${spec.name}: expected exactly one current founder`);
    return { ...company, founder: founders[0] };
  }
  // Every current member must be a seeded fictional account: the product
  // notifies them when the investor acts.
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
    `select p.id as profile_id, u.id as auth_id, u.email,
            exists (select 1 from onboarding.sessions s
                     where s.user_id = p.id and s.subject_id = c.id) as onboarded
       from core.companies c
       join core.company_members m on m.company_id = c.id
                                  and m.is_founder and m.is_current
       join identity.user_profiles p on p.id = m.user_id
       join auth.users u on u.id = p.auth_user_id
      where c.id = ${uuid(company.id)} and ${MARKED}
      order by onboarded desc, m.started_at nulls last, p.id`,
  );
  if (founders.length === 0)
    throw new Error(`${spec.name}: no seeded fictional founder`);
  return { ...company, founder: founders[0] };
}

async function resolveInvestor(investorId) {
  const [org] = await sql(
    `select id, display_name, tenant_id from core.investor_organisations
      where id = ${uuid(investorId)}`,
  );
  if (!org) throw new Error(`investor ${short(investorId)} not found`);
  const reps = await sql(
    `select p.id as profile_id, u.id as auth_id, u.email, (${MARKED}) as marked,
            split_part(u.email, '@', 2) = 'fictional.capitalq.local' as fictional_domain
       from core.investor_representatives r
       join identity.user_profiles p on p.id = r.user_id
       join auth.users u on u.id = p.auth_user_id
      where r.investor_organisation_id = ${uuid(investorId)} and r.is_current
      order by (u.email like 'investor.%') desc, r.started_at nulls last, p.id`,
  );
  if (reps.length === 0 || reps.some((r) => !r.marked || !r.fictional_domain))
    throw new Error(
      `${org.display_name}: a current representative is not a fictional seed`,
    );
  return { ...org, rep: reps[0] };
}

async function relationshipRow(companyId, investorId) {
  const [row] = await sql(
    `select id, current_state from network.relationships
      where company_id = ${uuid(companyId)}
        and investor_organisation_id = ${uuid(investorId)}`,
  );
  return row ?? null;
}

function manifestFor(key) {
  return JSON.parse(readFileSync(`${HERE}manifests/${key}.json`, "utf8"));
}

/** Seed id -> document id, from the founder's own document list. */
async function founderDocuments(token, companyId, manifest) {
  const r = await call(
    token,
    "GET",
    `/v1/documents?companyId=${encodeURIComponent(companyId)}`,
  );
  if (r.status !== 200) throw new Error(`list documents: ${brief(r)}`);
  const byName = new Map(
    r.body.documents
      .filter((d) => d.currentVersion)
      .map((d) => [d.currentVersion.originalFilename, d.id]),
  );
  const ids = {};
  for (const doc of manifest.documents) {
    const id = byName.get(doc.fileName);
    if (!id) throw new Error(`${doc.id}: not uploaded (run upload.mjs)`);
    ids[doc.id] = id;
  }
  return ids;
}

// --- the relationship -----------------------------------------------------------

const MATCHED = new Set([
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
  "PASSED",
  "INVESTED",
]);

async function waitForState(companyId, investorId, wanted) {
  for (let i = 0; i < 15; i++) {
    const row = await relationshipRow(companyId, investorId);
    if (row && wanted.includes(row.current_state)) return row;
    await sleep(2000);
  }
  return relationshipRow(companyId, investorId);
}

async function ensureDiligence(key, company, investor, founder, rep, log) {
  let row = await relationshipRow(company.id, investor.id);
  log.push({ step: "relationship.before", state: row?.current_state ?? null });
  if (
    row &&
    ["DECLINED", "PAUSED", "PASSED", "INVESTED"].includes(row.current_state)
  )
    throw new Error(
      `${key}: relationship is ${row.current_state}; not changed`,
    );

  if (!row || ["DISCOVERED"].includes(row.current_state)) {
    const r = await call(
      rep.token,
      "POST",
      `/v1/network/companies/${company.id}/express-interest`,
      { surface: "COMPANY_PROFILE", note: PAIRS[key].interestNote },
      `cq-evidence-rel-${key}-interest`,
    );
    log.push({ step: "investor.express_interest", status: r.status });
    if (!ok(r)) throw new Error(`${key}: express interest ${brief(r)}`);
    row = await waitForState(company.id, investor.id, [
      "INTEREST_EXPRESSED",
      ...MATCHED,
    ]);
  }

  if (row?.current_state === "INTEREST_EXPRESSED") {
    const incoming = await call(
      founder.token,
      "GET",
      `/v1/network/companies/${company.id}/incoming-interest`,
    );
    if (!ok(incoming)) throw new Error(`${key}: incoming ${brief(incoming)}`);
    const item = incoming.body.items.find(
      (i) => i.investorOrganisationId === investor.id,
    );
    if (!item) throw new Error(`${key}: interest not in the founder's inbox`);
    const r = await call(
      founder.token,
      "POST",
      `/v1/network/interests/${item.interestId}/accept`,
      {},
      `cq-evidence-rel-${key}-accept`,
    );
    log.push({ step: "founder.accept_interest", status: r.status });
    if (!ok(r)) throw new Error(`${key}: accept ${brief(r)}`);
    row = await waitForState(company.id, investor.id, [...MATCHED]);
  }

  if (row && ["CONNECTED", "MEETING_HELD"].includes(row.current_state)) {
    const r = await call(
      rep.token,
      "POST",
      `/v1/network/relationships/${row.id}/meeting-outcome`,
      { outcome: "DILIGENCE" },
      `cq-evidence-rel-${key}-diligence`,
    );
    log.push({ step: "investor.diligence_started", status: r.status });
    if (!ok(r)) throw new Error(`${key}: diligence ${brief(r)}`);
    row = await waitForState(company.id, investor.id, ["IN_DILIGENCE"]);
  }
  if (row?.current_state !== "IN_DILIGENCE")
    throw new Error(`${key}: relationship is ${row?.current_state}`);
  log.push({ step: "relationship.after", state: row.current_state });
  return row.id;
}

// --- diligence ------------------------------------------------------------------

async function diligenceView(token, relationshipId) {
  const r = await call(
    token,
    "GET",
    `/v1/network/relationships/${relationshipId}/diligence`,
  );
  if (!ok(r)) throw new Error(`diligence view ${brief(r)}`);
  return r.body;
}

async function ensureRequest(key, which, relationshipId, rep, log) {
  const spec = PAIRS[key][which];
  const view = await diligenceView(rep.token, relationshipId);
  const found = view.requests.find((q) => q.title === spec.title);
  if (found) {
    log.push({
      step: `request.${which}`,
      action: "present",
      status: found.status,
    });
    return found;
  }
  const r = await call(
    rep.token,
    "POST",
    `/v1/network/relationships/${relationshipId}/diligence/requests`,
    {
      title: spec.title,
      note: spec.note,
      ...(spec.about ? { about: spec.about } : {}),
    },
    `cq-evidence-rel-${key}-request-${which}`,
  );
  log.push({ step: `investor.request.${which}`, status: r.status });
  if (!ok(r)) throw new Error(`${key}: request ${which} ${brief(r)}`);
  const after = await diligenceView(rep.token, relationshipId);
  return after.requests.find((q) => q.requestId === r.body.requestId);
}

// --- sharing ----------------------------------------------------------------------

async function access(token, documentId) {
  const r = await call(
    token,
    "GET",
    `/v1/data-room/documents/${documentId}/access`,
  );
  if (!ok(r)) throw new Error(`access ${short(documentId)} ${brief(r)}`);
  return r.body;
}

async function seedPair(key) {
  const spec = PAIRS[key];
  const manifest = manifestFor(key);
  const company = await resolveCompany(spec.company);
  const investor = await resolveInvestor(spec.investorId);
  if (
    manifest.plannedInvestor &&
    !investor.display_name.startsWith(manifest.plannedInvestor.split(" ")[0])
  )
    throw new Error(`${key}: manifest names ${manifest.plannedInvestor}`);
  const founder = await founderSession(company);
  if (founder.authUserId !== company.founder.auth_id)
    throw new Error("signed in as a different founder than resolved");
  const rep = await signIn(investor.rep.email);
  if (rep.authUserId !== investor.rep.auth_id)
    throw new Error("signed in as a different investor than resolved");
  console.log(
    `${key}: company ${short(company.id)} founder ${short(company.founder.profile_id)} investor ${short(investor.id)} rep ${short(investor.rep.profile_id)}`,
  );
  const log = [];
  const relationshipId = await ensureDiligence(
    key,
    company,
    investor,
    founder,
    rep,
    log,
  );
  console.log(`  relationship ${short(relationshipId)} IN_DILIGENCE`);
  const docs = await founderDocuments(founder.token, company.id, manifest);

  // 1. The answered request: asked by the investor, answered by the founder
  // with one planned document (a relationship_shared disclosure policy).
  const answered = await ensureRequest(
    key,
    "answered",
    relationshipId,
    rep,
    log,
  );
  if (answered.status === "OPEN") {
    const r = await call(
      founder.token,
      "POST",
      `/v1/network/relationships/${relationshipId}/diligence/requests/${answered.requestId}/fulfil`,
      { documentId: docs[spec.answered.documentId] },
      `cq-evidence-rel-${key}-fulfil-answered`,
    );
    log.push({ step: "founder.fulfil.answered", status: r.status });
    if (!ok(r)) throw new Error(`${key}: fulfil ${brief(r)}`);
  }
  // 2. The pending request: left OPEN for the live private-to-shared step.
  const pending = await ensureRequest(key, "pending", relationshipId, rep, log);
  if (pending.status !== "OPEN")
    log.push({ step: "request.pending", warning: `status ${pending.status}` });

  // 3. The other planned documents: the founder's data-room share with this
  // relationship, filed in the manifest's folder (SHARED_ONLY on filing).
  const shares = [];
  for (const doc of manifest.documents) {
    if (!doc.plannedShareWith) continue;
    if (spec.mustStayPrivate.includes(doc.id))
      throw new Error(
        `${doc.id}: planned share conflicts with mustStayPrivate`,
      );
    const documentId = docs[doc.id];
    const before = await access(founder.token, documentId);
    const has = before.grants.some((g) => g.relationshipId === relationshipId);
    if (doc.id === spec.answered.documentId || has) {
      shares.push({
        id: doc.id,
        documentId,
        action: has ? "present" : "via-request",
      });
      continue;
    }
    const r = await call(
      founder.token,
      "POST",
      `/v1/data-room/documents/${documentId}/grants`,
      {
        relationshipId,
        accessLevel: "view",
        days: 90,
        ...(before.level === "PRIVATE" ? { fileIn: doc.dataRoomFolder } : {}),
      },
      `cq-evidence-rel-${key}-grant-${doc.id}`,
    );
    shares.push({
      id: doc.id,
      documentId,
      action: "granted",
      status: r.status,
    });
    if (!ok(r)) throw new Error(`${key}: grant ${doc.id} ${brief(r)}`);
  }
  for (const s of shares)
    console.log(
      `  share ${s.id} (${short(s.documentId)}): ${s.action}${s.status ? ` ${s.status}` : ""}`,
    );
  return {
    key,
    companyId: company.id,
    investorId: investor.id,
    investorName: investor.display_name,
    relationshipId,
    log,
    shares,
    requests: {
      answered: answered.requestId,
      pending: pending.requestId,
    },
  };
}

// --- verify -------------------------------------------------------------------------

async function verifyPair(key, otherInvestorId) {
  const spec = PAIRS[key];
  const manifest = manifestFor(key);
  const company = await resolveCompany(spec.company);
  const investor = await resolveInvestor(spec.investorId);
  const other = await resolveInvestor(otherInvestorId);
  const founder = await founderSession(company);
  const rep = await signIn(investor.rep.email);
  const outsider = await signIn(other.rep.email);
  const row = await relationshipRow(company.id, investor.id);
  const docs = await founderDocuments(founder.token, company.id, manifest);
  const ids = Object.values(docs).map(uuid).join(",");
  const policies = await sql(
    `select dp.resource_id as document_id, dp.scope_type, dp.access_level,
            dp.recipient_type, dp.recipient_id, dp.expires_at, dp.revoked_at
       from permissions.disclosure_policies dp
      where dp.resource_id in (${ids}) and dp.revoked_at is null`,
  );
  const entries = await sql(
    `select de.document_id, de.level, de.visibility_scope, de.folder_code
       from evidence.data_room_entries de where de.document_id in (${ids})`,
  );
  const room = await call(
    rep.token,
    "GET",
    `/v1/companies/${company.id}/data-room`,
  );
  const roomText = JSON.stringify(room.body);
  const otherRoom = await call(
    outsider.token,
    "GET",
    `/v1/companies/${company.id}/data-room`,
  );
  const otherRoomText = JSON.stringify(otherRoom.body);
  const dil = await diligenceView(rep.token, row.id);
  const checks = [];
  for (const doc of manifest.documents) {
    const documentId = docs[doc.id];
    const planned = Boolean(doc.plannedShareWith);
    const open = await call(
      rep.token,
      "GET",
      `/v1/companies/${company.id}/data-room/documents/${documentId}/open`,
    );
    const download = await call(
      rep.token,
      "GET",
      `/v1/network/relationships/${row.id}/diligence/documents/${documentId}/download`,
    );
    const otherOpen = await call(
      outsider.token,
      "GET",
      `/v1/companies/${company.id}/data-room/documents/${documentId}/open`,
    );
    const otherGet = await call(
      outsider.token,
      "GET",
      `/v1/documents/${documentId}`,
    );
    const mine = policies.filter(
      (p) => p.document_id === documentId && p.recipient_id === row.id,
    );
    const foreign = policies.filter(
      (p) => p.document_id === documentId && p.recipient_id !== row.id,
    );
    checks.push({
      id: doc.id,
      documentId,
      planned,
      sensitivity: doc.defaultSensitivity,
      policies: mine.map(
        (p) =>
          `${p.scope_type}/${p.access_level}/${p.expires_at ? "expiry" : "no-expiry"}`,
      ),
      otherPolicies: foreign.length,
      entry: entries.find((e) => e.document_id === documentId) ?? null,
      investorRoomListed: roomText.includes(documentId),
      investorOpen: open.status,
      investorDiligenceShare: dil.shares.some(
        (s) => s.documentId === documentId,
      ),
      investorDiligenceDownload: download.status,
      otherRoomListed: otherRoomText.includes(documentId),
      otherOpen: otherOpen.status,
      otherGet: otherGet.status,
    });
  }
  const usage = await sql(
    `select task_class, purpose, count(*) as calls, coalesce(sum(cost_usd), 0) as usd
       from ai_ops.model_usage
      where occurred_at >= now() - interval '6 hours'
        and (tenant_id in (${uuid(company.tenant_id)}, ${uuid(investor.tenant_id)})
             or user_id in (${uuid(company.founder.profile_id)}, ${uuid(investor.rep.profile_id)}))
      group by 1, 2`,
  );
  return {
    key,
    relationshipId: row.id,
    state: row.current_state,
    investorRoomStatus: room.status,
    otherInvestor: other.display_name,
    otherRoomStatus: otherRoom.status,
    requests: dil.requests.map((q) => ({
      title: q.title,
      status: q.status,
      fulfilledBy: q.fulfilledBy?.documentId ?? null,
      about: q.about?.statement ?? null,
    })),
    shares: dil.shares.length,
    checks,
    modelUsageLast6h: usage,
  };
}

// --- mandates ---------------------------------------------------------------------

// Declared policy only (the investor's own words, through their mandate
// API). Observed behaviour and Q inference are never written here; they come
// from the product's own projections.
const MANDATE_ADDITIONS = {
  [SAVANNA]: {
    text: "Decision process: partner first call, a second call with the founders, then diligence on the data room; the investment committee meets fortnightly and decides within three weeks of diligence starting. Diligence needs: management accounts, bank statements for the last three months, cap table, customer contracts, the round terms and use of funds.",
    constraints: [
      [
        "custom.text",
        "text",
        "Decision: IC fortnightly; a decision within three weeks of diligence starting.",
        "NEUTRAL",
      ],
      [
        "custom.text",
        "text",
        "Diligence: management accounts, three months of bank statements, cap table, customer contracts, round terms.",
        "NEUTRAL",
      ],
    ],
  },
  [THAMES_ARC]: {
    text: "Decision process: an associate screen, a partner meeting, then diligence; the partnership decides weekly and issues terms within four weeks of diligence starting. Diligence needs: 18 months of management accounts, bank statements, the cap table including any advance subscriptions, and evidence of regulated or public-sector customer contracts.",
    constraints: [
      [
        "custom.text",
        "text",
        "Decision: partnership weekly; terms within four weeks of diligence starting.",
        "NEUTRAL",
      ],
      [
        "custom.text",
        "text",
        "Diligence: 18 months of management accounts, bank statements, cap table with advance subscriptions, regulated or public-sector contracts.",
        "NEUTRAL",
      ],
    ],
  },
};

async function enrichMandates() {
  const out = [];
  for (const [investorId, add] of Object.entries(MANDATE_ADDITIONS)) {
    const investor = await resolveInvestor(investorId);
    const rep = await signIn(investor.rep.email);
    const list = await call(
      rep.token,
      "GET",
      `/v1/investors/${investorId}/mandates`,
    );
    if (!ok(list)) throw new Error(`mandates ${brief(list)}`);
    const active = (list.body.items ?? []).filter((m) => m.status === "ACTIVE");
    if (active.length !== 1)
      throw new Error(
        `${investor.display_name}: ${active.length} active mandates`,
      );
    const one = await call(
      rep.token,
      "GET",
      `/v1/investors/${investorId}/mandates/${active[0].id}`,
    );
    if (!ok(one)) throw new Error(`mandate ${brief(one)}`);
    const m = one.body;
    const before = {
      rawChars: (m.rawMandateText ?? "").length,
      constraints: m.constraints.length,
      dimensions: [...new Set(m.constraints.map((c) => c.dimension))],
    };
    const raw = m.rawMandateText ?? "";
    const wanted = add.constraints.map(
      ([dimension, kind, value, importance]) => ({
        dimension,
        operator: kind === "codes" ? "IN" : "EQ",
        value:
          kind === "codes" ? { kind, values: value } : { kind, text: value },
        importance,
        isHardExclusion: false,
      }),
    );
    const same = (a, b) =>
      a.dimension === b.dimension &&
      JSON.stringify(a.value) === JSON.stringify(b.value);
    const kept = m.constraints
      .filter((c) => c.dimension !== "cheque.typical")
      .map((c) => ({
        dimension: c.dimension,
        operator: c.operator,
        value: c.value,
        importance: c.importance,
        isHardExclusion: c.isHardExclusion,
      }));
    const missing = wanted.filter((w) => !kept.some((k) => same(k, w)));
    const needsText = !raw.includes("Decision process:");
    if (missing.length === 0 && !needsText) {
      out.push({ investor: investor.display_name, action: "present", before });
      continue;
    }
    const r = await call(
      rep.token,
      "PATCH",
      `/v1/investors/${investorId}/mandates/${m.id}`,
      {
        expectedVersion: m.version,
        ...(needsText
          ? { rawMandateText: `${raw.trim()}\n\n${add.text}`.trim() }
          : {}),
        ...(missing.length ? { constraints: [...kept, ...missing] } : {}),
      },
      `cq-evidence-rel-mandate-${short(investorId)}-v${m.version}`,
    );
    out.push({
      investor: investor.display_name,
      action: "updated",
      status: r.status,
      before,
      added: missing.length,
      text: needsText,
      error: ok(r) ? undefined : brief(r),
    });
  }
  return out;
}

// --- GateQ: Halyard applies through Thames Arc's gate ----------------------------------
//
// Through the applicant's own routes, as Halyard's signed-in founder:
//   form (no model): stage first given as pre_seed (their last round), then
//     corrected to seed, the round they are raising: a FORM answer that
//     CORRECTS the earlier one, which stays as history (`superseded`);
//   interview (paid, reserved first): the deck's gross margin (82%) and the
//     management accounts' (29.3%, fixtures `hs-gross-margin`) said as two
//     sources, which the reader links as a disagreement; the founder then
//     leaves it open for the investor;
//   submit: the frozen dossier reaches Thames Arc's inbox, on the same
//     canonical relationship that holds the diligence requests.
const GATEQ = {
  key: "halyard",
  investorId: THAMES_ARC,
  form: {
    companyName: "Halyard Security",
    oneLiner:
      "Passkey rollout and phishing-resistant sign-in for NHS trusts and UK councils.",
    website: "https://halyard-security.example",
    sectors: ["Cybersecurity", "Public-sector SaaS"],
    country: "GB",
    raise: { amount: "3000000", currency: "GBP" },
    instrument: "EQUITY",
    lead: "LOOKING",
  },
  firstStage: "pre_seed",
  correctedStage: "seed",
  turns: [
    "Our pitch deck gives our gross margin as 82%.",
    "Our management accounts for the 12 months to October 2026 show a gross margin of 29.3%.",
    "Both are our figures from different documents. I'd rather leave that open for the investor to weigh: the deck figure is licence margin, and the accounts put the deployment team's payroll in cost of sales.",
  ],
  // Decision 100: the 29.3% note was stored split at the decimal point
  // ("…29." and "3%.", before fix 9cf769860). The founder restates it whole
  // in one turn, saying it is a correction, so the split notes are kept as
  // superseded history rather than deleted. The draft is corrected, not
  // restarted.
  correction:
    "Correction to my earlier answer, which got cut at the decimal point: our management accounts for the 12 months to October 2026 show a gross margin of 29.3%, not 29 and 3% as two notes, because the deployment team sits in cost of sales. The 82.0% in the pitch deck is licence margin.",
};

async function gateqApplication(mode) {
  const company = await resolveCompany(PAIRS[GATEQ.key].company);
  const investor = await resolveInvestor(GATEQ.investorId);
  const [gateway] = await sql(
    `select id, public_id, status from gateq.gateways
      where investor_organisation_id = ${uuid(investor.id)} and status = 'ACTIVE'`,
  );
  if (!gateway) throw new Error("Thames Arc has no active gateway");
  const founder = await signIn(company.founder.email);
  const [profile] = await sql(
    `select display_name from identity.user_profiles
      where id = ${uuid(company.founder.profile_id)}`,
  );
  const log = [];
  // Already sent: nothing to write.
  const mine = await call(founder.token, "GET", "/v1/gateq/my-applications");
  if (!ok(mine)) throw new Error(`my-applications ${brief(mine)}`);
  const sent = mine.body.applications.find(
    (a) => a.investorOrganisationId === investor.id,
  );
  if (sent) {
    log.push({
      step: "application",
      action: "already-submitted",
      id: sent.applicationId,
    });
    return { gatewayId: gateway.id, applicationId: sent.applicationId, log };
  }
  // The founder's own unsent draft is reopened; a first visit starts one.
  const started = await call(
    founder.token,
    "POST",
    "/v1/gateq/apply/account/start",
    { gatewayPublicId: gateway.public_id, mode: "form" },
    "cq-evidence-gateq-halyard-start",
  );
  if (!ok(started)) throw new Error(`start ${brief(started)}`);
  const guest = started.body.sessionToken;
  const reference = started.body.application.reference;
  log.push({ step: "founder.start", status: started.status, reference });
  const [app] = await sql(
    `select id, status from gateq.applications
      where gateway_id = ${uuid(gateway.id)} and public_reference = ${text(reference)}`,
  );
  const applicant = (method, path, body, key) =>
    call(guest, method, path, body, key);

  const coverage = async () => {
    const r = await applicant("GET", "/v1/gateq/apply/coverage");
    if (!ok(r)) throw new Error(`coverage ${brief(r)}`);
    return r.body;
  };
  let cov = await coverage();
  if (!cov.contact?.confirmed) {
    const r = await call(
      founder.token,
      "POST",
      "/v1/gateq/apply/contact/account",
      {
        name: profile?.display_name ?? "Founder",
        email: company.founder.email,
        role: "Co-founder and CEO",
        companyName: GATEQ.form.companyName,
        sessionToken: guest,
      },
      "cq-evidence-gateq-halyard-contact",
    );
    log.push({ step: "founder.contact_account", status: r.status });
    if (!ok(r)) throw new Error(`contact ${brief(r)}`);
  }
  // The form, then the founder's correction of the stage.
  const stage = cov.statements?.dimensions?.find(
    (d) => d.dimension === "company.stage",
  );
  const corrected = (stage?.superseded ?? []).some(
    (s) => s.via === "CORRECTION",
  );
  if (!corrected) {
    const first = await applicant(
      "POST",
      "/v1/gateq/apply/answers",
      { ...GATEQ.form, stage: GATEQ.firstStage },
      "cq-evidence-gateq-halyard-form-1",
    );
    log.push({ step: "founder.form", status: first.status });
    if (!ok(first)) throw new Error(`form ${brief(first)}`);
    const second = await applicant(
      "POST",
      "/v1/gateq/apply/answers",
      { stage: GATEQ.correctedStage },
      "cq-evidence-gateq-halyard-form-2",
    );
    log.push({ step: "founder.form_correction", status: second.status });
    if (!ok(second)) throw new Error(`correction ${brief(second)}`);
  }
  if (mode === "gateq-interview") {
    const open = await applicant("POST", "/v1/gateq/apply/interview/open", {});
    log.push({ step: "founder.interview_open", status: open.status });
    if (!ok(open)) throw new Error(`interview open ${brief(open)}`);
    for (const [i, message] of GATEQ.turns.entries()) {
      const r = await applicant("POST", "/v1/gateq/apply/turn", {
        message,
        clientTurnId: `cq-evidence-gateq-halyard-turn-${i + 1}`,
      });
      log.push({
        step: `founder.turn_${i + 1}`,
        status: r.status,
        deduplicated: r.body?.deduplicated,
      });
      if (!ok(r)) throw new Error(`turn ${i + 1} ${brief(r)}`);
    }
  }
  if (mode === "gateq-correct") {
    // The interview is already open on this draft; one turn, keyed so a
    // retry is the same turn and spends no second model call.
    const r = await applicant("POST", "/v1/gateq/apply/turn", {
      // Second correction (decision 100): the first, sent before the
      // supersession fix, stored no CORRECTS link; a new id is a new turn.
      message:
        "Correction: our management accounts for the 12 months to October 2026 show a gross margin of 29.3%, which replaces the two notes cut at the decimal point. The 82.0% in the pitch deck is licence margin, a different measure from gross margin.",
      clientTurnId: "cq-evidence-gateq-halyard-correct-margin-2",
    });
    log.push({
      step: "founder.correct_margin",
      status: r.status,
      deduplicated: r.body?.deduplicated,
      body: ok(r) ? undefined : brief(r),
    });
  }
  if (mode === "gateq-submit") {
    const r = await applicant("POST", "/v1/gateq/apply/submit", {
      clientRequestId: "cq-evidence-gateq-halyard-submit",
    });
    log.push({
      step: "founder.submit",
      status: r.status,
      body: ok(r) ? undefined : brief(r),
    });
  }
  cov = await coverage();
  const dims = (cov.statements?.dimensions ?? []).map((d) => ({
    dimension: d.dimension,
    status: d.status,
    statements: d.statements.map((s) => `${s.sourceKind}:${s.summary}`),
    superseded: d.superseded.map((s) => `${s.via}:${s.summary}`),
    disagreements: d.disagreements.map(
      (x) => `${x.state}${x.active ? "" : "(history)"}`,
    ),
  }));
  return {
    gatewayId: gateway.id,
    applicationId: app?.id ?? null,
    reference,
    log,
    dimensions: dims.filter((d) => d.statements.length || d.superseded.length),
  };
}

// --- main -----------------------------------------------------------------------------

const [mode = "verify", only] = process.argv.slice(2);
mkdirSync(`${HERE}out`, { recursive: true });
const report = existsSync(REPORT)
  ? JSON.parse(readFileSync(REPORT, "utf8"))
  : {};
const keys = only ? [only] : Object.keys(PAIRS);
for (const k of keys) if (!PAIRS[k]) throw new Error(`unknown pair ${k}`);

if (mode === "seed") {
  report.seedStartedAt ??= new Date().toISOString();
  report.seed ??= {};
  for (const key of keys) report.seed[key] = await seedPair(key);
} else if (mode === "mandates") {
  report.mandates = await enrichMandates();
  console.log(JSON.stringify(report.mandates, null, 1));
} else if (mode === "verify") {
  const outsider = {
    halyard: SAVANNA,
    tensorgate: THAMES_ARC,
    nixo: THAMES_ARC,
    ajopot: THAMES_ARC,
    watchly: THAMES_ARC,
    "maji-loop": THAMES_ARC,
  };
  report.verify ??= {};
  for (const key of keys)
    report.verify[key] = await verifyPair(key, outsider[key]);
  for (const v of keys.map((key) => report.verify[key])) {
    const leaks = v.checks.filter(
      (c) =>
        c.otherRoomListed ||
        c.otherPolicies > 0 ||
        [c.otherOpen, c.otherGet].some((s) => s >= 200 && s < 300) ||
        (!c.planned &&
          (c.investorRoomListed ||
            c.investorDiligenceShare ||
            c.policies.length > 0)),
    );
    const missing = v.checks.filter(
      (c) =>
        c.planned &&
        (c.policies.length === 0 ||
          (c.investorOpen !== 200 && c.investorDiligenceDownload !== 200)),
    );
    console.log(
      `${v.key}: ${v.state}; requests ${v.requests.map((q) => q.status).join("/")}; planned shared ${v.checks.filter((c) => c.planned).length - missing.length}/${v.checks.filter((c) => c.planned).length}; leaks ${leaks.length}`,
    );
  }
} else if (mode.startsWith("gateq-")) {
  const gateqModes = [
    "gateq-form",
    "gateq-interview",
    "gateq-correct",
    "gateq-submit",
  ];
  if (!gateqModes.includes(mode))
    throw new Error(`mode: ${gateqModes.join(" | ")}`);
  report.gateq ??= {};
  report.gateq[mode] = await gateqApplication(mode);
  console.log(JSON.stringify(report.gateq[mode], null, 1));
} else {
  throw new Error(
    "mode: seed | mandates | verify | gateq-form | gateq-interview | gateq-correct | gateq-submit",
  );
}
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`report: ${REPORT}`);
