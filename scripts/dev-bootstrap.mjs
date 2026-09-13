#!/usr/bin/env node
/* global process, console, fetch, URL, crypto */
/**
 * Local synthetic identities for development (CQ-PRE-REC-001 §9).
 *
 *   pnpm dev:bootstrap
 *
 * Creates, idempotently, three synthetic people against the LOCAL Supabase
 * stack and the running local API, through the same public paths a person
 * uses — sign-up, then the onboarding runtime — so every row they own was
 * written by a canonical service and nothing here reaches into a table:
 *
 *   founder   a founder journey bound to a canonical company
 *   investor  an investor journey bound to a canonical investor organisation
 *   member    a person with no organisation yet
 *
 * Re-running after `pnpm db:reset` recreates them; re-running otherwise
 * changes nothing and reports what already exists. Refuses any Supabase URL
 * that is not loopback: hosted projects are never targeted.
 *
 * Reads SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY from
 * the root `.env.local` (values are never printed) and CQ_API_URL (default
 * http://127.0.0.1:3001). The synthetic password is printed because it is
 * not a secret: these accounts exist only on this machine.
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
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) env[match[1]] = value;
  }
}

const SUPABASE_URL = env.SUPABASE_URL;
const PUBLISHABLE_KEY = env.SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = env.SUPABASE_SECRET_KEY;
const API_URL = (env.CQ_API_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const PASSWORD = "CapitalQ-dev-2026!";

function fail(message) {
  console.error(`dev:bootstrap: ${message}`);
  process.exit(1);
}

if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
  fail(
    "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required in .env.local",
  );
}
const host = new URL(SUPABASE_URL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  fail(`refusing to bootstrap against a non-local Supabase host (${host})`);
}

const PEOPLE = [
  {
    key: "founder",
    email: "dev-founder@capitalq.local",
    displayName: "Dev Founder",
  },
  {
    key: "investor",
    email: "dev-investor@capitalq.local",
    displayName: "Dev Investor",
  },
  {
    key: "member",
    email: "dev-member@capitalq.local",
    displayName: "Dev Member",
  },
];

async function json(response) {
  const text = await response.text();
  try {
    return text.length === 0 ? null : JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

/** Create the auth user (confirmed) or accept that it already exists. */
async function ensureAuthUser(person) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: person.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: person.displayName, synthetic: true },
    }),
  });
  if (response.ok) return "created";
  const body = await json(response);
  const message = String(body?.msg ?? body?.message ?? body?.error ?? "");
  if (response.status === 422 || /already|exists/i.test(message)) {
    return "existing";
  }
  fail(`could not create ${person.key}: ${response.status} ${message}`);
}

async function signIn(person) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: person.email, password: PASSWORD }),
    },
  );
  if (!response.ok) {
    fail(`could not sign in ${person.key}: ${response.status}`);
  }
  const body = await json(response);
  return body.access_token;
}

async function api(token, method, path, body, idempotent = false) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await json(response);
  if (!response.ok && response.status !== 404) {
    fail(
      `${method} ${path} failed: ${response.status} ${JSON.stringify(parsed)}`,
    );
  }
  return { status: response.status, body: parsed };
}

/** Submit a step if the session is on it; otherwise leave the journey as it is. */
async function submitIfCurrent(token, view, stepKey, value) {
  if (view.session.currentStepKey !== stepKey) return view;
  const result = await api(
    token,
    "POST",
    `/v1/onboarding/sessions/${view.session.id}/responses`,
    {
      stepKey,
      response: {
        value,
        sourceModality: value.type === "TEXT" ? "TYPED_TEXT" : "SELECTION",
      },
      expectedSessionVersion: view.session.version,
    },
    true,
  );
  return result.body;
}

async function bootstrapFounder(token) {
  const current = await api(
    token,
    "GET",
    "/v1/onboarding/sessions/current?journeyType=founder",
  );
  let view =
    current.status === 200
      ? current.body
      : (
          await api(
            token,
            "POST",
            "/v1/onboarding/sessions",
            { journeyType: "founder" },
            true,
          )
        ).body;
  if (view.session.subject !== null) {
    return { state: "existing", companyId: view.session.subject.id };
  }
  view = await submitIfCurrent(token, view, "F0.intent", {
    type: "SINGLE_SELECT",
    optionKey: "raising_now",
  });
  view = await submitIfCurrent(token, view, "F1.company_name", {
    type: "TEXT",
    text: "Northstar Logistics (dev)",
  });
  return {
    state: "created",
    companyId: view.session.subject?.id ?? null,
    currentStep: view.session.currentStepKey,
  };
}

async function bootstrapInvestor(token) {
  const current = await api(
    token,
    "GET",
    "/v1/onboarding/sessions/current?journeyType=investor",
  );
  let view =
    current.status === 200
      ? current.body
      : (
          await api(
            token,
            "POST",
            "/v1/onboarding/sessions",
            { journeyType: "investor" },
            true,
          )
        ).body;
  if (view.session.subject !== null) {
    return {
      state: "existing",
      investorOrganisationId: view.session.subject.id,
    };
  }
  view = await submitIfCurrent(token, view, "I0.investor_type", {
    type: "SINGLE_SELECT",
    optionKey: "vc",
  });
  view = await submitIfCurrent(token, view, "I0.organisation_name", {
    type: "TEXT",
    text: "Meridian Ventures (dev)",
  });
  return {
    state: "created",
    investorOrganisationId: view.session.subject?.id ?? null,
    currentStep: view.session.currentStepKey,
  };
}

const report = {};
for (const person of PEOPLE) {
  const auth = await ensureAuthUser(person);
  const token = await signIn(person);
  const me = await api(token, "GET", "/v1/me");
  if (me.status !== 200) fail(`${person.key}: /v1/me returned ${me.status}`);
  let journey = null;
  if (person.key === "founder") journey = await bootstrapFounder(token);
  if (person.key === "investor") journey = await bootstrapInvestor(token);
  report[person.key] = { email: person.email, auth, journey };
}

console.log("Local synthetic identities (LOCAL Supabase only):");
for (const [key, entry] of Object.entries(report)) {
  console.log(
    `  ${key.padEnd(9)} ${entry.email}  auth=${entry.auth}` +
      (entry.journey === null
        ? ""
        : `  journey=${JSON.stringify(entry.journey)}`),
  );
}
console.log(`  password  ${PASSWORD}  (synthetic; this machine only)`);
console.log("Sign in at http://localhost:3000/auth/sign-in");
