import type { Page } from "@playwright/test";

/**
 * GPT-Live with no OpenAI audio: a fake at the browser's RTCPeerConnection
 * boundary (V). The page's GPT-Live call (apps/web/src/features/voice/live/
 * live-call.ts) creates a peer, adds the microphone, opens data channel
 * "oai-events", gathers ICE, and POSTs its offer to the web relay; the Q API
 * creates the session (the fake vendor answers that, fake-vendors.mjs) and
 * returns an SDP answer. Everything server-side is real: the relay, the
 * allowlist, the line, the delegation broker, Q Brain's voice turn.
 *
 * This fake records every event the page sends (`__cqLiveSent`) and lets a
 * test emit GPT-Live server events (`__cqLiveEmit`). It is MOCK audio:
 * nothing here is model output.
 */
export async function installLiveFake(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Listener = (event: MessageEvent) => void;
    const own = window as Window & {
      __cqLiveSent?: unknown[];
      __cqLiveEmit?: (event: Record<string, unknown>) => void;
      __cqLivePeers?: number;
    };
    own.__cqLiveSent = [];
    // Every audio element the page makes, and the most that were ever
    // audible at once (a stream attached, not muted), sampled every 50 ms.
    const audioState = window as Window & {
      __cqAudios?: HTMLAudioElement[];
      __cqMaxAudible?: number;
    };
    audioState.__cqAudios = [];
    audioState.__cqMaxAudible = 0;
    const RealAudio = window.Audio;
    (window as unknown as { Audio: unknown }).Audio = function FakeAudioCtor(
      src?: string,
    ) {
      const element = new RealAudio(src);
      audioState.__cqAudios?.push(element);
      return element;
    };
    setInterval(() => {
      const audible = (audioState.__cqAudios ?? []).filter(
        (a) => a.srcObject !== null && !a.muted,
      ).length;
      audioState.__cqMaxAudible = Math.max(
        audioState.__cqMaxAudible ?? 0,
        audible,
      );
    }, 50);
    own.__cqLivePeers = 0;
    let channelRef: {
      dispatch: (data: string) => void;
      readyState: RTCDataChannelState;
    } | null = null;
    own.__cqLiveEmit = (event) => channelRef?.dispatch(JSON.stringify(event));
    // The page has the answer and is listening: events emitted now arrive.
    (own as { __cqLiveOpen?: () => boolean }).__cqLiveOpen = () =>
      channelRef?.readyState === "open";

    // Plain members only: Playwright transpiles this function and private
    // members need helpers the page does not have.
    class FakeChannel extends EventTarget {
      label: string;
      readyState: RTCDataChannelState = "connecting";
      onmessage: Listener | null = null;
      constructor(label: string) {
        super();
        this.label = label;
      }
      open() {
        this.readyState = "open";
        this.dispatchEvent(new Event("open"));
      }
      dispatch(data: string) {
        const event = new MessageEvent("message", { data });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }
      send(data: string) {
        try {
          own.__cqLiveSent?.push(JSON.parse(data));
        } catch {
          own.__cqLiveSent?.push(data);
        }
      }
      close() {
        this.readyState = "closed";
        this.dispatchEvent(new Event("close"));
      }
    }

    class FakePeer extends EventTarget {
      connectionState: RTCPeerConnectionState = "new";
      iceGatheringState: RTCIceGatheringState = "complete";
      localDescription: { type: string; sdp: string } | null = null;
      fakeChannel: FakeChannel | null = null;
      constructor() {
        super();
        own.__cqLivePeers = (own.__cqLivePeers ?? 0) + 1;
      }
      addTrack(track: MediaStreamTrack) {
        return { track };
      }
      createDataChannel(label: string) {
        this.fakeChannel = new FakeChannel(label);
        channelRef = this.fakeChannel;
        return this.fakeChannel;
      }
      createOffer() {
        return Promise.resolve({
          type: "offer",
          sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=fake-offer\r\n",
        });
      }
      setLocalDescription(description: { type: string; sdp: string }) {
        this.localDescription = description;
        return Promise.resolve();
      }
      setRemoteDescription() {
        this.connectionState = "connected";
        this.dispatchEvent(new Event("connectionstatechange"));
        setTimeout(() => this.fakeChannel?.open(), 10);
        // The provider's voice as a real media stream (a quiet tone), so
        // the page attaches it to its speaker exactly as with GPT-Live.
        setTimeout(() => {
          if (this.connectionState === "closed") return;
          const context = new AudioContext();
          const destination = context.createMediaStreamDestination();
          const tone = context.createOscillator();
          const gain = context.createGain();
          gain.gain.value = 0.001;
          tone.connect(gain).connect(destination);
          tone.start();
          this.dispatchEvent(
            Object.assign(new Event("track"), {
              streams: [destination.stream],
            }),
          );
        }, 30);
        return Promise.resolve();
      }
      close() {
        this.fakeChannel?.close();
        this.connectionState = "closed";
      }
    }
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      FakePeer;
  });
}

export async function emitLive(
  page: Page,
  event: Record<string, unknown>,
): Promise<void> {
  await page.evaluate((e) => {
    (window as Window & { __cqLiveEmit?: (x: unknown) => void }).__cqLiveEmit?.(
      e,
    );
  }, event);
}

export type LiveSent = {
  readonly type?: string;
  readonly delegation_id?: string | null;
  readonly content?: string;
};

export async function liveSent(page: Page): Promise<LiveSent[]> {
  return page.evaluate(
    () =>
      ((window as Window & { __cqLiveSent?: unknown[] }).__cqLiveSent ??
        []) as LiveSent[],
  );
}

/** The most audio elements ever audible at the same time on the page. */
export async function maxAudible(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as Window & { __cqMaxAudible?: number }).__cqMaxAudible ?? 0,
  );
}

/** Audio elements audible right now. */
export async function audibleNow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        (window as Window & { __cqAudios?: HTMLAudioElement[] }).__cqAudios ??
        []
      ).filter((a) => a.srcObject !== null && !a.muted).length,
  );
}

export async function livePeers(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as Window & { __cqLivePeers?: number }).__cqLivePeers ?? 0,
  );
}

/** The person says something: GPT-Live's input transcript, word by word. */
export async function liveUserSays(page: Page, words: string): Promise<void> {
  for (const word of words.split(" ")) {
    await emitLive(page, {
      type: "session.input_transcript.delta",
      delta: ` ${word}`,
      start_ms: 0,
      end_ms: 0,
    });
  }
}
