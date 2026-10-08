import type { BrowserContext, Page, Route } from "@playwright/test";

/**
 * Failure injection at the browser's edges. Nothing here touches a server's
 * internals: a fault is what a person's device or network would do.
 */

/** Next.js server actions are POSTs carrying a `next-action` header. */
function isServerAction(route: Route): boolean {
  const request = route.request();
  return request.method() === "POST" && request.headers()["next-action"] !== undefined;
}

/**
 * Relay failure: the next `count` server actions fail as a dropped network
 * would (the duplex `heard` relay and the Q send are server actions; audit
 * C-08). Returns a function that stops the fault.
 */
export async function failServerActions(
  page: Page,
  count = 1,
  how: "abort" | "hang" = "abort",
): Promise<() => Promise<void>> {
  let left = count;
  const handler = async (route: Route) => {
    if (!isServerAction(route) || left <= 0) return route.fallback();
    left -= 1;
    if (how === "abort") return route.abort("internetdisconnected");
    // Never answered: the caller's own deadline is what is under test.
    return new Promise<void>(() => undefined);
  };
  await page.route("**/*", handler);
  return () => page.unroute("**/*", handler);
}

/** Network loss for `ms`, then back. */
export async function dropNetwork(context: BrowserContext, ms: number): Promise<void> {
  await context.setOffline(true);
  await new Promise((resolve) => setTimeout(resolve, ms));
  await context.setOffline(false);
}

/** Lost microphone permission mid-line: revoke, and end the live track. */
export async function loseMicrophone(page: Page): Promise<void> {
  await page.context().clearPermissions();
  await page.evaluate(() => {
    const own = window as Window & { __cqTracks?: MediaStreamTrack[] };
    for (const track of own.__cqTracks ?? []) {
      track.stop();
      track.dispatchEvent(new Event("ended"));
    }
  });
}

/** Keeps a handle on every microphone track the page opens (for loseMicrophone). */
export async function trackMicrophones(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const own = window as Window & { __cqTracks?: MediaStreamTrack[] };
    own.__cqTracks = [];
    const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (original === undefined) return;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      own.__cqTracks?.push(...stream.getAudioTracks());
      return stream;
    };
  });
}
