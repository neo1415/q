// Design-only walkthrough recording. Synthetic records, scripted Q, no API calls.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("@playwright/test", {
    paths: [process.cwd(), process.env.CQ_TOOL_CHECKOUT ?? "/workspace/q"],
  }),
);
const out = resolve(process.argv[2] ?? "design/relationship-hub/review/videos");
mkdirSync(out, { recursive: true });
const base =
  process.env.HUB_URL ??
  "http://127.0.0.1:4321/design/relationship-hub/index.html";
const browser = await chromium.launch({
  executablePath: process.env.CQ_CHROMIUM ?? "/usr/bin/chromium",
});
const receipts = [];
for (const name of ["investor", "founder", "q-navigation", "mobile"]) {
  const mobile = name === "mobile";
  const viewport = mobile
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 };
  const ctx = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    recordVideo: { dir: out, size: viewport },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const role = name === "founder" ? "founder" : "investor";
  await page.goto(`${base}#${role}/overview`);
  await page.waitForTimeout(1800);
  const navigate = async (hash) => {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(1800);
  };
  if (name === "investor") {
    for (const hash of [
      "investor/pipeline?view=table",
      "investor/pipeline?view=board",
      "investor/record/halden/overview",
      "investor/record/halden/evidence",
      "investor/record/halden/meetings?t=2205",
      "investor/work/w2",
      "investor/reports",
    ])
      await navigate(hash);
  } else if (name === "founder") {
    for (const hash of [
      "founder/investors?view=table",
      "founder/record/northgate/requests",
      "founder/fundraising",
      "founder/updates",
    ])
      await navigate(hash);
    await page.evaluate(() => window.HUB.runCommand("What should I do next?"));
  } else if (name === "q-navigation") {
    await page.evaluate(() =>
      window.HUB.runCommand("Show the margin evidence"),
    );
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.HUB.runCommand("Open the term sheet"));
  } else {
    await navigate("investor/pipeline?view=table");
    await navigate("investor/record/halden/overview");
    await navigate("founder/overview");
    await navigate("founder/record/northgate/requests");
    await page.evaluate(() => window.HUB.runCommand("What should I do next?"));
  }
  await page.waitForTimeout(2200);
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  const target = resolve(out, `${name}.mp4`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      webm,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      target,
    ],
    { stdio: "ignore" },
  );
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height:format=duration",
        "-of",
        "json",
        target,
      ],
      { encoding: "utf8" },
    ),
  );
  execFileSync("ffmpeg", ["-v", "error", "-i", target, "-f", "null", "-"], {
    stdio: "pipe",
  });
  receipts.push({ name, errors, overflow, ...probe });
}
await browser.close();
writeFileSync(
  resolve(out, "validation.json"),
  JSON.stringify(receipts, null, 2),
);
if (
  receipts.some(
    (r) => r.errors.length || r.overflow.document > r.overflow.viewport,
  )
)
  throw new Error(
    "Walkthrough layout or runtime errors; inspect validation.json",
  );
console.log(JSON.stringify(receipts));
