#!/usr/bin/env node
/**
 * R19 / R29: narrated deck videos for the seeded fictional companies.
 *
 * For each seeded company this signs in as its synthetic founder through the
 * deployed web sign-in (the same form a person uses), reads the company and
 * its seeded PITCH_DECK artifact through the deployed APIs, renders the deck
 * PDF to slides, narrates the committed script (narrated-deck-scripts.json)
 * through the deployed q-api one-way speech route under the founder's own
 * session (ElevenLabs behind the Q voice adapter, no voice cloning), muxes a
 * 16:9 MP4 with an "AI-narrated" label burned in, and publishes it through the
 * app's own pitch flow: create pitch, reserve a direct upload, upload the
 * bytes, sync, wait for READY, then let authorised investors play it.
 *
 * Idempotent: a company whose pitch is already READY is skipped, narration
 * audio is cached per segment in the output directory (a rerun never pays
 * for the same words twice), and a pitch left mid-upload by an earlier run
 * is resumed rather than duplicated.
 *
 * Reads only env: CQ_SEED_ACCOUNT_PASSWORD (required; never printed),
 * CQ_WEB_URL, CQ_API_URL, CQ_Q_API_URL, CQ_R19_OUT. Tokens are never printed.
 *
 *   node scripts/seed/narrated-deck-videos.mjs --probe --only ledgerfold
 *   node scripts/seed/narrated-deck-videos.mjs --publish --only ledgerfold
 *   node scripts/seed/narrated-deck-videos.mjs --publish
 *
 * Needs ffmpeg, ffprobe, pdftoppm and pdftotext on PATH.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = (process.env.CQ_WEB_URL ?? "https://capital-qweb-production.up.railway.app").replace(/\/$/, "");
const API = (process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app").replace(/\/$/, "");
const QAPI = (process.env.CQ_Q_API_URL ?? "https://capital-qq-api-production.up.railway.app").replace(/\/$/, "");
const OUT = process.env.CQ_R19_OUT ?? "/home/user/r19-out";
const PASSWORD = process.env.CQ_SEED_ACCOUNT_PASSWORD ?? "";
const FICTIONAL_DOMAIN = "fictional.capitalq.local";
const POLL_MS = 30_000;
const POLL_MAX_MS = 10 * 60_000;
const W = 1280;
const H = 720;
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const PROBE = flag("--probe");
const PUBLISH = flag("--publish");
const ONLY = option("--only")?.split(",").map((s) => s.trim()).filter(Boolean);

if (PASSWORD.length === 0) {
  console.error("CQ_SEED_ACCOUNT_PASSWORD is required (never printed)");
  process.exit(2);
}

const scripts = JSON.parse(readFileSync(join(here, "narrated-deck-scripts.json"), "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (cmd, argv) => execFileSync(cmd, argv, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const stableKey = (...parts) => {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ---------------------------------------------------------------- sign-in

/** Signs in through the deployed web form (no JS path) and returns the access token. */
async function signIn(email) {
  const page = await fetch(`${WEB}/auth/sign-in`, { redirect: "follow" });
  const html = await page.text();
  const forms = html.split("<form").slice(1);
  const form = forms.find((f) => f.includes('name="password"'));
  if (form === undefined) throw new Error("sign-in: password form not found");
  const body = new FormData();
  for (const m of form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/?>/g)) {
    const value = (m[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&#x27;", "'");
    body.append(m[1], value);
  }
  body.set("email", email);
  body.set("password", PASSWORD);
  const cookieIn = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const answer = await fetch(`${WEB}/auth/sign-in`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: cookieIn.length > 0 ? { cookie: cookieIn } : {},
  });
  const jar = new Map();
  for (const c of answer.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
  }
  const names = [...jar.keys()].filter((k) => /^sb-.*-auth-token(\.\d+)?$/.test(k)).sort((a, b) => {
    const n = (k) => Number(k.split(".").pop()) || 0;
    return n(a) - n(b);
  });
  if (names.length === 0) throw new Error(`sign-in: no session cookie (HTTP ${answer.status})`);
  let raw = names.map((k) => jar.get(k)).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = JSON.parse(raw).access_token;
  if (typeof token !== "string") throw new Error("sign-in: no access token in session");
  return token;
}

// ---------------------------------------------------------------- api

async function call(base, token, method, path, body, idempotencyKey) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = idempotencyKey ?? crypto.randomUUID();
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const type = response.headers.get("content-type") ?? "";
  const payload = type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const detail = Buffer.isBuffer(payload) ? `${payload.length} bytes` : JSON.stringify(payload).slice(0, 300);
    throw new Error(`${method} ${path}: HTTP ${response.status} ${detail}`);
  }
  return { payload, type };
}

async function companyIdOf(token) {
  const { payload } = await call(API, token, "GET", "/v1/onboarding/sessions/current?journeyType=founder");
  const id = payload?.session?.subject?.id;
  if (typeof id !== "string") throw new Error("founder session has no company");
  return id;
}

async function deckPdf(token, companyId, dir) {
  const file = join(dir, "deck.pdf");
  if (existsSync(file)) return file;
  const { payload } = await call(QAPI, token, "GET", `/v1/q/artifacts?limit=50&subjectId=${companyId}`);
  const deck = (payload.items ?? []).find((a) => a.type === "PITCH_DECK");
  if (deck === undefined) throw new Error("no PITCH_DECK artifact");
  const id = deck.artifactId ?? deck.id;
  const pdf = await call(QAPI, token, "GET", `/v1/q/artifacts/${id}/export/pdf`);
  writeFileSync(file, pdf.payload);
  return file;
}

function renderSlides(pdf, dir) {
  const slidesDir = join(dir, "slides");
  mkdirSync(slidesDir, { recursive: true });
  if (readdirSync(slidesDir).filter((f) => f.endsWith(".png")).length === 0) {
    run("pdftoppm", ["-png", "-scale-to-x", String(W), "-scale-to-y", "-1", pdf, join(slidesDir, "s")]);
  }
  return readdirSync(slidesDir).filter((f) => f.endsWith(".png")).sort().map((f) => join(slidesDir, f));
}

// ---------------------------------------------------------------- narration

let charactersSpoken = 0;

async function narrate(token, text, file) {
  if (existsSync(file)) return file;
  const { payload, type } = await call(QAPI, token, "POST", "/v1/q/voice/speech", { text, voice: "FEMALE" });
  if (!Buffer.isBuffer(payload) || payload.length === 0) throw new Error(`speech: unexpected ${type}`);
  charactersSpoken += text.length;
  writeFileSync(file, payload);
  return file;
}

const durationOf = (file) =>
  Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());

function mux(slides, segments, dir) {
  const out = join(dir, "pitch.mp4");
  if (existsSync(out)) return out;
  const spoken = segments.reduce((sum, s) => sum + s.seconds, 0);
  // Room around each line; stretched evenly when the words alone run short of a minute.
  const gap = Math.max(0.8, (62 - spoken) / segments.length);
  const parts = [];
  segments.forEach((segment, i) => {
    const slide = slides[Math.min(segment.slide - 1, slides.length - 1)];
    const seconds = segment.seconds + gap;
    const part = join(dir, `part-${String(i).padStart(2, "0")}.mp4`);
    const lead = (gap / 2).toFixed(2);
    run("ffmpeg", [
      "-y", "-loglevel", "error",
      "-loop", "1", "-framerate", "30", "-t", seconds.toFixed(2), "-i", slide,
      "-i", segment.audio,
      "-filter_complex",
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p,` +
        `drawtext=fontfile=${FONT}:text='AI-narrated':fontsize=20:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8:x=w-tw-24:y=h-th-24[v];` +
        `[1:a]aresample=48000,adelay=${Math.round(Number(lead) * 1000)}:all=1,apad,atrim=0:${seconds.toFixed(2)}[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-r", "30",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
      "-t", seconds.toFixed(2), part,
    ]);
    parts.push(part);
  });
  const list = join(dir, "parts.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
  return out;
}

// ---------------------------------------------------------------- publish

const pitchPath = (companyId) => `/v1/companies/${companyId}/pitch`;

async function currentPitch(token, companyId) {
  const { payload } = await call(API, token, "GET", pitchPath(companyId));
  return payload.pitch;
}

async function publish(token, companyId, key, mp4, existing) {
  let pitch = existing;
  if (pitch === null || !["CREATED", "UPLOAD_PENDING"].includes(pitch.status)) {
    const body = pitch === null ? {} : { replacesMediaAssetId: pitch.mediaAssetId };
    const created = await call(API, token, "POST", pitchPath(companyId), body, stableKey("r19", key, "pitch", pitch?.mediaAssetId ?? "first"));
    pitch = created.payload.pitch;
  }
  const base = `${pitchPath(companyId)}/${pitch.mediaAssetId}`;
  const session = (await call(API, token, "POST", `${base}/upload-session`, { expectedVersion: pitch.version })).payload;
  if (session.uploadMode !== "DIRECT") throw new Error(`upload mode ${session.uploadMode} not handled`);
  const form = new FormData();
  form.append("file", new Blob([readFileSync(mp4)], { type: "video/mp4" }), "pitch.mp4");
  const upload = await fetch(session.uploadUrl, { method: "POST", body: form });
  if (!upload.ok) throw new Error(`upload: HTTP ${upload.status}`);
  const started = Date.now();
  for (;;) {
    pitch = (await call(API, token, "POST", `${base}/sync`, {})).payload.pitch;
    console.log(`  ${key}: ${pitch.status} moderation=${pitch.moderationStatus}`);
    if (pitch.status === "READY") break;
    if (["UPLOAD_FAILED", "PROCESSING_FAILED", "EXPIRED", "DELETED"].includes(pitch.status)) {
      throw new Error(`pitch ended ${pitch.status}`);
    }
    if (Date.now() - started > POLL_MAX_MS) throw new Error("pitch not READY within 10 minutes");
    await sleep(POLL_MS);
  }
  return ensureAuthorised(token, companyId, pitch);
}

async function ensureAuthorised(token, companyId, pitch) {
  if (pitch.playbackPolicy !== "PRIVATE") return pitch;
  const { payload } = await call(API, token, "POST", `${pitchPath(companyId)}/${pitch.mediaAssetId}/playback-policy`, {
    playbackPolicy: "AUTHORISED",
    expectedVersion: pitch.version,
  });
  return payload.pitch;
}

// ---------------------------------------------------------------- main

const results = [];
for (const entry of scripts.companies) {
  if (ONLY !== undefined && !ONLY.includes(entry.key)) continue;
  const dir = join(OUT, entry.key);
  mkdirSync(dir, { recursive: true });
  try {
    const token = await signIn(`founder.${entry.key}@${FICTIONAL_DOMAIN}`);
    const companyId = await companyIdOf(token);
    const existing = await currentPitch(token, companyId);
    if (existing !== null && ["READY", "PROCESSING", "UPLOADING"].includes(existing.status)) {
      const pitch = existing.status === "READY" ? await ensureAuthorised(token, companyId, existing) : existing;
      console.log(`${entry.key}: already has a pitch (${pitch.status}); skipped`);
      results.push({ key: entry.key, pitchId: pitch.mediaAssetId, status: pitch.status, playback: pitch.playbackPolicy, skipped: true });
      continue;
    }
    const slides = renderSlides(await deckPdf(token, companyId, dir), dir);
    if (PROBE) {
      const pdf = join(dir, "deck.pdf");
      console.log(`${entry.key}: company ${companyId}, ${slides.length} slides`);
      writeFileSync(join(dir, "deck.txt"), run("pdftotext", ["-layout", pdf, "-"]));
      continue;
    }
    const segments = [];
    for (const [i, segment] of entry.segments.entries()) {
      const audio = await narrate(token, segment.text, join(dir, `seg-${String(i).padStart(2, "0")}.mp3`));
      segments.push({ slide: segment.slide, audio, seconds: durationOf(audio) });
    }
    const mp4 = mux(slides, segments, dir);
    const seconds = durationOf(mp4);
    console.log(`${entry.key}: video ${seconds.toFixed(1)} s`);
    if (seconds < 60 || seconds > 90) throw new Error(`video is ${seconds.toFixed(1)} s, outside 60-90 s`);
    if (!PUBLISH) continue;
    const pitch = await publish(token, companyId, entry.key, mp4, existing);
    results.push({ key: entry.key, pitchId: pitch.mediaAssetId, status: pitch.status, playback: pitch.playbackPolicy, moderation: pitch.moderationStatus });
  } catch (error) {
    console.error(`${entry.key}: FAILED ${error instanceof Error ? error.message : String(error)}`);
    results.push({ key: entry.key, error: error instanceof Error ? error.message : String(error) });
  }
}
console.log(`narration characters sent this run: ${charactersSpoken}`);
writeFileSync(join(OUT, `results-${Date.now()}.json`), JSON.stringify({ charactersSpoken, results }, null, 2));
console.log(JSON.stringify(results));
