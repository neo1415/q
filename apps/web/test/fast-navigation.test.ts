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
  noteAsked,
  performClientAction,
  registerShellRouter,
  setHardLoad,
  registerClientPrefetch,
  registerClientRouter,
  settingsPath,
} from "../src/features/q/client-actions";
import {
  navigationHeard,
  navigationHeardFor,
  navigationHearingDelta,
  navigationTyping,
  resetFastNavigation,
  setNavigationTransport,
  type FastNavigationTransport,
} from "../src/features/q/control/fast-navigation";
import { lastNavigationTo } from "../src/features/q/control/navigation-lifecycle";
import { fastMoveLine } from "../src/features/voice/live/live-call";
import { performTurnChain } from "../src/features/voice/use-follow-turn";
import {
  claimVoiceAudio,
  releaseVoiceAudio,
} from "../src/features/voice/voice-audio";
import {
  requestMove,
  noteRedirect,
  noteRoute,
  onNavigationOutcome,
  resetUiActController,
  type NavigationOutcome,
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
    window.history.pushState(null, "", path);
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
    // A later, separate request (a new sentence) to the same page moves again.
    window.history.replaceState(null, "", "/home");
    noteRoute("/home");
    noteAsked();
    performClientAction({ kind: "OPEN_SETTINGS", section: "privacy" });
    await vi.waitFor(() => expect(pushed).toEqual([PRIVACY, PRIVACY]));
  });
});

describe("partial words while they speak", () => {
  it("a page by name is read in the browser: prefetch only, no server", async () => {
    const { asked } = stub(server);
    navigationHearingDelta("item_1", "open ");
    navigationHearingDelta("item_1", "discover");
    await vi.waitFor(() => expect(prefetched).toEqual(["/discover"]));
    expect(asked).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it("a record by name asks the server once, and only prefetches", async () => {
    const { asked } = stub(server);
    navigationHearingDelta("item_1b", "Take me to Shiftwell ");
    navigationHearingDelta("item_1b", "relationship");
    await vi.waitFor(() =>
      expect(prefetched).toEqual([`/relationships/company/${SHIFTWELL}`]),
    );
    expect(asked).toEqual([
      { text: "Take me to Shiftwell relationship", final: false },
    ]);
    expect(pushed).toEqual([]);
  });

  it("latency: words being typed resolve and prefetch the record before Send; Send asks nothing more", async () => {
    const { asked } = stub(server);
    const say = "Take me to Shiftwell relationship";
    navigationTyping("Take me to Shift");
    navigationTyping(say);
    await vi.waitFor(() =>
      expect(prefetched).toEqual([`/relationships/company/${SHIFTWELL}`]),
    );
    expect(pushed).toEqual([]);
    await navigationHeard(say);
    expect(asked).toEqual([{ text: say, final: false }]);
    expect(pushed).toEqual([`/relationships/company/${SHIFTWELL}`]);
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
    const say = "Take me to Shiftwell relationship";
    navigationHearingDelta("item_3", say);
    await vi.waitFor(() => expect(prefetched).toHaveLength(1));
    const timing = await navigationHeardFor("item_3", say.toLowerCase());
    expect(timing?.path).toBe(`/relationships/company/${SHIFTWELL}`);
    // One read for the whole utterance: the final reused the partial's.
    expect(asked).toHaveLength(1);
    expect(timing?.ms ?? Infinity).toBeLessThan(50);
    expect(pushed).toEqual([`/relationships/company/${SHIFTWELL}`]);
  });
});

describe("time from final words to router.push", () => {
  it("page by name: under 150 ms, with no server round trip", async () => {
    const { asked } = stub(server, 1_000);
    const timing = await navigationHeard("open discover");
    expect(timing?.ms ?? Infinity).toBeLessThan(150);
    expect(asked).toEqual([]);
  });

  it("named record: under 400 ms with a 200 ms reader", async () => {
    stub(server, 200);
    const timing = await navigationHeard("Take me to Shiftwell relationship");
    expect(timing?.path).toBe(`/relationships/company/${SHIFTWELL}`);
    expect(timing?.ms ?? Infinity).toBeLessThan(400);
  });
});

/**
 * GPT-Live's line (live-call.ts): `session.input_transcript.delta` pieces,
 * an utterance closed by 900 ms of quiet or by the delegation, and then
 * the bridge's delegation reading every word since the last one.
 */
describe("GPT-Live transcript sequences", () => {
  function hear(key: string, pieces: readonly string[]): string {
    for (const piece of pieces) navigationHearingDelta(key, piece);
    return pieces.join("").trim();
  }

  it("a page with a lead-in moves at once, from the browser", async () => {
    const { asked } = stub(server);
    const said = hear("live_u1", ["Okay", ",", " open", " discover", "."]);
    const timing = await navigationHeardFor("live_u1", said);
    expect(timing?.path).toBe("/discover");
    expect(timing?.ms ?? Infinity).toBeLessThan(150);
    expect(asked.filter((body) => body.final)).toEqual([]);
    expect(pushed).toEqual(["/discover"]);
  });

  it("a request split by a pause ('Open...' / 'Halyard') moves once, whole", async () => {
    const { asked } = stub((text) =>
      /^open halyard security\.?$/iu.test(text) ? RELATIONSHIP : LEAVE,
    );
    expect(
      await navigationHeardFor("live_u2", hear("live_u2", ["Open", "..."])),
    ).toBeNull();
    const timing = await navigationHeardFor(
      "live_u3",
      hear("live_u3", [" halyard", " security."]),
    );
    expect(timing?.path).toBe(`/relationships/company/${SHIFTWELL}`);
    expect(asked.at(-1)).toEqual({
      text: "Open halyard security.",
      final: true,
    });
    expect(pushed).toHaveLength(1);
  });

  it("the utterance and then the delegation of the same words: one push", async () => {
    stub(server);
    const said = hear("live_u4", ["Take me to", " Shiftwell relationship."]);
    await navigationHeardFor("live_u4", said);
    // The bridge's delegation: the same words, read again.
    const again = await navigationHeard(`Um, ${said}`);
    expect(again?.path).toBe(`/relationships/company/${SHIFTWELL}`);
    expect(pushed).toEqual([`/relationships/company/${SHIFTWELL}`]);
  });

  it("'open discover... no wait' across pieces never moves", async () => {
    stub(server);
    const said = hear("live_u5", ["open", " discover", "...", " no", " wait"]);
    expect(await navigationHeardFor("live_u5", said)).toBeNull();
    expect(await navigationHeard(said)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(pushed).toEqual([]);
  });

  it("the voice is told the page is open, not to ask Q Brain", () => {
    expect(fastMoveLine("/discover")).toMatch(/already opened/u);
    expect(fastMoveLine("/discover")).toMatch(/do not ask Q's backend/u);
  });

  it("'open' is said only on the DONE receipt (V, founder live 2026-10-09)", () => {
    expect(fastMoveLine("/discover", "DONE")).toMatch(/\(confirmed\)/u);
    for (const receipt of ["FAILED", "PENDING"] as const) {
      const line = fastMoveLine("/discover", receipt);
      expect(line).not.toMatch(/\(confirmed\)|already opened/u);
      expect(line).toMatch(/never say it is open|do not say it is open/u);
    }
  });

  it("asked again after they moved on, it moves again", async () => {
    stub(server);
    await navigationHeard("open discover");
    window.history.pushState(null, "", "/home");
    noteRoute("/home");
    await navigationHeard("open discover");
    expect(pushed).toEqual(["/discover", "/discover"]);
  });
});

/**
 * Live 2026-10-09 ("most of the stuff I tell it, it says it didn't go
 * through"): a page that sends them on (Investors -> Discover) is a move
 * that arrived, never FAILED.
 */
describe("a move to a page that redirects", () => {
  it("is DONE when it lands where that page sent it", async () => {
    const seen: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => seen.push(outcome));
    // The router's push is still on its way when the page sends them on.
    registerClientRouter(() => undefined);
    const move = requestMove({ path: "/investors" });
    noteRedirect("/investors", "/discover");
    noteRoute("/discover");
    await move.settled;
    stop();
    expect(seen).toEqual([
      expect.objectContaining({
        status: "DONE",
        expected: "/investors",
        route: "/discover",
      }),
    ]);
  });

  it("without the page's word, landing elsewhere is not arrival", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => seen.push(outcome));
    registerClientRouter(() => undefined);
    requestMove({ path: "/rehearsals" });
    noteRoute("/relationships");
    await vi.advanceTimersByTimeAsync(21_000);
    stop();
    expect(seen.map((outcome) => outcome.status)).toEqual(["FAILED"]);
  });
});

/**
 * V's GPT-Live bridge waits for a move's receipt before the voice speaks:
 * a move without one would leave it saying "coming up". Every move gets
 * one, including the deduped and the already-there.
 */
describe("every move gets a receipt", () => {
  function receipts(): { seen: NavigationOutcome[]; stop: () => void } {
    const seen: NavigationOutcome[] = [];
    const stop = onNavigationOutcome((outcome) => seen.push(outcome));
    return { seen, stop };
  }

  it("G2-D2: Q's OPEN_RECORD_PAGE after the fast path already opened it: that receipt, no second move", async () => {
    stub(server);
    await navigationHeard("Take me to Shiftwell relationship");
    const path = `/relationships/company/${SHIFTWELL}`;
    expect(lastNavigationTo(path)?.phase).toBe("VERIFIED");
    const fastId = lastNavigationTo(path)?.intentId;
    const { seen, stop } = receipts();
    performClientAction({
      kind: "OPEN_RECORD_PAGE",
      page: "RELATIONSHIP_COMPANY",
      id: SHIFTWELL,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();
    // The same sentence's move: its one receipt stands (nav-X-1), no nav-X-2.
    expect(seen).toEqual([]);
    expect(lastNavigationTo(path)?.intentId).toBe(fastId);
    expect(pushed).toHaveLength(1);
  });

  it("a voice turn's move to the page they are on: DONE at once", () => {
    window.history.pushState(null, "", "/discover");
    noteRoute("/discover");
    const { seen, stop } = receipts();
    performTurnChain({
      sequence: 1,
      navigate: "DISCOVER",
      handoff: null,
    } as unknown as Parameters<typeof performTurnChain>[0]);
    stop();
    expect(seen).toEqual([
      {
        status: "DONE",
        intentId: expect.any(String) as unknown,
        expected: "/discover",
        route: "/discover",
      },
    ]);
  });
});

/**
 * V's live test 2026-10-09: a delegated open landed by a HARD RELOAD (the
 * page's Q session had no router registered at that moment), which ends
 * the voice call. Moves wait briefly for a router; never a full load
 * while a call holds the audio.
 */
describe("Q's moves never hard-reload while a call is live", () => {
  const owner = { stop: () => undefined };

  afterEach(() => {
    releaseVoiceAudio(owner);
    registerShellRouter(null);
    setHardLoad(null);
  });

  it("with no page router, the shell's router moves", async () => {
    registerClientRouter(null);
    const shell: string[] = [];
    registerShellRouter((path) => shell.push(path));
    await navigationHeard("open discover");
    expect(shell).toEqual(["/discover"]);
  });

  it("with no router at all, the move waits and goes once one registers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    registerClientRouter(null);
    const loads: string[] = [];
    setHardLoad((path) => loads.push(path));
    await navigationHeard("open discover");
    expect(pushed).toEqual([]);
    vi.advanceTimersByTime(500);
    registerClientRouter((path) => pushed.push(path));
    expect(pushed).toEqual(["/discover"]);
    vi.advanceTimersByTime(5_000);
    expect(loads).toEqual([]);
  });

  it("never a full page load while a voice call holds the audio", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    registerClientRouter(null);
    await claimVoiceAudio(owner);
    const loads: string[] = [];
    setHardLoad((path) => loads.push(path));
    await navigationHeard("open discover");
    vi.advanceTimersByTime(5_000);
    expect(loads).toEqual([]);
  });

  it("with no call and no router, the last resort still opens the page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    registerClientRouter(null);
    const loads: string[] = [];
    setHardLoad((path) => loads.push(path));
    await navigationHeard("open discover");
    vi.advanceTimersByTime(2_500);
    expect(loads).toEqual(["/discover"]);
  });
});
