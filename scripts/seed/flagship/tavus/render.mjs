#!/usr/bin/env node
/**
 * Flagship presenter videos: render one company's AI-presenter video on Tavus.
 *
 * Reads docs/flagship/<slug>/video/plan.json and, only with --apply and
 * TAVUS_API_KEY set, sends Tavus "Generate Video" (POST /v2/videos, x-api-key
 * header, body { replica_id, script, video_name, background_url?,
 * properties? }). The returned video_id is stored in
 * docs/flagship/<slug>/video/state.json.
 *
 * Why it is strict:
 * - Tavus has no idempotency key, so this tool is the guard. A slug that
 *   already has a video_id is never re-created, and there is no --force. A
 *   "requesting" marker is written before the POST, so a crash between the
 *   POST and saving the id refuses a second POST until someone checks the
 *   Tavus video list by hand and clears the marker.
 * - Credits are the founder's. Each script is estimated at 2.5 spoken words
 *   per second; a script over 62 s, or all four plans together over 240 s,
 *   is refused before anything is sent.
 * - The API key is read from the environment, sent only as a header and never
 *   printed, logged or written to disk.
 *
 *   node scripts/seed/flagship/tavus/render.mjs kuuza            # dry run
 *   node scripts/seed/flagship/tavus/render.mjs kuuza --apply    # creates once
 *   node scripts/seed/flagship/tavus/render.mjs kuuza --status   # poll + download
 *   node scripts/seed/flagship/tavus/render.mjs --check          # budget only
 *
 * --status polls GET /v2/videos/{video_id} until `ready` (or `error`/`deleted`)
 * and downloads download_url to /tmp/claude-0/acc/flagship/video/<slug>.mp4.
 * Behind the cloud egress proxy run with NODE_USE_ENV_PROXY=1.
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../../..");
const FLAGSHIP = join(REPO, "docs/flagship");
const TAVUS = "https://tavusapi.com";
const OUT_DIR = "/tmp/claude-0/acc/flagship/video";
const WORDS_PER_SECOND = 2.5;
const MAX_SCRIPT_SECONDS = 62;
const MAX_TOTAL_SECONDS = 240;
const POLL_MS = 30_000;
const POLL_MAX_MS = 45 * 60_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const APPLY = flag("--apply");
const STATUS = flag("--status");
const CHECK = flag("--check");
const slug = args.find((a) => !a.startsWith("--"));

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

if (flag("--force"))
  fail("--force is not supported: a video is created once per slug.", 2);
if (APPLY && STATUS) fail("Use --apply or --status, not both.", 2);

const wordsOf = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const estimateSeconds = (text) => wordsOf(text) / WORDS_PER_SECOND;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function planPath(s) {
  return join(FLAGSHIP, s, "video", "plan.json");
}
function statePath(s) {
  return join(FLAGSHIP, s, "video", "state.json");
}

function readPlan(s) {
  const file = planPath(s);
  if (!existsSync(file)) fail(`No plan at ${file}`);
  const plan = JSON.parse(readFileSync(file, "utf8"));
  const problems = [];
  if (
    typeof plan.replicaId !== "string" ||
    !/^r[0-9a-z]{6,}$/.test(plan.replicaId)
  )
    problems.push("replicaId must be a Tavus stock replica id (r…)");
  if (typeof plan.script !== "string" || plan.script.trim().length === 0)
    problems.push("script is required");
  if (typeof plan.targetSeconds !== "number" || plan.targetSeconds <= 0)
    problems.push("targetSeconds must be a positive number");
  if (typeof plan.videoName !== "string" || plan.videoName.length === 0)
    problems.push("videoName is required");
  // The disclosure must be heard, not only captioned: within the first 20 words.
  if (
    typeof plan.script === "string" &&
    !/\bAI presenter\b/i.test(
      plan.script.trim().split(/\s+/).slice(0, 20).join(" "),
    )
  )
    problems.push("the opening must identify the presenter as an AI presenter");
  if (plan.background?.url != null && !/^https:\/\//.test(plan.background.url))
    problems.push("background.url must be https or null");
  if (problems.length > 0)
    fail(`${s}: invalid plan\n - ${problems.join("\n - ")}`);
  return plan;
}

function readState(s) {
  const file = statePath(s);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
function writeState(s, state) {
  writeFileSync(statePath(s), `${JSON.stringify(state, null, 2)}\n`);
}

/** Every plan across docs/flagship, so the 240 s cap covers all companies. */
function budget() {
  const rows = readdirSync(FLAGSHIP, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(planPath(d.name)))
    .map((d) => {
      const plan = readPlan(d.name);
      return {
        slug: d.name,
        words: wordsOf(plan.script),
        seconds: estimateSeconds(plan.script),
        target: plan.targetSeconds,
      };
    });
  const total = rows.reduce((sum, r) => sum + r.seconds, 0);
  return { rows, total };
}

function enforceBudget() {
  const { rows, total } = budget();
  for (const r of rows)
    console.log(
      `  ${r.slug.padEnd(16)} ${String(r.words).padStart(4)} words  ≈${r.seconds.toFixed(1)} s  (target ${r.target} s)`,
    );
  console.log(
    `  total ≈${total.toFixed(1)} s of ${MAX_TOTAL_SECONDS} s allowed`,
  );
  const over = rows.filter((r) => r.seconds > MAX_SCRIPT_SECONDS);
  if (over.length > 0)
    fail(
      `Refused: ${over.map((r) => r.slug).join(", ")} estimated over ${MAX_SCRIPT_SECONDS} s.`,
    );
  if (total > MAX_TOTAL_SECONDS)
    fail(`Refused: all plans together estimated over ${MAX_TOTAL_SECONDS} s.`);
}

/** Only fields from the Tavus Generate Video schema. */
function requestBody(plan) {
  const body = {
    replica_id: plan.replicaId,
    script: plan.script.trim(),
    video_name: plan.videoName,
  };
  if (plan.background?.url) body.background_url = plan.background.url;
  if (typeof plan.startWithWave === "boolean")
    body.properties = { start_with_wave: plan.startWithWave };
  return body;
}

function apiKey() {
  const key = process.env.TAVUS_API_KEY ?? "";
  if (key.length === 0) fail("TAVUS_API_KEY is not set (never printed).", 2);
  return key;
}

async function tavus(method, path, body) {
  const response = await fetch(`${TAVUS}${path}`, {
    method,
    headers: {
      "x-api-key": apiKey(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 300) };
  }
  return { status: response.status, ok: response.ok, payload };
}

function outOfCredit(where) {
  fail(
    `Tavus returned HTTP 402 (out of credit) on ${where}. Nothing more was sent. ` +
      "Top up the Tavus account, or stop here; do not retry in a loop.",
    3,
  );
}

const errorText = (payload) =>
  String(payload?.error ?? payload?.message ?? JSON.stringify(payload)).slice(
    0,
    300,
  );

// ---------------------------------------------------------------- commands

async function create(s, plan) {
  const state = readState(s);
  if (state?.video_id) {
    console.log(
      `${s}: already created as video_id ${state.video_id} (status ${state.status ?? "unknown"}). Not re-creating; use --status.`,
    );
    return;
  }
  if (state?.status === "requesting")
    fail(
      `${s}: an earlier --apply started a request at ${state.requestedAt} and did not record a video_id. ` +
        "Check the Tavus video list for a video named " +
        JSON.stringify(plan.videoName) +
        " and record its id in state.json, or delete state.json if none exists. Refusing to POST again.",
    );
  const body = requestBody(plan);
  const base = {
    slug: s,
    replicaId: plan.replicaId,
    videoName: plan.videoName,
    scriptSha256: sha256(body.script),
    estimatedSeconds: Number(estimateSeconds(body.script).toFixed(1)),
  };
  writeState(s, {
    ...base,
    status: "requesting",
    requestedAt: new Date().toISOString(),
  });
  let result;
  try {
    result = await tavus("POST", "/v2/videos", body);
  } catch (error) {
    // Unknown outcome: keep the marker so nothing is POSTed twice.
    fail(
      `${s}: request failed before a response (${error instanceof Error ? error.message : error}). Marker kept.`,
    );
  }
  if (result.status === 402) {
    writeState(s, {
      ...base,
      status: "not_created",
      lastError: "HTTP 402 out of credit",
      at: new Date().toISOString(),
    });
    outOfCredit("POST /v2/videos");
  }
  if (!result.ok || typeof result.payload?.video_id !== "string") {
    // 4xx means Tavus rejected it and nothing was created; 5xx is ambiguous.
    const definite = result.status >= 400 && result.status < 500;
    writeState(s, {
      ...base,
      status: definite ? "not_created" : "requesting",
      requestedAt: new Date().toISOString(),
      lastError: `HTTP ${result.status} ${errorText(result.payload)}`,
    });
    fail(`${s}: Tavus HTTP ${result.status}: ${errorText(result.payload)}`);
  }
  const p = result.payload;
  writeState(s, {
    ...base,
    video_id: p.video_id,
    status: p.status ?? "queued",
    hosted_url: p.hosted_url ?? null,
    created_at: p.created_at ?? null,
    recordedAt: new Date().toISOString(),
  });
  console.log(
    `${s}: created video_id ${p.video_id} (${p.status ?? "queued"}). Next: --status`,
  );
}

async function status(s) {
  const state = readState(s);
  if (!state?.video_id)
    fail(`${s}: no video_id in state.json; nothing to poll.`);
  const id = encodeURIComponent(state.video_id);
  const started = Date.now();
  for (;;) {
    const result = await tavus("GET", `/v2/videos/${id}`);
    if (result.status === 402) outOfCredit(`GET /v2/videos/${state.video_id}`);
    if (!result.ok)
      fail(`${s}: Tavus HTTP ${result.status}: ${errorText(result.payload)}`);
    const v = result.payload;
    const next = {
      ...state,
      status: v.status ?? state.status,
      status_details: v.status_details ?? null,
      hosted_url: v.hosted_url ?? state.hosted_url ?? null,
      updated_at: v.updated_at ?? null,
      checkedAt: new Date().toISOString(),
    };
    writeState(s, next);
    console.log(
      `${s}: ${next.status}${next.status_details ? ` (${next.status_details})` : ""}`,
    );
    if (v.status === "ready") {
      if (typeof v.download_url !== "string" || v.download_url.length === 0)
        fail(
          `${s}: ready but no download_url yet; run --status again shortly.`,
        );
      mkdirSync(OUT_DIR, { recursive: true });
      const out = join(OUT_DIR, `${s}.mp4`);
      // download_url is a direct file link; the API key is not sent to it.
      const file = await fetch(v.download_url);
      if (!file.ok || file.body === null)
        fail(`${s}: download HTTP ${file.status}`);
      await pipeline(Readable.fromWeb(file.body), createWriteStream(out));
      writeState(s, {
        ...next,
        downloadedTo: out,
        downloadedAt: new Date().toISOString(),
      });
      console.log(`${s}: downloaded to ${out}`);
      return;
    }
    if (v.status === "error" || v.status === "deleted")
      fail(
        `${s}: video ${v.status}: ${v.error_details ?? v.status_details ?? "no detail"}`,
      );
    if (Date.now() - started > POLL_MAX_MS)
      fail(`${s}: not ready after 45 minutes; run --status again later.`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// ---------------------------------------------------------------- main

console.log("Budget (2.5 words/s estimate):");
enforceBudget();
if (CHECK && slug === undefined) process.exit(0);
if (slug === undefined || !SLUG.test(slug))
  fail("Usage: render.mjs <slug> [--apply | --status]", 2);

const plan = readPlan(slug);
if (STATUS) {
  await status(slug);
} else if (APPLY) {
  apiKey();
  await create(slug, plan);
} else {
  const state = readState(slug);
  console.log(`\nDRY RUN for ${slug} — nothing sent. Add --apply to create.`);
  if (state?.video_id)
    console.log(
      `(already created: video_id ${state.video_id}; --apply would do nothing)`,
    );
  console.log(`POST ${TAVUS}/v2/videos`);
  console.log("x-api-key: <TAVUS_API_KEY, redacted>");
  console.log("content-type: application/json");
  console.log(JSON.stringify(requestBody(plan), null, 2));
}
