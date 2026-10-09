import { afterEach, describe, expect, it, vi } from "vitest";

import type { NavigationOutcome } from "../src/features/q/ui-act-controller";
import { createLiveBridge } from "../src/features/voice/live/bridge";
import {
  followMoveNow,
  moveNote,
  movePath,
  noteForMove,
  receiptListener,
  MOVE_RECEIPT_WAIT_MS,
} from "../src/features/voice/live/move";

const TENSORGATE = "0f2a6a0e-4b1c-4c3d-8e5f-6a7b8c9d0e1f";
const PATH = `/company/${TENSORGATE}`;

/**
 * V (founder live 2026-10-09: "I've opened their page" / "It's not open
 * yet"): a GPT-Live delegation that moved the screen is followed at once
 * and its receipt awaited before the voice speaks; the voice is told the
 * page is open only on DONE.
 */

function receipts() {
  let listener: ((outcome: NavigationOutcome) => void) | null = null;
  return {
    subscribe: (next: (outcome: NavigationOutcome) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    emit: (outcome: NavigationOutcome) => listener?.(outcome),
    listening: () => listener !== null,
  };
}

describe("a delegated move is followed now, and spoken only from its receipt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the voice surface to read its board at once, listening first", async () => {
    const r = receipts();
    let listeningWhenAsked = false;
    const done = followMoveNow({
      path: PATH,
      subscribe: r.subscribe,
      dispatch: () => {
        listeningWhenAsked = r.listening();
        r.emit({
          status: "DONE",
          intentId: "nav-1",
          expected: PATH,
          route: PATH,
        });
      },
    });
    expect(await done).toBe("DONE");
    expect(listeningWhenAsked).toBe(true);
    expect(r.listening()).toBe(false);
  });

  it("reports FAILED from C's receipt, and PENDING when no receipt comes in time", async () => {
    const failed = receipts();
    const outcome = followMoveNow({
      path: PATH,
      subscribe: failed.subscribe,
      dispatch: () => {
        failed.emit({
          status: "FAILED",
          intentId: "nav-1",
          expected: PATH,
          reason: "NOT_LANDED",
        });
      },
    });
    expect(await outcome).toBe("FAILED");
    vi.useFakeTimers();
    const silent = receipts();
    const pending = followMoveNow({
      path: PATH,
      subscribe: silent.subscribe,
      dispatch: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(MOVE_RECEIPT_WAIT_MS);
    expect(await pending).toBe("PENDING");
  });

  it("tells the voice the page is open only on DONE", () => {
    expect(moveNote("DONE")).toContain("open on their screen now");
    expect(moveNote("FAILED")).toContain("did NOT open");
    expect(moveNote("FAILED")).toContain("never say it is open");
    expect(moveNote("PENDING")).toContain("do not say it is open");
  });

  it("the bridge waits for the receipt before it hands the result to the voice", async () => {
    const sent: { type: string; content: string }[] = [];
    let release: (note: string) => void = () => undefined;
    let answer: (o: {
      commentary: string;
      move: { navigate: null; action: null };
    }) => void = () => undefined;
    const bridge = createLiveBridge({
      send: (event) => {
        sent.push(event);
      },
      delegate: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      newEventId: () => "e",
      now: () => 0,
      settleMs: 0,
      beforeSpeak: (outcome) =>
        outcome.move !== undefined
          ? new Promise<string>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(null),
    });
    bridge.handle({
      type: "session.input_transcript.delta",
      delta: "Open Tensorgate",
    });
    bridge.handle({
      type: "session.delegation.created",
      delegation: { id: "dlg_open", target: "client" },
    });
    await vi.waitFor(() => {
      expect(answer).not.toBeUndefined();
    });
    answer({
      commentary: "Verified: Opening Tensorgate.",
      move: { navigate: null, action: null },
    });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    // Nothing is spoken while the move has no receipt.
    expect(
      sent.filter((e) => e.type === "session.commentary.append"),
    ).toHaveLength(0);
    release(moveNote("DONE"));
    await vi.waitFor(() => {
      expect(
        sent.filter((e) => e.type === "session.commentary.append"),
      ).toHaveLength(1);
    });
    expect(sent.at(-1)?.content).toContain("open on their screen now");
  });

  it("a receipt for another route (an earlier move landing late) never answers this move", async () => {
    vi.useFakeTimers();
    const r = receipts();
    const outcome = followMoveNow({
      path: PATH,
      subscribe: r.subscribe,
      dispatch: () => {
        r.emit({
          status: "DONE",
          intentId: "nav-1",
          expected: "/discover",
          route: "/discover",
        });
        r.emit({
          status: "FAILED",
          intentId: "nav-2",
          expected: "/elsewhere",
          reason: "NOT_LANDED",
        });
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    r.emit({ status: "DONE", intentId: "nav-3", expected: PATH, route: PATH });
    expect(await outcome).toBe("DONE");
    // And the fast path's listener waits for its own path the same way.
    const fast = receipts();
    const listening = receiptListener(fast.subscribe);
    fast.emit({
      status: "DONE",
      intentId: "nav-4",
      expected: "/discover",
      route: "/discover",
    });
    const mine = listening.for(PATH);
    await vi.advanceTimersByTimeAsync(MOVE_RECEIPT_WAIT_MS);
    expect(await mine).toBe("PENDING");
  });

  it("maps the run's move to the route it expects; a data-room document has none", async () => {
    expect(
      movePath({
        navigate: null,
        action: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: TENSORGATE },
      }),
    ).toBe(PATH);
    expect(movePath({ navigate: "DISCOVER", action: null })).toBe("/discover");
    expect(
      movePath({
        navigate: null,
        action: {
          kind: "OPEN_RECORD_PAGE",
          page: "DATA_ROOM_DOCUMENT",
          id: TENSORGATE,
          companyId: TENSORGATE,
        },
      }),
    ).toBeNull();
    // No route: no receipt is awaited, nothing is said about a page.
    const follow = vi.fn(() => Promise.resolve("DONE" as const));
    expect(
      await noteForMove(
        {
          navigate: null,
          action: {
            kind: "OPEN_RECORD_PAGE",
            page: "DATA_ROOM_DOCUMENT",
            id: TENSORGATE,
            companyId: TENSORGATE,
          },
        },
        follow,
      ),
    ).toBeNull();
    expect(follow).not.toHaveBeenCalled();
    expect(await noteForMove(undefined, follow)).toBeNull();
    expect(
      await noteForMove({ navigate: "DISCOVER", action: null }, follow),
    ).toContain("(confirmed)");
    expect(follow).toHaveBeenCalledWith("/discover");
  });
});
