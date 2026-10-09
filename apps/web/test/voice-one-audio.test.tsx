// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One voice line produces audio in a tab (founder 2026-10-09: "there were
 * two voices talking at the same time"). The browser's WebRTC, microphone
 * and audio graph are faked at their boundary; the line code is real.
 *
 * (a) two surfaces (the app's dock and the preview's line) hold the tab's
 *     one voice line: opening one ends the other first;
 * (b) the preview's standalone GPT-Live call and the dock end each other
 *     first, either way round, and GPT-Live goes silent at once;
 * (c) a GPT-Live open that is slow: ended while connecting, it closes when
 *     it comes up, and no fallback line is started after the end; a call
 *     that fails mid-connect closes its peer and microphone;
 * (d) a renewal leaves nothing of the old session playing, and an ended
 *     call is silent at once, before its session has closed.
 */

const standardEnds = vi.fn(() => Promise.resolve());
const standardStarts = vi.fn(() => Promise.resolve());
const fakeTransport = () => ({
  state: "LISTENING" as const,
  connected: true,
  muted: false,
  transcript: [],
  start: standardStarts,
  end: standardEnds,
  sendText: () => undefined,
  setMuted: () => undefined,
  setVolume: () => undefined,
  inputLevel: () => 0,
  outputLevel: () => 0,
});
vi.mock("../src/features/voice/provider/deepgram-session", () => ({
  useDeepgramVoiceSession: () => fakeTransport(),
}));
vi.mock("../src/features/voice/provider/elevenlabs-session", () => ({
  useElevenLabsVoiceSession: () => fakeTransport(),
}));
vi.mock("../src/features/voice/provider/duplex-session", () => ({
  useDuplexVoiceSession: () => ({
    ...fakeTransport(),
    start: () => Promise.resolve(false),
  }),
}));

// ---------------------------------------------------------- browser fakes
class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = "open";
  readonly sent: { type?: string }[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as { type?: string });
  }
  emit(event: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
  }
}
const peers: FakePeer[] = [];
let failRemote = false;
class FakePeer extends EventTarget {
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription: { sdp: string } | null = null;
  closed = false;
  channel = new FakeChannel();
  constructor() {
    super();
    peers.push(this);
  }
  addTrack() {
    return {};
  }
  createDataChannel() {
    return this.channel;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "v=0 offer" });
  }
  setLocalDescription(description: { sdp: string }) {
    this.localDescription = description;
    return Promise.resolve();
  }
  setRemoteDescription() {
    return failRemote
      ? Promise.reject(new Error("bad answer"))
      : Promise.resolve();
  }
  close() {
    this.closed = true;
  }
  /** The provider's audio arriving on this peer. */
  track(stream: unknown) {
    this.dispatchEvent(
      Object.assign(new Event("track"), { streams: [stream] }),
    );
  }
}
class FakeAudioContext {
  createAnalyser() {
    return { fftSize: 512, getFloatTimeDomainData: () => undefined };
  }
  createMediaStreamSource() {
    return { connect: () => undefined };
  }
  close() {
    return Promise.resolve();
  }
}
const audios: HTMLAudioElement[] = [];
class FakeAudio {
  autoplay = false;
  muted = false;
  volume = 1;
  srcObject: unknown = null;
  constructor() {
    audios.push(this as unknown as HTMLAudioElement);
  }
}
function microphone() {
  const track = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream,
  };
}
const relayCalls: string[] = [];
const relay: typeof fetch = (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  relayCalls.push(url);
  if (url.endsWith("/open")) {
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as { voiceSessionId?: string };
    return Promise.resolve(
      Response.json({
        voiceSessionId:
          body.voiceSessionId ?? "5f000000-0000-4000-8000-000000000009",
        sdp: "v=0 answer",
        model: "gpt-live-1",
        maxSessionMs: 1_200_000,
        idleMs: 180_000,
      }),
    );
  }
  if (url.includes("/usage/")) {
    return Promise.resolve(
      Response.json({ recordedSeconds: 0, remainingMs: 1_000_000 }),
    );
  }
  return Promise.resolve(new Response(null, { status: 204 }));
};

vi.stubGlobal("RTCPeerConnection", FakePeer);
vi.stubGlobal("AudioContext", FakeAudioContext);
vi.stubGlobal("Audio", FakeAudio);

let liveOn = true;
vi.mock("../src/features/voice/live/live-call", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../src/features/voice/live/live-call")
    >();
  return {
    ...real,
    liveVoiceAvailable: () => Promise.resolve(liveOn),
    startLiveCall: (options: Parameters<typeof real.startLiveCall>[0]) =>
      slowOpen === null
        ? real.startLiveCall({
            fetch: relay,
            microphone: () => Promise.resolve(microphone().stream),
            ...options,
          })
        : slowOpen.then(() =>
            real.startLiveCall({
              fetch: relay,
              microphone: () => Promise.resolve(microphone().stream),
              ...options,
            }),
          ),
  };
});
let slowOpen: Promise<void> | null = null;

const { useVoiceSession } =
  await import("../src/features/voice/use-voice-session");
const { askLiveAvailability, forgetLiveAvailability } =
  await import("../src/features/voice/live/availability");
/** The availability answer is in (it is asked as the surface mounts). */
const ready = () =>
  act(async () => {
    await askLiveAvailability();
  });
const { startLiveCall } = await import("../src/features/voice/live/live-call");
const { voiceAudioOwner } = await import("../src/features/voice/voice-audio");
const { openVoiceLine, voiceLineHolder } =
  await import("../src/features/voice/voice-line");

const credential = {
  voiceSessionId: "5f000000-0000-4000-8000-000000000001",
  providerConversationId: "dg_5f000000",
  token: "standard-token",
  voice: "FEMALE" as const,
  expiresAt: "2026-10-09T12:00:00.000Z",
  provider: "deepgram" as const,
};

const standalone = (overrides: Record<string, unknown> = {}) =>
  startLiveCall({
    voice: "FEMALE",
    fetch: relay,
    microphone: () => Promise.resolve(microphone().stream),
    onEnded: () => undefined,
    ...overrides,
  });

/** The audible lines right now: an audio element with a stream, unmuted. */
const audible = () => audios.filter((a) => a.srcObject !== null && !a.muted);

describe("one voice line produces audio in a tab", () => {
  beforeEach(() => {
    forgetLiveAvailability();
    liveOn = true;
    slowOpen = null;
    failRemote = false;
    peers.length = 0;
    audios.length = 0;
    relayCalls.length = 0;
    standardEnds.mockClear();
    standardStarts.mockClear();
  });
  afterEach(async () => {
    const owner = voiceAudioOwner();
    const stopping = owner?.stop();
    // Each call waits for its session's final usage: the provider says so.
    for (const peer of peers) {
      peer.channel.emit({
        type: "session.closed",
        reason: "close_requested",
        usage: { seconds: 1 },
      });
    }
    await stopping;
  });

  it("(a) the preview opening a line ends the dock's line first (one voice line per tab)", async () => {
    liveOn = false;
    const dock = renderHook(() => useVoiceSession());
    const preview = renderHook(() => useVoiceSession({}, { live: false }));
    // Each surface holds the tab's line the way the app's surfaces do.
    const dockHolder = { release: () => dock.result.current.end() };
    const previewHolder = { release: () => preview.result.current.end() };
    await ready();
    await act(async () => {
      await openVoiceLine(dockHolder, () =>
        dock.result.current.start({ credential }),
      );
    });
    expect(standardStarts).toHaveBeenCalledTimes(1);
    standardEnds.mockClear();
    const order: string[] = [];
    standardEnds.mockImplementationOnce(() => {
      order.push("dock ended");
      return Promise.resolve();
    });
    await act(async () => {
      await openVoiceLine(previewHolder, async () => {
        order.push("preview starts");
        await preview.result.current.start({ credential });
      });
    });
    expect(order).toEqual(["dock ended", "preview starts"]);
    expect(voiceLineHolder()).toBe(previewHolder);
  });

  it("(b) the preview's standalone GPT-Live call and the dock end each other first, either way round", async () => {
    liveOn = false;
    const dock = renderHook(() => useVoiceSession());
    const dockHolder = { release: () => dock.result.current.end() };
    await ready();
    await act(async () => {
      await openVoiceLine(dockHolder, () =>
        dock.result.current.start({ credential }),
      );
    });
    standardEnds.mockClear();
    // The preview's A: a standalone GPT-Live call under its own holder.
    let call: Awaited<ReturnType<typeof standalone>> | null = null;
    const previewHolder = {
      release: async () => {
        await call?.end("superseded");
      },
    };
    await openVoiceLine(previewHolder, async () => {
      call = await standalone();
    });
    expect(standardEnds).toHaveBeenCalled();
    peers[0]?.track({ id: "q-voice" });
    expect(audible()).toHaveLength(1);
    // The dock opens again: the call goes silent at once and closes its
    // session (its final usage is still on its way, so not awaited here).
    const reopening = openVoiceLine(dockHolder, () =>
      dock.result.current.start({ credential }),
    );
    await vi.waitFor(() => {
      expect(audible()).toHaveLength(0);
    });
    expect(peers[0]?.channel.sent.some((e) => e.type === "session.close")).toBe(
      true,
    );
    peers[0]?.channel.emit({
      type: "session.closed",
      reason: "close_requested",
      usage: { seconds: 3 },
    });
    await act(async () => {
      await reopening;
    });
    expect(voiceLineHolder()).toBe(dockHolder);
  });

  it("(c) a slow GPT-Live open that is ended while connecting never plays, and no fallback starts after the end", async () => {
    let release = () => undefined as void;
    slowOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { result } = renderHook(() => useVoiceSession());
    let starting: Promise<void> = Promise.resolve();
    await ready();
    act(() => {
      starting = result.current.start({ credential });
    });
    await act(async () => {
      await result.current.end();
    });
    release();
    await act(async () => {
      await starting;
    });
    // It came up superseded: closed, and nothing else was opened.
    for (const peer of peers) {
      peer.track({ id: "late" });
    }
    expect(audible()).toHaveLength(0);
    expect(standardStarts).not.toHaveBeenCalled();
  });

  it("(c) a GPT-Live call that fails mid-connect closes its peer and its microphone", async () => {
    failRemote = true;
    const mic = microphone();
    await expect(
      standalone({ microphone: () => Promise.resolve(mic.stream) }),
    ).rejects.toThrow();
    expect(peers[0]?.closed).toBe(true);
    expect(mic.track.stopped).toBe(true);
    expect(voiceAudioOwner()).toBeNull();
  });

  it("(d) a renewal leaves nothing of the old session playing", async () => {
    const call = await standalone();
    peers[0]?.track({ id: "first" });
    expect(audible()).toHaveLength(1);
    // The provider ends the session on its own: the call renews.
    peers[0]?.channel.emit({
      type: "session.closed",
      reason: "provider",
      usage: { seconds: 30 },
    });
    await vi.waitFor(() => {
      expect(peers).toHaveLength(2);
    });
    expect(peers[0]?.closed).toBe(true);
    // The old peer's late audio never reaches the speaker; the new one's does.
    peers[0]?.track({ id: "old-late" });
    peers[1]?.track({ id: "renewed" });
    const playing = audible();
    expect(playing).toHaveLength(1);
    expect(playing[0]?.srcObject).toEqual({ id: "renewed" });
    void call;
  });

  it("(d) an ended call is silent at once, before its session has closed", async () => {
    const call = await standalone();
    peers[0]?.track({ id: "q-voice" });
    const ending = call.end();
    // Nothing from the provider yet (no session.closed), and already silent.
    expect(audible()).toHaveLength(0);
    peers[0]?.channel.emit({
      type: "session.closed",
      reason: "close_requested",
      usage: { seconds: 5 },
    });
    await ending;
    await call.finished;
    expect(peers[0]?.closed).toBe(true);
  });
});
