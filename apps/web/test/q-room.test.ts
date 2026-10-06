// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  QPageManifestSchema,
  type QShowInQRoomIntent,
} from "@capital-q/contracts";

import {
  performClientAction,
  recordPagePath,
  settingsPath,
  type ClientActionEffects,
} from "../src/features/q/client-actions";
import type { QTurn } from "../src/features/q/conversation";
import {
  currentManifest,
  registerQDialog,
  registerQSection,
  resetManifest,
  seeingNow,
  setQFilters,
  setQTab,
} from "../src/features/q/manifest";
import { seeingLine } from "../src/features/q/q-can-see";
import { currentScreen } from "../src/features/q/screen";
import { roomCardHref } from "../src/features/q/room/room-card-view";
import { asksToClose, roomStage } from "../src/features/q/room/room-stage";

/**
 * Q room W2: the page manifest (R1), deep links (R2), and cards that close
 * when the conversation moves on (R4).
 */

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEDGERLINE = id(1);
const CLEARWATER = id(2);
const TOBENNA = id(3);

afterEach(() => {
  resetManifest();
  document.body.innerHTML = "";
});

describe("the page manifest (R1)", () => {
  it("sends ids and closed kinds only; the page's labels stay in the browser", () => {
    document.body.innerHTML = `<div data-q-section="feed"></div><div data-q-section="below"></div>`;
    registerQSection({
      id: "feed",
      kind: "COMPANY_FEED",
      refs: [
        { kind: "COMPANY", id: LEDGERLINE },
        { kind: "COMPANY", id: CLEARWATER },
      ],
      total: 12,
      label: "12 companies",
    });
    registerQSection({
      id: "below",
      kind: "APPROVAL_LIST",
      refs: [],
      total: 2,
      label: "2 waiting approvals",
    });
    setQTab("dataroom");
    setQFilters({ sector: "fintech" });
    const manifest = currentManifest();
    expect(QPageManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest?.sections.map((s) => s.id)).toEqual(["feed", "below"]);
    expect(manifest?.tab).toBe("dataroom");
    const wire = JSON.stringify(currentScreen("/discover"));
    expect(wire).toContain(LEDGERLINE);
    expect(wire).not.toContain("12 companies");
    expect(wire).not.toContain("waiting approvals");
    expect(seeingNow().parts).toEqual(["12 companies", "2 waiting approvals"]);
  });

  it("covers the whole page, not only what is in view, and never a part hidden from Q", () => {
    document.body.innerHTML = `<div data-q-section="feed"></div><div data-q-hidden><div data-q-section="private"></div></div>`;
    registerQSection({ id: "feed", kind: "COMPANY_FEED", refs: [], total: 3 });
    registerQSection({
      id: "private",
      kind: "CHAT",
      refs: [{ kind: "INVESTOR_ORGANISATION", id: TOBENNA }],
      total: 1,
    });
    const manifest = currentManifest();
    expect(manifest?.sections.map((s) => s.id)).toEqual(["feed"]);
    expect(JSON.stringify(manifest)).not.toContain(TOBENNA);
  });

  it("puts an open modal on top: registered, or any open window on the page, but not Q's own dock", () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Ledgerline preview"></div>
      <div role="dialog" aria-label="Q"><p data-q-self>Q can see</p></div>`;
    expect(currentManifest()?.dialogs).toEqual([
      { id: "window-1", kind: "OTHER", refs: [] },
    ]);
    expect(seeingNow().window).toBe("Ledgerline preview");
    const stop = registerQDialog({
      id: "preview",
      kind: "COMPANY_PREVIEW",
      refs: [{ kind: "COMPANY", id: LEDGERLINE }],
      label: "Ledgerline preview",
    });
    expect(currentManifest()?.dialogs).toEqual([
      {
        id: "preview",
        kind: "COMPANY_PREVIEW",
        refs: [{ kind: "COMPANY", id: LEDGERLINE }],
      },
    ]);
    stop();
  });

  it("drops what the contract would refuse rather than sending it", () => {
    registerQSection({
      id: "Not A Slug!",
      kind: "OTHER",
      refs: [],
      total: 1,
    });
    expect(currentManifest()).toBeUndefined();
  });

  it("says what Q can see, the window included", () => {
    expect(seeingLine("DISCOVER", ["12 companies"], "Ledgerline preview")).toBe(
      "Discover · 12 companies · window: Ledgerline preview",
    );
    expect(seeingLine("HOME", [], null)).toBe("Q room · nothing open");
  });
});

describe("deep links (R2)", () => {
  it("builds each record's path from the fixed route map", () => {
    expect(recordPagePath("COMPANY_DATA_ROOM", LEDGERLINE)).toBe(
      `/company/${LEDGERLINE}?tab=dataroom`,
    );
    expect(recordPagePath("COMPANY_ELEVATOR", LEDGERLINE)).toBe(
      `/company/${LEDGERLINE}?tab=elevator`,
    );
    expect(recordPagePath("COMPANY_DECK", LEDGERLINE)).toBe(
      `/company/${LEDGERLINE}?tab=deck`,
    );
    expect(recordPagePath("COMPANY_TEAM", LEDGERLINE)).toBe(
      `/company/${LEDGERLINE}?tab=team`,
    );
    expect(recordPagePath("WORK_ITEM", id(9))).toBe(`/work/${id(9)}`);
    expect(recordPagePath("CAPITAL_ROUND", id(9))).toBe(
      `/capital?round=${id(9)}#round-${id(9)}`,
    );
    expect(recordPagePath("GATEQ_APPLICATION", id(9))).toBe(
      `/gateq?item=${id(9)}`,
    );
    expect(recordPagePath("RELATIONSHIP_INVESTOR_MESSAGES", TOBENNA)).toBe(
      `/relationships/investor/${TOBENNA}/messages`,
    );
    expect(settingsPath("notifications")).toBe("/settings#notifications");
    expect(settingsPath("usage")).toBe("/settings/usage");
  });

  it("follows OPEN_SETTINGS and leaves SHOW_IN_Q_ROOM to the stage", () => {
    const went: string[] = [];
    const effects = {
      goTo: (path: string) => went.push(path),
    } as unknown as ClientActionEffects;
    expect(
      performClientAction(
        { kind: "OPEN_SETTINGS", section: "connections" },
        effects,
      ),
    ).toBe(true);
    expect(
      performClientAction(
        {
          kind: "SHOW_IN_Q_ROOM",
          object: "DATA_ROOM",
          id: LEDGERLINE,
          title: "Ledgerline",
        },
        effects,
      ),
    ).toBe(true);
    expect(went).toEqual(["/settings#connections"]);
  });
});

const person = (n: number, text: string): QTurn => ({
  kind: "PERSON",
  id: `p${String(n)}`,
  text,
  unconfirmed: false,
});
const answer = (
  n: number,
  text: string,
  show?: QShowInQRoomIntent,
  streaming = false,
): QTurn => ({
  kind: "Q",
  id: `q${String(n)}`,
  text,
  streaming,
  sourceCount: 0,
  publicSources: [],
  findings: [],
  uncertainties: [],
  blocks: show === undefined ? [] : [{ kind: "UI_INTENT", intent: show }],
});
const dataRoom: QShowInQRoomIntent = {
  kind: "SHOW_IN_Q_ROOM",
  object: "DATA_ROOM",
  id: LEDGERLINE,
  title: "Ledgerline",
};
const chat: QShowInQRoomIntent = {
  kind: "SHOW_IN_Q_ROOM",
  object: "CHAT_WITH_INVESTOR",
  id: TOBENNA,
  title: "Tobenna Okafor",
};

describe("cards close when the conversation moves on (R4)", () => {
  it("shows the card the answer carries, and keeps it while we stay on its subject", () => {
    const stage = roomStage([
      person(1, "Open Ledgerline's data room"),
      answer(1, "Here's Ledgerline's data room.", dataRoom),
      person(2, "Which of these are audited?"),
      answer(2, "Two are audited accounts."),
    ]);
    expect(stage.open?.intent).toEqual(dataRoom);
    expect(stage.note).toBeNull();
  });

  it("a new subject closes it straight away, with a quiet note", () => {
    const stage = roomStage([
      person(1, "Open Ledgerline's data room"),
      answer(1, "Here it is.", dataRoom),
      person(2, "How did Clearwater do last month?"),
      answer(2, "Clearwater made £41k in September."),
    ]);
    expect(stage.open).toBeNull();
    expect(stage.note?.text).toBe(
      "Closed Ledgerline's data room as we moved on",
    );
    expect(stage.closed.map((card) => card.intent)).toEqual([dataRoom]);
  });

  it("the subject coming back reopens it at once, before Q answers", () => {
    const stage = roomStage([
      person(1, "Open Ledgerline's data room"),
      answer(1, "Here it is.", dataRoom),
      person(2, "How did Clearwater do last month?"),
      answer(2, "Clearwater made £41k."),
      person(3, "Back to Ledgerline: what's in the legal folder?"),
      answer(3, "", undefined, true),
    ]);
    expect(stage.open?.intent).toEqual(dataRoom);
  });

  it("a new card replaces the open one, and says so", () => {
    const stage = roomStage([
      person(1, "Open Ledgerline's data room"),
      answer(1, "Here it is.", dataRoom),
      person(2, "Open the chat with Tobenna"),
      answer(2, "Opening your chat with Tobenna.", chat),
    ]);
    expect(stage.open?.intent).toEqual(chat);
    expect(stage.note?.text).toBe(
      "Closed Ledgerline's data room as we moved on",
    );
  });

  it("'close it' closes it, quietly", () => {
    expect(asksToClose("Close it")).toBe(true);
    expect(asksToClose("close that card please")).toBe(true);
    expect(asksToClose("Close the round with Kola")).toBe(false);
    const stage = roomStage([
      person(1, "Open the chat with Tobenna"),
      answer(1, "Opening it.", chat),
      person(2, "Close it."),
      answer(2, "Closed."),
    ]);
    expect(stage.open).toBeNull();
    expect(stage.note).toBeNull();
  });

  it("a still-streaming answer decides nothing yet", () => {
    const stage = roomStage([
      person(1, "Open Ledgerline's data room"),
      answer(1, "Here it is.", dataRoom),
      person(2, "How did Clearwater do?"),
      answer(2, "Clearwater…", undefined, true),
    ]);
    expect(stage.open?.intent).toEqual(dataRoom);
  });

  it("links each card to its record's page", () => {
    expect(roomCardHref(dataRoom)).toBe(`/company/${LEDGERLINE}?tab=dataroom`);
    expect(roomCardHref(chat)).toBe(
      `/relationships/investor/${TOBENNA}/messages`,
    );
  });
});
