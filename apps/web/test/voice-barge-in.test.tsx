// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateQVoiceSessionResponse } from "@capital-q/contracts";

import {
  upsertLine,
  type VoiceTranscriptLine,
} from "../src/features/voice/session";

/**
 * Barge-in and one utterance per turn, in the browser (acceptance J and
 * the voice half of B, 2026-09-24).
 *
 * The Deepgram SDK is replaced by a scripted double: the test plays the
 * provider's events in the order the agent sends them and reads what the
 * adapter did with the speaker and the socket. What is proven:
 *
 * - speech onset while Q is audible stops Q at once, whatever the
 *   microphone level reads (echo cancellation keeps it low);
 * - audio of the answer that was talked over is never played afterwards;
 * - the hidden "go on" cue is never injected while the person is still
 *   talking, only after a sound that produced no words;
 * - the cue never reaches the transcript, even when the provider folds it
 *   into the person's words;
 * - one utterance the provider reports in several pieces is one line.
 */

type Handler = (payload: unknown) => void;

class FakeSession {
  static last: FakeSession | null = null;
  readonly handlers = new Map<string, Handler[]>();
  readonly injected: string[] = [];
  constructor() {
    FakeSession.last = this;
  }
  on(event: string, handler: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
  emit(event: string, payload: unknown = {}) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return undefined;
  }
  sendAudio() {
    return undefined;
  }
  injectUserMessage(content: string) {
    this.injected.push(content);
  }
}

class FakeMicrophone {
  static last: FakeMicrophone | null = null;
  static level = 0;
  muted = false;
  readonly deliver: (frame: ArrayBuffer) => void;
  constructor(onFrame: (frame: ArrayBuffer) => void) {
    this.deliver = onFrame;
    FakeMicrophone.last = this;
  }
  start() {
    return Promise.resolve();
  }
  stop() {
    return undefined;
  }
  mute() {
    this.muted = true;
  }
  unmute() {
    this.muted = false;
  }
  getInputVolume() {
    return FakeMicrophone.level;
  }
}

class FakePlayer {
  static last: FakePlayer | null = null;
  readonly queued: unknown[] = [];
  interrupts = 0;
  remaining = 0;
  constructor() {
    FakePlayer.last = this;
  }
  queue(chunk: unknown) {
    this.queued.push(chunk);
    this.remaining += 1;
  }
  interrupt() {
    this.interrupts += 1;
    this.remaining = 0;
  }
  getRemainingPlaybackTime() {
    return this.remaining;
  }
  getOutputVolume() {
    return 0;
  }
  setVolume() {
    return undefined;
  }
  dispose() {
    return undefined;
  }
}

vi.mock("@deepgram/agents", () => ({
  AgentSession: FakeSession,
  AgentMicrophone: FakeMicrophone,
  AgentPlayer: FakePlayer,
}));

const { useDeepgramVoiceSession } =
  await import("../src/features/voice/provider/deepgram-session");

const CREDENTIAL = {
  voiceSessionId: "00000000-0000-4000-8000-000000000001",
  voice: "FEMALE",
  provider: "deepgram",
  token: "t",
  deepgram: { agent: {}, audio: {} },
} as unknown as CreateQVoiceSessionResponse;

async function started(
  options: {
    readonly credential?: CreateQVoiceSessionResponse;
    readonly applied?: boolean;
  } = {},
) {
  const onInterrupted = vi.fn();
  const onLine = vi.fn();
  const onError = vi.fn();
  const onEnded = vi.fn();
  const hook = renderHook(() =>
    useDeepgramVoiceSession({ onInterrupted, onLine, onError, onEnded }),
  );
  await act(async () => {
    await hook.result.current.start({
      credential: options.credential ?? CREDENTIAL,
    });
  });
  const session = FakeSession.last;
  const player = FakePlayer.last;
  if (session === null || player === null) throw new Error("not started");
  act(() => {
    session.emit("connected");
    if (options.applied !== false) session.emit("settings-applied");
  });
  return { hook, session, player, onInterrupted, onLine, onError, onEnded };
}

function qIsTalking(session: FakeSession) {
  act(() => {
    session.emit("agent-started-speaking");
    session.emit("audio", new ArrayBuffer(8));
    session.emit("audio", new ArrayBuffer(8));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeMicrophone.level = 0;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("barge-in", () => {
  it("stops Q the moment the person starts speaking, even when the microphone reads quiet", async () => {
    const { hook, session, player, onInterrupted } = await started();
    qIsTalking(session);
    // Echo cancellation keeps the level low while Q's own voice is in the
    // room; the provider has already heard speech and said so.
    FakeMicrophone.level = 0;
    act(() => {
      session.emit("user-started-speaking");
    });
    expect(player.interrupts).toBe(1);
    expect(hook.result.current.state).toBe("INTERRUPTED");
    expect(onInterrupted).toHaveBeenCalledTimes(1);
  });

  it("never plays audio from the answer that was talked over", async () => {
    const { session, player } = await started();
    qIsTalking(session);
    act(() => {
      session.emit("user-started-speaking");
    });
    const before = player.queued.length;
    // The tail of the old answer, still in flight.
    act(() => {
      session.emit("audio", new ArrayBuffer(8));
    });
    expect(player.queued.length).toBe(before);
    // Q's next answer is heard in full.
    act(() => {
      session.emit("conversation-text", {
        role: "user",
        content: "What about Lagos?",
      });
      session.emit("agent-started-speaking");
      session.emit("audio", new ArrayBuffer(8));
    });
    expect(player.queued.length).toBe(before + 1);
  });

  it("plays a reply the agent goes on speaking, rather than silencing it for good (answers but doesn't talk)", async () => {
    // Live: Q's words on screen and no sound. The agent did not take the
    // sound as an interruption and kept speaking the same reply, with no
    // new announcement; the browser dropped all of it.
    const { session, player } = await started();
    qIsTalking(session);
    act(() => {
      session.emit("user-started-speaking");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const before = player.queued.length;
    act(() => {
      session.emit("audio", new ArrayBuffer(8));
    });
    expect(player.queued.length).toBe(before + 1);
  });

  it("does not inject the go-on cue while the person is still talking", async () => {
    const { session } = await started();
    qIsTalking(session);
    FakeMicrophone.level = 0.3;
    act(() => {
      session.emit("user-started-speaking");
    });
    // Several seconds of a long sentence: the provider has not ended the
    // turn, so no words have come back yet. Nothing may be injected.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(session.injected).toEqual([]);
    // The turn ends with words: still nothing to repair.
    act(() => {
      session.emit("conversation-text", {
        role: "user",
        content: "I'm not saying you need to find somebody publicly linked.",
      });
    });
    FakeMicrophone.level = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(session.injected).toEqual([]);
  });

  it("asks Q to carry on after a sound that produced no words", async () => {
    const { session } = await started();
    qIsTalking(session);
    FakeMicrophone.level = 0.3;
    act(() => {
      session.emit("user-started-speaking");
    });
    // A cough: loud for a moment, then quiet, and no words follow.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    FakeMicrophone.level = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(session.injected).toEqual(["[continue]"]);
  });
});

describe("one utterance, one line", () => {
  it("never shows the go-on cue, even folded into the person's words", async () => {
    const { hook, session } = await started();
    act(() => {
      session.emit("conversation-text", {
        role: "user",
        content: "[continue] I like it balanced. [continue]",
      });
    });
    const users = hook.result.current.transcript.filter(
      (line) => line.role === "user",
    );
    expect(users.map((line) => line.text)).toEqual(["I like it balanced."]);
  });

  it("keeps an utterance the provider reports in pieces as one line", async () => {
    const { hook, session, onLine } = await started();
    act(() => {
      session.emit("conversation-text", {
        role: "assistant",
        content: "Which investors?",
      });
      session.emit("conversation-text", {
        role: "user",
        content: "I'm asking what investors would likely be interested",
      });
      session.emit("conversation-text", {
        role: "user",
        content:
          "I'm asking what investors would likely be interested. Which ones, specific names?",
      });
    });
    const users = hook.result.current.transcript.filter(
      (line) => line.role === "user",
    );
    expect(users.map((line) => line.text)).toEqual([
      "I'm asking what investors would likely be interested. Which ones, specific names?",
    ]);
    // Consumers hear the grown line under the id they already have, and
    // put it in place rather than adding a second question.
    const sent = onLine.mock.calls
      .map(([line]) => line as VoiceTranscriptLine)
      .filter((line) => line.role === "user");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.id).toBe(sent[0]?.id);
    let shown: readonly VoiceTranscriptLine[] = [];
    for (const line of sent) shown = upsertLine(shown, line);
    expect(shown.map((line) => line.text)).toEqual([
      "I'm asking what investors would likely be interested. Which ones, specific names?",
    ]);
    // A new turn after Q has answered is a new line.
    act(() => {
      session.emit("conversation-text", {
        role: "assistant",
        content: "Two names stand out.",
      });
      session.emit("conversation-text", { role: "user", content: "Why?" });
    });
    expect(
      hook.result.current.transcript
        .filter((line) => line.role === "user")
        .map((line) => line.text),
    ).toEqual([
      "I'm asking what investors would likely be interested. Which ones, specific names?",
      "Why?",
    ]);
  });
});

describe("no silent dead starts", () => {
  const GREETED = {
    ...CREDENTIAL,
    deepgram: {
      agent: { greeting: "Hi Ada. What shall we look at?" },
      audio: {},
    },
  } as unknown as CreateQVoiceSessionResponse;

  it("is not listening until the agent has applied its settings, and gives the line up if it never does", async () => {
    const { hook, onError, onEnded } = await started({ applied: false });
    // The socket is open, but nothing the person says reaches anyone yet.
    expect(hook.result.current.state).toBe("CONNECTING");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(onError).toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledWith("dropped");
  });

  it("listens once the settings are applied", async () => {
    const { hook } = await started();
    expect(hook.result.current.state).toBe("LISTENING");
  });

  it("says so when Q's greeting never produces a sound", async () => {
    const { onError } = await started({ credential: GREETED });
    FakeMicrophone.last?.deliver(new ArrayBuffer(4));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/can't speak/i);
  });

  it("stays quiet about a greeting that was heard", async () => {
    const { session, onError } = await started({ credential: GREETED });
    FakeMicrophone.last?.deliver(new ArrayBuffer(4));
    act(() => {
      session.emit("agent-started-speaking");
      session.emit("audio", new ArrayBuffer(8));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("says so once when replies arrive as text and never as sound", async () => {
    const { session, onError } = await started();
    FakeMicrophone.last?.deliver(new ArrayBuffer(4));
    for (const content of ["First reply.", "Second reply."]) {
      act(() => {
        session.emit("conversation-text", { role: "assistant", content });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
    }
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a reply the person talked over for a silent one", async () => {
    const { session, onError } = await started();
    FakeMicrophone.last?.deliver(new ArrayBuffer(4));
    act(() => {
      session.emit("conversation-text", {
        role: "assistant",
        content: "Here is what I found.",
      });
      session.emit("user-started-speaking");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("says so when the microphone never produces a frame", async () => {
    const { onError } = await started();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
    });
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/microphone/i);
  });
});
