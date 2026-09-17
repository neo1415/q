#!/usr/bin/env node
/* global console, URL, fetch, setTimeout */
/**
 * One command to demo Capital Q with Q's voice (CQ-Q-VOICE-001 rework):
 *
 *   pnpm demo            against whatever .env.local names
 *   pnpm demo --local    against the local Supabase stack, whatever
 *                        .env.local names (the hosted values stay put)
 *
 * 1. Works out which Supabase the configuration points at. Every service
 *    must agree: auth (SUPABASE_URL), the web app
 *    (NEXT_PUBLIC_SUPABASE_URL) and the database (DATABASE_URL) are
 *    either all the local stack or all one hosted project. A mix is
 *    refused up front, because it fails later in ways that look like
 *    everything else: a session the API cannot verify, a person the
 *    database has never heard of. `--local` makes them agree by taking
 *    every value from `supabase status`, without touching either file.
 * 2. Starts the local database if it is wanted and not running.
 * 3. Opens an ngrok tunnel to the Q API so the Speech Engine can reach it,
 *    and waits for the public hostname (never printed in full).
 * 4. Re-provisions the two Speech Engines against that hostname
 *    (pnpm voice:setup), because the hostname changes on every restart.
 * 5. Runs `pnpm dev` (web, api, q-api, workers) in the foreground.
 *
 * Stop with Ctrl+C; the tunnel is closed with it. The database is left
 * running. Nothing here prints a secret or a token.
 *
 * Run it from a terminal of your own. A stack started from inside another
 * application's process tree (an editor's terminal, an assistant's shell)
 * dies with that application: the Claude desktop app updated itself
 * mid-demo and took web, api, q-api and workers with it, with nothing in
 * this log to say so. `scripts/demo-detached.ps1` exists for that case.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(
  new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const shell = isWindows;

function log(message) {
  console.log(`[demo] ${message}`);
}

/** Set one key in .env.local, replacing an existing line or appending. */
function upsertEnv(key, value) {
  const file = resolve(root, ".env.local");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  const entry = `${key}=${value}`;
  if (index >= 0) lines[index] = entry;
  else lines.push(entry);
  writeFileSync(file, lines.join("\n"));
}

/** Read one key from an env file without printing it. */
function fileValue(file, key) {
  if (!existsSync(file)) return undefined;
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(
    readFileSync(file, "utf8"),
  );
  return match === null
    ? undefined
    : match[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * The value a service will actually see: the shell wins over the file,
 * exactly as dev-env.mjs and Next.js resolve it.
 */
function effective(key, file = resolve(root, ".env.local")) {
  const shell = process.env[key];
  if (shell !== undefined && shell.length > 0) return shell;
  return fileValue(file, key);
}

/** Whether a URL names this machine's Supabase stack or a hosted project. */
function supabaseTarget(url) {
  if (url === undefined || url.length === 0) return "unset";
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1"
      ? "local"
      : "hosted";
  } catch {
    return "unset";
  }
}

/**
 * What `supabase status` reports for the running local stack, as a map.
 * Values are never printed; the keys are the CLI's own.
 */
function localStackEnv() {
  const status = run("supabase", ["status", "-o", "env"], { quiet: true });
  if (status.status !== 0) return null;
  const out = {};
  for (const line of String(status.stdout ?? "").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function envHas(key) {
  const file = resolve(root, ".env.local");
  return new RegExp(`^${key}=.+`, "m").test(readFileSync(file, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.quiet ? "pipe" : "inherit",
    shell,
    encoding: "utf8",
  });
  return result;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function tunnelHost() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (response.ok) {
        const body = await response.json();
        const tunnel = (body.tunnels ?? []).find((t) =>
          String(t.public_url).startsWith("https://"),
        );
        if (tunnel) {
          return new URL(tunnel.public_url).host;
        }
      }
    } catch {
      // Not up yet.
    }
    await sleep(1000);
  }
  return null;
}

async function main() {
  if (!existsSync(resolve(root, ".env.local"))) {
    log("no .env.local found; copy .env.example and fill in the keys first.");
    process.exit(1);
  }

  const wantsLocal = process.argv.includes("--local");

  // 1. Which Supabase. Google sign-in on the LOCAL stack reads its
  // credentials from the environment at `supabase start`; without them the
  // provider is declared but cannot work. The plain GOOGLE_* names are
  // accepted as well, because that is what the Google console calls them
  // and what a person pastes. (A hosted project takes them in its own
  // dashboard; nothing here is sent anywhere.)
  for (const [key, alias] of [
    ["SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"],
    ["SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"],
  ]) {
    const value = effective(key) ?? effective(alias);
    if (value !== undefined && value.length > 0) {
      process.env[key] = value;
    } else {
      process.env[key] = "unset";
      log(
        `${key} (or ${alias}) is not in .env.local; Google sign-in on the local stack will not work until it is.`,
      );
    }
  }

  const webEnv = resolve(root, "apps/web/.env.local");
  const targets = {
    SUPABASE_URL: supabaseTarget(effective("SUPABASE_URL")),
    NEXT_PUBLIC_SUPABASE_URL: supabaseTarget(
      effective("NEXT_PUBLIC_SUPABASE_URL", webEnv),
    ),
    DATABASE_URL: supabaseTarget(effective("DATABASE_URL")),
  };
  const distinct = new Set(Object.values(targets));
  let target = wantsLocal ? "local" : ([...distinct][0] ?? "unset");
  if (!wantsLocal && (distinct.size > 1 || target === "unset")) {
    log("the configuration points at more than one Supabase:");
    for (const [key, where] of Object.entries(targets)) {
      log(`  ${key.padEnd(26)} ${where}`);
    }
    log(
      "Every service must use the same one. Either give DATABASE_URL (and DATABASE_MIGRATION_URL) the hosted project's connection strings and put the hosted URL and publishable key in apps/web/.env.local, or run `pnpm demo --local` to use the local stack for everything.",
    );
    process.exit(1);
  }

  if (target === "local") {
    const status = run("supabase", ["status"], { quiet: true });
    if (status.status !== 0) {
      log("starting the local database...");
      const started = run("supabase", ["start"]);
      if (started.status !== 0) {
        log("the database did not start; see the output above.");
        process.exit(1);
      }
    } else {
      log("database is running.");
    }
    if (wantsLocal) {
      // Every Supabase value from the running stack, for this process and
      // its children only. The files keep whatever they say.
      const stack = localStackEnv();
      if (stack === null) {
        log("could not read the local stack's settings (supabase status).");
        process.exit(1);
      }
      const mapping = {
        SUPABASE_URL: "API_URL",
        SUPABASE_PUBLISHABLE_KEY: "PUBLISHABLE_KEY",
        SUPABASE_SECRET_KEY: "SECRET_KEY",
        DATABASE_URL: "DB_URL",
        NEXT_PUBLIC_SUPABASE_URL: "API_URL",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "PUBLISHABLE_KEY",
      };
      for (const [key, from] of Object.entries(mapping)) {
        const value = stack[from];
        if (value === undefined || value.length === 0) {
          log(`the local stack did not report ${from}; cannot run --local.`);
          process.exit(1);
        }
        process.env[key] = value;
      }
      log("using the local Supabase stack for every service (--local).");
    }
  } else {
    log(
      "using the hosted Supabase project from .env.local; the local database is not started.",
    );
  }

  // 2. Tunnel. Reuse a running one; otherwise open one.
  let host = await Promise.race([tunnelHost(), sleep(1500).then(() => null)]);
  let tunnel = null;
  if (host === null) {
    log("opening a tunnel to the Q API...");
    tunnel = spawn(
      "ngrok",
      ["http", "3002", "--log=stdout", "--log-level=warn"],
      {
        cwd: root,
        stdio: "ignore",
        shell,
      },
    );
    host = await tunnelHost();
    if (host === null) {
      log(
        "the tunnel did not come up. Is ngrok installed and authenticated? (ngrok config add-authtoken ...)",
      );
      tunnel.kill();
      process.exit(1);
    }
  }
  log(`tunnel is up (…${host.slice(-18)}).`);

  // 3. This server's public origin, for the Deepgram think route.
  upsertEnv("Q_API_PUBLIC_URL", `https://${host}`);
  log("public origin recorded for the voice transport.");

  // 3b. ElevenLabs Speech Engines against this hostname, when they exist.
  if (!envHas("ELEVENLABS_SPEECH_ENGINE_ID")) {
    log("no ElevenLabs engines configured; skipping voice:setup.");
  } else {
    log("pointing the Speech Engines at the tunnel...");
    const setup = run(
      pnpm,
      ["voice:setup", "--", "--ws-url", `wss://${host}/v1/q/voice/ws`],
      {
        quiet: true,
      },
    );
    if (setup.status !== 0) {
      // Not fatal. The transport in use is Deepgram, which is configured
      // per session and needs nothing here; the ElevenLabs engines are
      // the secondary path. A ten-second network blip reaching
      // ElevenLabs once took the whole stack down before anything had
      // started, with a working tunnel left running on its own.
      log(
        "voice:setup did not complete; carrying on. ElevenLabs engines still point at the previous hostname. Re-run `pnpm voice:setup` once the network is back.",
      );
      console.log((setup.stdout ?? "") + (setup.stderr ?? ""));
    } else {
      log("Speech Engines ready.");
    }
  }

  // 4. Everything else.
  log("starting web, api, q-api and workers. Sign in at http://localhost:3000");
  const dev = spawn(pnpm, ["dev"], { cwd: root, stdio: "inherit", shell });
  const stop = () => {
    dev.kill();
    tunnel?.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  dev.on("exit", (code) => {
    tunnel?.kill();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
