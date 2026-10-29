// Shared by record.mjs and eval.mjs (research acceptance gate, owner
// 2026-10-29): read the provider keys from the Railway service's variables
// (by NAME; values are never printed, logged or written), snapshot the
// model catalog (reference data: providers, models, prices, routing
// policies -- no customer data) through the read-only Supabase
// Management API, and run the vitest driver with them in its environment.
//
// Needs RAILWAY_API_TOKEN (or RAILWAY_TOKEN_FILE), SUPABASE_ACCESS_TOKEN and,
// in the cloud sandbox, NODE_USE_ENV_PROXY=1.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const CASES_DIR = join(
  ROOT,
  "apps/q-api/test/research-acceptance/cases",
);
export const FIXTURES_DIR = join(
  ROOT,
  "apps/q-api/test/research-acceptance/fixtures",
);

/** The variable names read from Railway, and the driver's names for them. */
const KEYS = {
  CQ_RA_BRAVE_KEY: ["BRAVE_API", "BRAVE_SEARCH_API_KEY"],
  CQ_RA_SERP_KEY: ["SERPER_API_KEY", "SERP_API_KEY"],
  CQ_RA_OPENAI_KEY: ["OPENAI_API_KEY"],
};

export function parseArgs(argv) {
  const args = { dryRun: false, force: false, cases: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--case")
      args.cases.push(...String(argv[(i += 1)] ?? "").split(","));
    else throw new Error(`unknown argument ${arg}`);
  }
  args.cases = args.cases
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
  return args;
}

export function caseIds(only) {
  const ids = readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
  const unknown = only.filter((id) => !ids.includes(id));
  if (unknown.length > 0)
    throw new Error(`unknown case(s): ${unknown.join(", ")}`);
  return only.length === 0 ? ids : ids.filter((id) => only.includes(id));
}

export function recorded(id) {
  return (
    existsSync(join(FIXTURES_DIR, `${id}.web.json`)) &&
    existsSync(join(FIXTURES_DIR, `${id}.models.json`))
  );
}

/** What is configured, by name only. */
export function credentialPresence() {
  return {
    RAILWAY_API_TOKEN:
      process.env.RAILWAY_API_TOKEN !== undefined ||
      process.env.RAILWAY_TOKEN_FILE !== undefined,
    SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN !== undefined,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY === "1",
  };
}

const looksDisabled = (value) =>
  value === undefined || /^disabled/i.test(value.trim());

/** The keys from the Railway service's production variables; never printed. */
export async function railwayKeys(serviceName) {
  const { rw } = await import("../handoff/railway/rw.mjs");
  const projects = await rw(
    `query { projects { edges { node { id name environments { edges { node { id name } } } services { edges { node { id name } } } } } } }`,
  );
  const project = projects.data?.projects.edges.find(
    (edge) => edge.node.name === "Q",
  )?.node;
  if (project === undefined) throw new Error("Railway project Q not found");
  const environment = project.environments.edges.find(
    (edge) => edge.node.name === "production",
  )?.node.id;
  const service = project.services.edges.find(
    (edge) => edge.node.name === serviceName,
  )?.node.id;
  if (environment === undefined || service === undefined)
    throw new Error(`Railway service ${serviceName} (production) not found`);
  const read = await rw(
    `query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,
    { p: project.id, e: environment, s: service },
  );
  const variables = read.data?.variables ?? {};
  const keys = {};
  for (const [target, names] of Object.entries(KEYS)) {
    const value = names
      .map((name) => variables[name])
      .find((one) => !looksDisabled(one));
    if (value === undefined)
      throw new Error(`${target}: none of ${names.join(", ")} is set`);
    keys[target] = value.trim();
  }
  console.log(
    `keys read from Railway ${serviceName}: ${Object.keys(keys).join(", ")} (values not shown)`,
  );
  return keys;
}

/** The model catalog snapshot, through the read-only Management API. */
export async function catalogFile() {
  const project = process.env.CQ_RA_SUPABASE_PROJECT ?? "vcohxiqsmnkzxnvawgri";
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token === undefined) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  const select = async (query) => {
    if (!/^\s*select\b/i.test(query)) throw new Error("select only");
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${project}/database/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, read_only: true }),
      },
    );
    if (!response.ok)
      throw new Error(`catalog read failed: HTTP ${response.status}`);
    return response.json();
  };
  // The gateway's own loader and mapping; its four selects take no parameters.
  const { loadModelCatalogSnapshot } = await import(
    join(ROOT, "packages/model-gateway/dist/index.js")
  );
  const sql = (strings, ...values) => {
    if (values.length > 0)
      throw new Error("the catalog loader took a parameter");
    return select(strings.join(""));
  };
  const snapshot = await loadModelCatalogSnapshot(sql, new Date());
  const dir = mkdtempSync(join(tmpdir(), "research-acceptance-"));
  const file = join(dir, "catalog.json");
  writeFileSync(file, JSON.stringify(snapshot));
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Runs the vitest driver with the keys in its environment only. */
export function runDriver(mode, ids, extraEnv) {
  const env = {
    ...process.env,
    ...extraEnv,
    CQ_RA_MODE: mode,
    CQ_RA_CASES: ids.join(","),
  };
  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.research-acceptance.config.ts",
    ],
    { cwd: ROOT, env, stdio: "inherit" },
  );
  return result.status ?? 1;
}
