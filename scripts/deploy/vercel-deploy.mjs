#!/usr/bin/env node
/**
 * Deploys apps/web to Vercel production in one command, through Vercel's
 * REST API (no CLI, no dependencies beyond Node 24). The Node services go to
 * Fly.io (scripts/deploy/fly-deploy.mjs). Runbook: docs/ai-handoff/FLY-DEPLOY.md.
 *
 *   VERCEL_TOKEN=... node scripts/deploy/vercel-deploy.mjs
 *   node scripts/deploy/vercel-deploy.mjs --dry-run
 *
 * Steps:
 *   1. creates the project if missing (root directory apps/web, Next.js,
 *      Node 24.x); apps/web/vercel.json carries the monorepo install and
 *      build commands (pnpm from the repo root, turbo
 *      --filter=@capital-q/web...);
 *   2. reads <env-dir>/web.env (exported from Railway), drops every
 *      RAILWAY_* key, PORT and NODE_ENV (Vercel sets it; production during
 *      install would skip devDependencies the build needs), rewrites the
 *      cross-service addresses to the Fly hosts and this project's origin,
 *      adds ENABLE_EXPERIMENTAL_COREPACK=1 so Vercel uses the pinned pnpm
 *      (packageManager), and upserts them as encrypted variables — values
 *      travel only in the HTTPS request body and are never printed;
 *   3. uploads the tracked files a web build reads (`git ls-files`, minus
 *      docs, design, supabase, tests and every .env*) and creates a
 *      production deployment, then waits for it and probes /favicon.ico.
 *
 * Flags:
 *   --dry-run            print the plan (names only); no request is sent
 *   --project <name>     Vercel project (default capital-q-web)
 *   --team <id>          team id (or VERCEL_TEAM_ID); omit for a personal account
 *   --web-origin <url>   web's production origin (default
 *                        https://capital-q-web.vercel.app); if Vercel
 *                        assigns another domain, rerun both scripts with it
 *   --fly-prefix <p>     Fly app prefix for api/q-api (default capital-q)
 *   --env-dir <dir>      env files (default ~/.cq-secrets/fly); must be
 *                        outside this repository
 *
 * In the cloud sandbox set NODE_USE_ENV_PROXY=1 so fetch uses the proxy.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_WEB_ORIGIN,
  describePlan,
  insideRepo,
  parseOrigin,
  planEnv,
  readEnvFile,
} from "./env-plan.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = "https://api.vercel.com";

/** Paths a web build never reads; kept out of the upload. */
const EXCLUDED_PREFIXES = [
  ".github/",
  ".railway/",
  ".claude/",
  "capital-q-audit/",
  "deploy/",
  "design/",
  "docs/",
  "infra/",
  "supabase/",
  "tests/",
];

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];

function fail(message) {
  console.error(`vercel-deploy: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    project: "capital-q-web",
    team: process.env.VERCEL_TEAM_ID?.trim() || undefined,
    webOrigin: DEFAULT_WEB_ORIGIN,
    flyPrefix: "capital-q",
    envDir: join(homedir(), ".cq-secrets", "fly"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--"))
        fail(`${arg} needs a value`);
      i += 1;
      return next;
    };
    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--project":
        options.project = value();
        break;
      case "--team":
        options.team = value();
        break;
      case "--web-origin":
        try {
          options.webOrigin = parseOrigin(arg, value());
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
        break;
      case "--fly-prefix":
        options.flyPrefix = value();
        break;
      case "--env-dir":
        options.envDir = resolve(value());
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          readFileSync(fileURLToPath(import.meta.url), "utf8")
            .split("*/")[0]
            .replace(/^#!.*\n\/\*\*\n?/, "")
            .replace(/^ \* ?/gm, ""),
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const dry = options.dryRun;
const log = (line = "") => console.log(line);
const token = process.env.VERCEL_TOKEN?.trim() ?? "";
if (!dry && token === "") fail("VERCEL_TOKEN is not set");
if (insideRepo(repoRoot, options.envDir)) {
  fail("--env-dir is inside the repository; env files must live outside it");
}

const hosts = {
  webOrigin: options.webOrigin,
  apiOrigin: `https://${options.flyPrefix}-api.fly.dev`,
  qApiOrigin: `https://${options.flyPrefix}-q-api.fly.dev`,
};

/** One Vercel API call. Bodies may hold values; nothing here logs a body. */
async function vercel(method, path, { body, headers = {}, allow = [] } = {}) {
  const url = new URL(path, API);
  if (options.team) url.searchParams.set("teamId", options.team);
  log(`  ${method} ${url.pathname}${url.search}`);
  if (dry) return { status: 0, json: {} };
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && !(body instanceof Uint8Array)
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : body instanceof Uint8Array
          ? body
          : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text === "" ? {} : JSON.parse(text);
  } catch {
    json = {};
  }
  if (!response.ok && !allow.includes(response.status)) {
    // Error bodies carry a code and message, never a variable value.
    fail(
      `${method} ${url.pathname} → ${response.status} ${json?.error?.code ?? ""} ${json?.error?.message ?? ""}`,
    );
  }
  return { status: response.status, json };
}

// ---------------------------------------------------------------- env plan

const envFile = join(options.envDir, "web.env");
if (!existsSync(envFile)) fail(`env file missing: ${envFile}`);
const env = planEnv("web", readEnvFile(envFile), hosts);
if (env.entries.delete("NODE_ENV")) env.dropped.push("NODE_ENV");
env.entries.set("ENABLE_EXPERIMENTAL_COREPACK", "1");
env.added.push("ENABLE_EXPERIMENTAL_COREPACK");
const missing = REQUIRED.filter(
  (n) => (env.entries.get(n) ?? "").trim() === "",
);
if (missing.length > 0) fail(`${envFile} lacks required ${missing.join(", ")}`);

// ------------------------------------------------------------------- files

const listed = spawnSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (listed.status !== 0) fail("git ls-files failed");
const files = listed.stdout
  .split("\0")
  .filter(Boolean)
  .filter((file) => !EXCLUDED_PREFIXES.some((p) => file.startsWith(p)))
  // Secrets never leave the machine, tracked or not.
  .filter((file) => {
    const base = file.split("/").pop() ?? "";
    return !/^\.env(\.|$)/.test(base) || base === ".env.example";
  })
  .filter(
    (file) =>
      existsSync(join(repoRoot, file)) &&
      statSync(join(repoRoot, file)).isFile(),
  )
  .map((file) => {
    const data = readFileSync(join(repoRoot, file));
    return {
      file,
      data,
      size: data.length,
      sha: createHash("sha1").update(data).digest("hex"),
    };
  });
const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

// -------------------------------------------------------------------- main

log(`Capital Q web → Vercel${dry ? " (dry run: no request is sent)" : ""}`);
log(`project: ${options.project}   team: ${options.team ?? "personal"}`);
log(
  `hosts:   web ${hosts.webOrigin}  api ${hosts.apiOrigin}  q-api ${hosts.qApiOrigin}`,
);
log(
  `upload:  ${files.length} tracked files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
);
log();

log("1. project");
const projectSettings = {
  framework: "nextjs",
  rootDirectory: "apps/web",
  nodeVersion: "24.x",
};
const found = await vercel(
  "GET",
  `/v9/projects/${encodeURIComponent(options.project)}`,
  {
    allow: [404],
  },
);
let projectId = found.json?.id;
if (dry || found.status === 404) {
  const created = await vercel("POST", "/v11/projects", {
    body: { name: options.project, ...projectSettings },
  });
  projectId = created.json?.id ?? options.project;
} else {
  await vercel("PATCH", `/v9/projects/${encodeURIComponent(projectId)}`, {
    body: projectSettings,
  });
}

log("\n2. environment (production + preview, encrypted)");
log(`  from ${envFile}:`);
log(describePlan(env));
log(`  names: ${[...env.entries.keys()].join(", ")}`);
await vercel(
  "POST",
  `/v10/projects/${encodeURIComponent(projectId ?? options.project)}/env?upsert=true`,
  {
    body: [...env.entries].map(([key, value]) => ({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview"],
    })),
  },
);

log("\n3. deployment");
const deploymentBody = {
  name: options.project,
  project: projectId ?? options.project,
  target: "production",
  files: files.map(({ file, sha, size }) => ({ file, sha, size })),
};
let deployment = await vercel(
  "POST",
  "/v13/deployments?skipAutoDetectionConfirmation=1",
  {
    body: deploymentBody,
    allow: [400],
  },
);
if (!dry && deployment.status === 400) {
  const needed = new Set(deployment.json?.error?.missing ?? []);
  if (deployment.json?.error?.code !== "missing_files" || needed.size === 0) {
    fail(`deployment refused: ${deployment.json?.error?.code ?? "unknown"}`);
  }
  log(`  uploading ${needed.size} files Vercel does not have`);
  const queue = files.filter((f) => needed.has(f.sha));
  const worker = async () => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
      const url = new URL("/v2/files", API);
      if (options.team) url.searchParams.set("teamId", options.team);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "x-vercel-digest": f.sha,
        },
        body: f.data,
      });
      if (!response.ok) fail(`upload of ${f.file} → ${response.status}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  deployment = await vercel(
    "POST",
    "/v13/deployments?skipAutoDetectionConfirmation=1",
    {
      body: deploymentBody,
    },
  );
}
if (dry) {
  log(
    "  (missing files are uploaded with POST /v2/files, then the deployment is retried)",
  );
  log(`  poll GET /v13/deployments/<id> until READY`);
  log(`  probe GET ${hosts.webOrigin}/favicon.ico`);
  log("\ndry run complete: no project, variable or deployment was touched.");
  process.exit(0);
}

const id = deployment.json?.id;
log(`  deployment ${id} (${deployment.json?.url ?? "no url yet"})`);
let state = deployment.json?.readyState;
for (
  let i = 0;
  i < 120 && !["READY", "ERROR", "CANCELED"].includes(state);
  i += 1
) {
  await new Promise((r) => setTimeout(r, 10_000));
  const poll = await vercel("GET", `/v13/deployments/${id}`);
  state = poll.json?.readyState;
  deployment = poll;
}
log(`  state: ${state}`);
if (state !== "READY")
  fail("deployment did not become READY; see the Vercel dashboard build log");

const aliases = (deployment.json?.alias ?? []).map((a) => `https://${a}`);
log(`  production domains: ${aliases.join(", ") || "none reported"}`);
if (aliases.length > 0 && !aliases.includes(hosts.webOrigin)) {
  log(
    `  WARNING: ${hosts.webOrigin} is not among them. Rerun this script and ` +
      "fly-deploy.mjs with --web-origin set to the real production domain.",
  );
}

try {
  const response = await fetch(`${hosts.webOrigin}/favicon.ico`, {
    signal: AbortSignal.timeout(15_000),
  });
  log(`  probe ${hosts.webOrigin}/favicon.ico → ${response.status}`);
} catch (error) {
  log(
    `  probe failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
log(
  "\ndone. Update the external addresses listed in docs/ai-handoff/FLY-DEPLOY.md.",
);
