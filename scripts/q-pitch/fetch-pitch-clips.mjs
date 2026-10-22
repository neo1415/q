#!/usr/bin/env node
/**
 * Stand-in pitches for the Q Story master's Discover beats: portrait stock
 * clips of a person talking to camera (Pexels, free licence), so the feed
 * shows a pitch actually playing. The harness's companies are fictional;
 * the clips are never shipped with the app and never committed (they stay
 * in --out, and master-story.mjs reads them from there).
 *
 *   PEXELS_API=... NODE_USE_ENV_PROXY=1 \
 *     node scripts/q-pitch/fetch-pitch-clips.mjs --out <dir> [--count 3]
 *
 * Each clip is cut to 20 s, scaled to 720x1280 and encoded VP9 (the
 * recorder's Chromium has no H.264), with a credits.json beside it.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const out = option("out", null);
if (out === null) throw new Error("--out <dir> is required");
const count = Number(option("count", "3"));
const key = process.env.PEXELS_API ?? process.env.PEXELS_API_KEY;
if (key === undefined || key.length === 0) {
  console.error("PEXELS_API is not set");
  process.exit(1);
}

const QUERIES = [
  "woman talking to camera office",
  "man talking to camera startup",
  "entrepreneur speaking to camera",
  "business woman presenting to camera",
];

await mkdir(out, { recursive: true });
const credits = [];
const seen = new Set();
for (const query of QUERIES) {
  if (credits.length >= count) break;
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("size", "medium");
  url.searchParams.set("per_page", "10");
  const response = await fetch(url, { headers: { Authorization: key } });
  if (!response.ok) throw new Error(`Pexels ${String(response.status)}`);
  const { videos } = await response.json();
  for (const video of videos) {
    if (credits.length >= count) break;
    if (seen.has(video.id) || video.duration < 8) continue;
    // The smallest portrait file at least 720 wide.
    const file = video.video_files
      .filter((f) => f.height > f.width && f.width >= 720)
      .sort((a, b) => a.width - b.width)[0];
    if (file === undefined) continue;
    seen.add(video.id);
    const n = credits.length + 1;
    const raw = path.join(out, `raw-${String(n)}.mp4`);
    const bytes = Buffer.from(await (await fetch(file.link)).arrayBuffer());
    await writeFile(raw, bytes);
    const clip = path.join(out, `pitch-${String(n)}.webm`);
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      raw,
      "-t",
      "20",
      "-vf",
      "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,setsar=1",
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-b:v",
      "1500k",
      "-an",
      clip,
    ]);
    credits.push({
      file: path.basename(clip),
      pexelsId: video.id,
      by: video.user?.name ?? null,
      url: video.url,
      query,
    });
    console.log(`pitch-${String(n)}: ${video.url}`);
  }
}
await writeFile(
  path.join(out, "credits.json"),
  `${JSON.stringify(credits, null, 2)}\n`,
);
console.log(`${String(credits.length)} clips in ${out}`);
