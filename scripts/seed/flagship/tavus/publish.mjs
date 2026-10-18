#!/usr/bin/env node
/**
 * Flagship presenter videos: publish a rendered Tavus MP4 as a company pitch.
 *
 * Same flow as scripts/seed/narrated-deck-videos.mjs (create pitch → reserve
 * a direct upload session → POST the bytes to Cloudflare Stream → sync until
 * READY → make playback AUTHORISED), but:
 * - the caller supplies an existing authorised session by path: either a
 *   Playwright storageState JSON (sb-*-auth-token cookies) or a JSON file
 *   holding { "access_token": "…" }. This tool never signs in and never reads
 *   a password;
 * - the MP4 is the Tavus render from render.mjs, so no ElevenLabs/speech call
 *   is made anywhere;
 * - it is a dry run unless --apply is given.
 *
 *   node scripts/seed/flagship/tavus/publish.mjs kuuza --session /path/state.json
 *   node scripts/seed/flagship/tavus/publish.mjs kuuza --session /path/state.json --apply
 *
 * --probe only reads the company and its current pitch (no writes).
 * Options: --company-id <uuid> (default: the founder's current onboarding
 * subject), --file <mp4> (default /tmp/claude-0/acc/flagship/video/<slug>.mp4).
 * Env: CQ_API_URL. Tokens are never printed. Behind the cloud egress proxy run
 * with NODE_USE_ENV_PROXY=1.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

const API = (
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app"
).replace(/\/$/, "");
const POLL_MS = 30_000;
const POLL_MAX_MS = 10 * 60_000;
// packages/media DEFAULT_PITCH_DURATION_POLICY: target 30-120 s, hard max 180 s.
const MIN_SECONDS = 30;
const MAX_SECONDS = 120;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const optionValues = new Set(
  ["--session", "--company-id", "--file"].map(option).filter(Boolean),
);
const APPLY = flag("--apply");
const PROBE = flag("--probe");
const slug = args.find((a) => !a.startsWith("--") && !optionValues.has(a));
const sessionFile = option("--session");
const mp4 = option("--file") ?? `/tmp/claude-0/acc/flagship/video/${slug}.mp4`;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

if (slug === undefined || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))
  fail(
    "Usage: publish.mjs <slug> --session <path> [--company-id <id>] [--file <mp4>] [--apply]",
    2,
  );
if (sessionFile === undefined || !existsSync(sessionFile))
  fail(
    "--session <path> to a storageState or access-token JSON is required",
    2,
  );

const stableKey = (...parts) => {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Access token from a Playwright storageState or an { access_token } file. */
function accessToken(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (typeof data.access_token === "string") return data.access_token;
  if (typeof data.accessToken === "string") return data.accessToken;
  const cookies = Array.isArray(data.cookies) ? data.cookies : [];
  const parts = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort(
      (a, b) =>
        (Number(a.name.split(".").pop()) || 0) -
        (Number(b.name.split(".").pop()) || 0),
    );
  if (parts.length === 0)
    fail("session file has no access_token and no sb-*-auth-token cookie");
  let raw = parts.map((c) => decodeURIComponent(c.value)).join("");
  if (raw.startsWith("base64-"))
    raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = JSON.parse(raw).access_token;
  if (typeof token !== "string") fail("session cookie holds no access token");
  return token;
}

async function call(token, method, path, body, idempotencyKey) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET")
    headers["idempotency-key"] = idempotencyKey ?? crypto.randomUUID();
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (response.headers.get("content-type") ?? "").includes("json")
    ? await response.json()
    : { bytes: (await response.arrayBuffer()).byteLength };
  if (!response.ok)
    throw new Error(
      `${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 300)}`,
    );
  return payload;
}

function durationOf(file) {
  try {
    return Number(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ])
        .toString()
        .trim(),
    );
  } catch {
    return Number.NaN;
  }
}

const pitchPath = (companyId) => `/v1/companies/${companyId}/pitch`;

async function ensureAuthorised(token, companyId, pitch) {
  if (pitch.playbackPolicy !== "PRIVATE") return pitch;
  const answer = await call(
    token,
    "POST",
    `${pitchPath(companyId)}/${pitch.mediaAssetId}/playback-policy`,
    { playbackPolicy: "AUTHORISED", expectedVersion: pitch.version },
  );
  return answer.pitch;
}

// ---------------------------------------------------------------- main

const token = accessToken(sessionFile);
if (!existsSync(mp4))
  fail(`${slug}: no video at ${mp4}; run render.mjs --status first`);
const seconds = durationOf(mp4);
const size = statSync(mp4).size;
console.log(
  `${slug}: ${mp4} ${(size / 1e6).toFixed(1)} MB, ${Number.isNaN(seconds) ? "duration unknown (no ffprobe)" : `${seconds.toFixed(1)} s`}`,
);
if (!Number.isNaN(seconds) && (seconds < MIN_SECONDS || seconds > MAX_SECONDS))
  fail(
    `${slug}: ${seconds.toFixed(1)} s is outside the ${MIN_SECONDS}-${MAX_SECONDS} s pitch target`,
  );

if (!APPLY && !PROBE) {
  console.log(`DRY RUN — nothing sent (session parsed locally). Would:
  1. GET onboarding subject (or use --company-id) and GET ${pitchPath("<companyId>")}
     stop if a pitch is already READY / PROCESSING / UPLOADING
  2. POST ${pitchPath("<companyId>")} (idempotency key stable per slug)
  3. POST …/upload-session { expectedVersion }  (DIRECT upload only)
  4. POST the MP4 bytes to the returned Cloudflare Stream uploadUrl
  5. POST …/sync every 30 s until READY (10 min max)
  6. POST …/playback-policy AUTHORISED if PRIVATE
--probe runs step 1 only (read-only). --apply publishes.`);
  process.exit(0);
}

const companyId =
  option("--company-id") ??
  (
    await call(
      token,
      "GET",
      "/v1/onboarding/sessions/current?journeyType=founder",
    )
  )?.session?.subject?.id;
if (typeof companyId !== "string")
  fail("no company: pass --company-id or use a founder session");

const existing = (await call(token, "GET", pitchPath(companyId))).pitch;
console.log(
  `${slug}: company ${companyId}; current pitch ${existing ? `${existing.status} (${existing.mediaAssetId})` : "none"}`,
);
if (
  existing !== null &&
  ["READY", "PROCESSING", "UPLOADING"].includes(existing.status)
) {
  console.log(
    `${slug}: already has a ${existing.status} pitch; not uploading. Replace it in the app if intended.`,
  );
  process.exit(0);
}
if (!APPLY) {
  console.log(`${slug}: probe only; add --apply to publish.`);
  process.exit(0);
}

let pitch = existing;
if (pitch === null || !["CREATED", "UPLOAD_PENDING"].includes(pitch.status)) {
  pitch = (
    await call(
      token,
      "POST",
      pitchPath(companyId),
      pitch === null ? {} : { replacesMediaAssetId: pitch.mediaAssetId },
      stableKey(
        "flagship-tavus",
        slug,
        "pitch",
        pitch?.mediaAssetId ?? "first",
      ),
    )
  ).pitch;
}
const base = `${pitchPath(companyId)}/${pitch.mediaAssetId}`;
const session = await call(token, "POST", `${base}/upload-session`, {
  expectedVersion: pitch.version,
});
if (session.uploadMode !== "DIRECT")
  fail(`upload mode ${session.uploadMode} not handled`);
const form = new FormData();
form.append(
  "file",
  new Blob([readFileSync(mp4)], { type: "video/mp4" }),
  `${slug}.mp4`,
);
// Bytes go straight to the CDN upload URL, never through the app origin.
const upload = await fetch(session.uploadUrl, { method: "POST", body: form });
if (!upload.ok) fail(`upload: HTTP ${upload.status}`);
const started = Date.now();
for (;;) {
  pitch = (await call(token, "POST", `${base}/sync`, {})).pitch;
  console.log(
    `  ${slug}: ${pitch.status} moderation=${pitch.moderationStatus}`,
  );
  if (pitch.status === "READY") break;
  if (
    ["UPLOAD_FAILED", "PROCESSING_FAILED", "EXPIRED", "DELETED"].includes(
      pitch.status,
    )
  )
    fail(`pitch ended ${pitch.status}`);
  if (Date.now() - started > POLL_MAX_MS)
    fail("pitch not READY within 10 minutes");
  await sleep(POLL_MS);
}
pitch = await ensureAuthorised(token, companyId, pitch);
console.log(
  JSON.stringify({
    slug,
    companyId,
    pitchId: pitch.mediaAssetId,
    status: pitch.status,
    playback: pitch.playbackPolicy,
    moderation: pitch.moderationStatus,
  }),
);
