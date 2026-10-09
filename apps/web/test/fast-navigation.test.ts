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
  movedEarlyTo,
  performClientAction,
  registerClientPrefetch,
  registerClientRouter,
  settingsPath,
} from "../src/features/q/client-actions";
import {
  navigationHeard,
  navigationHeardFor,
  navigationHearingDelta,
  resetFastNavigation,
  setNavigationTransport,
  type FastNavigationTransport,
} from "../src/features/q/control/fast-navigation";
import {
  noteRoute,
  resetUiActController,
} from "../src/features/q/ui-act-controller";
import { loadWire } from "../src/features/q/wire";

/**
 * RECOVERY-2026-10 (C, founder 2026-10-09: "stupid fast"): the screen moves
 * when the sentence ends, once; Q's answer about the same sentence never
 * moves it again; partial words only prefetch; words taken back never move.
 */

const SHIFTWELL = "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";

const DISCOVER: QFastNavigationResponse = {
  kind: "NAVIGATE",
  intent: { kind: "NAVIGATE", destination: "DISCOVER" },
  ms: 2,
};
const RELATIONSHIP: QFastNavigationResponse = {
  kind: "NAVIGATE",
  intent: {
    kind: "OPEN_RECORD_PAGE",
    page: "RELATIONSHIP_COMPANY",
    id: SHIFTWELL,
  },
  ms: 20,
};
const SETTINGS: QFastNavigationResponse = {
  kind: "NAVIGATE",
  intent: { kind: "OPEN_SETTINGS", section: "privacy" },
  ms: 2,
};
const PRIVACY = settingsPath("privacy");
const LEAVE: QFastNavigationResponse = { kind: "LEAVE_TO_Q", ms: 1 };

/** A stand-in for the code-only reader: the server's decision by the words. */
function stub(
  decide: (text: string) => QFastNavigationResponse,
  delayMs = 0,
): { asked: { text: string; final: boolean }[] } {
  const asked: { text: string; final: boolean }[] = [];
  const transport: FastNavigationTransport = (body) => {
    asked.push(body);
    return new Promise((resolve) =>
      setTimeout(() => resolve(decide(body.text)), delayMs),
    );
  };
  setNavigationTransport(transport);
  return { asked };
}

/** Mirrors the server reader on the words these tests say. */
function server(text: string): QFastNavigationResponse {
  if (/\b(no wait|actually|never mind)\b/iu.test(text)) return LEAVE;
  if (/^open discover$/iu.test(text.trim())) return DISCOVER;
  if (/shiftwell relationship/iu.test(text)) return RELATIONSHIP;
  return LEAVE;
}

// Q's answers are checked against the wire contracts; loaded first, so a
// "no second move" below is the dedupe, not a contract still loading.
beforeAll(async () => {
  await loadWire();
}, 30_000);

let pushed: string[];
let prefetched: string[];

beforeEach(() => {
  resetFastNavigation();
  resetUiActController();
  window.history.replaceState(null, "", "/home");
  noteRoute("/home");
  pushed = [];
  prefetched = [];
  registerClientRouter((path) => {
    pushed.push(path);
    noteRoute(path);
  });
  registerClientPrefetch((path) => prefetched.push(path));
});

afterEach(() => {
  registerClientRouter(null);
  registerClientPrefetch(null);
  resetFastNavigation();
  vi.useRealTimers();
});

describe("fast navigation at the end of the sentence", () => {
  it("moves once to a page named plainly; Q's answer does not move again", async () => {
    stub(server);
    const timing = await navigationHeard("open discover");
    expect(timing?.path).toBe("/discover");
    expect(pushed).toEqual(["/discover"]);
    // Q's NAVIGATE answer is followed by q-session, which asks this first:
    // the early move is its move, once.
    expect(movedEarlyTo("/discover")).toBe(true);
    expect(movedEarlyTo("/discover")).toBe(false);
  });

  it("a page Q's answer opens as an action is not opened twice", async () => {
    stub(() => SETTINGS);
    await navigationHeard("open privacy settings");
    expect(pushed).toEqual([PRIVACY]);
    expect(
      performClientAction({ kind: "OPEN_SETTINGS", section: "privacy" }),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushed).toEqual([PRIVACY]);
  });

  it("moves once to a named record; Q's answer does not move again", async () => {
    stub(server);
    await navigationHeard("Take me to Shiftwell relationship");
    expect(pushed).toEqual([`/relationships/company/${SHIFTWELL}`]);
    performClientAction({
      kind: "OPEN_RECORD_PAGE",
      page: "RELATIONSHIP_COMPANY",
      id: SHIFTWELL,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushed).toHaveLength(1);
  });

  it("an ambiguous or unknown name never moves early: Q's answer asks", async () => {
    stub(server);
    expect(await navigationHeard("Open Shiftwell")).toBeNull();
    expect(pushed).toEqual([]);
  });

  it("Q may still move after the early move was consumed", async () => {
    stub(() => SETTINGS);
    await navigationHeard("open privacy settings");
    performClientAction({ kind: "OPEN_SETTINGS", section: "privacy" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A later, separate request to the same page moves again.
    window.history.replaceState(null, "", "/home");
    noteRoute("/home");
    performClientAction({ kind: "OPEN_SETTINGS", section: "privacy" });
    await vi.waitFor(() => expect(pushed).toEqual([PRIVACY, PRIVACY]));
  });
});

describe("partial words while they speak", () => {
  it("prefetch only, and never move", async () => {
    const { asked } = stub(server);
    navigationHearingDelta("item_1", "open ");
    navigationHearingDelta("item_1", "discover");
    await vi.waitFor(() => expect(prefetched).toEqual(["/discover"]));
    expect(asked).toEqual([{ text: "open discover", final: false }]);
    expect(pushed).toEqual([]);
  });

  it("'open discover... no wait' never moves", async () => {
    stub(server);
    navigationHearingDelta("item_2", "open discover");
    await vi.waitFor(() => expect(prefetched).toEqual(["/discover"]));
    navigationHearingDelta("item_2", " no wait");
    expect(await navigationHeardFor("item_2", "open discover no wait")).toBe(
      null,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(pushed).toEqual([]);
  });

  it("the final words reuse what the partials resolved", async () => {
    const { asked } = stub(server, 100);
    navigationHearingDelta("item_3", "open discover");
    await vi.waitFor(() => expect(prefetched).toEqual(["/discover"]));
    const timing = await navigationHeardFor("item_3", "Open discover");
    expect(timing?.path).toBe("/discover");
    // One read for the whole utterance: the final reused the partial's.
    expect(asked).toHaveLength(1);
    expect(timing?.ms ?? Infinity).toBeLessThan(50);
    expect(pushed).toEqual(["/discover"]);
  });
});

describe("time from final words to router.push", () => {
  it("page by name: under 150 ms with a 20 ms reader", async () => {
    stub(server, 20);
    const timing = await navigationHeard("open discover");
    expect(timing?.ms ?? Infinity).toBeLessThan(150);
  });

  it("named record: under 400 ms with a 200 ms reader", async () => {
    stub(server, 200);
    const timing = await navigationHeard("Take me to Shiftwell relationship");
    expect(timing?.path).toBe(`/relationships/company/${SHIFTWELL}`);
    expect(timing?.ms ?? Infinity).toBeLessThan(400);
  });
});
