// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { QFastNavigationResponse } from "@capital-q/contracts";

import {
  performClientAction,
  Q_MATERIAL_CLOSE_EVENT,
  Q_MATERIAL_OPEN_EVENT,
  registerClientRouter,
} from "../src/features/q/client-actions";
import {
  actedHere,
  documentAsked,
  navigationHeard,
  resetFastNavigation,
  setNavigationTransport,
} from "../src/features/q/control/fast-navigation";
import { closeTopmost } from "../src/features/q/control/instant-acts";
import {
  registerControl,
  resetControls,
} from "../src/features/q/control/registry";
import { shownOf } from "../src/features/q/control/q-show-modal";
import {
  closeShown,
  showInModal,
  shownNow,
} from "../src/features/q/control/show-store";
import {
  resetReadyDocuments,
  viewingDocumentNow,
} from "../src/features/documents/document-ready";
import {
  noteRoute,
  resetUiActController,
  UI_ACT_RECEIPT_EVENT,
} from "../src/features/q/ui-act-controller";
import { fastActLine } from "../src/features/voice/live/live-call";
import { movePath } from "../src/features/voice/live/move";
import { loadWire } from "../src/features/q/wire";

/**
 * Lane 7 (owner 2026-10-21): from any page, close / back / scroll / a
 * control by its name / a document by its name happen at once, by code,
 * with no model -- and never twice. Consequential controls never.
 */

const COMPANY = "7b1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f72";
const CERT = "6a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f71";
const BRIEF = "8c1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f73";

beforeAll(async () => {
  await loadWire();
}, 30_000);

let pushed: string[];
let rect: { readonly mockRestore: () => void };

beforeEach(() => {
  resetFastNavigation();
  resetUiActController();
  resetControls();
  resetReadyDocuments();
  closeShown();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/discover");
  noteRoute("/discover");
  pushed = [];
  registerClientRouter((path) => {
    pushed.push(path);
    window.history.pushState(null, "", path);
    noteRoute(path);
  });
  // jsdom lays nothing out: everything here has a box.
  rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      width: 100,
      height: 44,
      top: 10,
      left: 10,
      right: 110,
      bottom: 54,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
});

afterEach(() => {
  rect.mockRestore();
  registerClientRouter(null);
  resetFastNavigation();
  vi.useRealTimers();
});

function button(name: string, onClick: () => void, attrs = ""): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = `<button type="button" ${attrs}>${name}</button>`;
  const element = holder.firstElementChild as HTMLElement;
  element.addEventListener("click", onClick);
  document.body.append(element);
  return element;
}

function transport(answer: QFastNavigationResponse) {
  const asked: { text: string; companyId?: string | undefined }[] = [];
  setNavigationTransport((body) => {
    asked.push(body);
    return Promise.resolve(answer);
  });
  return asked;
}

describe("close it, from any page", () => {
  it("closes what Q is showing first", () => {
    showInModal({ key: "a", title: "Top three", text: "", blocks: [] });
    expect(actedHere("close it")).toBe(true);
    expect(shownNow()).toBeNull();
  });

  it("closes the topmost dialog through its own close control", () => {
    let closed = 0;
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    const close = button(
      "x",
      () => {
        closed += 1;
        dialog.remove();
      },
      'aria-label="Close"',
    );
    dialog.append(close);
    expect(actedHere("Q, close the document please")).toBe(true);
    expect(closed).toBe(1);
  });

  it("presses Escape on a dialog with no close control", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    const keys: string[] = [];
    document.addEventListener("keydown", (event) => keys.push(event.key), {
      once: true,
    });
    expect(closeTopmost()).toBe(true);
    expect(keys).toEqual(["Escape"]);
  });

  it("never dismisses a confirmation, and leaves 'close it' to Q when nothing is open", () => {
    const alert = document.createElement("div");
    alert.setAttribute("role", "alertdialog");
    document.body.append(alert);
    expect(actedHere("close it")).toBe(false);
    alert.remove();
    expect(actedHere("close it")).toBe(false);
  });

  it("closes the data-room document open in the Q room", () => {
    const heard: string[] = [];
    window.addEventListener(Q_MATERIAL_CLOSE_EVENT, () => heard.push("c"), {
      once: true,
    });
    window.dispatchEvent(
      new CustomEvent(Q_MATERIAL_OPEN_EVENT, {
        detail: { companyId: COMPANY, documentId: CERT, title: "Cert" },
      }),
    );
    // Opened by the viewer (screen.ts), which this test stands in for.
    return import("../src/features/q/screen").then(
      ({ setMaterialDocument }) => {
        setMaterialDocument({ companyId: COMPANY, documentId: CERT });
        expect(actedHere("close that")).toBe(true);
        expect(heard).toEqual(["c"]);
        setMaterialDocument(null);
      },
    );
  });
});

describe("back and scroll", () => {
  it("goes back only when a page of this app is behind them", async () => {
    expect(actedHere("go back")).toBe(false);
    noteRoute("/relationships");
    const receipts: string[] = [];
    window.addEventListener(UI_ACT_RECEIPT_EVENT, (event) =>
      receipts.push((event as CustomEvent<{ act: string }>).detail.act),
    );
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {
      noteRoute("/discover");
    });
    expect(actedHere("take me back")).toBe(true);
    await vi.waitFor(() => expect(receipts).toEqual(["BACK"]));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it("scrolls when there is room, and leaves it to Q when there is none", () => {
    const area = document.documentElement;
    Object.defineProperty(area, "scrollHeight", {
      value: 3000,
      configurable: true,
    });
    Object.defineProperty(area, "clientHeight", {
      value: 800,
      configurable: true,
    });
    expect(actedHere("scroll up")).toBe(false);
    expect(actedHere("scroll down a bit")).toBe(true);
  });
});

describe("a control by its visible name", () => {
  it("presses one of the page's own registered controls", async () => {
    let pressed = 0;
    const element = button("Readiness", () => (pressed += 1));
    element.setAttribute("aria-expanded", "false");
    element.addEventListener("click", () =>
      element.setAttribute("aria-expanded", "true"),
    );
    registerControl({
      id: "disclosure.readiness",
      kind: "DISCLOSURE",
      element: () => element,
    });
    expect(actedHere("press Readiness")).toBe(true);
    await vi.waitFor(() => expect(pressed).toBe(1));
  });

  it("presses a plain button a person could press", () => {
    let pressed = 0;
    button("Show more", () => (pressed += 1));
    expect(actedHere("click the show more button")).toBe(true);
    expect(pressed).toBe(1);
  });

  it("never presses a consequential control, by its name or the words", () => {
    let pressed = 0;
    button("Express interest", () => (pressed += 1));
    button("Delete", () => (pressed += 1));
    button("Continue", () => (pressed += 1), 'aria-label="Approve and send"');
    expect(actedHere("press express interest")).toBe(false);
    expect(actedHere("click delete")).toBe(false);
    expect(actedHere("press approve and send")).toBe(false);
    expect(pressed).toBe(0);
  });

  it("two controls with that name: Q asks which, nothing is pressed", () => {
    let pressed = 0;
    button("Details", () => (pressed += 1));
    button("Details", () => (pressed += 1));
    expect(actedHere("press details")).toBe(false);
    expect(pressed).toBe(0);
  });

  it("a submit button or a disabled one is never pressed", () => {
    let pressed = 0;
    button("Filters", () => (pressed += 1)).setAttribute("type", "submit");
    button("Sort", () => (pressed += 1), "disabled");
    expect(actedHere("press filters")).toBe(false);
    expect(actedHere("press sort")).toBe(false);
    expect(pressed).toBe(0);
  });
});

describe("a document by its name, in the viewer over this page", () => {
  it("opens a data-room document where they are, with the screen's company as input; Q's answer does not open it again", async () => {
    window.history.replaceState(null, "", `/company/${COMPANY}?tab=overview`);
    const asked = transport({
      kind: "NAVIGATE",
      intent: {
        kind: "OPEN_RECORD_PAGE",
        page: "DATA_ROOM_DOCUMENT",
        id: CERT,
        companyId: COMPANY,
        title: "Certificate of incorporation",
      },
      ms: 4,
    });
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
    expect(documentAsked("open the certificate of incorporation")).toBe(true);
    const timing = await navigationHeard(
      "open the certificate of incorporation",
    );
    expect(timing).toMatchObject({ path: "#document", route: false });
    expect(asked[0]?.companyId).toBe(COMPANY);
    expect(opened).toEqual([
      {
        companyId: COMPANY,
        documentId: CERT,
        title: "Certificate of incorporation",
      },
    ]);
    // No move at all: it is on the page they are on.
    expect(pushed).toEqual([]);
    performClientAction({
      kind: "OPEN_RECORD_PAGE",
      page: "DATA_ROOM_DOCUMENT",
      id: CERT,
      companyId: COMPANY,
      title: "Certificate of incorporation",
    });
    expect(opened).toHaveLength(1);
    window.removeEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
  });

  it("opens a document Q made in the viewer over this page, not on Documents", async () => {
    transport({
      kind: "NAVIGATE",
      intent: { kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: BRIEF },
      ms: 3,
    });
    await navigationHeard("open my investor brief");
    expect(pushed).toEqual([]);
    expect(viewingDocumentNow()).toBe(BRIEF);
    // Q's answer naming it does not open it again (nor move to Documents).
    performClientAction({
      kind: "OPEN_RECORD_PAGE",
      page: "DOCUMENT",
      id: BRIEF,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pushed).toEqual([]);
  });

  it("a document the person may not open never opens and nothing names it", async () => {
    transport({ kind: "LEAVE_TO_Q", ms: 2 });
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
    expect(await navigationHeard("open the secret cap table")).toBeNull();
    expect(opened).toEqual([]);
    expect(pushed).toEqual([]);
    expect(document.body.textContent).not.toMatch(/cap table/iu);
    window.removeEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
  });

  it("the voice line waits for no route receipt for a document", () => {
    expect(
      movePath({
        navigate: null,
        action: { kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: BRIEF },
      }),
    ).toBeNull();
    expect(fastActLine()).toMatch(/already done/u);
  });
});

describe("what Q shows, over the page", () => {
  it("an answer's cards are shown; plain words are not", () => {
    const base = {
      kind: "Q" as const,
      id: "t1",
      text: "Three fit.",
      streaming: false,
      sourceCount: 0,
      publicSources: [],
      findings: [],
      uncertainties: [],
    };
    expect(shownOf({ ...base, blocks: [] })).toBeNull();
    type Block = Extract<
      Parameters<typeof shownOf>[0],
      { kind: "Q" }
    >["blocks"][number];
    // Only its kind decides; the cards' content is the cards' own.
    const cards = { kind: "ANSWER_CARDS", cards: [] } as unknown as Block;
    expect(shownOf({ ...base, blocks: [cards] })).toMatchObject({
      key: "t1",
      text: "Three fit.",
    });
    expect(shownOf({ ...base, streaming: true, blocks: [cards] })).toBeNull();
  });
});
