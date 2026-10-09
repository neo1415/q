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
    own.__cqLivePeers = 0;
    let channelRef: { dispatch: (data: string) => void } | null = null;
    own.__cqLiveEmit = (event) => channelRef?.dispatch(JSON.stringify(event));

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
