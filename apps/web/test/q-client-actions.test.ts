import { beforeAll, describe, expect, it, vi } from "vitest";

import type { QTurn } from "../src/features/q/conversation";
import {
  openSubjectPage,
  recordIntentPath,
  performClientAction,
  subjectPagePath,
  type ClientActionEffects,
} from "../src/features/q/client-actions";
import { intentHref } from "../src/features/q/q-result-blocks";
import { materialShouldClose } from "../src/features/q/material-viewer-logic";
import { followOfTurns } from "../src/features/q/follow-navigation";
import { currentScreen, setOpenDocument } from "../src/features/q/screen";
import { loadWire } from "../src/features/q/wire";

// W7: the wire's contracts load after the first paint in the browser;
// here they are in before any test reads Q's data.
beforeAll(async () => {
  await loadWire();
});

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
    setDiscoverFilters: (intent) =>
      done.push(
        `filters:${intent.sectorCodes.join("+")}:${intent.countryCodes.join("+")}`,
      ),
    screen: (intent) =>
      done.push(`screen:${intent.act}:${intent.section ?? ""}`),
    openMaterial: (document) =>
      done.push(`material:${document.companyId}:${document.documentId}`),
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
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  } satisfies QTurn;
}

describe("performing a client action", () => {
  it("opens the chat itself, and works the screen (founder report 2026-09-30)", () => {
    const { port, done } = effects();
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      performClientAction(
        {
          kind: "OPEN_RECORD_PAGE",
          page: "RELATIONSHIP_INVESTOR_MESSAGES",
          id,
        },
        port,
      ),
    ).toBe(true);
    expect(
      performClientAction({ kind: "SCREEN_ACT", act: "PAGE_DOWN" }, port),
    ).toBe(true);
    expect(
      performClientAction(
        { kind: "SCREEN_ACT", act: "SHOW_SECTION", section: "commitment" },
        port,
      ),
    ).toBe(true);
    // A section the pages do not have is refused, never guessed.
    expect(
      performClientAction(
        { kind: "SCREEN_ACT", act: "SHOW_SECTION", section: "anything" },
        port,
      ),
    ).toBe(false);
    expect(done).toEqual([
      `go:/relationships/investor/${id}/messages`,
      "screen:PAGE_DOWN:",
      "screen:SHOW_SECTION:commitment",
    ]);
  });

  it("sets the Discover filters, and refuses a malformed filter intent (ux/discover-filters)", () => {
    const { port, done } = effects();
    const intent = {
      kind: "SET_DISCOVER_FILTERS",
      sectorCodes: ["fintech"],
      stageCodes: [],
      countryCodes: ["NG"],
      raise: null,
      raiseDisclosedOnly: false,
      verifiedOnly: false,
      hasPitch: false,
    };
    expect(performClientAction(intent, port)).toBe(true);
    expect(
      performClientAction({ ...intent, countryCodes: ["Nigeria"] }, port),
    ).toBe(false);
    expect(done).toEqual(["filters:fintech:NG"]);
  });

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
    const { timeZone: _withDoc, ...withDoc } = currentScreen("/home") ?? {};
    // voiceq-63: Q's viewer shows a document Q made (an artifact): it rides
    // as artifactId, which the server reads through read_my_document. As
    // documentId it was dropped by the firewall (canonical documents only).
    expect(withDoc).toEqual({ route: "HOME", artifactId: DOC });
    setOpenDocument(null);
    const { timeZone: _closed, ...closed } = currentScreen("/home") ?? {};
    expect(closed).toEqual({ route: "HOME" });
  });

  it("ignores an id that is not one", () => {
    setOpenDocument("not-a-uuid");
    const { timeZone: _tz, ...screen } = currentScreen("/profile") ?? {};
    expect(screen).toEqual({ route: "PROFILE" });
  });
});

describe("card and intent links to a record's page (R0, live 2026-10-06)", () => {
  const COMPANY = "0a8b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  it("a card's company or investor opens its page; other subjects open nothing", () => {
    const went: string[] = [];
    expect(
      openSubjectPage({ kind: "COMPANY", companyId: COMPANY }, (path) =>
        went.push(path),
      ),
    ).toBe(true);
    expect(went).toEqual([`/company/${COMPANY}`]);
    expect(
      subjectPagePath({
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: COMPANY,
      }),
    ).toBe(`/investors/${COMPANY}`);
    expect(
      subjectPagePath({ kind: "RELATIONSHIP", relationshipId: COMPANY }),
    ).toBeNull();
  });

  it("a data-room document opens in the viewer where they are, never without its company", () => {
    const { port, done } = effects();
    const DOC = "1a8b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(
      performClientAction(
        {
          kind: "OPEN_RECORD_PAGE",
          page: "DATA_ROOM_DOCUMENT",
          id: DOC,
          companyId: COMPANY,
          title: "Certificate of Incorporation",
        },
        port,
      ),
    ).toBe(true);
    expect(
      performClientAction(
        { kind: "OPEN_RECORD_PAGE", page: "DATA_ROOM_DOCUMENT", id: DOC },
        port,
      ),
    ).toBe(false);
    expect(done).toEqual([`material:${COMPANY}:${DOC}`]);
  });

  it("OPEN_COMPANY and FOCUS_SECTION intents link to the company page", () => {
    expect(intentHref({ kind: "OPEN_COMPANY", companyId: COMPANY })).toBe(
      `/company/${COMPANY}`,
    );
    expect(
      intentHref({
        kind: "FOCUS_SECTION",
        companyId: COMPANY,
        section: "DOCUMENTS",
      }),
    ).toBe(`/company/${COMPANY}?tab=dataroom`);
  });
});

describe("the opened data-room document closes when the topic moves on (R0)", () => {
  const DOC = "1a8b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const person = (text: string): QTurn => ({
    kind: "PERSON",
    id: `p-${text}`,
    text,
    unconfirmed: false,
  });
  it("stays while they talk about it, closes when asked or when Q moves on", () => {
    expect(
      materialShouldClose(
        [
          person("what does it say about the registered office?"),
          qTurn("q1", [
            {
              kind: "UI_INTENT",
              intent: {
                kind: "OPEN_RECORD_PAGE",
                page: "DATA_ROOM_DOCUMENT",
                id: DOC,
                companyId: DOC,
              },
            },
          ]),
        ],
        DOC,
      ),
    ).toBe(false);
    expect(materialShouldClose([person("ok, close it")], DOC)).toBe(true);
    expect(
      materialShouldClose(
        [
          qTurn("q2", [
            {
              kind: "UI_INTENT",
              intent: { kind: "NAVIGATE", destination: "DISCOVER" },
            },
          ]),
        ],
        DOC,
      ),
    ).toBe(true);
  });
});

describe("a record page with its tab, deck section and viewer (N2)", () => {
  const id = "d48c26d2-5aca-4788-9033-073b0f9d08ec";
  it("selects the company tab, the deck section and the viewer in the URL", () => {
    expect(
      recordIntentPath({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY_TEAM",
        id,
        tab: "team",
      }),
    ).toBe(`/company/${id}?tab=team`);
    expect(
      recordIntentPath({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY_DECK",
        id,
        tab: "deck",
        subTab: "THE_ASK",
        viewer: "OPEN",
      }),
    ).toBe(`/company/${id}?tab=deck&sub=the_ask&open=1`);
  });
  it("opens a relationship's calls and diligence, and leaves a bare page bare", () => {
    expect(
      recordIntentPath({
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_COMPANY",
        id,
        tab: "calls",
      }),
    ).toBe(`/relationships/company/${id}/calls`);
    expect(
      recordIntentPath({
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_INVESTOR",
        id,
        tab: "diligence",
      }),
    ).toBe(`/relationships/investor/${id}/diligence`);
    expect(
      recordIntentPath({ kind: "OPEN_RECORD_PAGE", page: "COMPANY", id }),
    ).toBe(`/company/${id}`);
  });
});
