import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { test, type BrowserContext } from "@playwright/test";

import { RUN_PATH } from "./stack.js";

/**
 * Every move's `cq:navigation-timing` (navigation-lifecycle.ts: pushMs,
 * commitMs, totalMs, pushes), appended with the test that made it to
 * `<run>/nav-timing.ndjson`, so the gate can report the typed moves'
 * send->VERIFIED breakdown as p50/p95. Observation only: nothing asserts
 * on it here.
 */
export const NAV_TIMING_FILE = resolve(RUN_PATH, "nav-timing.ndjson");

export async function recordNavigationTimings(
  context: BrowserContext,
): Promise<void> {
  let title = "";
  try {
    title = test.info().titlePath.slice(1).join(" > ");
  } catch {
    // Outside a test (setup): still recorded, untitled.
  }
  mkdirSync(RUN_PATH, { recursive: true });
  await context.exposeBinding("__cqNavTiming", (_source, detail: unknown) => {
    appendFileSync(
      NAV_TIMING_FILE,
      `${JSON.stringify({ at: new Date().toISOString(), test: title, timing: detail })}\n`,
    );
  });
  await context.addInitScript(() => {
    window.addEventListener("cq:navigation-timing", (event) => {
      const send = (window as unknown as Record<string, unknown>)[
        "__cqNavTiming"
      ];
      if (typeof send === "function")
        void (send as (detail: unknown) => Promise<void>)(
          (event as CustomEvent<unknown>).detail,
        );
    });
  });
}
