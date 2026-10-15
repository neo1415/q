#!/usr/bin/env node
/**
 * Recovery G: plays the founder's recorded clips into Capital Q's voice line
 * as the microphone, and writes what the app heard next to what was said.
 *
 *   node scripts/recovery/voice/play-clips.mjs [clips-dir]
 *
 * LIVE only (it needs real speech recognition): refuses unless the local
 * stack was started with CQ_RECOVERY_MODE=live, i.e. on the founder's own
 * machine per LIVE-PROCEDURE.md. Build budget for live calls is $0.
 *
 * Clip files: `NN-short-name.wav` (16-bit PCM, mono, 16 or 48 kHz) with a
 * sidecar `NN-short-name.txt` holding the exact words spoken. One browser
 * launch per clip, because Chromium takes the fake-mic file as a launch flag.
 * Output: `NN-short-name.heard.json` = { expected, heard, wordErrorRate }.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const RUN =
  process.env.CQ_RECOVERY_RUN_DIR ??
  resolve(ROOT, ".playwright/recovery-stack");
const DIR = resolve(process.argv[2] ?? resolve(RUN, "clips"));
const mode = existsSync(resolve(RUN, "mode"))
  ? readFileSync(resolve(RUN, "mode"), "utf8").trim()
  : "unknown";
if (mode !== "live") {
  console.error(
    `LIVE-PENDING: the stack is ${mode}; clips need real recognition (LIVE-PROCEDURE.md).`,
  );
  process.exit(3);
}
const env = Object.fromEntries(
  readFileSync(resolve(RUN, "stack.env"), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
const WEB = env.CQ_WEB_ORIGIN;
const EMAIL =
  process.env.CQ_LIVE_EMAIL ?? "founder.ledgerfold@fictional.capitalq.local";
const { chromium } = await import("@playwright/test");

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
function wer(expected, heard) {
  const a = words(expected);
  const b = words(heard);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return a.length === 0 ? null : d[a.length][b.length] / a.length;
}

const clips = readdirSync(DIR)
  .filter((name) => name.endsWith(".wav"))
  .sort();
if (clips.length === 0) {
  console.error(`no .wav clips in ${DIR}`);
  process.exit(2);
}
for (const clip of clips) {
  const base = clip.replace(/\.wav$/u, "");
  const expected = existsSync(resolve(DIR, `${base}.txt`))
    ? readFileSync(resolve(DIR, `${base}.txt`), "utf8").trim()
    : "";
  const browser = await chromium.launch({
    executablePath: process.env.CQ_E2E_CHROMIUM,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${resolve(DIR, clip)}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await (
    await browser.newContext({ permissions: ["microphone"] })
  ).newPage();
  await page.goto(`${WEB}/auth/sign-in`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(env.CQ_SEED_ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), {
    timeout: 60_000,
  });
  await page.goto(`${WEB}/home`);
  const before = await page
    .locator('[data-q-turn-role="USER"], [data-role="USER"]')
    .count();
  await page.getByRole("button", { name: /Talk with Q/u }).click();
  // Long enough for the clip, the end of turn and the transcript.
  await page.waitForTimeout(Number(process.env.CQ_CLIP_WAIT_MS ?? 20_000));
  const users = await page
    .locator('[data-q-turn-role="USER"], [data-role="USER"]')
    .allInnerTexts();
  const heard = users.slice(before).join(" ").trim();
  const result = {
    clip,
    expected,
    heard,
    wordErrorRate: wer(expected, heard),
    mode: "LIVE",
    at: new Date().toISOString(),
  };
  writeFileSync(
    resolve(DIR, `${base}.heard.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(
    `${clip}: WER ${result.wordErrorRate === null ? "n/a" : result.wordErrorRate.toFixed(2)} | heard: ${heard.slice(0, 120)}`,
  );
  await browser.close();
}
