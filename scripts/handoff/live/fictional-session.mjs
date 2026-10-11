// Shared sign-in for live checks on FICTIONAL accounts only
// (*@fictional.capitalq.local). Reads the public Supabase URL/key from
// CQ_SB_URL / CQ_SB_PUBLISHABLE (or CQ_PUBLIC_JSON pointing at a file with
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), and the
// seed password from CQ_SEED_ACCOUNT_PASSWORD. Never prints a secret.
import { readFileSync } from "node:fs";

export const API =
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app";
export const Q_API =
  process.env.CQ_Q_API_URL ??
  "https://capital-qq-api-production.up.railway.app";

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

export async function signIn(email, baseUrl = API) {
  if (!email.endsWith("@fictional.capitalq.local"))
    throw new Error("live checks run on fictional accounts only");
  const password = process.env.CQ_SEED_ACCOUNT_PASSWORD;
  if (!password) throw new Error("missing CQ_SEED_ACCOUNT_PASSWORD");
  const { url, key } = publicConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(`sign-in ${email}: HTTP ${response.status}`);
  const body = await response.json();
  return { baseUrl, accessToken: body.access_token };
}
