// Railway GraphQL client for the handoff helpers. The token comes from the
// environment (RAILWAY_API_TOKEN, else RAILWAY_TOKEN) or from the file named by
// RAILWAY_TOKEN_FILE; it is never printed and never committed.
import { readFileSync } from "node:fs";

const tok = (
  process.env.RAILWAY_API_TOKEN ??
  process.env.RAILWAY_TOKEN ??
  (process.env.RAILWAY_TOKEN_FILE
    ? readFileSync(process.env.RAILWAY_TOKEN_FILE, "utf8")
    : "")
).trim();
if (!tok) throw new Error("set RAILWAY_API_TOKEN or RAILWAY_TOKEN_FILE");

export async function rw(query, variables = {}) {
  const r = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tok}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}
