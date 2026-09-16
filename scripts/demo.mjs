#!/usr/bin/env node
/* global console, URL, fetch, setTimeout */
/**
 * One command to demo Capital Q with Q's voice (CQ-Q-VOICE-001 rework):
 *
 *   pnpm demo
 *
 * 1. Starts the local database if it is not running (supabase start).
 * 2. Opens an ngrok tunnel to the Q API so the Speech Engine can reach it,
 *    and waits for the public hostname (never printed in full).
 * 3. Re-provisions the two Speech Engines against that hostname
 *    (pnpm voice:setup), because the hostname changes on every restart.
 * 4. Runs `pnpm dev` (web, api, q-api, workers) in the foreground.
 *
 * Stop with Ctrl+C; the tunnel is closed with it. The database is left
 * running. Nothing here prints a secret or a token.
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

/** Read one key from .env.local without printing it. */
function envValue(key) {
  const file = resolve(root, ".env.local");
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(
    readFileSync(file, "utf8"),
  );
  return match === null
    ? undefined
    : match[1].trim().replace(/^["']|["']$/g, "");
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

  // 1. Database. Google sign-in reads its credentials from the
  // environment; without them the provider is declared but cannot work.
  for (const key of [
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET",
  ]) {
    const value = envValue(key);
    if (value !== undefined && value.length > 0) {
      process.env[key] = value;
    } else if (process.env[key] === undefined) {
      process.env[key] = "unset";
      log(
        `${key} is not in .env.local; Google sign-in will not work until it is.`,
      );
    }
  }
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
      log("voice:setup failed:");
      console.log((setup.stdout ?? "") + (setup.stderr ?? ""));
      tunnel?.kill();
      process.exit(1);
    }
    log("Speech Engines ready.");
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
