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

import type {
  QNavigationChooseRequest,
  QNavigationChooseResponse,
} from "@capital-q/contracts";

import {
  performClientAction,
  registerClientRouter,
} from "../src/features/q/client-actions";
import {
  resetContextSet,
  setConversationTurns,
} from "../src/features/q/control/context-set";
import {
  navigationHeard,
  resetFastNavigation,
  setChoiceTransport,
} from "../src/features/q/control/fast-navigation";
import { resetControls } from "../src/features/q/control/registry";
import { closeShown, shownNow } from "../src/features/q/control/show-store";
import type { QTurn } from "../src/features/q/conversation";
import {
  noteRoute,
  resetUiActController,
} from "../src/features/q/ui-act-controller";
import { viewingDocumentNow } from "../src/features/documents/document-ready";
import { resetReadyDocuments } from "../src/features/documents/document-ready";
import { loadWire } from "../src/features/q/wire";

/**
 * Lane 7 (owner 2026-10-21, binding: "names must NOT be required"): "open
 * their deck", "that one", "the other one" resolve from the screen and
 * the conversation, by code; a torn reading gets the Q API's permission-
 * checked tie-break or a one-tap chooser; context never opens a document
 * the person may not see.
 */

const NIXO = "9d1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f74";
const HALYARD = "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";
const NORTHWIND = "7b1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f72";
const ACORN = "1a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f75";
const MEMO = "8c1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f73";

type Block = Extract<QTurn, { kind: "Q" }>["blocks"][number];

function answer(id: string, blocks: readonly unknown[], text = ""): QTurn {
  return {
    kind: "Q",
    id,
    text,
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks: blocks as Block[],
  };
}

const card = (name: string, companyId: string) => ({
  rank: 1,
  name,
  subject: { kind: "COMPANY", companyId },
});
const cards = (...items: readonly (readonly [string, string])[]) => ({
  kind: "ANSWER_CARDS",
  cards: items.map(([name, id]) => card(name, id)),
});
const opened = (page: string, id: string) => ({
  kind: "UI_INTENT",
  intent: { kind: "OPEN_RECORD_PAGE", page, id },
});

beforeAll(async () => {
  await loadWire();
}, 30_000);

let pushed: string[];
let asked: QNavigationChooseRequest[];

function choose(
  reply: (body: QNavigationChooseRequest) => QNavigationChooseResponse | null,
): void {
  asked = [];
  setChoiceTransport((body) => {
    asked.push(body);
    const answer = reply(body);
    // null: the Q API never answers in time.
    return answer === null
      ? new Promise(() => undefined)
      : Promise.resolve(answer);
  });
}

beforeEach(() => {
  resetFastNavigation();
  resetUiActController();
  resetControls();
  resetContextSet();
  resetReadyDocuments();
  closeShown();
  document.body.innerHTML = "<main><h1></h1></main>";
  window.history.replaceState(null, "", "/home");
  noteRoute("/home");
  pushed = [];
  registerClientRouter((path) => {
    pushed.push(path);
    window.history.pushState(null, "", path);
    noteRoute(path);
  });
  choose(() => ({ kind: "NONE", allowed: [], ms: 1 }));
});

afterEach(() => {
  registerClientRouter(null);
  resetFastNavigation();
  vi.useRealTimers();
});

describe("pointing, resolved by code", () => {
  it('"open their deck" after talking about Nixo opens Nixo\'s deck', async () => {
    setConversationTurns([
      answer("a1", [opened("COMPANY", NIXO)], "Nixo builds payroll rails."),
    ]);
    const moved = await navigationHeard("open their deck");
    expect(moved).toMatchObject({ via: "CODE", handled: true });
    expect(pushed).toEqual([`/company/${NIXO}?tab=deck`]);
    expect(asked).toEqual([]);
  });

  it('"open this one" on a company page opens that page\'s record, not the last topic', async () => {
    setConversationTurns([answer("a1", [opened("COMPANY", NIXO)])]);
    window.history.replaceState(null, "", `/relationships/company/${HALYARD}`);
    noteRoute(`/relationships/company/${HALYARD}`);
    await navigationHeard("open this one");
    expect(pushed).toEqual([`/company/${HALYARD}`]);
  });

  it('"show me that" right after a single card opens that card\'s record', async () => {
    window.history.replaceState(null, "", `/company/${NORTHWIND}`);
    noteRoute(`/company/${NORTHWIND}`);
    setConversationTurns([answer("a1", [cards(["Halyard", HALYARD])])]);
    await navigationHeard("show me that");
    expect(pushed).toEqual([`/company/${HALYARD}`]);
  });

  it('"the other one" after a comparison goes to the one not on screen', async () => {
    setConversationTurns([
      answer("a1", [cards(["Nixo", NIXO], ["Halyard", HALYARD])]),
    ]);
    window.history.replaceState(null, "", `/company/${NIXO}`);
    noteRoute(`/company/${NIXO}`);
    await navigationHeard("go back to the other one");
    expect(pushed).toEqual([`/company/${HALYARD}`]);
  });

  it('"the second one" counts in the newest list Q showed', async () => {
    setConversationTurns([
      answer("a1", [
        cards(["Northwind", NORTHWIND], ["Nixo", NIXO], ["Acorn", ACORN]),
      ]),
    ]);
    await navigationHeard("open the second one");
    expect(pushed).toEqual([`/company/${NIXO}`]);
  });

  it('"their stuff" about an investor is the relationship page', async () => {
    window.history.replaceState(null, "", `/investors/${ACORN}`);
    noteRoute(`/investors/${ACORN}`);
    await navigationHeard("open their stuff");
    expect(pushed).toEqual([`/relationships/investor/${ACORN}`]);
  });

  it('"open the memo" opens the memo Q made, over the page', async () => {
    setConversationTurns([
      answer("a1", [
        {
          kind: "ARTIFACT_REFERENCE",
          artifactId: MEMO,
          type: "INVESTMENT_BRIEF",
          status: "READY",
          title: "Investment memo: Nixo",
        },
      ]),
    ]);
    const done = await navigationHeard("open the memo");
    expect(done).toMatchObject({ path: "#document", handled: true });
    expect(viewingDocumentNow()).toBe(MEMO);
    expect(pushed).toEqual([]);
  });

  it('"open it" right after a document was opened is that document', async () => {
    performClientAction({
      kind: "OPEN_RECORD_PAGE",
      page: "DOCUMENT",
      id: MEMO,
    });
    resetReadyDocuments();
    await navigationHeard("open it");
    expect(viewingDocumentNow()).toBe(MEMO);
  });

  it("nothing in context: left to Q, nothing moves", async () => {
    expect(await navigationHeard("open their deck")).toBeNull();
    expect(pushed).toEqual([]);
  });
});

describe("torn: the Q API's tie-break, then the chooser", () => {
  // Two subjects equally recent: an answer about both.
  const torn = () =>
    setConversationTurns([
      answer("a1", [opened("COMPANY", NIXO), opened("COMPANY", HALYARD)]),
    ]);

  it("the Q API's choice (one capped model call) is opened", async () => {
    torn();
    choose(() => ({ kind: "CHOSEN", key: "c2", model: true, ms: 300 }));
    const moved = await navigationHeard("open their deck");
    expect(moved).toMatchObject({ via: "MODEL" });
    expect(asked[0]?.candidates.map((one) => one.page)).toEqual([
      "COMPANY_DECK",
      "COMPANY_DECK",
    ]);
    expect(pushed).toHaveLength(1);
  });

  it("no answer in time: a one-tap chooser, never a question in prose", async () => {
    torn();
    choose(() => null);
    const moved = await navigationHeard("open their deck");
    expect(moved).toMatchObject({ path: "#chooser", via: "CHOOSER" });
    expect(pushed).toEqual([]);
    const choices = shownNow()?.choices ?? [];
    expect(choices).toHaveLength(2);
    choices[1]?.choose();
    expect(pushed).toHaveLength(1);
  }, 5_000);

  it("permission: what the Q API says they may not open never opens, even mentioned", async () => {
    torn();
    // Only Halyard's is theirs to open (c2); no model answer.
    choose((body) => ({
      kind: "NONE",
      allowed: body.candidates
        .filter((one) => one.id === HALYARD)
        .map((one) => one.key),
      ms: 5,
    }));
    await navigationHeard("open their deck");
    expect(pushed).toEqual([`/company/${HALYARD}?tab=deck`]);
    expect(shownNow()).toBeNull();
  });

  it("permission: nothing allowed opens nothing and offers nothing", async () => {
    torn();
    choose(() => ({ kind: "NONE", allowed: [], ms: 5 }));
    expect(await navigationHeard("open their deck")).toBeNull();
    expect(pushed).toEqual([]);
    expect(shownNow()).toBeNull();
  });
});

describe("a document Q just made", () => {
  it('"open the doc" on a company page is the memo Q just made, not the page\'s data room', async () => {
    window.history.replaceState(null, "", `/company/${NORTHWIND}`);
    noteRoute(`/company/${NORTHWIND}`);
    setConversationTurns([
      answer("a1", [opened("COMPANY", NIXO)]),
      answer("a2", [
        {
          kind: "ARTIFACT_REFERENCE",
          artifactId: MEMO,
          type: "INVESTMENT_BRIEF",
          status: "READY",
          title: "Investment memo: Nixo",
        },
      ]),
    ]);
    await navigationHeard("open the doc");
    expect(viewingDocumentNow()).toBe(MEMO);
    expect(pushed).toEqual([]);
  });
});
