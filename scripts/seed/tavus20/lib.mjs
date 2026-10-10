// Shared helpers for the tavus-20 seed. Secrets are fetched at runtime from
// the Supabase management API into this process's memory only; nothing here
// ever prints or writes a key, password or token.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const WEB = (
  process.env.CQ_WEB_URL ?? "https://capital-qweb-production.up.railway.app"
).replace(/\/$/, "");
export const API = (
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app"
).replace(/\/$/, "");
export const QAPI = (
  process.env.CQ_Q_API_URL ?? "https://capital-qq-api-production.up.railway.app"
).replace(/\/$/, "");
export const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
export const SB_URL = `https://${PROJECT_REF}.supabase.co`;
export const ASSETS =
  process.env.CQ_SEED_ASSETS ??
  "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/seed-assets";
export const VIDEOS =
  process.env.CQ_SEED_VIDEOS ??
  "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/tavus/videos";
export const STATE_FILE = join(ROOT, "docs/seed/tavus-20/seed-state.json");
export const FINDINGS_FILE = join(ROOT, "docs/seed/tavus-20/SEED-FINDINGS.md");

export const companies = () =>
  JSON.parse(
    readFileSync(join(ROOT, "docs/seed/tavus-20/companies-full.json"), "utf8"),
  );

let keys = null;
/** Supabase keys, in memory only. */
export async function supabaseKeys() {
  if (keys) return keys;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`api-keys: HTTP ${r.status}`);
  const list = await r.json();
  const pick = (type) => list.find((k) => k.type === type)?.api_key;
  keys = {
    secret:
      pick("secret") ?? list.find((k) => k.name === "service_role")?.api_key,
    publishable:
      pick("publishable") ?? list.find((k) => k.name === "anon")?.api_key,
  };
  if (!keys.secret || !keys.publishable) throw new Error("keys missing");
  return keys;
}

/** Read-only SQL through the management API (inspection only, never writes). */
export async function sql(query) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  const j = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error(`sql: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function admin(path, init = {}) {
  const k = await supabaseKeys();
  return fetch(`${SB_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: k.secret,
      authorization: `Bearer ${k.secret}`,
      "content-type": "application/json",
    },
  });
}

/** Asset slug: accents dropped ("Orphéa" → "orphea"), titles kept out by callers. */
export const assetSlug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const personSlug = (name) =>
  assetSlug(name.replace(/^(Dr|Prof)\.?\s+/i, ""));

// Email slug: kept exactly as first used (accents became hyphens, e.g.
// "ine-s"), because the accounts already exist under those addresses.
export const slugOf = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const firstNameOf = (name) =>
  slugOf(name.replace(/^(Dr|Prof)\.?\s+/i, "").split(/\s+/)[0]);
export const emailFor = (personName, companyName) =>
  `adedaniel502+cq-${firstNameOf(personName)}-${slugOf(companyName).replace(/-/g, "")}@gmail.com`;

/** Find an auth user by email (read-only SQL; the admin API has no lookup). */
export async function findUser(email) {
  const rows = await sql(
    `select id, raw_user_meta_data->>'fictional_demo' as fd from auth.users where lower(email)=lower('${email.replace(/'/g, "''")}')`,
  );
  return rows[0] ?? null;
}

/** Create (or adopt, only when it is ours) a confirmed fictional account. */
export async function ensureAccount({ email, displayName, seedKey }) {
  const found = await findUser(email);
  if (found) {
    if (found.fd !== "true")
      throw new Error(`${email} exists and is not fictional; refusing`);
    return { id: found.id, created: false };
  }
  const r = await admin("/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      // The founder's shared seed password (env only, never printed), so
      // they can sign in as any fictional person; random when unset.
      password:
        process.env.CQ_SEED_ACCOUNT_PASSWORD ||
        randomBytes(24).toString("base64url"),
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        full_name: displayName,
        fictional_demo: true,
        synthetic: true,
        fictional_seed_key: seedKey,
      },
      app_metadata: { synthetic: true, fictional_demo: true },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `create ${email}: HTTP ${r.status} ${body.msg ?? body.error_code ?? ""}`,
    );
  return { id: body.id, created: true };
}

/** A one-time magic-link token hash (no email is sent by generate_link). */
export async function magicTokenHash(email) {
  const r = await admin("/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`generate_link: HTTP ${r.status}`);
  return body.hashed_token ?? body.properties?.hashed_token;
}

/** An API access token for a user, via a magic-link token exchange. */
export async function accessToken(email) {
  const k = await supabaseKeys();
  const hash = await magicTokenHash(email);
  const r = await fetch(`${SB_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: k.publishable, "content-type": "application/json" },
    body: JSON.stringify({ type: "email", token_hash: hash }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`verify: HTTP ${r.status}`);
  return j.access_token;
}

/** API call under a user's token. Returns {status, body}. */
export async function call(base, token, method, path, body, idem) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET"
        ? {}
        : { "idempotency-key": idem ?? crypto.randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: keep the raw text as the body.
  }
  return { status: r.status, body: parsed };
}

export function loadState() {
  if (!existsSync(STATE_FILE)) return { companies: {} };
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
export function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}
export const assetDir = (c) =>
  join(ASSETS, `${String(c.n).padStart(2, "0")}-${assetSlug(c.company)}`);
/** The final 9:16 cut, found by number (one file name spells "Orphéa" as "orph-a"). */
export const videoFile = (c) => {
  const nn = String(c.n).padStart(2, "0");
  const hit = existsSync(VIDEOS)
    ? readdirSync(VIDEOS).find(
        (f) => f.startsWith(`${nn}-`) && f.endsWith("-9x16.mp4"),
      )
    : undefined;
  return join(VIDEOS, hit ?? `${nn}-${slugOf(c.company)}-9x16.mp4`);
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
