#!/usr/bin/env node
/**
 * Q Story evidence (S1): drives the story in Chromium against a running
 * web server and writes, under docs/ai-handoff/evidence/q-story/:
 *
 *   story-desktop.webm       the full story, recorded (desktop, light)
 *   frames/*.png             key frames (light and dark, 390 px and desktop)
 *   metrics.json             cue-to-word offsets (median, p95), dropped
 *                            frames, CLS, fallbacks, preload time
 *
 * Also captures the talking-speed montage's screenshots (#51) into
 * apps/web/public/q-pitch/story/screens/ with --screens.
 *
 *   node scripts/q-pitch/record-story.mjs --base http://127.0.0.1:3200
 *     [--screens] [--frames] [--full] [--path /dev/story]
 *
 * The default path is the design harness (/dev/story: fictional data, no
 * service read, no model call). Point --path at /home?qpitch=story with a
 * signed-in storage state (--state file) to record the real app.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const flag = (name) => process.argv.includes(`--${name}`);
const base = option("base", "http://127.0.0.1:3200");
const storyPath = option("path", "/dev/story");
const state = option("state", undefined);
const out = path.join(root, "docs/ai-handoff/evidence/q-story");
const executablePath =
  process.env.CQ_CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);

const browser = await chromium.launch({
  ...(executablePath === undefined ? {} : { executablePath }),
  args: ["--autoplay-policy=no-user-gesture-required"],
});

/** Layout shifts, summed (session windows are not needed for a CLS of 0). */
const CLS_SCRIPT = () => {
  window.__cls = 0;
  window.__shifts = [];
  try {
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        window.__shifts.push({
          value: entry.value,
          at: Math.round(entry.startTime),
          path: window.location.pathname + window.location.search,
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // Not supported: recorded as null below.
  }
};

async function open(viewport, colorScheme, recordVideo) {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    deviceScaleFactor: viewport.width < 500 ? 2 : 1,
    ...(state === undefined ? {} : { storageState: state }),
    ...(recordVideo
      ? { recordVideo: { dir: path.join(out, "video-tmp"), size: viewport } }
      : {}),
  });
  await context.addInitScript(CLS_SCRIPT);
  if (state === undefined) {
    // Signed out (the harness): the app's session proxy guards /q-pitch/*,
    // so the story's static files are answered from disk here, as the
    // Discover harness's media is. A signed-in run loads them as usual.
    await context.route("**/q-pitch/story/**", async (route) => {
      const url = new URL(route.request().url());
      const file = path.join(
        root,
        "apps/web/public",
        decodeURIComponent(url.pathname),
      );
      if (!file.startsWith(path.join(root, "apps/web/public/q-pitch/story/"))) {
        return route.abort();
      }
      try {
        const body = await readFile(file);
        const type = file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".mp3")
            ? "audio/mpeg"
            : "image/jpeg";
        return route.fulfill({ status: 200, body, contentType: type });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    });
  }
  const page = await context.newPage();
  return { context, page };
}

/** The harness's pages, compiled once before a timed run (dev server). */
const WARM = [
  "/dev/story/discover",
  "/dev/story/crm?view=capital",
  "/dev/story/profile?tab=diligence",
  "/dev/story/crm?view=record",
  "/dev/story/gateq?view=gate",
  "/dev/story/gateq?view=inbox-detail",
  "/dev/story/gateq?view=inbox",
];
let warmed = false;
async function warm(page) {
  if (warmed || !storyPath.startsWith("/dev/")) return;
  for (const url of WARM) {
    await page
      .goto(`${base}${url}`, { waitUntil: "load", timeout: 300_000 })
      .catch(() => undefined);
  }
  warmed = true;
}

async function startStory(page) {
  await warm(page);
  await page.goto(`${base}${storyPath}`, { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Start the story" });
  await start.waitFor({ timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Start the story",
      );
      return button !== undefined && !button.disabled;
    },
    undefined,
    { timeout: 120_000 },
  );
  await start.click();
  await page.waitForFunction(
    () => typeof window.__cqStoryEvidence === "function",
    undefined,
    {
      timeout: 30_000,
    },
  );
}

const evidence = (page) =>
  page.evaluate(() => window.__cqStoryEvidence?.() ?? null);

/** Key frames: jump with the Next control, then let the beat's cues land. */
async function frames(viewport, colorScheme, beats, label) {
  const { context, page } = await open(viewport, colorScheme, false);
  await startStory(page);
  await mkdir(path.join(out, "frames"), { recursive: true });
  let at = 1;
  for (const [beat, settleMs, name] of beats) {
    while (at < beat) {
      await page.getByRole("button", { name: "Next beat" }).click();
      at += 1;
    }
    await page.waitForTimeout(settleMs);
    await page.screenshot({
      path: path.join(
        out,
        "frames",
        `${label}-${String(beat).padStart(2, "0")}-${name}.png`,
      ),
    });
  }
  await context.close();
}

if (flag("screens")) {
  // #51: one still per word, of the real page components (harness data).
  const dir = path.join(root, "apps/web/public/q-pitch/story/screens");
  await mkdir(dir, { recursive: true });
  const shots = [
    ["discovery", "/dev/discover"],
    ["inbound", "/dev/gateq-v2?view=inbox"],
    ["intelligence", "/dev/profile?tab=diligence"],
    ["readiness", "/dev/crm?view=raise&tab=readiness"],
    ["matching", "/dev/crm?view=raise&tab=investors"],
    ["data", "/dev/profile?tab=dataroom"],
    ["relationships", "/dev/crm?view=record"],
    ["execution", "/dev/work"],
  ];
  const { context, page } = await open(
    { width: 1280, height: 800 },
    "light",
    false,
  );
  for (const [name, url] of shots) {
    await page
      .goto(`${base}${url}`, { waitUntil: "load", timeout: 180_000 })
      .catch(() => undefined);
    await page.waitForTimeout(2_500);
    await page.screenshot({
      path: path.join(dir, `${name}.jpg`),
      type: "jpeg",
      quality: 72,
    });
    console.log("screen", name);
  }
  await context.close();
}

if (flag("frames")) {
  const DESKTOP = { width: 1440, height: 900 };
  const PHONE = { width: 390, height: 844 };
  await frames(
    DESKTOP,
    "light",
    [
      [3, 1_600, "night"],
      [7, 1_800, "montage"],
      [36, 6_500, "mandate"],
      [46, 5_000, "investiq"],
    ],
    "desktop-light",
  );
  await frames(
    DESKTOP,
    "dark",
    [
      [30, 4_500, "mismatch"],
      [41, 4_500, "interview"],
      [49, 4_500, "q-card"],
      [54, 9_000, "home"],
    ],
    "desktop-dark",
  );
  await frames(
    PHONE,
    "light",
    [
      [12, 4_000, "questions"],
      [44, 6_000, "inbox"],
    ],
    "phone-light",
  );
  await frames(
    PHONE,
    "dark",
    [
      [26, 2_500, "silence"],
      [51, 4_000, "montage"],
    ],
    "phone-dark",
  );
}

if (flag("full")) {
  const viewport = { width: 1280, height: 800 };
  const { context, page } = await open(viewport, "light", true);
  const started = Date.now();
  await startStory(page);
  await page.waitForFunction(
    () => window.__cqStoryEvidence?.()?.phase === "DONE",
    undefined,
    {
      timeout: 12 * 60_000,
      polling: 500,
    },
  );
  const result = await evidence(page);
  const cls = await page.evaluate(() => ({
    cls: window.__cls ?? null,
    shifts: window.__shifts ?? [],
  }));
  const video = page.video();
  await context.close();
  await mkdir(out, { recursive: true });
  if (video !== null) await video.saveAs(path.join(out, "story-desktop.webm"));
  await writeFile(
    path.join(out, "metrics.json"),
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        base,
        path: storyPath,
        viewport,
        wallMs: Date.now() - started,
        ...result,
        cls,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify({ ...result, cls: cls.cls }, null, 2));
}

await browser.close();
