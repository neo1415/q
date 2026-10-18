import type { QSilenceBeat } from "@capital-q/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withSilenceLadder, type SilenceLive } from "../src/voice/narration.js";

/** A source whose first sentence arrives only when `release` is called. */
function slowAnswer(sentences: readonly string[]) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* source(): AsyncGenerator<string> {
    await gate;
    for (const sentence of sentences) yield sentence;
  }
  return { source: source(), release: () => release() };
}

async function collect(iterable: AsyncIterable<string>, into: string[]) {
  for await (const part of iterable) into.push(part);
}

describe("the silence ladder on a voice turn (ADR 0062)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing before a quick answer", async () => {
    const answer = slowAnswer(["Here it is."]);
    const heard: string[] = [];
    const done = collect(
      withSilenceLadder(answer.source, {
        live: { stage: "REVIEWING_COMPANY", approvalWaiting: false },
        seed: 1,
        now: () => Date.now(),
      }),
      heard,
    );
    await vi.advanceTimersByTimeAsync(400);
    answer.release();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(heard).toEqual(["Here it is."]);
  });

  it("speaks a stage line at 1.5 s, progress at 4 s, and stops once the answer starts", async () => {
    const answer = slowAnswer(["Done."]);
    const heard: string[] = [];
    const live: SilenceLive = {
      stage: "PREPARING_DOCUMENT",
      approvalWaiting: false,
    };
    const done = collect(
      withSilenceLadder(answer.source, {
        live,
        focus: () => Promise.resolve({ name: "Ledgerline", thing: "deck" }),
        seed: 7,
        now: () => Date.now(),
      }),
      heard,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(heard).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatch(/Ledgerline's/u);
    await vi.advanceTimersByTimeAsync(2_600);
    expect(heard).toHaveLength(2);
    answer.release();
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
    expect(heard.at(-1)).toBe("Done.");
    expect(heard).toHaveLength(3);
  });

  it("brings back one remembered thread past 8 s, once, and hands duplex beats out of band", async () => {
    const answer = slowAnswer(["Ready."]);
    const heard: string[] = [];
    const narrated: QSilenceBeat[] = [];
    const used: string[] = [];
    const thread = vi.fn(() =>
      Promise.resolve({
        memoryItemId: "7b0b1c1e-6f5f-4d8e-9a43-3c3f1f0b2a11",
        followUp: "how was Lagos?",
      }),
    );
    const done = collect(
      withSilenceLadder(answer.source, {
        live: { stage: "CHECKING_EVIDENCE", approvalWaiting: false },
        thread,
        onThread: (id) => used.push(id),
        narrate: (beat) => narrated.push(beat),
        seed: 3,
        now: () => Date.now(),
      }),
      heard,
    );
    await vi.advanceTimersByTimeAsync(25_000);
    answer.release();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(heard).toEqual(["Ready."]);
    expect(thread).toHaveBeenCalledTimes(1);
    const threads = narrated.filter((beat) => beat.kind === "THREAD");
    expect(threads).toHaveLength(1);
    expect(threads[0]?.kind === "THREAD" && threads[0].text).toMatch(/Lagos/u);
    expect(used).toEqual(["7b0b1c1e-6f5f-4d8e-9a43-3c3f1f0b2a11"]);
    // Never the tone (the browser's), never more than the ladder allows.
    expect(narrated.some((beat) => beat.kind === "TONE")).toBe(false);
    expect(narrated.length).toBeLessThanOrEqual(4);
  });

  it("never records a beat as the answer: what is remembered is the answer's own sentences (W4b)", async () => {
    const answer = slowAnswer(["The deck asks for $2M.", "Burn is unstated."]);
    const heard: string[] = [];
    const recorded: string[] = [];
    // As the voice turn composes it: the record is taken inside the ladder.
    async function* tap(source: AsyncIterable<string>) {
      for await (const part of source) {
        recorded.push(part);
        yield part;
      }
    }
    const done = collect(
      withSilenceLadder(tap(answer.source), {
        live: { stage: "REVIEWING_COMPANY", approvalWaiting: false },
        focus: () => Promise.resolve({ name: "Ledgerline", thing: "deck" }),
        seed: 9,
        now: () => Date.now(),
      }),
      heard,
    );
    await vi.advanceTimersByTimeAsync(9_000);
    answer.release();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(heard.length).toBeGreaterThan(2);
    expect(heard.slice(0, -2).every((line) => /…$/u.test(line))).toBe(true);
    expect(recorded).toEqual(["The deck asks for $2M.", "Burn is unstated."]);
  });

  it("stays silent while an approval is waiting", async () => {
    const answer = slowAnswer(["Approved."]);
    const narrated: QSilenceBeat[] = [];
    const done = collect(
      withSilenceLadder(answer.source, {
        live: { stage: "WAITING_FOR_APPROVAL", approvalWaiting: true },
        narrate: (beat) => narrated.push(beat),
        thread: () =>
          Promise.resolve({
            memoryItemId: "7b0b1c1e-6f5f-4d8e-9a43-3c3f1f0b2a11",
            followUp: "how was Lagos?",
          }),
        seed: 5,
        now: () => Date.now(),
      }),
      [],
    );
    await vi.advanceTimersByTimeAsync(30_000);
    answer.release();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(narrated).toEqual([]);
  });
  it("keeps narrating until the whole answer is in on a deferred line (duplex: nothing is heard until ask_q returns)", async () => {
    let release: () => void = () => undefined;
    const second = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* source(): AsyncGenerator<string> {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      yield "First sentence.";
      await second;
      yield "Second sentence.";
    }
    const heard: string[] = [];
    const narrated: QSilenceBeat[] = [];
    const done = collect(
      withSilenceLadder(source(), {
        live: { stage: "COMPARING_OPPORTUNITIES", approvalWaiting: false },
        narrate: (beat) => narrated.push(beat),
        untilDone: true,
        seed: 5,
        now: () => Date.now(),
      }),
      heard,
    );
    await vi.advanceTimersByTimeAsync(12_000);
    release();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(heard).toEqual(["First sentence.", "Second sentence."]);
    // The stage line at 1.5 s and progress past 4 s, although the first
    // sentence arrived at 1 s.
    expect(
      narrated.filter((beat) => beat.kind !== "TONE").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
