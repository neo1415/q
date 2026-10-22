#!/usr/bin/env node
/**
 * Q Story pitch master (owner, 22 Oct): the whole story recorded in
 * Chromium from a PRODUCTION build of /dev/story, with Q's rendered voice
 * mixed in, then audited frame by frame. Writes to
 * docs/ai-handoff/evidence/q-story/master/:
 *
 *   q-story-master-1080p.mp4   1920x1080, H.264 + AAC, 30 fps
 *   q-story-master-720p.mp4    1280x720, under 16 MB, for sharing
 *   audit.json                 page-text and OCR checks (0.5 s), cue timing,
 *                              CLS, long frames, fallbacks
 *   sheets/sheet-NN.jpg        a frame every 2 s, for the eye pass
 *
 *   node scripts/q-pitch/master-story.mjs --base http://127.0.0.1:3200 \
 *     [--voice pFZP5JQG7iQjIQuC4Bku] [--pitches <dir>] [--skip-ocr]
 *     [--edition investor|founder]   (writes to master/<edition>/)
 *
 * Another voice set is one flag: --voice <id> (its render must exist under
 * apps/web/public/story-media/<id>/). Playwright records no sound, so each
 * beat's audio is logged as it starts and its clip is mixed in at that
 * moment. Nothing here reads a service or calls a model.
 *
 * The "Internal rehearsal" stamp is the gate's (certifyStory), never the
 * recorder's: when the owner's approval is recorded for this cut
 * (STORY_OWNER_APPROVAL in packages/q-pitch/src/story/claims.ts) and every
 * product claim holds, a rebuild and a re-run records the AUDIENCE cut.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const base = option("base", "http://127.0.0.1:3200");
const voice = option("voice", "pFZP5JQG7iQjIQuC4Bku");
const skipOcr = process.argv.includes("--skip-ocr");
if (!/^[A-Za-z0-9]{8,40}$/u.test(voice)) throw new Error("not a voice id");
// --edition investor|founder: one of the story's cuts (editions.ts); the
// full story is the default and keeps the folder it always had.
const edition = option("edition", "full");
if (!["full", "investor", "founder"].includes(edition)) {
  throw new Error("not an edition");
}
const out = path.join(
  root,
  "docs/ai-handoff/evidence/q-story/master",
  edition === "full" ? "" : edition,
);
const work = path.join(os.tmpdir(), `q-story-master-${String(Date.now())}`);
await mkdir(out, { recursive: true });
await mkdir(work, { recursive: true });
const ff = (args) =>
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);

// Words that must never be on screen in the master.
const BANNED = [
  "can't",
  "can’t",
  "did not",
  "error",
  "loading",
  "fallback",
  "harness",
  "rendering",
  "shown here instead",
];

// ── The Discover pitch: a muted VP9 slideshow of the curated photos ────
// (headless Chromium plays no H.264; the harness's media path is answered
// here, as the Discover harness expects of a browser run).
const pitchWebm = path.join(work, "pitch.webm");
const photos = [14, 15, 16, 17].map((n) =>
  path.join(
    root,
    "apps/web/public/story-media/pictures",
    `${String(n).padStart(2, "0")}.jpg`,
  ),
);
ff([
  ...photos.flatMap((file) => ["-loop", "1", "-t", "3", "-i", file]),
  "-filter_complex",
  `${photos
    .map(
      (_, i) =>
        `[${String(i)}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24,setsar=1[v${String(i)}]`,
    )
    .join(
      ";",
    )};${photos.map((_, i) => `[v${String(i)}]`).join("")}concat=n=${String(photos.length)}:v=1:a=0[out]`,
  "-map",
  "[out]",
  "-c:v",
  "libvpx-vp9",
  // Real-time settings: a 12 s stand-in pitch, not a film; seconds, not minutes.
  "-deadline",
  "realtime",
  "-cpu-used",
  "8",
  "-b:v",
  "700k",
  "-an",
  pitchWebm,
]);
const pitchBytes = await readFile(pitchWebm);
const posterBytes = await readFile(photos[0]);

// ── The voice set: hashed clip names from the render's index ───────────
const mediaDir = path.join(root, "apps/web/public/story-media", voice);
const index = JSON.parse(
  await readFile(path.join(mediaDir, "index.json"), "utf8"),
);
// The cut's beats in play order (the built package is the script's source).
const story = await import(path.join(root, "packages/q-pitch/dist/index.js"));
const order = story.editionBeats(story.STORY_EDITIONS[edition.toUpperCase()]);
const clips = order.map((beat) =>
  path.join(mediaDir, index.files[beat.id].audio),
);

const browser = await chromium.launch({
  ...(existsSync("/opt/pw-browsers/chromium")
    ? { executablePath: "/opt/pw-browsers/chromium" }
    : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const viewport = { width: 1920, height: 1080 };

// --pitches <dir>: stand-in pitch clips (scripts/q-pitch/fetch-pitch-clips.mjs),
// one per company in the order the feed asks for them; else the stills.
const pitchDir = option("pitches", null);
const pitchClips =
  pitchDir === null
    ? [pitchBytes]
    : await Promise.all(
        (await readdir(pitchDir))
          .filter((name) => /^pitch-\d+\.webm$/u.test(name))
          .sort()
          .map((name) => readFile(path.join(pitchDir, name))),
      );
const clipFor = new Map();
async function answerMedia(context) {
  await context.route("**/dev/discover/media/**", (route) => {
    const url = route.request().url();
    if (url.endsWith(".jpg")) {
      // With real clips, no poster: a still that is not the clip's own
      // first frame would flash before it plays.
      return pitchDir === null
        ? route.fulfill({ body: posterBytes, contentType: "image/jpeg" })
        : route.fulfill({ status: 404 });
    }
    const asset = new URL(url).pathname.split("/").pop() ?? "";
    if (!clipFor.has(asset)) {
      clipFor.set(asset, pitchClips[clipFor.size % pitchClips.length]);
    }
    return route.fulfill({
      body: clipFor.get(asset),
      contentType: "video/webm",
    });
  });
  await context.route("**/api/pitch-captions/**", (route) =>
    route.fulfill({ body: "WEBVTT\n\n", contentType: "text/vtt" }),
  );
}

// Warm every page the story visits in a production server first: each is
// rendered once and left idle, so no first-render work lands mid-story.
{
  const context = await browser.newContext({ viewport });
  await answerMedia(context);
  const page = await context.newPage();
  for (const url of [
    "/dev/story",
    "/dev/story/discover",
    "/dev/story/crm?view=capital",
    "/dev/story/profile?tab=diligence",
    "/dev/story/crm?view=record",
    "/dev/story/gateq?view=gate",
    "/dev/story/gateq-review?page=investor-inbox&state=dossier",
    "/dev/story/gateq?view=inbox",
  ]) {
    // "load", not "networkidle": Discover keeps a stream open by design.
    await page.goto(`${base}${url}`, { waitUntil: "load", timeout: 120_000 });
    await page.waitForTimeout(2_500);
  }
  await context.close();
}

const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  colorScheme: "light",
  recordVideo: { dir: work, size: viewport },
});
await answerMedia(context);
await context.addInitScript((banned) => {
  // Each beat's audio start, in wall-clock ms (for the mix).
  window.__audioStarts = [];
  const Source = window.AudioBufferSourceNode;
  const start = Source.prototype.start;
  Source.prototype.start = function (when, offset, length) {
    const ctx = this.context;
    const delay = Math.max(0, ((when ?? 0) - ctx.currentTime) * 1000);
    window.__audioStarts.push({
      at: Date.now() + delay,
      duration: length ?? this.buffer?.duration ?? 0,
      // A cut part plays a window of its beat's clip.
      offset: offset ?? 0,
      length: length ?? null,
    });
    return start.call(this, when, offset, length);
  };
  // Layout shifts, and what is on screen every 0.5 s.
  window.__cls = 0;
  window.__shifts = [];
  window.__textHits = [];
  window.__overlays = [];
  window.__overSince = new Map();
  const OVER_PAGE = [
    ".cq-story-stage .cq-story-type",
    ".cq-story-stage .cq-story-outcomes",
    ".cq-story-stage .cq-story-wordmark",
    ".cq-story-stage .cq-story-tagline",
    ".cq-story-stage .cq-story-split",
    ".cq-story-stage .cq-story-centre > .cq-story-panel",
    ".cq-story-stage .cq-story-screens",
    ".cq-story-stage [data-story-qcard]",
  ].join(", ");
  window.__badge = 0;
  new window.PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__cls += entry.value;
      window.__shifts.push({ value: entry.value, at: Date.now() });
    }
  }).observe({ type: "layout-shift", buffered: true });
  window.setInterval(() => {
    const text = (document.body?.innerText ?? "").toLowerCase();
    for (const word of banned) {
      if (text.includes(word)) window.__textHits.push({ word, at: Date.now() });
    }
    if (document.querySelector("nextjs-portal, [data-nextjs-toast]") !== null) {
      window.__badge += 1;
    }
    // Large stage type and artifacts over the page (not docked beside a
    // lit section): where they are, and since when, for the clutter check.
    const now = Date.now();
    const seen = new Map();
    for (const node of document.querySelectorAll(OVER_PAGE)) {
      const r = node.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (Number(window.getComputedStyle(node).opacity) < 0.99) continue;
      const box = [r.x, r.y, r.width, r.height].map(Math.round);
      const key = box.join(",");
      seen.set(key, window.__overSince.get(key) ?? now);
      window.__overlays.push({ at: now, box, since: seen.get(key) });
    }
    window.__overSince = seen;
  }, 500);
}, BANNED);

const videoStart = Date.now();
const page = await context.newPage();
await page.goto(
  `${base}/dev/story?voice=${voice}&film=1${edition === "full" ? "" : `&edition=${edition}`}`,
  {
    waitUntil: "networkidle",
  },
);
await page.waitForFunction(
  () =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Start the story" && !b.disabled,
    ),
  undefined,
  { timeout: 120_000 },
);
// A breath on the opening frame, then Start (the press is the gesture).
await page.waitForTimeout(1_500);
await page.getByRole("button", { name: "Start the story" }).click();
// The film opens at the press: the start dialog is not part of the story.
const startedAt = Date.now();
// The pointer leaves, so the controls step back for the whole story.
await page.mouse.move(viewport.width - 4, viewport.height / 2);
await page.waitForFunction(
  () => window.__cqStoryEvidence?.()?.phase === "DONE",
  undefined,
  {
    timeout: 15 * 60_000,
    polling: 100,
  },
);
// And closes on the last word: the end card is the live product's, not
// the film's.
const doneAt = Date.now();
await page.waitForTimeout(3_000);
const evidence = await page.evaluate(() => ({
  story: window.__cqStoryEvidence?.() ?? null,
  starts: window.__audioStarts,
  cls: window.__cls,
  shifts: window.__shifts,
  textHits: window.__textHits,
  badge: window.__badge,
  overlays: window.__overlays,
}));
const video = page.video();
await context.close();
// Saved before the browser goes: the recording is the browser's file.
const raw = path.join(work, "raw.webm");
await video?.saveAs(raw);
await browser.close();

// ── Mix: each clip at its logged start ─────────────────────────────────
const starts = evidence.starts.filter((s) => s.duration > 0.2);
if (starts.length !== clips.length) {
  console.warn(
    `audio starts ${String(starts.length)} ≠ clips ${String(clips.length)}: a beat played as silence or was repeated`,
  );
}
const pairs = starts.slice(0, clips.length).map((s, i) => ({
  clip: clips[i],
  delayMs: Math.max(0, Math.round(s.at - videoStart)),
  trim:
    s.length === null
      ? ""
      : `atrim=start=${String(s.offset)}:duration=${String(s.length)},asetpts=PTS-STARTPTS,`,
}));
const master = path.join(out, "q-story-master-1080p.mp4");
/** Where the film starts in the recording (the Start press). */
const trimStart = Math.max(0, (startedAt - videoStart) / 1000 - 0.2);
ff([
  "-i",
  raw,
  ...pairs.flatMap((p) => ["-i", p.clip]),
  "-filter_complex",
  `${pairs
    .map(
      (p, i) =>
        `[${String(i + 1)}:a]${p.trim}adelay=${String(p.delayMs)}|${String(p.delayMs)}[a${String(i)}]`,
    )
    .join(
      ";",
    )};${pairs.map((_, i) => `[a${String(i)}]`).join("")}amix=inputs=${String(pairs.length)}:normalize=0:dropout_transition=0[aout]`,
  "-map",
  "0:v",
  "-map",
  "[aout]",
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-movflags",
  "+faststart",
  "-ss",
  String(trimStart),
  "-to",
  String((doneAt - videoStart) / 1000 - 0.15),
  master,
]);
const share = path.join(out, "q-story-master-720p.mp4");
ff([
  "-i",
  master,
  "-vf",
  "scale=1280:720",
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "30",
  "-maxrate",
  "260k",
  "-bufsize",
  "520k",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "96k",
  "-movflags",
  "+faststart",
  share,
]);

// ── Audit: OCR every 0.5 s; contact sheets every 2 s ───────────────────
const frames = path.join(work, "frames");
await mkdir(frames, { recursive: true });
ff([
  "-i",
  master,
  "-vf",
  "fps=2,scale=1280:-2",
  path.join(frames, "f%04d.png"),
]);
const files = (await readdir(frames)).sort();
const ocrHits = [];
if (!skipOcr) {
  for (const file of files) {
    let text;
    try {
      text = execFileSync(
        "tesseract",
        [path.join(frames, file), "-", "--psm", "11"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).toLowerCase();
    } catch {
      continue;
    }
    for (const word of BANNED) {
      if (text.includes(word)) {
        ocrHits.push({
          word,
          frame: file,
          second: (Number(file.slice(1, 5)) - 1) / 2,
        });
      }
    }
  }
}
// ── Clutter behind overlay text (owner, 22 Oct) ──────────────────────
// Large stage type and artifacts over the page need a quiet backing: the
// ring just outside each box (never the glyphs) must be one even tone.
// Clutter is the share of ring pixels more than 8 grey levels from the
// ring's median; page rows showing through a thin scrim measure 2-4%, a
// solid scrim 0%. A box is checked once it has been up for 0.6 s (past the
// scrim's own fade), at most once a second.
const RING = 32;
const CLUTTER_MAX = 0.01;
const overlayClutter = [];
const checked = new Set();
for (const sample of evidence.overlays) {
  if (sample.at - sample.since < 600) continue;
  const second = Math.round((sample.at - videoStart) / 1000 - trimStart);
  const key = `${String(second)}:${sample.box.join(",")}`;
  if (second < 0 || checked.has(key)) continue;
  checked.add(key);
  const [x, y, w, h] = sample.box;
  const X = Math.max(0, x - RING);
  const Y = Math.max(0, y - RING);
  const W = Math.min(viewport.width - X, w + 2 * RING);
  const H = Math.min(viewport.height - Y, h + 2 * RING);
  if (W <= 0 || H <= 0) continue;
  let bytes;
  try {
    bytes = execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-ss",
      String((sample.at - videoStart) / 1000 - trimStart),
      "-i",
      master,
      "-frames:v",
      "1",
      "-vf",
      `crop=${String(W)}:${String(H)}:${String(X)}:${String(Y)},format=gray`,
      "-f",
      "rawvideo",
      "-",
    ]);
  } catch {
    continue;
  }
  const ring = [];
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const gx = X + i;
      const gy = Y + j;
      if (gx >= x && gx < x + w && gy >= y && gy < y + h) continue;
      ring.push(bytes[j * W + i] ?? 0);
    }
  }
  if (ring.length === 0) continue;
  const median = [...ring].sort((a, b) => a - b)[Math.floor(ring.length / 2)];
  const clutter =
    ring.filter((v) => Math.abs(v - median) > 8).length / ring.length;
  if (clutter > CLUTTER_MAX) {
    overlayClutter.push({
      second,
      box: sample.box,
      clutter: Math.round(clutter * 1000) / 10,
    });
  }
}

const sheets = path.join(out, "sheets");
await rm(sheets, { recursive: true, force: true });
await mkdir(sheets, { recursive: true });
ff([
  "-i",
  master,
  "-vf",
  "fps=0.5,scale=480:-2,tile=4x4:padding=4:color=white",
  path.join(sheets, "sheet-%02d.jpg"),
]);

const durations = execFileSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_name,width,height,r_frame_rate",
    "-of",
    "json",
    master,
  ],
  { encoding: "utf8" },
);
const sizes = {
  master: (await readFile(master)).byteLength,
  share: (await readFile(share)).byteLength,
};
const audit = {
  recordedAt: new Date().toISOString(),
  voice,
  model: index.model,
  probe: JSON.parse(durations),
  bytes: sizes,
  story: evidence.story,
  cls: evidence.cls,
  shifts: evidence.shifts.length,
  audioStarts: starts.length,
  clips: clips.length,
  pageTextHits: evidence.textHits,
  devBadgeSamples: evidence.badge,
  ocrFrames: files.length,
  ocrHits,
  overlayBoxesChecked: checked.size,
  overlayClutter,
  defects:
    evidence.textHits.length +
    evidence.badge +
    ocrHits.length +
    overlayClutter.length +
    (evidence.story?.fallbacks ?? 0),
};
await writeFile(
  path.join(out, "audit.json"),
  `${JSON.stringify(audit, null, 2)}\n`,
);
console.log(JSON.stringify({ ...audit, probe: undefined }, null, 2));
await rm(work, { recursive: true, force: true });
