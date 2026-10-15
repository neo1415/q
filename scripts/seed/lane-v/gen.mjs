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
const save = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jobs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const words = (s) => s.trim().split(/\s+/).length;
for (const job of jobs) {
  // ~2.4 words/s for these voices: keep each script inside its length window.
  const n = words(job.script);
  if (n < 60 || n > 150)
    throw new Error(`${job.slug}: ${n} words is outside 60–150`);
}

for (const job of jobs) {
  const v = (ledger.videos[job.slug] ??= {});
  if ((v.file && fs.existsSync(v.file)) || v.videoId) continue;
  for (;;) {
    // Keys the lead has reserved (key#1 is also the Railway-configured key
    // used by the live app): never used for new seeding jobs.
    while ((ledger.excluded ?? []).includes(tag(ledger.activeKey)))
      ledger.activeKey += 1;
    const i = ledger.activeKey;
    if (i >= keys().length) {
      console.log("ALL KEYS EXHAUSTED");
      save();
      process.exit(3);
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
      const k = ledger.keys[v.key];
      k.videos += 1;
      k.seconds = Math.round((k.seconds + secs) * 10) / 10;
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
console.log(JSON.stringify(ledger.keys));
