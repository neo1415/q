import { describe, expect, it, vi } from "vitest";

import type { QVoiceDuplexCredential } from "@capital-q/contracts";

import {
  DuplexLine,
  type DuplexEnvironment,
  type DuplexLineEvents,
  type DuplexRelays,
} from "../src/features/voice/provider/duplex-line";

/**
 * Owner 2026-11-06 (live, UDP blocked): a duplex line that cannot connect
 * falls back to the standard voice, and leaving Q (Chat) ends it in
 * whatever state it is in. Every microphone track it opened is stopped:
 * on a failed connect, and on a close while it is still connecting.
 */

const CREDENTIAL: QVoiceDuplexCredential = {
  clientSecret: "ek_fake_secret",
  callsUrl: "https://realtime.invalid/v1/realtime/calls",
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxSessionMs: 600_000,
  idleMs: 30_000,
};

function line(options: {
  readonly offer: () => Promise<RTCSessionDescriptionInit>;
}) {
  const track = { enabled: true, stop: vi.fn(), kind: "audio" };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const peer = {
    addTrack: () => undefined,
    createDataChannel: () => ({ close: () => undefined }),
    createOffer: options.offer,
    setLocalDescription: () => Promise.resolve(),
    setRemoteDescription: () => Promise.resolve(),
    close: vi.fn(),
    connectionState: "new",
  };
  const environment: DuplexEnvironment = {
    createPeer: () => peer as unknown as RTCPeerConnection,
    getMicrophone: () => Promise.resolve(stream),
    fetch: () => Promise.reject(new Error("offline")),
    createAudio: () =>
      ({
        volume: 1,
        srcObject: null,
        autoplay: true,
      }) as unknown as HTMLAudioElement,
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
  const relays: DuplexRelays = {
    tool: () => Promise.resolve(null),
    usage: () => Promise.resolve({ continue: true }),
    end: () => Promise.resolve(),
  };
  const events: DuplexLineEvents = {
    onState: () => undefined,
    onLine: () => undefined,
    onInterrupted: () => undefined,
    onFallback: vi.fn(),
    onEnded: vi.fn(),
  };
  return {
    track,
    events,
    duplex: new DuplexLine({
      credential: CREDENTIAL,
      relays,
      events,
      environment,
    }),
  };
}

describe("a duplex line's microphone, when the line cannot come up", () => {
  it("is stopped when the connect fails and the line falls back", async () => {
    const { duplex, track, events } = line({
      offer: () => Promise.reject(new Error("no route")),
    });
    await expect(duplex.open()).resolves.toBe(false);
    expect(events.onFallback).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it("is stopped at once when the line is closed while still connecting", async () => {
    // The connect never answers (UDP blocked): close() must not wait for it.
    const { duplex, track } = line({
      offer: () => new Promise(() => undefined),
    });
    const opening = duplex.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(track.stop).not.toHaveBeenCalled();
    duplex.close();
    expect(track.stop).toHaveBeenCalled();
    void opening;
  });
});
