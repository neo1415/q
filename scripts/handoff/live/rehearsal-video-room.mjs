/* global MediaStream, MediaRecorder, btoa -- run inside the page */
// ONE paid Tavus rehearsal room on production, with evidence. Owner-approved
// per run only (about 3.5 min, about $1.23 on the Builder plan). Signs in as a
// fictional demo founder, starts a rehearsal with the counterpart, opens
// the video room (the server holds the Tavus key), joins it in headless
// Chromium with a fake camera and microphone, and records what the face
// sends (video + audio, the browser's own MediaRecorder) for RECORD_MS.
// Then it ends the room. The room's own 180 s cap ends it regardless.
//
//   NODE_USE_ENV_PROXY=1 CQ_SEED_ACCOUNT_PASSWORD=... SB_PUBLISHABLE=... \
//   node scripts/handoff/live/rehearsal-video-room.mjs <outDir> [founderLocal] [KIND/uuid] [interviewerId]
//
// Secrets come from env only and are never printed. Writes
// <outDir>/room.webm and <outDir>/room.json; the recording holds no
// personal data (fictional founder, a stock face).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};
const out = process.argv[2];
if (out === undefined) {
  console.error(
    "usage: rehearsal-video-room.mjs <outDir> [founder] [KIND/uuid] [interviewer]",
  );
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const SB_URL = process.env.SB_URL ?? "https://vcohxiqsmnkzxnvawgri.supabase.co";
const QAPI =
  process.env.QAPI ?? "https://capital-qq-api-production.up.railway.app";
const RECORD_MS = Number(process.env.RECORD_MS ?? 75_000);
const founder = `${process.argv[3] ?? "founder.souqsheet"}@fictional.capitalq.local`;
const [kind, id] = (
  process.argv[4] ??
  "INVESTOR_ORGANISATION/b0075742-0000-4000-8000-0000000000c1"
).split("/");
const interviewerId = process.argv[5] ?? "partner-steve";

const signIn = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: need("SB_PUBLISHABLE"),
    "content-type": "application/json",
  },
  body: JSON.stringify({
    email: founder,
    password: need("CQ_SEED_ACCOUNT_PASSWORD"),
  }),
});
if (!signIn.ok) {
  console.error(`sign-in ${signIn.status}`);
  process.exit(1);
}
const { access_token: token } = await signIn.json();
const call = async (method, path, body) => {
  const started = Date.now();
  const response = await fetch(`${QAPI}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: the status says what happened.
  }
  return { status: response.status, ms: Date.now() - started, json, text };
};

const report = { founder, counterpart: `${kind}/${id}`, interviewerId };
const started = await call("POST", "/v1/q/rehearsals", {
  counterpart: { kind, id },
  voice: "MALE",
  difficulty: "REALISTIC",
});
const rehearsal = started.json?.rehearsal ?? started.json;
report.rehearsalId = rehearsal?.id ?? null;
report.opening =
  (rehearsal?.turns ?? []).filter((t) => t.from === "THEM").at(-1)?.text ??
  null;
console.log(JSON.stringify({ start: started.status, opening: report.opening }));
if (report.rehearsalId === null) process.exit(1);

const video = await call(
  "POST",
  `/v1/q/rehearsals/${report.rehearsalId}/video`,
  {
    interviewerId,
  },
);
report.video = { status: video.status, ms: video.ms, mode: video.json?.mode };
console.log(
  JSON.stringify({ video: report.video, reason: video.json?.reason }),
);
const joinUrl = video.json?.session?.joinUrl ?? null;
if (video.json?.mode !== "VIDEO" || joinUrl === null) {
  writeFileSync(join(out, "room.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(
    process.env.PLAYWRIGHT_PATH ??
      new URL(
        "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright",
        import.meta.url,
      ).pathname,
  ));
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--ignore-certificate-errors",
  ],
});
const page = await browser.newPage();
const joinedAt = Date.now();
await page.goto(joinUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
// Daily's prebuilt page asks for a name first (23 Oct run: the room was
// opened and paid for, but the browser sat on "Enter your name" and never
// joined), then may show a join button.
const nameBox = page.getByRole("textbox").first();
if (
  await nameBox
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
) {
  await nameBox.fill("Rehearsal check");
  await page
    .getByRole("button", { name: /continue/i })
    .first()
    .click();
}
for (const label of [/join/i, /continue/i]) {
  const button = page.getByRole("button", { name: label }).first();
  if (
    await button
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await button.click().catch(() => undefined);
  }
}
await page
  .screenshot({ path: join(out, "room-joined.png") })
  .catch(() => undefined);
// Record every remote stream the page plays, as the browser hears it.
const recorded = await page.evaluate(async (ms) => {
  const deadline = Date.now() + 45_000;
  let tracks = [];
  while (Date.now() < deadline) {
    const elements = [...document.querySelectorAll("video, audio")];
    tracks = elements
      .map((el) => el.srcObject)
      .filter((stream) => stream instanceof MediaStream)
      .flatMap((stream) => stream.getTracks())
      .filter((track) => track.readyState === "live");
    const hasVideo = tracks.some((t) => t.kind === "video");
    const hasAudio = tracks.some((t) => t.kind === "audio");
    if (hasVideo && hasAudio) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (tracks.length === 0) return { found: 0, data: null };
  const stream = new MediaStream(tracks);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.start(1_000);
  await new Promise((resolve) => setTimeout(resolve, ms));
  recorder.stop();
  await new Promise((resolve) => (recorder.onstop = resolve));
  const blob = new Blob(chunks, { type: "video/webm" });
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 1) {
    binary += String.fromCharCode(buffer[i]);
  }
  return {
    found: tracks.length,
    kinds: tracks.map((t) => t.kind),
    data: btoa(binary),
  };
}, RECORD_MS);
report.recording = {
  tracks: recorded.found,
  kinds: recorded.kinds ?? [],
  seconds: Math.round((Date.now() - joinedAt) / 1000),
};
if (recorded.data !== null) {
  writeFileSync(join(out, "room.webm"), Buffer.from(recorded.data, "base64"));
}
await page.screenshot({ path: join(out, "room.png") }).catch(() => undefined);
await browser.close();

const ended = await call(
  "POST",
  `/v1/q/rehearsals/${report.rehearsalId}/video/end`,
  {},
);
report.end = { status: ended.status, ms: ended.ms };
report.roomSeconds = Math.round((Date.now() - joinedAt) / 1000);
writeFileSync(join(out, "room.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
