#!/usr/bin/env node
/**
 * Give existing synthetic demo accounts the verification marker, and ask
 * Capital Q to verify their founders' companies (CQ-VERIFY-002).
 *
 *   node scripts/demo-verify-seed.mjs                     # dry run, local
 *   node scripts/demo-verify-seed.mjs --apply             # act, local
 *   node scripts/demo-verify-seed.mjs --email a@x --email b@y --apply
 *   node scripts/demo-verify-seed.mjs --accounts accounts.json --apply
 *   node scripts/demo-verify-seed.mjs --hosted-synthetic --apply
 *
 * What it does, per account, and nothing else:
 *
 *   1. Only an account that was CREATED synthetic (user_metadata.synthetic
 *      = true, which every bootstrap and smoke script sets) is touched. A
 *      real person's account is refused by name, so this can never turn a
 *      real person into one the synthetic decider will verify.
 *   2. Sets app_metadata.synthetic = true through the Supabase admin API
 *      (PUT /auth/v1/admin/users/{id}). app_metadata is the marker the
 *      Verification decider reads; only the service role can write it.
 *   3. For a founder whose company is network_visible, signs in AS that
 *      founder (an admin magic-link token exchanged for a session; no
 *      password is typed or stored) and asks for verification through the
 *      public API. The worker then decides it on the normal path, under
 *      the deployment's own attestation, and readiness follows.
 *
 * No database connection, no table write, no decision: the script asks,
 * Capital Q decides. Dry run by default; --apply to act.
 *
 * Where it runs: a loopback Supabase, or -- with --hosted-synthetic -- the
 * hosted synthetic staging project, and only when
 * CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF names exactly the project
 * SUPABASE_URL points at (the same attestation the model gateway checks).
 * Anything else is refused before a request is made.
 *
 * Environment: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY,
 * CQ_API_URL (defaults: the local stack). Values already in the process
 * environment win over the repository's .env.local.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = { ...process.env };
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null || env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (value.length > 0) env[match[1]] = value;
  }
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const HOSTED = argv.includes("--hosted-synthetic");
const valuesOf = (flag) =>
  argv.flatMap((arg, i) => (arg === flag && argv[i + 1] ? [argv[i + 1]] : []));

/** The accounts `pnpm dev:bootstrap` creates. */
const DEFAULT_ACCOUNTS = [
  "dev-founder@capitalq.local",
  "dev-investor@capitalq.local",
  "dev-member@capitalq.local",
];

function accountsFromArgs() {
  const listed = valuesOf("--email");
  for (const file of valuesOf("--accounts")) {
    const parsed = JSON.parse(readFileSync(resolve(file), "utf8"));
    if (!Array.isArray(parsed) || !parsed.every((e) => typeof e === "string")) {
      throw new Error(`${file}: expected a JSON array of email addresses`);
    }
    listed.push(...parsed);
  }
  return [
    ...new Set(
      (listed.length > 0 ? listed : DEFAULT_ACCOUNTS).map((e) =>
        e.toLowerCase(),
      ),
    ),
  ];
}

const SUPABASE_URL = (env.SUPABASE_URL ?? "http://127.0.0.1:54321").replace(
  /\/$/,
  "",
);
const SECRET = env.SUPABASE_SECRET_KEY ?? "";
const PUBLISHABLE = env.SUPABASE_PUBLISHABLE_KEY ?? "";
const API_URL = (env.CQ_API_URL ?? "http://127.0.0.1:3011").replace(/\/$/, "");

/** The Supabase project ref of a hosted URL, or null. */
function projectRefOf(url) {
  const match = /^([a-z0-9]{16,})\.supabase\.(co|com|net)$/i.exec(
    new URL(url).hostname,
  );
  return match === null ? null : match[1].toLowerCase();
}

/** Refuses, by name, anywhere this script must not act. */
function whereRefusal() {
  let host;
  try {
    host = new URL(SUPABASE_URL).hostname;
  } catch {
    return `SUPABASE_URL is not a URL`;
  }
  const loopback = (h) =>
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(h);
  if (loopback(host)) {
    // A local person's session is never sent to a hosted API.
    return loopback(new URL(API_URL).hostname)
      ? null
      : `SUPABASE_URL is local but CQ_API_URL (${API_URL}) is not; set CQ_API_URL to the local api`;
  }
  if (!HOSTED) {
    return `SUPABASE_URL (${host}) is not loopback; pass --hosted-synthetic only for the synthetic staging project`;
  }
  const declared =
    env.CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  const inUse = projectRefOf(SUPABASE_URL);
  if (!declared) {
    return "--hosted-synthetic needs CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF naming the synthetic project";
  }
  if (inUse !== declared) {
    return `SUPABASE_URL is project ${inUse ?? "unknown"}, not the attested synthetic project ${declared}`;
  }
  return null;
}

const admin = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: SECRET,
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
  });

/** The admin API has no lookup by email; the pages are read until found. */
async function findUser(email) {
  for (let page = 1; page <= 50; page += 1) {
    const response = await admin(`/users?page=${page}&per_page=200`);
    if (!response.ok)
      throw new Error(`admin list users: HTTP ${response.status}`);
    const body = await response.json();
    const users = body.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found !== undefined) return found;
    if (users.length < 200) return null;
  }
  return null;
}

async function markSynthetic(user) {
  const response = await admin(`/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({
      app_metadata: { ...(user.app_metadata ?? {}), synthetic: true },
    }),
  });
  if (!response.ok) throw new Error(`admin update: HTTP ${response.status}`);
  const body = await response.json();
  return body.app_metadata?.synthetic === true;
}

/** A session for the person, without a password: admin link → verify. */
async function sessionFor(email) {
  const link = await admin("/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!link.ok) throw new Error(`generate_link: HTTP ${link.status}`);
  const linkBody = await link.json();
  const tokenHash = linkBody.hashed_token ?? linkBody.properties?.hashed_token;
  const verified = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
    body: JSON.stringify({ type: "email", token_hash: tokenHash }),
  });
  if (!verified.ok) throw new Error(`verify: HTTP ${verified.status}`);
  return (await verified.json()).access_token;
}

/** A body that is not JSON is still an answer: the caller reads the status. */
function parseJson(text) {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function api(token) {
  return async (method, path, headers = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
    const text = await response.text();
    return { status: response.status, body: parseJson(text) };
  };
}

/** The founder's company, as the founder's own journey names it. */
async function founderCompany(call) {
  const journey = await call(
    "GET",
    "/v1/onboarding/sessions/current?journeyType=founder",
  );
  const companyId = journey.body?.session?.subject?.id ?? null;
  if (journey.status !== 200 || companyId === null) return null;
  const company = await call("GET", `/v1/companies/${companyId}`);
  return company.status === 200 ? company.body : null;
}

async function seed(email) {
  const user = await findUser(email);
  if (user === null) {
    console.log(`  skip     ${email}: no such account`);
    return true;
  }
  if (user.user_metadata?.synthetic !== true) {
    // Never make a real person someone the synthetic decider will verify.
    console.log(`  REFUSED  ${email}: not created as a synthetic account`);
    return false;
  }

  const marked = user.app_metadata?.synthetic === true;
  if (marked) {
    console.log(`  ok       ${email}: app_metadata.synthetic already true`);
  } else if (!APPLY) {
    console.log(`  would    ${email}: set app_metadata.synthetic = true`);
  } else if (await markSynthetic(user)) {
    console.log(`  done     ${email}: app_metadata.synthetic = true`);
  } else {
    console.log(`  FAILED   ${email}: app_metadata did not take`);
    return false;
  }

  const call = api(await sessionFor(email));
  const company = await founderCompany(call);
  if (company === null) {
    console.log(`           ${email}: no founder company; nothing to verify`);
    return true;
  }
  if (company.marketplaceVisibility !== "network_visible") {
    console.log(
      `           ${email}: company ${company.id} is ${company.marketplaceVisibility}; visibility is the founder's choice, so no request`,
    );
    return true;
  }
  const standing = await call(
    "GET",
    `/v1/companies/${company.id}/verification`,
  );
  if (standing.status !== 200) {
    console.log(
      `  FAILED   ${email}: verification read HTTP ${standing.status}`,
    );
    return false;
  }
  const statuses = standing.body.standings
    .map((s) => `${s.claimType}=${s.status}`)
    .join(" ");
  if (!standing.body.requestable) {
    console.log(
      `           ${email}: company ${company.id} ${statuses}; nothing to request`,
    );
    return true;
  }
  if (!APPLY) {
    console.log(
      `  would    ${email}: request verification for company ${company.id} (${statuses})`,
    );
    return true;
  }
  const requested = await call(
    "POST",
    `/v1/companies/${company.id}/verification/requests`,
    { "idempotency-key": crypto.randomUUID() },
  );
  const after = (requested.body?.standings ?? [])
    .map((s) => `${s.claimType}=${s.status}`)
    .join(" ");
  const ok = requested.status === 202 || requested.status === 200;
  console.log(
    `  ${ok ? "done    " : "FAILED  "} ${email}: request HTTP ${requested.status} for company ${company.id} (${after}); the worker decides`,
  );
  return ok;
}

async function main() {
  const refusal = whereRefusal();
  if (refusal !== null) {
    console.error(`demo-verify-seed: refused: ${refusal}`);
    return 2;
  }
  if (SECRET.length === 0 || PUBLISHABLE.length === 0) {
    console.error(
      "demo-verify-seed: SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are required",
    );
    return 2;
  }
  const accounts = accountsFromArgs();
  console.log(
    `demo-verify-seed: ${APPLY ? "APPLY" : "dry run (pass --apply to act)"}; supabase ${new URL(SUPABASE_URL).host}; api ${API_URL}; ${accounts.length} account(s)`,
  );
  let ok = true;
  for (const email of accounts) {
    try {
      ok = (await seed(email)) && ok;
    } catch (error) {
      console.log(
        `  FAILED   ${email}: ${error instanceof Error ? error.message : String(error)}`,
      );
      ok = false;
    }
  }
  return ok ? 0 : 1;
}

process.exitCode = await main();
