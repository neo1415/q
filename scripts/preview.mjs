#!/usr/bin/env node
/**
 * The tester's stack (QX-DEV-001).
 *
 *   pnpm preview:start     bring it up on the current pushed commit
 *   pnpm preview:status    where it is, what it is on, whether Q answers
 *   pnpm preview:update    move it to the current pushed commit
 *   pnpm preview:stop      take it down (explicit only)
 *
 * Why this exists. Development is destructive by nature: packages are
 * rebuilt, services restart on every watched file, the demo stack is
 * stopped to run integration tests, and `db:reset` empties the database.
 * Somebody testing Capital Q at the same time saw "Can't reach Q" over and
 * over, through no fault of their own. This is a second, whole Capital Q
 * that development cannot reach.
 *
 * Four separations, and each one had to be real for the rest to matter.
 *
 * **A different checkout.** The preview is a detached git worktree at an
 * exact pushed commit — never a branch anybody could commit into by
 * accident, and never the working tree, so an unsaved half-written file
 * cannot appear in front of a tester.
 *
 * **A different build.** It runs built output, not `node --watch`. The
 * watch scope in development is already known to be too wide
 * (CQ-DEV-WATCH-SCOPE-001); a preview that watched anything would inherit
 * that, and rebuilding a package for development would restart the
 * tester's session.
 *
 * **A different database.** Its own Supabase project, its own containers,
 * its own volumes, its own ports. `pnpm db:reset` against development does
 * not touch it, which is the whole point: the tester's account still
 * exists after the agent empties its own database.
 *
 * **A different port range.** Everything is offset so the two stacks never
 * contend, and `pnpm demo:stop` matches this worktree and not the
 * preview's — a bare path prefix used to match both, because
 * `...\\Desktop\\q` is a prefix of `...\\Desktop\\q-preview`.
 *
 * **A different host name**, which is the one nobody expects. A browser
 * scopes cookies by host and ignores the port, so `localhost:3000` and
 * `localhost:3100` share one cookie jar: signing into development signs
 * you out of the preview, and a stale refresh token from one produces
 * "Invalid Refresh Token" in the other. The preview is therefore served
 * at `127.0.0.1` while development keeps `localhost`. Same machine,
 * different origin, separate sessions.
 *
 * Nothing here prints a secret. Keys come from the preview stack itself.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  ensurePreviewAccounts,
  PREVIEW_ACCOUNT_PASSWORD,
  PREVIEW_ACCOUNTS,
} from "./preview-accounts.mjs";

const root = resolve(
  new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";

/**
 * Where the preview lives. Siblings of the repository rather than folders
 * inside it: anything inside would be swept by a clean, matched by a watch
 * and picked up by the formatter.
 */
const WORKTREE = resolve(root, "..", "q-preview");
const DATA = resolve(root, "..", "q-preview-data");
const SUPABASE_DIR = join(DATA, "supabase");

/**
 * One coherent range, offset from development by 100 so the mapping stays
 * readable: 3000/3001/3002 becomes 3100/3101/3102, and every Supabase port
 * moves by the same 100.
 */
const PORTS = {
  web: 3100,
  api: 3101,
  qApi: 3102,
  supabaseApi: 54421,
  supabaseDb: 54422,
};
const SUPABASE_PROJECT = "capital-q-preview";
/** Every Supabase port in config.toml, and what it becomes here. */
const SUPABASE_PORT_MAP = {
  54321: 54421,
  54322: 54422,
  54320: 54420,
  54329: 54429,
  54323: 54423,
  54324: 54424,
  54327: 54427,
};

const log = (message) => {
  console.log(`[preview] ${message}`);
};

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.quiet === true ? "pipe" : "inherit",
    shell: isWindows,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The commit the preview may be moved to: the upstream branch head. */
function pushedHead() {
  run("git", ["fetch", "origin", "--quiet"], { quiet: true });
  const upstream = run("git", ["rev-parse", "@{u}"], { quiet: true });
  if (upstream.status !== 0) {
    log("this branch has no upstream; push it before starting a preview.");
    process.exit(1);
  }
  return String(upstream.stdout ?? "").trim();
}

function worktreeCommit() {
  if (!existsSync(WORKTREE)) return null;
  const head = run("git", ["rev-parse", "HEAD"], {
    cwd: WORKTREE,
    quiet: true,
  });
  return head.status === 0 ? String(head.stdout ?? "").trim() : null;
}

/**
 * The preview's own Supabase project, generated rather than edited.
 *
 * The worktree's `supabase/config.toml` is tracked, so changing it there
 * would make the worktree dirty and break the one promise this thing makes
 * — that the preview is exactly a pushed commit. Instead the file is
 * copied out to a directory git does not know about, with the project name
 * and every port rewritten, and the CLI is pointed at it with `--workdir`.
 * Migrations and the seed are copied from the worktree, so the preview's
 * schema is the schema of the commit it is running.
 */
function writeSupabaseWorkdir(fromWorktree) {
  mkdirSync(SUPABASE_DIR, { recursive: true });
  const source = join(fromWorktree, "supabase");

  let config = readFileSync(join(source, "config.toml"), "utf8");
  config = config.replace(
    /^project_id\s*=\s*".*"$/m,
    `project_id = "${SUPABASE_PROJECT}"`,
  );
  for (const [from, to] of Object.entries(SUPABASE_PORT_MAP)) {
    config = config.replace(
      new RegExp(`^(\\s*(?:shadow_)?port\\s*=\\s*)${from}\\s*$`, "gm"),
      `$1${to}`,
    );
  }
  // Anything that named a development port inside a URL moves with it.
  for (const [from, to] of Object.entries(SUPABASE_PORT_MAP)) {
    config = config.split(`:${from}`).join(`:${to}`);
  }
  writeFileSync(join(SUPABASE_DIR, "config.toml"), config);

  for (const part of ["migrations", "seed.sql", "tests"]) {
    const src = join(source, part);
    if (!existsSync(src)) continue;
    const dest = join(SUPABASE_DIR, part);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  }
}

function supabase(args, options = {}) {
  return run("npx", ["supabase", ...args, "--workdir", DATA], options);
}

/** What the preview stack reports about itself. Values are never printed. */
function previewStackEnv() {
  const status = supabase(["status", "-o", "env"], { quiet: true });
  if (status.status !== 0) return null;
  const out = {};
  for (const line of String(status.stdout ?? "").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * The environment the preview services run in.
 *
 * Written to a file git does not track, beside the worktree rather than
 * inside it. Every Supabase value comes from the preview stack, so there is
 * no way for a copied line to point the tester at the development database.
 * Provider keys are carried across from development because they are the
 * same account and this packet adds none.
 */
function writeEnvFile(stack) {
  const carried = [
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "GROQ_API_KEY_2",
    "GROQ_API_KEY_3",
    "GROQ_API_KEY_4",
    "ELEVENLABS_API_KEY",
    "DEEPGRAM_API_KEY",
    "TAVILY_API_KEY",
    "CQ_SYNTHETIC_DEMO_ROUTING",
  ];
  const devEnv = existsSync(join(root, ".env.local"))
    ? readFileSync(join(root, ".env.local"), "utf8")
    : "";
  const valueOf = (key) => {
    const match = new RegExp(`^${key}=(.*)$`, "m").exec(devEnv);
    return process.env[key] ?? (match === null ? undefined : match[1].trim());
  };

  const lines = [
    "# Generated by pnpm preview:start. Not tracked, not edited by hand.",
    `SUPABASE_URL=${stack.API_URL}`,
    `SUPABASE_PUBLISHABLE_KEY=${stack.PUBLISHABLE_KEY}`,
    `SUPABASE_SECRET_KEY=${stack.SECRET_KEY}`,
    `DATABASE_URL=${stack.DB_URL}`,
    `DATABASE_MIGRATION_URL=${stack.DB_URL}`,
    `NEXT_PUBLIC_SUPABASE_URL=${stack.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${stack.PUBLISHABLE_KEY}`,
    `NEXT_PUBLIC_CQ_API_URL=http://127.0.0.1:${String(PORTS.api)}`,
    `NEXT_PUBLIC_CQ_Q_API_URL=http://127.0.0.1:${String(PORTS.qApi)}`,
    `CQ_API_URL=http://127.0.0.1:${String(PORTS.api)}`,
    `CQ_Q_API_URL=http://127.0.0.1:${String(PORTS.qApi)}`,
    "CAPITAL_Q_ENV=local",
    "NODE_ENV=production",
  ];
  for (const key of carried) {
    const value = valueOf(key);
    if (value !== undefined && value.length > 0) lines.push(`${key}=${value}`);
  }
  writeFileSync(join(DATA, ".env.preview"), `${lines.join("\n")}\n`);
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function health() {
  return {
    web: await reachable(`http://127.0.0.1:${String(PORTS.web)}/`),
    api: await reachable(`http://127.0.0.1:${String(PORTS.api)}/health/ready`),
    qApi: await reachable(
      `http://127.0.0.1:${String(PORTS.qApi)}/health/ready`,
    ),
  };
}

function banner(commit) {
  const line = "=".repeat(53);
  console.log(`\n${line}`);
  console.log("CAPITAL Q TESTER STACK READY");
  console.log(`OPEN: http://127.0.0.1:${String(PORTS.web)}`);
  console.log(`COMMIT: ${commit}`);
  console.log(`${line}\n`);
}

async function report() {
  const commit = worktreeCommit();
  const states = await health();
  console.log("");
  console.log(`Commit:    ${commit ?? "(no preview worktree)"}`);
  console.log(
    `Web:       http://127.0.0.1:${String(PORTS.web)}   ${states.web ? "READY" : "down"}`,
  );
  console.log(
    "           (127.0.0.1, not localhost: a browser shares cookies across",
  );
  console.log(
    "            ports on one host, so localhost would share development's",
  );
  console.log("            session and sign the tester out.)");
  console.log(
    `API:       http://127.0.0.1:${String(PORTS.api)}   ${states.api ? "READY" : "down"}`,
  );
  console.log(
    `Q API:     http://127.0.0.1:${String(PORTS.qApi)}   ${states.qApi ? "READY" : "down"}`,
  );
  console.log(
    `Database:  ${SUPABASE_PROJECT} on 127.0.0.1:${String(PORTS.supabaseDb)} (api ${String(PORTS.supabaseApi)})`,
  );
  console.log(
    "Voice:     shares development's tunnel; see the ledger for the constraint",
  );
  // Whether somebody can sign in, never who or with what. `pnpm
  // preview:accounts` prints the details, because asking for them is the
  // moment to show them.
  // Whether somebody can sign in, never who or with what. `pnpm
  // preview:accounts` prints the details, because asking for them is the
  // moment to show them.
  console.log(
    `Users:     synthetic Founder / Investor: ${
      states.api ? "READY (pnpm preview:accounts)" : "unknown (API down)"
    }`,
  );
  console.log("");
  return states.web && states.api && states.qApi;
}

/** Bring the worktree to an exact pushed commit. */
function placeWorktree(commit) {
  if (!existsSync(WORKTREE)) {
    mkdirSync(dirname(WORKTREE), { recursive: true });
    log(`creating the preview worktree at ${WORKTREE}`);
    const added = run("git", ["worktree", "add", "--detach", WORKTREE, commit]);
    if (added.status !== 0) {
      log("could not create the preview worktree.");
      process.exit(1);
    }
    return;
  }
  // Detached on purpose: there is no branch here for anybody to commit to.
  const moved = run("git", ["checkout", "--detach", commit], {
    cwd: WORKTREE,
  });
  if (moved.status !== 0) {
    log("could not move the preview worktree to that commit.");
    process.exit(1);
  }
}

function buildPreview() {
  log("installing and building the preview (its own node_modules and dist)");
  const installed = run(pnpm, ["install", "--frozen-lockfile"], {
    cwd: WORKTREE,
  });
  if (installed.status !== 0) {
    log("pnpm install failed in the preview worktree.");
    process.exit(1);
  }
  const built = run(pnpm, ["build"], { cwd: WORKTREE });
  if (built.status !== 0) {
    log("the preview build failed.");
    process.exit(1);
  }
}

function startServices() {
  const script = join(root, "scripts", "preview-detached.ps1");
  if (!isWindows) {
    log("only the Windows launcher exists today; see the ledger.");
    process.exit(1);
  }
  const started = run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-Worktree",
    WORKTREE,
    "-EnvFile",
    join(DATA, ".env.preview"),
    "-LogFile",
    join(DATA, "preview.log"),
    "-WebPort",
    String(PORTS.web),
    "-ApiPort",
    String(PORTS.api),
    "-QApiPort",
    String(PORTS.qApi),
  ]);
  if (started.status !== 0) {
    log("the preview services did not start.");
    process.exit(1);
  }
}

function stopServices() {
  if (!isWindows) return;
  run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(root, "scripts", "preview-stop.ps1"),
    "-Worktree",
    WORKTREE,
  ]);
}

async function waitForHealth(seconds) {
  for (let attempt = 0; attempt < seconds; attempt += 1) {
    const states = await health();
    if (states.web && states.api && states.qApi) return true;
    await sleep(1000);
  }
  return false;
}

async function bringUp({ reset }) {
  const commit = pushedHead();
  placeWorktree(commit);
  writeSupabaseWorkdir(WORKTREE);

  const running = supabase(["status"], { quiet: true });
  if (running.status !== 0) {
    log(`starting the preview database (${SUPABASE_PROJECT})`);
    const started = supabase(["start"]);
    if (started.status !== 0) {
      log("the preview database did not start.");
      process.exit(1);
    }
  }
  if (reset) {
    // Only ever the preview's own project. Development's `db:reset` has no
    // idea this exists, and this has no idea development exists.
    log("applying the preview's migrations and seed");
    const reseeded = supabase(["db", "reset"]);
    if (reseeded.status !== 0) {
      log("the preview database could not be reset.");
      process.exit(1);
    }
  }

  const stack = previewStackEnv();
  if (stack === null) {
    log("could not read the preview stack's settings.");
    process.exit(1);
  }
  writeEnvFile(stack);
  buildPreview();
  stopServices();
  startServices();

  log("waiting for the preview to answer...");
  const up = await waitForHealth(180);
  if (up) {
    // The reset took auth.users with it and the repository seed creates
    // none, so the tester's accounts go back before the stack is handed
    // over. It needs the API, so it waits for health first.
    const seeded = ensurePreviewAccounts({
      stack,
      apiUrl: `http://127.0.0.1:${String(PORTS.api)}`,
      dataDir: DATA,
    });
    log(
      seeded.ok
        ? "synthetic preview accounts: READY (pnpm preview:accounts)"
        : `synthetic preview accounts: NOT SEEDED (${seeded.reason})`,
    );
  }
  await report();
  if (!up) {
    log(`not all services are up; see ${join(DATA, "preview.log")}`);
    process.exit(1);
  }
  banner(commit);
}

const command = process.argv[2] ?? "status";
switch (command) {
  case "start":
    await bringUp({ reset: true });
    break;
  case "update":
    // The same path, because moving to a new commit may bring migrations
    // with it. The tester's accounts are re-seeded from the preview's own
    // seed, never from development.
    await bringUp({ reset: true });
    break;
  case "stop":
    stopServices();
    log("preview services stopped. The preview database is left running.");
    break;
  case "status":
    process.exit((await report()) ? 0 : 1);
    break;
  case "accounts": {
    // Explicitly asked for, so explicitly printed. Nothing else in this
    // script ever writes a password to a console or a log.
    console.log("");
    console.log(
      `Preview sign-in at http://127.0.0.1:${String(PORTS.web)}/auth/sign-in`,
    );
    console.log("(synthetic accounts; this machine only)");
    for (const account of PREVIEW_ACCOUNTS) {
      console.log(`  ${account.label.padEnd(10)} ${account.email}`);
    }
    console.log(`  password   ${PREVIEW_ACCOUNT_PASSWORD}`);
    console.log("");
    break;
  }
  default:
    log(
      `unknown command "${command}"; use start, status, update, accounts or stop.`,
    );
    process.exit(1);
}
