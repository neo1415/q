/* global process, console, setTimeout, fetch */
/**
 * Founder documents, as built (2026-10-08): the real pages over the
 * `/dev/founder-docs` harness's fictional data, from a production build
 * served with CQ_DEV_PREVIEW=1, at phone and desktop, light and dark.
 *
 *   pnpm --filter @capital-q/web build
 *   node scripts/founder-docs-built-shots.mjs [chromium-executable]
 *
 * Nothing reaches the API, the database or a provider.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const PORT = 3128;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const out = fileURLToPath(
  new URL("../docs/design/2026-10-08/founder-docs/built/", import.meta.url),
);
await mkdir(out, { recursive: true });

const server = spawn(
  "node",
  ["./node_modules/next/dist/bin/next", "start", "--port", String(PORT)],
  {
    cwd: web,
    env: {
      ...process.env,
      CQ_DEV_PREVIEW: "1",
      OPENAI_API_KEY: "disabled-locally-000000000000",
      ELEVENLABS_API_KEY: "disabled-locally-000000000000",
      DEEPGRAM_API_KEY: "disabled-locally-000000000000",
    },
    stdio: "ignore",
  },
);
try {
  for (let i = 0; i < 60; i += 1) {
    const up = await fetch(`${BASE}/dev/founder-docs`)
      .then((r) => r.ok)
      .catch(() => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const browser = await chromium.launch(
    process.argv[2] === undefined ? {} : { executablePath: process.argv[2] },
  );
  const sizes = { phone: [390, 844], desktop: [1440, 900] };
  const views = [
    ["requested", "?view=requested"],
    [
      "notification",
      "?view=requested&item=00000000-0000-4000-8000-000000000501",
    ],
    ["dataroom", "?view=dataroom"],
    ["access", "?view=access"],
    ["folder", "?view=folder"],
    ["investor", "?view=investor"],
  ];
  for (const [name, query] of views) {
    for (const [device, [width, height]] of Object.entries(sizes)) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.addInitScript((value) => {
          try {
            window.localStorage.setItem("cq.theme", value);
            window.sessionStorage.setItem("cq.splash.seen", "1");
          } catch {
            // A private window keeps the default.
          }
        }, theme);
        await page.goto(`${BASE}/dev/founder-docs${query}`);
        await page.waitForLoadState("load");
        await page.waitForTimeout(1200);
        await page.screenshot({
          path: `${out}${name}-${device}-${theme}.png`,
          fullPage: name !== "access" && name !== "folder",
        });
        await page.close();
      }
    }
  }
  await browser.close();
  console.log(`wrote ${out}`);
} finally {
  server.kill();
}
