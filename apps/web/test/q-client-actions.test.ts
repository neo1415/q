import { describe, expect, it, vi } from "vitest";

import type { QTurn } from "../src/features/q/conversation";
import {
  performClientAction,
  type ClientActionEffects,
} from "../src/features/q/client-actions";
import { followOfTurns } from "../src/features/q/follow-navigation";
import { currentScreen, setOpenDocument } from "../src/features/q/screen";

/**
 * Client actions (R20/R33; founder live test 2026-09-27 #4) and the open
 * document on screen (R21). Q's answer carries the action; the browser
 * performs it through the page's own code, once, after checking it again.
 */

function effects() {
  const done: string[] = [];
  const port: ClientActionEffects = {
    setTheme: (theme) => done.push(`theme:${theme}`),
    reload: () => done.push("reload"),
    openTab: (url) => {
      done.push(`open:${url}`);
      return true;
    },
    setQMotion: (motion) => done.push(`motion:${motion}`),
    setVoice: (voice) => done.push(`voice:${voice}`),
    signOut: () => done.push("sign-out"),
    goTo: (path) => done.push(`go:${path}`),
  };
  return { port, done };
}

function qTurn(id: string, blocks: Extract<QTurn, { kind: "Q" }>["blocks"]) {
  return {
    kind: "Q" as const,
    id,
    text: "Done.",
    streaming: false,
    sourceCount: 0,
    findings: [],
    uncertainties: [],
    blocks,
  } satisfies QTurn;
}

describe("performing a client action", () => {
  it("dispatches each kind to the page's own effect", () => {
    const { port, done } = effects();
    expect(
      performClientAction({ kind: "SET_THEME", theme: "dark" }, port),
    ).toBe(true);
    expect(performClientAction({ kind: "RELOAD_PAGE" }, port)).toBe(true);
    expect(
      performClientAction(
        { kind: "OPEN_WEBSITE", url: "https://zino-aviation.example" },
        port,
      ),
    ).toBe(true);
    expect(
      performClientAction({ kind: "SET_Q_MOTION", motion: "calm" }, port),
    ).toBe(true);
    expect(
      performClientAction({ kind: "SET_VOICE", voice: "MALE" }, port),
    ).toBe(true);
    expect(performClientAction({ kind: "SIGN_OUT" }, port)).toBe(true);
    expect(
      performClientAction(
        {
          kind: "OPEN_RECORD_PAGE",
          page: "RELATIONSHIP_INVESTOR",
          id: "c0000000-0000-4000-8000-000000000001",
        },
        port,
      ),
    ).toBe(true);
    expect(
      performClientAction({ kind: "OPEN_SETUP", journey: "investor" }, port),
    ).toBe(true);
    expect(done).toEqual([
      "theme:dark",
      "reload",
      "open:https://zino-aviation.example",
      "motion:calm",
      "voice:MALE",
      "sign-out",
      "go:/relationships/investor/c0000000-0000-4000-8000-000000000001",
      "go:/onboarding/investor?from=home",
    ]);
  });

  it("refuses anything that is not a valid client action, a script URL above all", () => {
    const { port, done } = effects();
    for (const raw of [
      { kind: "OPEN_WEBSITE", url: "javascript:alert(1)" },
      { kind: "OPEN_WEBSITE", url: "/profile" },
      { kind: "SET_THEME", theme: "neon" },
      { kind: "SET_Q_MOTION", motion: "wild" },
      { kind: "SET_VOICE", voice: "ROBOT" },
      { kind: "SIGN_OUT", redirect: "https://evil.example" },
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: "../admin" },
      {
        kind: "OPEN_RECORD_PAGE",
        page: "ADMIN",
        id: "c0000000-0000-4000-8000-000000000001",
      },
      { kind: "RUN_SCRIPT", code: "x" },
      { kind: "OPEN_SETUP", journey: "../admin" },
      null,
    ]) {
      expect(performClientAction(raw, port), JSON.stringify(raw)).toBe(false);
    }
    expect(done).toEqual([]);
  });

  it("the default theme effect is the theme control's own apply and store", async () => {
    vi.resetModules();
    const applyTheme = vi.fn();
    const storeTheme = vi.fn();
    vi.doMock("@/features/appearance/theme", () => ({
      applyTheme,
      storeTheme,
    }));
    const fresh = await import("../src/features/q/client-actions");
    fresh.BROWSER_EFFECTS.setTheme("light");
    expect(applyTheme).toHaveBeenCalledWith("light");
    expect(storeTheme).toHaveBeenCalledWith("light");
    vi.doUnmock("@/features/appearance/theme");
  });
});

describe("following an answer's client actions", () => {
  it("collects them from a new answer, once, beside its navigation", () => {
    const seen = new Set<string>();
    const turns = [
      qTurn("m1", [
        { kind: "UI_INTENT", intent: { kind: "SET_THEME", theme: "dark" } },
        {
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: "PROFILE" },
        },
      ]),
    ];
    expect(followOfTurns(turns, seen)).toEqual({
      navigate: "PROFILE",
      actions: [{ kind: "SET_THEME", theme: "dark" }],
    });
    expect(followOfTurns(turns, seen)).toEqual({ navigate: null, actions: [] });
  });

  it("never repeats one from an answer already on screen", () => {
    const seen = new Set<string>(["m1"]);
    expect(
      followOfTurns(
        [qTurn("m1", [{ kind: "UI_INTENT", intent: { kind: "RELOAD_PAGE" } }])],
        seen,
      ).actions,
    ).toEqual([]);
  });
});

describe("the screen includes the document open in Q's viewer (R21)", () => {
  const DOC = "e0000000-0000-4000-8000-000000000001";

  it("adds the open document to the route's context, and drops it when closed", () => {
    setOpenDocument(DOC);
    expect(currentScreen("/home")).toEqual({ route: "HOME", documentId: DOC });
    setOpenDocument(null);
    expect(currentScreen("/home")).toEqual({ route: "HOME" });
  });

  it("ignores an id that is not one", () => {
    setOpenDocument("not-a-uuid");
    expect(currentScreen("/profile")).toEqual({ route: "PROFILE" });
  });
});
