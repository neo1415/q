#!/usr/bin/env node
/**
 * Deploys Capital Q's api, q-api and workers to Fly.io in one command — the
 * fallback host while Railway (ADR 0014) is unavailable. apps/web goes to
 * Vercel (scripts/deploy/vercel-deploy.mjs). Runbook and the env var
 * checklist: docs/ai-handoff/FLY-DEPLOY.md.
 *
 *   FLY_API_TOKEN=... node scripts/deploy/fly-deploy.mjs
 *   node scripts/deploy/fly-deploy.mjs --dry-run
 *   node scripts/deploy/fly-deploy.mjs --only api,q-api
 *
 * For each service, in order api → q-api → workers:
 *   1. creates the Fly app if it does not exist;
 *   2. reads <env-dir>/<service>.env (exported from Railway), drops every
 *      RAILWAY_* key and PORT, rewrites the cross-service addresses to the
 *      new hosts, and imports the result as staged secrets — values go to
 *      flyctl on stdin, never argv, and are never printed;
 *   3. deploys the root Dockerfile's target on Fly's remote builder, one
 *      machine, no dedicated IPv4, no volumes;
 *   4. probes the public health route.
 *
 * Flags:
 *   --only <a,b>          services (api, q-api, workers; `web` deploys the
 *                         web Docker target to Fly as a fallback to Vercel)
 *   --dry-run             print the plan (names only); run nothing, need no
 *                         token or flyctl
 *   --web-origin <url>    web's production origin (default
 *                         https://capital-q-web.vercel.app; pass the real
 *                         Vercel production domain once it is known)
 *   --prefix <p>          app name prefix (default capital-q → capital-q-api)
 *   --org <slug>          Fly organisation for new apps (default personal)
 *   --env-dir <dir>       env files (default ~/.cq-secrets/fly); must be
 *                         outside this repository
 *   --skip-secrets        deploy without importing secrets
 *   --install-flyctl      run Fly's installer (curl -L https://fly.io/install.sh | sh)
 *                         if flyctl is missing
 *
 * Per-service app names can also be set with FLY_APP_API, FLY_APP_Q_API,
 * FLY_APP_WORKERS and FLY_APP_WEB. Health probes use Node fetch; in the
 * cloud sandbox set NODE_USE_ENV_PROXY=1. No dependencies beyond Node 24.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const KNOWN = ["api", "q-api", "workers", "web"];
const DEFAULT_SERVICES = ["api", "q-api", "workers"];

/**
 * What each service's env file must hold before a deploy is attempted.
 * Names only. Mirrors packages/config: a deployed (non-local) service refuses
 * to start, or starts without its core function, without these.
 */
const REQUIRED = {
  api: [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
  ],
  "q-api": ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"],
  workers: ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY"],
  web: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
};

/** Public by design and inlined by `next build`: build args for web. */
const WEB_BUILD_ARGS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];

const HEALTH = {
  api: ["/health/live", "/health/ready"],
  "q-api": ["/health/live", "/health/ready"],
  web: ["/favicon.ico"],
  workers: [],
};

function fail(message) {
  console.error(`fly-deploy: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    only: DEFAULT_SERVICES,
    dryRun: false,
    webOrigin: DEFAULT_WEB_ORIGIN,
    prefix: "capital-q",
    org: "personal",
    envDir: join(homedir(), ".cq-secrets", "fly"),
    skipSecrets: false,
    installFlyctl: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        fail(`${arg} needs a value`);
      }
      i += 1;
      return next;
    };
    switch (arg) {
      case "--only":
        options.only = value()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--web-origin":
        try {
          options.webOrigin = parseOrigin(arg, value());
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
        break;
      case "--prefix":
        options.prefix = value();
        break;
      case "--org":
        options.org = value();
        break;
      case "--env-dir":
        options.envDir = resolve(value());
        break;
      case "--skip-secrets":
        options.skipSecrets = true;
        break;
      case "--install-flyctl":
        options.installFlyctl = true;
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
  const unknown = options.only.filter((s) => !KNOWN.includes(s));
  if (unknown.length > 0) {
    fail(
      `unknown service(s): ${unknown.join(", ")}; known: ${KNOWN.join(", ")}`,
    );
  }
  options.only = KNOWN.filter((s) => options.only.includes(s));
  return options;
}

function appName(options, service) {
  const key = `FLY_APP_${service.toUpperCase().replace(/-/g, "_")}`;
  const override = process.env[key]?.trim();
  return override === undefined || override === ""
    ? `${options.prefix}-${service}`
    : override;
}

const flyOrigin = (app) => `https://${app}.fly.dev`;

function findFlyctl() {
  const candidates = [
    "flyctl",
    "fly",
    join(homedir(), ".fly", "bin", "flyctl"),
    process.env.FLYCTL_INSTALL
      ? join(process.env.FLYCTL_INSTALL, "bin", "flyctl")
      : undefined,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

/** fly secrets import input: one NAME=value per line, multi-line quoted. */
function secretsPayload(entries) {
  return (
    [...entries]
      .map(([name, value]) =>
        value.includes("\n") ? `${name}="""${value}"""` : `${name}=${value}`,
      )
      .join("\n") + "\n"
  );
}

/** Quotes for display only; commands are spawned with an argv array. */
const show = (argv) =>
  argv
    .map((a) =>
      /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`,
    )
    .join(" ");

// --------------------------------------------------------------------- main

const options = parseArgs(process.argv.slice(2));
const dry = options.dryRun;
const log = (line = "") => console.log(line);

const hosts = {
  webOrigin: options.only.includes("web")
    ? // Fallback: web on Fly serves at its own Fly address unless told otherwise.
      options.webOrigin === DEFAULT_WEB_ORIGIN
      ? flyOrigin(appName(options, "web"))
      : options.webOrigin
    : options.webOrigin,
  apiOrigin: flyOrigin(appName(options, "api")),
  qApiOrigin: flyOrigin(appName(options, "q-api")),
};

log(`Capital Q → Fly.io${dry ? " (dry run: nothing is executed)" : ""}`);
log(`services: ${options.only.join(", ")}   org: ${options.org}   region: ams`);
log(`env dir:  ${options.skipSecrets ? "skipped" : options.envDir}`);
log(
  `hosts:    web ${hosts.webOrigin}  api ${hosts.apiOrigin}  q-api ${hosts.qApiOrigin}`,
);
log();

if (!options.skipSecrets && insideRepo(repoRoot, options.envDir)) {
  fail("--env-dir is inside the repository; env files must live outside it");
}

const token = process.env.FLY_API_TOKEN?.trim() ?? "";
let flyctl = dry ? (findFlyctl() ?? "flyctl") : findFlyctl();
if (!dry) {
  if (token === "") fail("FLY_API_TOKEN is not set (a Fly org deploy token)");
  if (flyctl === undefined && options.installFlyctl) {
    log("installing flyctl: curl -L https://fly.io/install.sh | sh");
    const install = spawnSync(
      "sh",
      ["-c", "curl -fsSL https://fly.io/install.sh | sh"],
      { stdio: "inherit" },
    );
    if (install.status !== 0) fail("flyctl install failed");
    flyctl = findFlyctl();
  }
  if (flyctl === undefined) {
    fail(
      "flyctl not found. Install it with `curl -L https://fly.io/install.sh | sh` " +
        "(adds ~/.fly/bin/flyctl), or rerun with --install-flyctl",
    );
  }
}

// flyctl reads FLY_API_TOKEN from the environment; it is never an argument.
const childEnv = { ...process.env, FLY_API_TOKEN: token };

/** Runs (or, in a dry run, prints) one flyctl command. */
function fly(
  args,
  { input, inputNote, allowFailure = false, capture = false } = {},
) {
  log(`  $ ${show([flyctl, ...args])}${inputNote ? `  < ${inputNote}` : ""}`);
  if (dry) return { status: 0, stdout: "" };
  const result = spawnSync(flyctl, args, {
    cwd: repoRoot,
    env: childEnv,
    input,
    encoding: "utf8",
    stdio: [
      input === undefined ? "inherit" : "pipe",
      capture ? "pipe" : "inherit",
      "inherit",
    ],
  });
  if (result.status !== 0 && !allowFailure) {
    fail(`flyctl ${args[0]} ${args[1] ?? ""} failed (exit ${result.status})`);
  }
  return result;
}

let existingApps = new Set();
if (!dry) {
  const list = fly(["apps", "list", "--json"], { capture: true });
  try {
    existingApps = new Set(
      JSON.parse(list.stdout).map((app) => app.Name ?? app.name),
    );
  } catch {
    fail("could not read `flyctl apps list --json`");
  }
}

const problems = [];
const plan = [];
for (const service of options.only) {
  const app = appName(options, service);
  const envFile = join(options.envDir, `${service}.env`);
  let env = { entries: new Map(), dropped: [], rewritten: [], added: [] };
  if (!options.skipSecrets) {
    if (!existsSync(envFile)) {
      problems.push(`${service}: env file missing: ${envFile}`);
    } else {
      try {
        env = planEnv(service, readEnvFile(envFile), hosts);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
      const missing = REQUIRED[service].filter(
        (name) => (env.entries.get(name) ?? "").trim() === "",
      );
      if (missing.length > 0) {
        problems.push(
          `${service}: ${envFile} lacks required ${missing.join(", ")}`,
        );
      }
    }
  }
  plan.push({ service, app, envFile, env });
}

if (problems.length > 0) {
  for (const p of problems) console.error(`fly-deploy: ${p}`);
  if (!dry) process.exit(1);
  log("(dry run continues despite the problems above)\n");
}

for (const { service, app, envFile, env } of plan) {
  log(`── ${service} → ${app} (${flyOrigin(app)})`);

  // 1. App.
  if (dry || !existingApps.has(app)) {
    fly(["apps", "create", app, "--org", options.org], { allowFailure: dry });
  } else {
    log(`  app ${app} exists`);
  }

  // 2. Secrets: the rewritten env file, staged so they apply with the deploy.
  if (!options.skipSecrets && env.entries.size > 0) {
    log(`  env from ${envFile}:`);
    log(describePlan(env));
    fly(["secrets", "import", "--app", app, "--stage"], {
      input: secretsPayload(env.entries),
      inputNote: `${env.entries.size} names: ${[...env.entries.keys()].join(", ")}`,
    });
  }

  // 3. Deploy on Fly's remote builder.
  const deployArgs = [
    "deploy",
    repoRoot,
    "--config",
    join(repoRoot, "deploy", "fly", `${service}.fly.toml`),
    "--app",
    app,
    "--dockerfile",
    join(repoRoot, "Dockerfile"),
    "--build-target",
    service,
    "--remote-only",
    "--ha=false",
  ];
  const displayArgs = [...deployArgs];
  if (service === "web") {
    for (const name of WEB_BUILD_ARGS) {
      deployArgs.push("--build-arg", `${name}=${env.entries.get(name) ?? ""}`);
      displayArgs.push("--build-arg", `${name}=<from ${service}.env>`);
    }
  }
  log(`  $ ${show([flyctl, ...displayArgs])}`);
  if (!dry) {
    const result = spawnSync(flyctl, deployArgs, {
      cwd: repoRoot,
      env: childEnv,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      fail(`deploy of ${service} failed (exit ${result.status})`);
    }
  }

  // 4. Health.
  if (service === "workers") {
    fly(["status", "--app", app], { allowFailure: true });
  }
  for (const path of HEALTH[service]) {
    const url = `${flyOrigin(app)}${path}`;
    log(`  probe GET ${url}`);
    if (dry) continue;
    let outcome = "no response";
    // Up to ~2 minutes: a stopped machine is started by the first request.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        outcome = `${response.status}`;
        if (response.ok) break;
      } catch (error) {
        outcome = error instanceof Error ? error.message : String(error);
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    log(`    → ${outcome}`);
  }
  log();
}

log(
  dry
    ? "dry run complete: no app, secret or deploy was touched."
    : "done. Update the external addresses listed in docs/ai-handoff/FLY-DEPLOY.md.",
);
