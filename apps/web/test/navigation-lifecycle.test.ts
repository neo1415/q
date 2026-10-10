// @vitest-environment jsdom
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_ROUTE_PATTERNS,
  isAppRoute,
  registerNavigationViewer,
  resetAppRoutes,
} from "../src/features/q/control/app-routes";
import {
  CONTROL_WAIT_MS,
  NAVIGATION_RETRY_MS,
  NAVIGATION_WAIT_MS,
  NOT_FOUND_MARKER,
  onNavigationOutcome,
  onNavigationPhase,
  requestNavigation,
  type NavigationOutcome,
  type NavigationPhase,
} from "../src/features/q/control/navigation-lifecycle";
import {
  registerControl,
  resetControls,
} from "../src/features/q/control/registry";
import {
  registerClientRouter,
  registerShellRouter,
  setHardLoad,
} from "../src/features/q/control/router-registry";
import {
  claimVoiceAudio,
  releaseVoiceAudio,
} from "../src/features/voice/voice-audio";
import {
  noteRoute,
  performUiAct,
  resetUiActController,
} from "../src/features/q/ui-act-controller";

/**
 * R3: the one navigation lifecycle -- REQUESTED -> VALIDATED -> EXECUTING
 * -> VERIFIED | FAILED(reason). Hosted 2026-10-09: Q said it was opening a
 * page and the app then said it could not be opened, because the surface
 * that expected the move was not the one that made it.
 */

let pushes: string[] = [];
let outcomes: NavigationOutcome[] = [];
let phases: NavigationPhase[] = [];
const stops: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetUiActController();
  resetControls();
  resetAppRoutes();
  pushes = [];
  outcomes = [];
  phases = [];
  window.history.replaceState(null, "", "/home");
  noteRoute("/home");
  registerClientRouter((path) => pushes.push(path));
  stops.push(onNavigationOutcome((o) => outcomes.push(o)));
  stops.push(onNavigationPhase((s) => phases.push(s.phase)));
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  registerClientRouter(null);
  registerShellRouter(null);
  setHardLoad(null);
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** The router commits: the URL and the shell's settled-route report. */
function land(route: string): void {
  window.history.pushState(null, "", route);
  noteRoute(route);
}

describe("the lifecycle", () => {
  it("runs REQUESTED -> VALIDATED -> EXECUTING -> VERIFIED, pushing once", async () => {
    const move = requestNavigation({ path: "/capital" });
    expect(phases).toEqual(["REQUESTED", "VALIDATED", "EXECUTING"]);
    expect(pushes).toEqual(["/capital"]);
    land("/capital");
    await expect(move.settled).resolves.toEqual({
      status: "DONE",
      intentId: move.intentId,
      expected: "/capital",
      route: "/capital",
    });
    expect(phases.at(-1)).toBe("VERIFIED");
    expect(outcomes).toHaveLength(1);
  });

  it("a nonexistent page fails at VALIDATED; nothing is pushed", async () => {
    const move = requestNavigation({ path: "/not-a-page" });
    await expect(move.settled).resolves.toMatchObject({
      status: "FAILED",
      reason: "NOT_FOUND",
    });
    expect(phases).toEqual(["REQUESTED", "FAILED"]);
    expect(pushes).toEqual([]);
    // Off-app targets are never moves either.
    expect(
      (await requestNavigation({ path: "//evil.example/x" }).settled).status,
    ).toBe("FAILED");
  });

  it("a page the viewer can't open fails at VALIDATED with UNAUTHORIZED", async () => {
    registerNavigationViewer({ kind: "FOUNDER", admin: false });
    const move = requestNavigation({ path: "/admin/q" });
    await expect(move.settled).resolves.toMatchObject({
      status: "FAILED",
      reason: "UNAUTHORIZED",
    });
    expect(pushes).toEqual([]);
    registerNavigationViewer({ kind: "FOUNDER", admin: true });
    requestNavigation({ path: "/admin/q" });
    expect(pushes).toEqual(["/admin/q"]);
  });

  it("a redirect is VERIFIED where the page sent them (server redirect table)", async () => {
    const move = requestNavigation({ path: "/gateway" });
    land("/gateq?tab=gate");
    await expect(move.settled).resolves.toMatchObject({
      status: "DONE",
      expected: "/gateway",
      route: "/gateq?tab=gate",
    });
  });

  it("a nested tab is VERIFIED only once the route has its tab and the tab control registers", async () => {
    const move = requestNavigation({
      path: "/capital?tab=readiness",
      control: "tab.readiness",
    });
    // The path alone (no tab) is not arrival.
    land("/capital");
    await vi.advanceTimersByTimeAsync(10);
    expect(outcomes).toEqual([]);
    land("/capital?tab=readiness");
    await vi.advanceTimersByTimeAsync(200);
    expect(outcomes).toEqual([]);
    registerControl({
      id: "tab.readiness",
      kind: "TAB",
      element: () => document.body,
    });
    await expect(move.settled).resolves.toMatchObject({ status: "DONE" });
  });

  it("a destination whose control never registers is FAILED: CONTROL_MISSING", async () => {
    const move = requestNavigation({
      path: "/capital?tab=readiness",
      control: "tab.readiness",
    });
    land("/capital?tab=readiness");
    await vi.advanceTimersByTimeAsync(CONTROL_WAIT_MS + 100);
    await expect(move.settled).resolves.toMatchObject({
      status: "FAILED",
      reason: "CONTROL_MISSING",
    });
  });

  it("the not-found page is never reported as opened", async () => {
    const move = requestNavigation({ path: "/company/nope" });
    const marker = document.createElement("div");
    marker.setAttribute(NOT_FOUND_MARKER, "");
    document.body.append(marker);
    land("/company/nope");
    await expect(move.settled).resolves.toMatchObject({
      status: "FAILED",
      reason: "NOT_FOUND",
    });
  });

  it("a duplicate intent (same id) is one execution and the same receipt", async () => {
    const one = requestNavigation({ path: "/discover", intentId: "utt-1" });
    const two = requestNavigation({ path: "/discover", intentId: "utt-1" });
    expect(two).toBe(one);
    land("/discover");
    await one.settled;
    // Asked again with the same id after it settled: still that receipt.
    const three = requestNavigation({ path: "/discover", intentId: "utt-1" });
    expect(await three.settled).toEqual(await one.settled);
    expect(pushes).toEqual(["/discover"]);
    expect(outcomes).toHaveLength(1);
  });

  it("an id it makes itself is unique beyond this tab (q-api dedupes per person)", async () => {
    const one = requestNavigation({ path: "/discover" });
    land("/discover");
    await one.settled;
    const two = requestNavigation({ path: "/capital" });
    land("/capital");
    await two.settled;
    // Not the bare "nav-1" every new tab used to start from.
    expect(one.intentId).toMatch(/^nav-[A-Za-z0-9]{8}-\d+$/u);
    expect(two.intentId).not.toBe(one.intentId);
  });

  it("a delayed navigation (slow server page) is VERIFIED when it lands, never FAILED first", async () => {
    const move = requestNavigation({ path: "/relationships" });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(outcomes).toEqual([]);
    land("/relationships");
    await expect(move.settled).resolves.toMatchObject({ status: "DONE" });
    await vi.advanceTimersByTimeAsync(NAVIGATION_WAIT_MS);
    expect(outcomes.map((o) => o.status)).toEqual(["DONE"]);
  });

  it("a push the router dropped (page rewrote its URL mid-move) is pushed once more and lands", async () => {
    const move = requestNavigation({ path: "/capital" });
    // Discover's own replaceState lands instead of the push.
    noteRoute("/discover?tab=yours");
    await vi.advanceTimersByTimeAsync(NAVIGATION_RETRY_MS + 10);
    expect(pushes).toEqual(["/capital", "/capital"]);
    land("/capital");
    await expect(move.settled).resolves.toMatchObject({ status: "DONE" });
  });

  it("never landing at all: FAILED NOT_LANDED after the bound, exactly once", async () => {
    const move = requestNavigation({ path: "/documents" });
    await vi.advanceTimersByTimeAsync(NAVIGATION_WAIT_MS + 10);
    await expect(move.settled).resolves.toMatchObject({
      status: "FAILED",
      reason: "NOT_LANDED",
    });
    land("/documents");
    expect(outcomes).toHaveLength(1);
  });

  it("survives a remount mid-execution: the shell's router goes away and comes back", async () => {
    registerClientRouter(null);
    const move = requestNavigation({ path: "/work" });
    expect(pushes).toEqual([]);
    // The remounted shell registers its router: the move goes at once.
    const shell: string[] = [];
    registerShellRouter((path) => shell.push(path));
    expect(shell).toEqual(["/work"]);
    land("/work");
    await expect(move.settled).resolves.toMatchObject({ status: "DONE" });
  });

  it("no router while a voice call holds the audio: FAILED NO_ROUTER, never a reload", async () => {
    registerClientRouter(null);
    const loads: string[] = [];
    setHardLoad((path) => loads.push(path));
    const owner = { stop: () => undefined };
    await claimVoiceAudio(owner);
    try {
      const move = requestNavigation({ path: "/work" });
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(move.settled).resolves.toMatchObject({
        status: "FAILED",
        reason: "NO_ROUTER",
      });
      expect(loads).toEqual([]);
    } finally {
      releaseVoiceAudio(owner);
    }
  });

  it("a newer move supersedes one still on its way", async () => {
    const first = requestNavigation({ path: "/capital" });
    const second = requestNavigation({ path: "/discover" });
    await expect(first.settled).resolves.toMatchObject({
      status: "FAILED",
      reason: "SUPERSEDED",
    });
    land("/discover");
    await expect(second.settled).resolves.toMatchObject({ status: "DONE" });
  });

  it("UI acts queued after a move wait for its page", async () => {
    requestNavigation({ path: "/capital" });
    const act = performUiAct({
      kind: "UI_ACT",
      actId: "uia_r3wait01",
      act: "SELECT_TAB",
      target: "tab.readiness",
    });
    await vi.advanceTimersByTimeAsync(300);
    let selected = false;
    land("/capital");
    registerControl({
      id: "tab.readiness",
      kind: "TAB",
      element: () => document.body,
      onAct: () => {
        selected = true;
        return "DONE";
      },
      exclusive: true,
    });
    expect((await act).status).toBe("DONE");
    expect(selected).toBe(true);
  });
});

describe("the typed route table", () => {
  it("lists every page the signed-in app has (no drift)", () => {
    // jsdom's import.meta.url is not a file URL: from the run's root.
    const app =
      [join(process.cwd(), "apps/web/app"), join(process.cwd(), "app")].find(
        (dir) => existsSync(dir),
      ) ?? "";
    const found: string[] = [];
    const walk = (dir: string, route: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (!statSync(full).isDirectory()) {
          if (name === "page.tsx" && route.length > 0) found.push(route);
          continue;
        }
        walk(full, /^\(.+\)$/u.test(name) ? route : `${route}/${name}`);
      }
    };
    for (const group of ["(app)", "(onboarding)"]) walk(join(app, group), "");
    expect([...found].sort()).toEqual([...APP_ROUTE_PATTERNS].sort());
    expect(isAppRoute("/relationships/company/abc?tab=x")).toBe(true);
    expect(isAppRoute("/relationships/company")).toBe(false);
  });
});
