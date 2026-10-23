// Capital Q's pitch video for the demonstration seed (owner 2026-10-22/23:
// "seed the video"). The owner-approved investor master
// (supabase/seed-assets/capital-q-documents/capital-q-pitch-video.mp4) goes
// through the product's own pitch flow, as the founder, exactly as
// /pitch/new does: create the pitch, reserve a direct upload, send the bytes
// browser-style to the provider's edge (never through the API), sync until
// READY, then set the title and audience "Everyone on Capital Q" (NETWORK)
// with investor playback AUTHORISED. Nothing writes a media table directly.
//
// The founder's session comes from a one-time magic-link token exchange
// (generate_link sends no email). The token stays in process memory.
//
//   SUPABASE_ACCESS_TOKEN=… node scripts/seed/demo-companies/pitch.mjs \
//     --founder <david's account email> [--apply]
//
// Dry run by default: it reads the current pitch and says what it would do.
// Idempotent: a READY pitch with this title already live is left alone.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { API, accessToken, call, sleep, sql } from "../tavus20/lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
const MANIFEST = join(
  ROOT,
  "supabase/seed-assets/capital-q-documents/manifest.json",
);
const FIXTURE = join(
  ROOT,
  "supabase/seed-assets/demo-companies/companies.json",
);
const POLL_MS = 15_000;
const POLL_MAX_MS = 15 * 60_000;
const ENDED = ["UPLOAD_FAILED", "PROCESSING_FAILED", "EXPIRED", "DELETED"];

/** The video as the manifest names it, refused on a checksum mismatch. */
export function loadPitchVideo(manifestPath = MANIFEST) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const video = manifest.pitchVideo;
  if (video.ownerApprovedForAudience !== true) {
    throw new Error("the pitch video is not owner-approved for its audience");
  }
  const bytes = readFileSync(join(dirname(manifestPath), video.file));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== video.sha256) {
    throw new Error(`${video.file}: sha256 does not match the manifest`);
  }
  if (bytes.byteLength !== video.bytes) {
    throw new Error(`${video.file}: size does not match the manifest`);
  }
  return {
    ...video,
    path: join(dirname(manifestPath), video.file),
    sizeBytes: video.bytes,
    bytes,
  };
}

// The product's hard maximum for a pitch (DEFAULT_PITCH_DURATION_POLICY in
// @capital-q/media). The stream provider refuses a longer file after the
// upload, and the refused pitch has by then replaced the live one, so a
// longer master is trimmed here first, as the 23 Oct live run did by hand.
export const PITCH_HARD_MAX_SECONDS = 180;
const TRIM_TO_SECONDS = 179;

export function durationSeconds(path) {
  return Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      path,
    ])
      .toString()
      .trim(),
  );
}

/** The video as uploaded: the master, or its first 179 s when longer. */
export function withinPitchLimit(video) {
  const seconds = durationSeconds(video.path);
  if (seconds <= PITCH_HARD_MAX_SECONDS) return { ...video, seconds };
  const out = join(mkdtempSync(join(tmpdir(), "cq-pitch-")), video.file);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    video.path,
    "-t",
    String(TRIM_TO_SECONDS),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    out,
  ]);
  const trimmed = durationSeconds(out);
  if (trimmed > PITCH_HARD_MAX_SECONDS) {
    throw new Error(`trim left ${trimmed} s`);
  }
  return { ...video, path: out, bytes: readFileSync(out), seconds: trimmed };
}

/** What to do about the company's current pitch. */
export function pitchStep(current, title) {
  if (current?.status === "READY" && current.title === title) {
    return current.audience === "NETWORK" &&
      current.playbackPolicy === "AUTHORISED"
      ? "NOTHING"
      : "DETAILS";
  }
  return "UPLOAD";
}

// Retries of the same run reuse the same pitch record.
const stableKey = (...parts) => {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

async function api(token, method, path, body, key) {
  const r = await call(API, token, method, path, body, key);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(
      `${method} ${path}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`,
    );
  }
  return r.body;
}

async function setDetails(token, base, pitch, video) {
  return (
    await api(token, "POST", `${base}/${pitch.mediaAssetId}/details`, {
      title: video.title,
      audience: "NETWORK",
      playbackPolicy: "AUTHORISED",
      expectedVersion: pitch.version,
    })
  ).pitch;
}

async function upload(token, base, current, video) {
  let pitch = current;
  if (pitch === null || !["CREATED", "UPLOAD_PENDING"].includes(pitch.status)) {
    pitch = (
      await api(
        token,
        "POST",
        base,
        pitch === null ? {} : { replacesMediaAssetId: pitch.mediaAssetId },
        stableKey(
          "capital-q-pitch",
          video.sha256,
          pitch?.mediaAssetId ?? "first",
        ),
      )
    ).pitch;
  }
  const at = `${base}/${pitch.mediaAssetId}`;
  const session = await api(token, "POST", `${at}/upload-session`, {
    expectedVersion: pitch.version,
  });
  if (session.uploadMode !== "DIRECT") {
    throw new Error(`upload mode ${session.uploadMode} not handled`);
  }
  // Bytes go straight to the provider's edge, as from the browser.
  const form = new FormData();
  form.append(
    "file",
    new Blob([video.bytes], { type: video.mime }),
    video.file,
  );
  const sent = await fetch(session.uploadUrl, { method: "POST", body: form });
  if (!sent.ok) throw new Error(`upload: HTTP ${sent.status}`);
  const started = Date.now();
  for (;;) {
    pitch = (await api(token, "POST", `${at}/sync`, {})).pitch;
    console.log(`  pitch ${pitch.status}`);
    if (pitch.status === "READY") return pitch;
    if (ENDED.includes(pitch.status))
      throw new Error(`pitch ended ${pitch.status}`);
    if (Date.now() - started > POLL_MAX_MS) {
      throw new Error("pitch not READY within 15 minutes");
    }
    await sleep(POLL_MS);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const at = args.indexOf("--founder");
  const email = at === -1 ? undefined : args[at + 1];
  if (!email) throw new Error("--founder <account email> is required");

  const video = withinPitchLimit(loadPitchVideo());
  console.log(
    `video: ${video.seconds.toFixed(1)} s, ${video.bytes.byteLength} bytes`,
  );
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const spec = fixture.companies.find((c) => c.key === "capital-q");
  const orgId = spec.match.organisationId;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) throw new Error("bad organisation id");
  const [company] = await sql(
    `select id from core.companies where organisation_id = '${orgId}'`,
  );
  if (company === undefined)
    throw new Error("Capital Q is not on the platform");

  const token = await accessToken(email);
  const base = `/v1/companies/${company.id}/pitch`;
  const current = (await api(token, "GET", base)).pitch;
  const step = pitchStep(current, video.title);
  console.log(
    `Capital Q pitch: ${step} (current: ${current === null ? "none" : `${current.status} "${current.title ?? ""}"`})`,
  );
  if (!apply) {
    console.log("Dry run: nothing uploaded. Add --apply to upload.");
    return;
  }
  if (step === "NOTHING") return;
  const ready =
    step === "UPLOAD" ? await upload(token, base, current, video) : current;
  const done = await setDetails(token, base, ready, video);
  console.log(
    `Applied: ${done.status}, audience ${done.audience}, playback ${done.playbackPolicy}, id ${done.mediaAssetId}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
