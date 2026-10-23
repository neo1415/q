// Railway GraphQL helper for the handoff scripts in this folder. The token
// comes from RAILWAY_API_TOKEN (an account token, Bearer) or, failing that,
// RAILWAY_TOKEN_FILE; it is never printed. A project token needs
// mode "project" (Project-Access-Token header). Needs NODE_USE_ENV_PROXY=1
// in the cloud sandbox.
import { readFileSync } from "node:fs";

const tok = (
  process.env.RAILWAY_API_TOKEN ??
  readFileSync(process.env.RAILWAY_TOKEN_FILE ?? "", "utf8")
).trim();

export async function rw(query, variables = {}, mode = "bearer") {
  const headers = { "content-type": "application/json" };
  if (mode === "bearer") headers.authorization = `Bearer ${tok}`;
  else headers["Project-Access-Token"] = tok;
  const r = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}
