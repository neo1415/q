#!/usr/bin/env node
/**
 * Seeds the bulk fictional demo world (world.mjs, fictional-bulk.v1) into
 * the attested synthetic staging project through the product's own HTTP
 * API, under each fictional person's own session. Nothing here writes a
 * table: accounts come from the Supabase admin API (as dev:bootstrap does)
 * and everything a person owns is written by the route a browser calls,
 * under the same authorization.
 *
 *   /root/sb node scripts/seed/fictional-bulk/seed.mjs --hosted \
 *     --companies 1-20 [--investors all|none|<key,...>] [--concurrency 2]
 *
 * Strict target checks (refuses anything else):
 *   - --hosted is required, and the Supabase project must be the attested
 *     synthetic ref (CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF must equal it);
 *   - Railway must show q-api and workers in CAPITAL_Q_ENV=staging with
 *     CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED=true for that same ref;
 *   - the deployed workers revision must carry the fictional-account
 *     presence guard, or every company name would buy a paid web search.
 *
 * Idempotent: every person is found by email before being created (and
 * only adopted when it carries this seed's markers), the onboarding journey
 * resumes where it stopped, documents are matched by title, and per-step
 * progress (ids only) lives in docs/seed/fictional-bulk/seed-state.json.
 *
 * Model and paid-provider calls: none by this script. Narrative onboarding
 * steps are skipped (their text goes on the profile instead) so the
 * deployment's onboarding readers have nothing to read, and documents are
 * uploaded only after the journey completes, when no review runs.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import * as lib from "../tavus20/lib.mjs";
import {
  buildWorld,
  currencyCode,
  documentText,
  SEED_MARKER,
  storyText,
} from "./world.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const hosted = args.includes("--hosted");
const companyRange = opt("--companies", "none");
const investorsArg = opt("--investors", "none");
const concurrency = Math.max(1, Math.min(4, Number(opt("--concurrency", "2"))));
const worldCount = Number(opt("--world", "400"));
const STATE_FILE = join(lib.ROOT, "docs/seed/fictional-bulk/seed-state.json");

// ---------------------------------------------------------------- target

async function railway(query, variables = {}) {
  const r = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RAILWAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors)
    throw new Error(`railway: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j.data;
}

/** Every check is a refusal unless it positively passes. */
export async function assertSyntheticTarget() {
  if (!hosted)
    throw new Error(
      "refusing: pass --hosted (this seed writes only to the hosted synthetic project)",
    );
  const declared =
    process.env.CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  if (declared !== lib.PROJECT_REF) {
    throw new Error(
      "refusing: CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF must name the attested synthetic project this seed targets",
    );
  }
  if (!process.env.RAILWAY_TOKEN)
    throw new Error(
      "refusing: RAILWAY_TOKEN is needed to confirm the deployment's attestation",
    );
  const data = await railway(
    `{ projects { edges { node { id name environments { edges { node { id name } } } services { edges { node { id name } } } } } } }`,
  );
  const project = data.projects.edges
    .map((e) => e.node)
    .find((p) =>
      p.services.edges.some((s) => s.node.name === "@capital-q/workers"),
    );
  if (!project)
    throw new Error("refusing: no Railway project with the workers service");
  const env = project.environments.edges
    .map((e) => e.node)
    .find((e) => e.name === "production");
  const service = (name) =>
    project.services.edges.map((s) => s.node).find((s) => s.name === name);
  for (const name of ["@capital-q/workers", "@capital-q/q-api"]) {
    const s = service(name);
    const v = (
      await railway(
        `query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,
        { p: project.id, e: env.id, s: s.id },
      )
    ).variables;
    const ok =
      v.CAPITAL_Q_ENV === "staging" &&
      v.CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED === "true" &&
      v.CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF?.toLowerCase() ===
        lib.PROJECT_REF &&
      v.SUPABASE_URL === lib.SB_URL;
    if (!ok)
      throw new Error(
        `refusing: ${name} is not attested synthetic staging on ${lib.PROJECT_REF}`,
      );
  }
  // The deployed workers revision must skip presence research for
  // fictional accounts (claude/d-presence-fictional-oct15).
  const workers = service("@capital-q/workers");
  const deps = await railway(
    `query($s:String!,$e:String!){ deployments(first: 1, input: { serviceId: $s, environmentId: $e, status: { in: [SUCCESS] } }) { edges { node { id meta } } } }`,
    { s: workers.id, e: env.id },
  );
  const sha = deps.deployments.edges[0]?.node?.meta?.commitHash;
  if (!sha)
    throw new Error("refusing: cannot read the deployed workers revision");
  let source = "";
  try {
    execFileSync("git", ["-C", lib.ROOT, "fetch", "-q", "origin", sha], {
      stdio: "ignore",
    });
    source = execFileSync(
      "git",
      ["-C", lib.ROOT, "show", `${sha}:apps/workers/src/presence/dispatch.ts`],
      { encoding: "utf8" },
    );
  } catch {
    throw new Error(
      `refusing: cannot read the deployed workers source at ${sha.slice(0, 8)}`,
    );
  }
  if (!source.includes("isFictionalAccount")) {
    throw new Error(
      `refusing: deployed workers ${sha.slice(0, 8)} lack the fictional-account presence guard (paid web search per company)`,
    );
  }
  return { workersSha: sha };
}

// ------------------------------------------------------------- plumbing

const loadState = () =>
  existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
    : { marker: SEED_MARKER, companies: {}, investors: {} };
let state = loadState();
let saving = Promise.resolve();
function save() {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  saving = saving.then(() =>
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`),
  );
  return saving;
}
const idem = (...parts) => {
  const h = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

async function admin(path, init = {}) {
  const k = await lib.supabaseKeys();
  return fetch(`${lib.SB_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: k.secret,
      authorization: `Bearer ${k.secret}`,
      "content-type": "application/json",
    },
  });
}

/** Create, or adopt only when it carries this seed's markers. */
async function ensureAccount(person, seedKey) {
  const rows = await lib.sql(
    `select id, raw_app_meta_data->>'cq_seed' as seed, raw_app_meta_data->>'fictional_demo' as fd from auth.users where lower(email)=lower('${person.email.replace(/'/g, "''")}')`,
  );
  if (rows[0]) {
    if (rows[0].seed !== SEED_MARKER || rows[0].fd !== "true")
      throw new Error(
        `${person.email} exists without this seed's markers; refusing to touch it`,
      );
    return rows[0].id;
  }
  const r = await admin("/users", {
    method: "POST",
    body: JSON.stringify({
      email: person.email,
      password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: {
        display_name: person.displayName,
        full_name: person.displayName,
        synthetic: true,
        fictional_demo: true,
        fictional_seed_key: seedKey,
      },
      app_metadata: {
        synthetic: true,
        fictional_demo: true,
        cq_seed: SEED_MARKER,
      },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `create ${person.email}: HTTP ${r.status} ${body.msg ?? body.error_code ?? ""}`,
    );
  return body.id;
}

const tokens = new Map();
async function tokenFor(email) {
  const hit = tokens.get(email);
  if (hit && hit.at > Date.now() - 40 * 60_000) return hit.token;
  const token = await lib.accessToken(email);
  tokens.set(email, { token, at: Date.now() });
  return token;
}

/** One call; 5xx and 429 are retried with backoff, anything else non-2xx throws. */
async function ok(base, email, method, path, body, key) {
  for (let attempt = 0; ; attempt += 1) {
    const r = await lib.call(
      base,
      await tokenFor(email),
      method,
      path,
      body,
      key,
    );
    if (r.status >= 200 && r.status < 300) return r.body;
    if ((r.status >= 500 || r.status === 429) && attempt < 3) {
      await lib.sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(
      `${method} ${path}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`,
    );
  }
}
const api = (email, method, path, body, key) =>
  ok(lib.API, email, method, path, body, key);
const qapi = (email, method, path, body, key) =>
  ok(lib.QAPI, email, method, path, body, key);
const get = async (base, email, path) =>
  lib.call(base, await tokenFor(email), "GET", path);

let taxonomy = null;
/** canonical code → node ids, by vocabulary ("industry:fintech"), read once. */
async function loadTaxonomy(email) {
  if (taxonomy) return taxonomy;
  const map = new Map();
  for (const voc of [
    "industry",
    "product_category",
    "business_model",
    "customer_type",
    "geography",
  ]) {
    let cursor;
    for (let guard = 0; guard < 20; guard += 1) {
      const q = new URLSearchParams({ limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const page = await api(
        email,
        "GET",
        `/v1/taxonomy/vocabularies/${voc}/nodes?${q}`,
      );
      for (const n of page.items ?? [])
        map.set(`${voc}:${n.canonicalCode}`, n.id);
      if (typeof page.nextCursor !== "string") break;
      cursor = page.nextCursor;
    }
  }
  taxonomy = map;
  return map;
}
/** Node ids for codes across the given vocabularies; a code in two vocabularies yields both. */
function nodeIds(map, codes, vocabularies) {
  const ids = [];
  for (const code of codes) {
    const found = vocabularies
      .map((v) => map.get(`${v}:${code}`))
      .filter(Boolean);
    if (found.length === 0)
      throw new Error(`no taxonomy node ${code} in ${vocabularies.join("/")}`);
    ids.push(...found);
  }
  return [...new Set(ids)];
}

const sel = (optionKey) => ({ value: { type: "SINGLE_SELECT", optionKey } });
const multi = (keys) =>
  keys.length === 0
    ? "skip"
    : { value: { type: "MULTI_SELECT", optionKeys: [...keys] } };
const text = (t) => ({ value: { type: "TEXT", text: t } });
const range = (v) => ({ value: { type: "RANGE", value: String(v) } });
const confirm = { value: { type: "CONFIRMATION", confirmed: true } };
const refs = (resourceType, ids) =>
  ids.length === 0
    ? "skip"
    : {
        value: {
          type: "RESOURCE_REFERENCE",
          resourceType,
          resourceIds: [...ids],
        },
      };
const maybe = (v, f) => (v === undefined ? "skip" : f(v));

async function driveJourney(email, journeyType, answerFor) {
  const current = await get(
    lib.API,
    email,
    `/v1/onboarding/sessions/current?journeyType=${journeyType}`,
  );
  let view =
    current.status === 200
      ? current.body
      : await api(email, "POST", "/v1/onboarding/sessions", { journeyType });
  for (let guard = 0; guard < 90; guard += 1) {
    if (view.session.status === "COMPLETED") break;
    const path = `/v1/onboarding/sessions/${view.session.id}`;
    const expectedSessionVersion = view.session.version;
    if (view.progress.canComplete) {
      view = await api(email, "POST", `${path}/complete`, {
        expectedSessionVersion,
      });
      continue;
    }
    const step = view.currentStep;
    if (!step) break;
    const answer = await answerFor(step);
    if ((answer === null || answer === "skip") && step.required)
      throw new Error(
        `${journeyType} step ${step.stepKey} is required and has no scripted answer`,
      );
    view =
      answer === null || answer === "skip"
        ? await api(
            email,
            "POST",
            `${path}/steps/${encodeURIComponent(step.stepKey)}/skip`,
            { expectedSessionVersion },
          )
        : await api(email, "POST", `${path}/responses`, {
            stepKey: step.stepKey,
            response: {
              value: answer.value,
              sourceModality:
                answer.value.type === "TEXT" ? "TYPED_TEXT" : "SELECTION",
            },
            expectedSessionVersion,
          });
  }
  if (view.session.status !== "COMPLETED")
    throw new Error(
      `${journeyType} journey stopped at ${view.currentStep?.stepKey ?? "?"}`,
    );
  return view;
}

// ------------------------------------------------------------ founders

function founderAnswers(c, map) {
  const t = c.traction;
  const f = c.fin;
  return async (step) => {
    switch (step.stepKey) {
      case "F0.intent":
        return sel(c.intent);
      case "F1.company_name":
        return text(c.name);
      case "F1.website":
        return text(c.website);
      case "F1.country":
        return sel(c.countryOption);
      case "F1.stage":
        return sel(c.stageOption);
      // Narrative steps are skipped: their text goes on the profile, so no
      // onboarding reader (a model call) has anything to read.
      case "F1.description":
        return "skip";
      case "F1.categories":
        return refs(
          "TAXONOMY_NODE",
          nodeIds(map, c.categories, [
            "industry",
            "product_category",
            "business_model",
            "customer_type",
          ]).slice(0, 8),
        );
      case "F2.materials":
        return "skip";
      case "F3.review":
      case "F6.confirm":
      case "F8.snapshot":
        return confirm;
      case "F4.founder_role":
        return sel(c.founder.roleOption);
      case "F4.founder_count":
        return range(c.team.founderCount);
      case "F4.full_time":
        return sel(c.team.fullTimeOption);
      case "F4.team_size":
        return range(c.team.teamSize);
      case "F4.functions":
        return multi(c.team.functions);
      case "F5.signal":
        return sel(t.signal ?? "none");
      case "F5.pilots":
        return maybe(t.pilots, range);
      case "F5.revenue_status":
        return sel(t.revenueStatus ?? "early");
      case "F5.customers":
        return maybe(t.customers, range);
      case "F5.growth":
        return maybe(t.growth, sel);
      case "F5.fin_currency":
        return maybe(f.currency, sel);
      case "F5.monthly_revenue":
        return maybe(f.monthlyRevenue, range);
      case "F5.revenue_trend":
        return maybe(f.revenueTrend, sel);
      case "F5.gross_margin":
        return maybe(f.grossMargin, range);
      case "F5.monthly_burn":
        return maybe(f.monthlyBurn, range);
      case "F5.cash":
        return maybe(f.cash, range);
      case "F5.runway_months":
        return maybe(f.runwayMonths, range);
      case "F6.raising":
        return sel(c.raise.raising);
      case "F6.currency":
        return sel(c.raise.currencyOption);
      case "F6.target_amount":
        return range(c.raise.target.amount);
      case "F6.instrument":
        return sel(c.raise.instrument);
      case "F6.timeframe":
        return sel(c.raise.timeframe);
      case "F6.use_of_funds":
        return multi(c.raise.useOfFunds);
      case "F6.min_cheque":
        return maybe(c.raise.minCheque, range);
      case "F7.follow_up":
        return "skip";
      default:
        return step.required ? null : "skip";
    }
  };
}

async function ensureProfile(email, person) {
  const p = await api(email, "GET", "/v1/me/profile");
  if (p.displayName === person.displayName && p.headline === person.headline)
    return;
  await api(email, "PATCH", "/v1/me/profile", {
    expectedVersion: p.version,
    displayName: person.displayName,
    headline: person.headline,
  });
}
async function patchIfChanged(email, path, wanted) {
  const cur = await get(lib.API, email, path);
  const body = cur.status === 200 ? cur.body : {};
  const changes = Object.fromEntries(
    Object.entries(wanted).filter(([k, v]) => body[k] !== v),
  );
  if (Object.keys(changes).length === 0) return;
  await api(email, "PATCH", path, {
    ...(typeof body.version === "number"
      ? { expectedVersion: body.version }
      : {}),
    ...changes,
  });
}

const timeframeClose = {
  under_3: "2026-12-31",
  "3_6": "2027-03-31",
  "6_12": "2027-09-30",
};

async function uploadDocument(email, companyId, c, doc) {
  const bytes = Buffer.from(documentText(c, doc), "utf8");
  const created = await api(
    email,
    "POST",
    "/v1/documents/upload-sessions",
    {
      companyId,
      documentType: doc.kind,
      title: doc.title,
      filename: doc.filename,
      declaredMimeType: doc.mime,
      declaredSizeBytes: bytes.length,
    },
    idem(c.seedKey, "doc", doc.filename),
  );
  if (created.upload) {
    const put = await fetch(created.upload.url, {
      method: "PUT",
      headers: created.upload.headers,
      body: bytes,
    });
    if (!put.ok) throw new Error(`upload ${doc.filename}: HTTP ${put.status}`);
  }
  if (
    ["PENDING_AUTHORIZATION", "AUTHORIZED"].includes(
      created.uploadSession.status,
    )
  ) {
    await api(
      email,
      "POST",
      `/v1/documents/upload-sessions/${created.uploadSession.id}/complete`,
      { clientSha256: createHash("sha256").update(bytes).digest("hex") },
    );
  }
  return created.document.id;
}

async function seedCompany(c) {
  const s = (state.companies[c.key] ??= { name: c.name, steps: {} });
  const done = (step, extra = {}) => {
    Object.assign(s, extra);
    s.steps[step] = true;
    return save();
  };
  const f = c.founder.email;

  if (!s.steps.accounts) {
    s.founderUserId = await ensureAccount(c.founder, c.seedKey);
    s.memberUserIds = [];
    for (const m of c.members)
      s.memberUserIds.push(await ensureAccount(m, `${c.seedKey}:member`));
    await done("accounts");
  }
  if (!s.steps.journey) {
    await ensureProfile(f, c.founder);
    const map = await loadTaxonomy(f);
    const view = await driveJourney(f, "founder", founderAnswers(c, map));
    const companyId = view.session.subject?.id;
    if (!companyId) throw new Error("the founder journey bound no company");
    await done("journey", { companyId });
  }
  const base = `/v1/companies/${s.companyId}`;
  if (!s.steps.profile) {
    const cur = await api(f, "GET", base);
    const wanted = {
      legalName: c.legalName,
      websiteUrl: c.website,
      foundedDate: c.foundedDate,
      headquartersCountry: c.country,
      headquartersCity: c.city,
      shortDescription: c.shortDescription,
      primaryDescription: storyText(c),
    };
    const changes = Object.fromEntries(
      Object.entries(wanted).filter(([k, v]) => cur[k] !== v),
    );
    if (cur.currentStageCode === null && c.stageOption !== "unsure")
      changes.currentStageCode = c.stageOption;
    if (Object.keys(changes).length > 0)
      await api(f, "PATCH", base, { expectedVersion: cur.version, ...changes });
    await api(f, "PUT", `${base}/team/me`, {
      relationshipType: "team_member",
      businessTitle: c.founder.businessTitle,
      isFounder: true,
    });
    await patchIfChanged(f, `${base}/founder-profile/me`, {
      professionalSummary: c.founder.professionalSummary,
      backgroundSummary: c.founder.backgroundSummary,
    });
    await patchIfChanged(f, `${base}/team-facts`, {
      founderCount: c.team.founderCount,
      fullTimeFounderCount: c.team.fullTimeFounderCount,
      teamSize: c.team.teamSize,
    });
    await done("profile");
  }
  if (!s.steps.capital) {
    const cur = await get(lib.API, f, `${base}/capital-objectives/current`);
    if (cur.status !== 200)
      throw new Error(
        `no capital objective after the journey (HTTP ${cur.status})`,
      );
    const summary =
      `${c.raise.useOfFunds.map((u) => ({ product: "Product and engineering", hiring: "Key hires", gtm: "Sales and go-to-market", runway: "Runway", expansion: "New markets" })[u]).join("; ")}. ${c.story.raise}`.slice(
        0,
        1000,
      );
    const close = timeframeClose[c.raise.timeframe] ?? null;
    if (
      cur.body.useOfFundsSummary !== summary ||
      (close && cur.body.targetCloseDate !== close)
    ) {
      await api(f, "PATCH", `${base}/capital-objectives/${cur.body.id}`, {
        expectedVersion: cur.body.version,
        useOfFundsSummary: summary,
        ...(close ? { targetCloseDate: close } : {}),
      });
    }
    await done("capital", { capitalObjectiveId: cur.body.id });
  }
  if (!s.steps.documents) {
    const listed = await api(
      f,
      "GET",
      `/v1/documents?companyId=${s.companyId}`,
    ).catch(() => ({ items: [] }));
    const have = new Set(
      (listed.items ?? listed.documents ?? []).map((d) => d.title),
    );
    s.documentIds = s.documentIds ?? {};
    for (const doc of c.documents) {
      if (have.has(doc.title) && s.documentIds[doc.filename]) continue;
      s.documentIds[doc.filename] = await uploadDocument(
        f,
        s.companyId,
        c,
        doc,
      );
    }
    await done("documents");
  }
  if (!s.steps.q) {
    await qapi(f, "PUT", "/v1/q/standing/personality", {
      personality: c.q.personality,
    });
    await api(f, "PUT", "/v1/me/etiquette-guide", {
      sourceKind: "PASTE",
      text: c.q.guide,
    });
    // Fictional addresses receive no email, and an invented person needs no
    // weekly edition (each is a model call): Daily is off for them.
    await qapi(f, "PUT", "/v1/q/daily/preferences", {
      frequency: "OFF",
      email: false,
    });
    await done("q");
  }
  if (!s.steps.team) {
    const team = await api(f, "GET", "/v1/team");
    const orgId = team.organisation.organisationId;
    const inTeam = new Set(team.members.map((m) => m.email?.toLowerCase()));
    for (const m of c.members) {
      if (inTeam.has(m.email.toLowerCase())) continue;
      await ensureProfile(m.email, m);
      const pending = team.joinRequests.find(
        (j) => j.email?.toLowerCase() === m.email.toLowerCase(),
      );
      if (!pending)
        await api(
          m.email,
          "POST",
          "/v1/join-requests",
          {
            organisationId: orgId,
            message: `${m.displayName}, ${m.businessTitle}.`,
          },
          idem(c.seedKey, "join", m.email),
        );
    }
    const after = await api(f, "GET", "/v1/team");
    for (const j of after.joinRequests) {
      if (
        c.members.some((m) => m.email.toLowerCase() === j.email?.toLowerCase())
      ) {
        await api(f, "POST", `/v1/team/join-requests/${j.requestId}/decision`, {
          approve: true,
        });
      }
    }
    const final = await api(f, "GET", "/v1/team");
    for (const m of c.members) {
      const row = final.members.find(
        (x) => x.email?.toLowerCase() === m.email.toLowerCase(),
      );
      if (!row) throw new Error(`${m.email} is not on the team after approval`);
      if (m.appRole === "ADMIN" && row.role !== "ADMIN")
        await api(f, "PUT", `/v1/team/members/${row.membershipId}/role`, {
          role: "ADMIN",
        });
      await api(m.email, "POST", `/v1/organisations/${orgId}/activate`, {});
      tokens.delete(m.email);
      await api(m.email, "PUT", `${base}/team/me`, {
        relationshipType: "team_member",
        businessTitle: m.businessTitle,
        isFounder: m.isFounder,
      });
      await qapi(m.email, "PUT", "/v1/q/daily/preferences", {
        frequency: "OFF",
        email: false,
      });
    }
    await done("team", { organisationId: orgId });
  }
  if (!s.steps.visible) {
    const cur = await api(f, "GET", base);
    if (cur.marketplaceVisibility !== "network_visible") {
      await api(f, "POST", `${base}/visibility`, {
        visibility: "network_visible",
        expectedVersion: cur.version,
      });
    }
    await api(f, "POST", `${base}/marketplace-readiness/assess`, {}).catch(
      (e) =>
        console.log(
          `  [${c.key}] readiness assess: ${e.message.slice(0, 120)}`,
        ),
    );
    const after = await api(f, "GET", base);
    await done("visible", {
      visibility: after.marketplaceVisibility,
      readiness: after.marketplaceReadinessState,
    });
  }
  return s;
}

// ----------------------------------------------------------- investors

function investorAnswers(inv, map) {
  const tax = (codes, vocs) => refs("TAXONOMY_NODE", nodeIds(map, codes, vocs));
  return async (step) => {
    switch (step.stepKey) {
      case "I0.investor_type":
        return sel(inv.type);
      case "I0.organisation_name":
        return text(inv.name);
      case "I0.business_title":
        return text(inv.logins[0].businessTitle);
      case "I1.deployment_status":
        return sel("actively_investing");
      case "I1.mandate_context": {
        const ctx = step.context ?? {};
        const suggested = Object.entries(ctx)
          .filter(
            ([k, v]) => /^suggested.*Id$/.test(k) && typeof v === "string",
          )
          .map(([, v]) => v);
        const candidates = Array.isArray(ctx.candidates)
          ? ctx.candidates
              .map(
                (x) =>
                  Object.entries(x ?? {}).find(
                    ([k, v]) => /Id$|^id$/.test(k) && typeof v === "string",
                  )?.[1],
              )
              .filter(Boolean)
          : [];
        const ids = suggested.length > 0 ? suggested : candidates.slice(0, 1);
        return ids.length === 0
          ? null
          : refs("INVESTOR_MANDATE", ids.slice(0, 1));
      }
      case "I2.stages":
        return multi(inv.stages);
      case "I2.currency":
        return sel(inv.currency);
      case "I2.cheque_min":
        return range(inv.cheque[0]);
      case "I2.cheque_typical":
        return range(inv.cheque[1]);
      case "I2.cheque_max":
        return range(inv.cheque[2]);
      case "I2.investment_role":
        return multi(inv.roles);
      case "I3.geography":
        return tax(inv.geographies, ["geography"]);
      case "I3.geography_strength":
        return sel(inv.discovery === "strict" ? "must" : "strong");
      case "I3.sectors":
        return tax(inv.sectors, ["industry", "product_category"]);
      case "I3.sector_strength":
        return sel(inv.discovery === "exploratory" ? "nice" : "strong");
      case "I3.sectors_avoid":
        return inv.avoidSectors.length
          ? tax(inv.avoidSectors, ["industry", "product_category"])
          : "skip";
      case "I4.business_models":
        return inv.businessModels.length
          ? tax(inv.businessModels, ["business_model"])
          : "skip";
      case "I4.customer_types":
        return inv.customerTypes.length
          ? tax(inv.customerTypes, ["customer_type"])
          : "skip";
      case "I4.capital_intensity":
        return sel(inv.capitalIntensity);
      case "I4.regulatory_appetite":
        return sel(inv.regulatory);
      case "I4.revenue_state":
        return sel(inv.revenue);
      case "I5.founder_preferences":
        return multi(inv.founderPrefs);
      case "I5.founder_strength":
        return sel("strong");
      case "I6.green_flags":
        return multi(inv.greenFlags);
      case "I6.green_flag_strength":
        return sel("strong");
      case "I7.hard_exclusions":
        return multi(inv.hardExclusions);
      case "I7.sector_exclusions":
        return inv.sectorExclusions.length
          ? tax(inv.sectorExclusions, ["industry", "product_category"])
          : "skip";
      case "I9.discovery_mode":
        return sel(inv.discovery);
      case "I10.inbound_preference":
        return sel(inv.inbound);
      case "I11.review":
      case "I12.handoff":
        return confirm;
      // Narrative steps (custom criteria, portfolio, context) are skipped:
      // the thesis goes on the mandate in the investor's words instead.
      default:
        return step.required ? null : "skip";
    }
  };
}

async function seedInvestor(inv) {
  const s = (state.investors[inv.key] ??= { name: inv.name, steps: {} });
  const done = (step, extra = {}) => {
    Object.assign(s, extra);
    s.steps[step] = true;
    return save();
  };
  const [lead, ...team] = inv.logins;
  const e = lead.email;
  if (!s.steps.accounts) {
    s.userIds = [];
    for (const l of inv.logins)
      s.userIds.push(await ensureAccount(l, inv.seedKey));
    await done("accounts");
  }
  if (!s.steps.journey) {
    await ensureProfile(e, lead);
    // The first journey creates the organisation that taxonomy reads need.
    const map = taxonomy ?? (await loadTaxonomy(e).catch(() => null));
    const answers = map ? investorAnswers(inv, map) : null;
    await driveJourney(e, "investor", async (step) =>
      answers
        ? answers(step)
        : investorAnswers(inv, await loadTaxonomy(e))(step),
    );
    await done("journey");
  }
  if (!s.steps.organisation) {
    const org = await api(e, "GET", "/v1/investors/current");
    const byId = `/v1/investors/${org.id}`;
    await api(e, "PUT", `${byId}/representatives/me`, {
      businessTitle: lead.businessTitle,
    });
    if (org.visibility !== "network_visible")
      await api(e, "POST", `${byId}/visibility`, {
        visibility: "network_visible",
        expectedVersion: org.version,
      });
    const list = await api(e, "GET", `${byId}/mandates`);
    const mandate =
      (list.items ?? []).find((m) => m.status === "ACTIVE") ??
      (list.items ?? []).find((m) => m.status === "DRAFT");
    if (!mandate) throw new Error("no mandate after the investor journey");
    const mp = `${byId}/mandates/${mandate.id}`;
    const detail = await api(e, "GET", mp);
    const name = `${inv.name.replace(/ \(fictional\)$/, "")} mandate`;
    let version = detail.version;
    if (detail.rawMandateText !== inv.thesis || detail.name !== name)
      version = (
        await api(e, "PATCH", mp, {
          expectedVersion: version,
          name,
          rawMandateText: inv.thesis,
        })
      ).version;
    if (mandate.status === "DRAFT")
      await api(e, "POST", `${mp}/activate`, { expectedVersion: version });
    await qapi(e, "PUT", "/v1/q/daily/preferences", {
      frequency: "OFF",
      email: false,
    });
    await done("organisation", {
      investorOrganisationId: org.id,
      mandateId: mandate.id,
    });
  }
  if (!s.steps.team) {
    const t = await api(e, "GET", "/v1/team");
    const orgId = t.organisation.organisationId;
    for (const m of team) {
      if (
        t.members.some((x) => x.email?.toLowerCase() === m.email.toLowerCase())
      )
        continue;
      await ensureProfile(m.email, m);
      if (
        !t.joinRequests.some(
          (j) => j.email?.toLowerCase() === m.email.toLowerCase(),
        )
      ) {
        await api(
          m.email,
          "POST",
          "/v1/join-requests",
          {
            organisationId: orgId,
            message: `${m.displayName}, ${m.businessTitle}.`,
          },
          idem(inv.seedKey, "join", m.email),
        );
      }
    }
    for (const j of (await api(e, "GET", "/v1/team")).joinRequests) {
      if (team.some((m) => m.email.toLowerCase() === j.email?.toLowerCase()))
        await api(e, "POST", `/v1/team/join-requests/${j.requestId}/decision`, {
          approve: true,
        });
    }
    const final = await api(e, "GET", "/v1/team");
    for (const m of team) {
      const row = final.members.find(
        (x) => x.email?.toLowerCase() === m.email.toLowerCase(),
      );
      if (!row) throw new Error(`${m.email} is not on the firm after approval`);
      if (row.role !== "ADMIN")
        await api(e, "PUT", `/v1/team/members/${row.membershipId}/role`, {
          role: "ADMIN",
        });
      await api(m.email, "POST", `/v1/organisations/${orgId}/activate`, {});
      tokens.delete(m.email);
      await api(
        m.email,
        "PUT",
        `/v1/investors/${s.investorOrganisationId}/representatives/me`,
        { businessTitle: m.businessTitle },
      );
      await qapi(m.email, "PUT", "/v1/q/daily/preferences", {
        frequency: "OFF",
        email: false,
      });
    }
    await done("team", { organisationId: orgId });
  }
  if (!s.steps.gateq) {
    const map = await loadTaxonomy(e);
    const criteria = inv.gateq.map(
      ({ position, requiredness, label, config }) => {
        if (config.type === "TAXONOMY")
          return {
            position,
            requiredness,
            label,
            config: {
              type: "TAXONOMY",
              vocabularyCode: "industry",
              allowedNodeIds: nodeIds(
                map,
                config.allowedCodes.filter((x) => map.has(`industry:${x}`)),
                ["industry"],
              ),
            },
          };
        if (config.type === "EXCLUDED_TAXONOMY")
          return {
            position,
            requiredness,
            label,
            config: {
              type: "EXCLUDED_TAXONOMY",
              vocabularyCode: "industry",
              excludedNodeIds: nodeIds(map, config.excludedCodes, ["industry"]),
            },
          };
        return { position, requiredness, label, config };
      },
    );
    const existing = await api(
      e,
      "GET",
      `/v1/gateq/gateways?investorOrganisationId=${s.investorOrganisationId}`,
    ).catch(() => ({ gateways: [] }));
    let gateway = (existing.gateways ?? existing.items ?? []).find(
      (g) => g.name === `${inv.name} gate`,
    );
    gateway ??= await api(
      e,
      "POST",
      "/v1/gateq/gateways",
      {
        investorOrganisationId: s.investorOrganisationId,
        name: `${inv.name} gate`,
      },
      idem(inv.seedKey, "gateway"),
    );
    const gw = gateway.gateway ?? gateway;
    const versions = (
      await api(e, "GET", `/v1/gateq/gateways/${gw.id}/versions`)
    ).versions;
    if (!versions.some((v) => v.status === "PUBLISHED")) {
      const draft =
        versions.find((v) => v.status === "DRAFT") ??
        (await api(e, "POST", `/v1/gateq/gateways/${gw.id}/versions`, {
          inboundMode: "QUALIFIED",
          publicTitle: `Apply to ${inv.name.replace(/ \(fictional\)$/, "")}`,
          publicDescription: `${inv.thesis} (Fictional demo investor.)`.slice(
            0,
            2000,
          ),
          criteria,
        }));
      await api(
        e,
        "POST",
        `/v1/gateq/gateways/${gw.id}/versions/${draft.id}/publish`,
        {},
      );
    }
    await done("gateq", { gatewayId: gw.id, publicId: gw.publicId });
  }
  return s;
}

// ---------------------------------------------------------------- main

function parseRange(spec, max) {
  if (spec === "none") return [];
  if (spec === "all") return Array.from({ length: max }, (_, i) => i + 1);
  return spec.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  });
}

async function pool(items, worker) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          results.push({ item, ok: true, value: await worker(item) });
        } catch (error) {
          results.push({
            item,
            ok: false,
            error: String(error?.message ?? error)
              .split("\n")[0]
              .slice(0, 300),
          });
        }
      }
    }),
  );
  return results;
}

if (process.argv[1]?.endsWith("seed.mjs")) {
  const target = await assertSyntheticTarget();
  if (args.includes("--check-target")) {
    console.log(
      `target ok: ${lib.PROJECT_REF}, workers ${target.workersSha.slice(0, 8)}`,
    );
    process.exit(0);
  }
  if (
    !process.env.CQ_SEED_ACCOUNT_PASSWORD ||
    process.env.CQ_SEED_ACCOUNT_PASSWORD.length < 12
  )
    throw new Error("CQ_SEED_ACCOUNT_PASSWORD (12+ characters) is required");
  console.log(
    `fictional-bulk: ${lib.PROJECT_REF} attested synthetic staging; workers ${target.workersSha.slice(0, 8)} carry the presence guard`,
  );
  const world = buildWorld({ count: worldCount });
  const investors =
    investorsArg === "none"
      ? []
      : investorsArg === "all"
        ? world.investors
        : world.investors.filter((i) =>
            investorsArg.split(",").includes(i.key),
          );
  const companies = parseRange(companyRange, world.companies.length)
    .map((n) => world.companies[n - 1])
    .filter(Boolean);
  const invResults = await pool(investors, seedInvestor);
  for (const r of invResults)
    console.log(`investor ${r.item.key}: ${r.ok ? "ok" : `FAILED ${r.error}`}`);
  const coResults = await pool(companies, async (c) => {
    const s = await seedCompany(c);
    console.log(
      `company ${c.key} ${c.name}: ok (${s.visibility}/${s.readiness})`,
    );
    return s;
  });
  for (const r of coResults.filter((x) => !x.ok))
    console.log(`company ${r.item.key} ${r.item.name}: FAILED ${r.error}`);
  await save();
  console.log(
    `done: investors ${invResults.filter((r) => r.ok).length}/${invResults.length}, companies ${coResults.filter((r) => r.ok).length}/${coResults.length}`,
  );
}
