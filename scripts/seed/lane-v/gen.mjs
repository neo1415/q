#!/usr/bin/env node
/**
 * Generate stock-replica Tavus videos from a jobs file. One key is used until
 * Tavus refuses it for quota or credit; then the next key takes over. The
 * ledger (no secrets) records videos, seconds and the refusal per key#N.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/seed/lane-v/gen.mjs jobs.json [--submit-only]
 *   jobs.json: [{ slug, replica_id, script }]
 *
 * Output: $CQ_LANE_V_DIR/videos/<slug>.mp4 and $CQ_LANE_V_DIR/ledger.json.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { isQuotaRefusal, keyIndex, keys, tag, tv } from "./tavus.mjs";

const DIR =
  process.env.CQ_LANE_V_DIR ??
  "/tmp/claude-0/-home-user-q/36a4bcfb-949b-538e-957a-f912051e5af6/scratchpad/seed-v";
const LEDGER = `${DIR}/ledger.json`;
const OUT = `${DIR}/videos`;
fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER)
  ? JSON.parse(fs.readFileSync(LEDGER, "utf8"))
  : { activeKey: 0, keys: {}, videos: {} };
// Another run may have written the ledger meanwhile: merge per video, then
// recompute each key's totals from the videos themselves.
const save = () => {
  const disk = fs.existsSync(LEDGER)
    ? JSON.parse(fs.readFileSync(LEDGER, "utf8"))
    : { keys: {}, videos: {} };
  for (const [slug, v] of Object.entries(disk.videos ?? {})) {
    const mine = ledger.videos[slug];
    if (!mine || Object.keys(v).length > Object.keys(mine).length)
      ledger.videos[slug] = v;
  }
  ledger.activeKey = Math.max(ledger.activeKey, disk.activeKey ?? 0);
  for (const [k, d] of Object.entries(disk.keys ?? {}))
    (ledger.keys[k] ??= { videos: 0, seconds: 0, refusal: null }).refusal ??=
      d.refusal;
  for (const k of Object.values(ledger.keys))
    Object.assign(k, { videos: 0, seconds: 0 });
  for (const v of Object.values(ledger.videos)) {
    if (!v.key || !v.seconds) continue;
    const k = (ledger.keys[v.key] ??= { videos: 0, seconds: 0, refusal: null });
    k.videos += 1;
    k.seconds = Math.round((k.seconds + v.seconds) * 10) / 10;
  }
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jobs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const words = (s) => s.trim().split(/\s+/).length;
for (const job of jobs) {
  // ~2.4 words/s for these voices: keep each script inside its length window.
  const n = words(job.script);
  if (n < 60 || n > 150)
    throw new Error(`${job.slug}: ${n} words is outside 60–150`);
}

let exhausted = false;
for (const job of jobs) {
  if (exhausted) break;
  const v = (ledger.videos[job.slug] ??= {});
  if ((v.file && fs.existsSync(v.file)) || v.videoId) continue;
  for (;;) {
    // Keys the lead has reserved (key#1 is also the Railway-configured key
    // used by the live app): never used for new seeding jobs.
    while ((ledger.excluded ?? []).includes(tag(ledger.activeKey)))
      ledger.activeKey += 1;
    // Lead's per-key ceiling (e.g. CQ_TAVUS_KEY_CAP="key#4=1500"): stop at it.
    const cap = Object.fromEntries(
      (process.env.CQ_TAVUS_KEY_CAP ?? "")
        .split(",")
        .filter(Boolean)
        .map((x) => x.split("=")),
    );
    {
      const t = tag(ledger.activeKey);
      // Finished seconds plus an estimate for jobs queued but not yet ready.
      const used = Object.values(ledger.videos).reduce(
        (sum, v) =>
          v.key === t
            ? sum + (v.seconds ?? (v.file || v.failed ? 0 : (v.estimate ?? 35)))
            : sum,
        0,
      );
      if (cap[t] && used + 45 > Number(cap[t])) {
        ledger.keys[t] = {
          ...(ledger.keys[t] ?? {}),
          refusal: `lead cap ${cap[t]} s`,
        };
        ledger.activeKey += 1;
        continue;
      }
    }
    const i = ledger.activeKey;
    if (i >= keys().length) {
      // Stop submitting, but still collect every job already queued.
      console.log("ALL KEYS EXHAUSTED");
      exhausted = true;
      break;
    }
    const r = await tv(i, "POST", "/v2/videos", {
      replica_id: job.replica_id,
      script: job.script,
      video_name: `cq-seed-${job.slug}`,
    });
    const k = (ledger.keys[tag(i)] ??= {
      videos: 0,
      seconds: 0,
      refusal: null,
    });
    if (r.status < 300 && r.body?.video_id) {
      delete v.error;
      Object.assign(v, {
        estimate: Math.round(words(job.script) / 2.6),
        videoId: r.body.video_id,
        key: tag(i),
        replica: job.replica_id,
      });
      save();
      console.log(job.slug, "queued on", tag(i));
      break;
    }
    const msg = `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`;
    if (isQuotaRefusal(r)) {
      k.refusal = msg;
      ledger.activeKey += 1;
      save();
      console.log(tag(i), "refused:", msg, "-> next key");
      continue;
    }
    v.error = msg;
    save();
    console.log(job.slug, "error:", msg);
    break;
  }
}
if (process.argv.includes("--submit-only")) process.exit(0);

// Poll and download every queued video (Tavus renders take minutes).
for (let round = 0; round < 180; round++) {
  const pending = jobs.filter((j) => {
    const v = ledger.videos[j.slug];
    return v?.videoId && !v.file && !v.failed;
  });
  if (!pending.length) break;
  for (const j of pending) {
    const v = ledger.videos[j.slug];
    const r = await tv(keyIndex(v.key), "GET", `/v2/videos/${v.videoId}`);
    const st = r.body?.status;
    if (st === "ready" && r.body.download_url) {
      const file = `${OUT}/${j.slug}.mp4`;
      const res = await fetch(r.body.download_url);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      const secs = Number(
        execFileSync("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "csv=p=0",
          file,
        ]).toString(),
      );
      Object.assign(v, { file, seconds: Math.round(secs * 10) / 10 });
      save();
      console.log(j.slug, "ready", v.seconds, "s", v.key);
    } else if (/error|fail|deleted/i.test(st ?? "")) {
      v.failed = `${st} ${JSON.stringify(r.body?.status_details ?? "").slice(0, 160)}`;
      save();
      console.log(j.slug, "FAILED", v.failed);
    }
  }
  await sleep(20000);
}
save();
console.log(JSON.stringify(ledger.keys));
