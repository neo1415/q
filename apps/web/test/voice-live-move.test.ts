import { afterEach, describe, expect, it, vi } from "vitest";

import type { NavigationOutcome } from "../src/features/q/ui-act-controller";
import { createLiveBridge } from "../src/features/voice/live/bridge";
import {
  followMoveNow,
  moveNote,
  MOVE_RECEIPT_WAIT_MS,
} from "../src/features/voice/live/move";

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
      subscribe: r.subscribe,
      dispatch: () => {
        listeningWhenAsked = r.listening();
        r.emit({
          status: "DONE",
          expected: "/companies/tensorgate",
          route: "/companies/tensorgate",
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
      subscribe: failed.subscribe,
      dispatch: () => {
        failed.emit({ status: "FAILED", expected: "/companies/tensorgate" });
      },
    });
    expect(await outcome).toBe("FAILED");
    vi.useFakeTimers();
    const silent = receipts();
    const pending = followMoveNow({
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
    let answer: (o: { commentary: string; moved: boolean }) => void = () =>
      undefined;
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
        outcome.moved === true
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
    answer({ commentary: "Verified: Opening Tensorgate.", moved: true });
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
});
