// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceInterview } from "../src/features/voice/use-voice-interview";

/**
 * W3-C (audit finding 6): voice is a chunk of its own, fetched on the
 * first sign the person means to talk, and the session holds an idle stub
 * until then. What must not regress is how soon a talk reaches the real
 * voice: with the chunk fetched on intent, a press goes through with no
 * timer, no poll and no wait added; without an intent first, it waits
 * only for the chunk itself, and is never dropped.
 */

const chunk = vi.hoisted(() => ({
  imported: 0,
  talks: [] as { readonly at: number; readonly greeting: unknown }[],
}));

// The stub chunk: the real engine's shape, a scripted voice inside. Mocked
// afresh for each test (doMock), so each counts its own fetch.
const stubChunk = async () => {
  chunk.imported += 1;
  const { useEffect, useState } = await import("react");
  const NOTHING_HEARD: readonly never[] = [];
  return {
    VoiceEngine: ({
      onValue,
    }: {
      readonly onValue: (voice: VoiceInterview) => void;
    }) => {
      const [active, setActive] = useState(false);
      const voice: VoiceInterview = {
        client: {
          state: active ? "LISTENING" : "IDLE",
          connected: active,
          muted: false,
          // State, as the real client's is: the same array until it changes.
          transcript: NOTHING_HEARD,
          start: () => Promise.resolve(),
          end: () => Promise.resolve(),
          sendText: () => undefined,
          setMuted: () => undefined,
          setVolume: () => undefined,
          inputLevel: () => 0,
          outputLevel: () => 0,
        },
        active,
        voice: "FEMALE",
        notice: null,
        turn: null,
        talk: (input) => {
          chunk.talks.push({ at: Date.now(), greeting: input.firstMessage });
          setActive(true);
          return Promise.resolve();
        },
        end: () => {
          setActive(false);
          return Promise.resolve();
        },
        chooseVoice: () => Promise.resolve(),
        clearNotice: () => undefined,
      };
      useEffect(() => {
        onValue(voice);
      });
      return null;
    },
  };
};

let lazy: typeof import("../src/features/voice/lazy-voice-interview");
let voice: VoiceInterview;
const seen = (latest: VoiceInterview) => {
  voice = latest;
};

function Harness({
  onVoice,
}: {
  readonly onVoice: (voice: VoiceInterview) => void;
}) {
  const voice = lazy.useLazyVoiceInterview();
  useEffect(() => {
    onVoice(voice);
  });
  return (
    <>
      <button type="button" data-q-control="talk">
        Talk
      </button>
      <span data-active={String(voice.active)} />
      {voice.engine}
    </>
  );
}

/**
 * Let React's commits settle and, once it was asked for, the chunk's own
 * fetch (the one shared promise); no timer moves.
 */
async function settle(chunkAsked = false) {
  await act(async () => {
    if (chunkAsked) await lazy.preloadVoice();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.resetModules();
  vi.doMock("../src/features/voice/voice-engine", stubChunk);
  chunk.imported = 0;
  chunk.talks.length = 0;
  lazy = await import("../src/features/voice/lazy-voice-interview");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const THREAD = { thread: { welcome: true as const }, firstMessage: "Hello" };

describe("voice loads on first intent", () => {
  it("is an idle stub, and fetches nothing, until the person shows intent", async () => {
    render(<Harness onVoice={seen} />);
    await settle();
    expect(chunk.imported).toBe(0);
    expect(voice.active).toBe(false);
    expect(voice.client.state).toBe("IDLE");
    expect(voice.voice).toBeDefined();
    // Ending a line that never opened has nothing to end, and fetches nothing.
    await act(() => voice.end());
    expect(chunk.imported).toBe(0);
  });

  for (const [intent, fire] of [
    ["hover", (b: Element) => fireEvent.pointerOver(b)],
    ["focus", (b: Element) => fireEvent.focusIn(b)],
    ["press", (b: Element) => fireEvent.pointerDown(b)],
    [
      "Control+K",
      () => fireEvent.keyDown(document.body, { key: "k", ctrlKey: true }),
    ],
  ] as const) {
    it(`${intent} fetches the chunk, and the talk then goes straight through`, async () => {
      const view = render(<Harness onVoice={seen} />);
      fire(view.getByRole("button", { name: "Talk" }));
      await settle();
      expect(chunk.imported).toBe(1);
      await settle(true);
      const pressedAt = Date.now();
      await act(() => voice.talk(THREAD));
      // First audio's budget: the real voice is asked at the same instant,
      // with nothing scheduled in between.
      expect(chunk.talks).toEqual([{ at: pressedAt, greeting: "Hello" }]);
      expect(vi.getTimerCount()).toBe(0);
      await settle(true);
      expect(voice.active).toBe(true);
      expect(voice.client.state).toBe("LISTENING");
    });
  }

  it("a talk with no intent before it waits only for the chunk, and is never dropped", async () => {
    render(<Harness onVoice={seen} />);
    await settle();
    const pressedAt = Date.now();
    let done = false;
    // Pressed before anything fetched the chunk: the press fetches it.
    const talking = voice.talk(THREAD).then(() => {
      done = true;
    });
    expect(chunk.talks).toEqual([]);
    await settle(true);
    await act(() => talking);
    expect(chunk.imported).toBe(1);
    expect(done).toBe(true);
    expect(chunk.talks).toEqual([{ at: pressedAt, greeting: "Hello" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("other keys and other controls fetch nothing", async () => {
    const view = render(<Harness onVoice={seen} />);
    fireEvent.keyDown(document.body, { key: "k" });
    fireEvent.keyDown(document.body, { key: "j", ctrlKey: true });
    fireEvent.pointerOver(view.container);
    await settle();
    expect(chunk.imported).toBe(0);
  });
});
