import type { Page } from "@playwright/test";

/**
 * The duplex line with no OpenAI: a fake at the RTCPeerConnection boundary.
 *
 * duplex-line.ts creates a peer, adds the microphone track, opens data
 * channel "oai-events", POSTs its SDP offer to the credential's callsUrl and
 * waits for the channel to open (apps/web/src/features/voice/provider/
 * duplex-line.ts:600-643). This fake answers all of that inside the page,
 * records every event the browser sends (`__cqDuplexSent`) and lets the test
 * emit realtime server events (`__cqDuplexEmit`), so the line's own logic
 * (barge-in, transcripts, watchdogs, rejoin, fallback) is what runs.
 *
 * The SDP POST is answered by `page.route`, or held forever to simulate a
 * realtime connect timeout (DUPLEX_CONNECT_MS, duplex-line.ts:352).
 */
export type DuplexMode =
  "connect" | "never-answer" | "refuse" | "channel-never-opens";

export async function installDuplexFake(
  page: Page,
  mode: DuplexMode = "connect",
): Promise<void> {
  await page.addInitScript((fakeMode: DuplexMode) => {
    type Listener = (event: { data: string }) => void;
    const own = window as Window & {
      __cqDuplexSent?: unknown[];
      __cqDuplexEmit?: (event: Record<string, unknown>) => void;
      __cqDuplexPeers?: number;
      __cqDuplexState?: (state: RTCPeerConnectionState) => void;
    };
    own.__cqDuplexSent = [];
    own.__cqDuplexPeers = 0;
    let channelRef: {
      onmessage: Listener | null;
      dispatch: (data: string) => void;
    } | null = null;
    own.__cqDuplexEmit = (event) => channelRef?.dispatch(JSON.stringify(event));

    class FakeChannel extends EventTarget {
      label: string;
      readyState: RTCDataChannelState = "connecting";
      onmessage: Listener | null = null;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(label: string) {
        super();
        this.label = label;
      }
      open() {
        if (fakeMode === "channel-never-opens") return;
        this.readyState = "open";
        this.onopen?.();
        this.dispatchEvent(new Event("open"));
        this.dispatch(JSON.stringify({ type: "session.created", session: {} }));
      }
      dispatch(data: string) {
        const event = new MessageEvent("message", { data });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }
      send(data: string) {
        try {
          own.__cqDuplexSent?.push(JSON.parse(data));
        } catch {
          own.__cqDuplexSent?.push(data);
        }
      }
      close() {
        this.readyState = "closed";
        this.onclose?.();
        this.dispatchEvent(new Event("close"));
      }
    }

    class FakePeer extends EventTarget {
      connectionState: RTCPeerConnectionState = "new";
      iceConnectionState: RTCIceConnectionState = "new";
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: unknown) => void) | null = null;
      // Plain members, never `#private`: Playwright transpiles this init
      // function and private members need helpers the page does not have
      // ("_classPrivateMethodInitSpec is not defined"), which silently made
      // every fake peer throw and every line fall back with CONNECT.
      fakeChannel: FakeChannel | null = null;
      constructor() {
        super();
        own.__cqDuplexPeers = (own.__cqDuplexPeers ?? 0) + 1;
        own.__cqDuplexState = (state) => this.fakeSetState(state);
      }
      addTrack(track: MediaStreamTrack) {
        return {
          track,
          replaceTrack: () => Promise.resolve(),
          getParameters: () => ({}),
        };
      }
      createDataChannel(label: string) {
        this.fakeChannel = new FakeChannel(label);
        channelRef = this.fakeChannel;
        return this.fakeChannel;
      }
      createOffer() {
        return Promise.resolve({
          type: "offer",
          sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=fake\r\n",
        });
      }
      setLocalDescription() {
        return Promise.resolve();
      }
      setRemoteDescription() {
        this.fakeSetState("connected");
        setTimeout(() => this.fakeChannel?.open(), 10);
        return Promise.resolve();
      }
      getStats() {
        return Promise.resolve(new Map());
      }
      getReceivers() {
        return [];
      }
      getSenders() {
        return [];
      }
      close() {
        this.fakeChannel?.close();
        this.fakeSetState("closed");
      }
      fakeSetState(state: RTCPeerConnectionState) {
        this.connectionState = state;
        this.onconnectionstatechange?.();
        this.dispatchEvent(new Event("connectionstatechange"));
      }
    }
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      FakePeer;
  }, mode);

  await page.route(/\/v1\/realtime\/calls/u, async (route) => {
    if (mode === "never-answer") return new Promise<void>(() => undefined);
    if (mode === "refuse")
      return route.fulfill({ status: 500, body: "refused" });
    return route.fulfill({
      status: 201,
      headers: {
        "content-type": "application/sdp",
        location: "/v1/realtime/calls/rtc_fakecall0000000001",
      },
      body: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=fake-answer\r\n",
    });
  });
}

/** Emits a realtime server event on the fake data channel. */
export async function emitRealtime(
  page: Page,
  event: Record<string, unknown>,
): Promise<void> {
  await page.evaluate((e) => {
    (
      window as Window & { __cqDuplexEmit?: (x: unknown) => void }
    ).__cqDuplexEmit?.(e);
  }, event);
}

/** A whole spoken user turn as the realtime API reports it. */
export async function userSays(
  page: Page,
  itemId: string,
  transcript: string,
): Promise<void> {
  await emitRealtime(page, {
    type: "input_audio_buffer.speech_started",
    item_id: itemId,
    audio_start_ms: 0,
  });
  await emitRealtime(page, {
    type: "input_audio_buffer.speech_stopped",
    item_id: itemId,
    audio_end_ms: 1200,
  });
  await emitRealtime(page, {
    type: "input_audio_buffer.committed",
    item_id: itemId,
    previous_item_id: null,
  });
  await emitRealtime(page, {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: itemId,
    content_index: 0,
    transcript,
  });
}

export async function duplexSent(
  page: Page,
): Promise<Array<{ type?: string }>> {
  return page.evaluate(
    () =>
      ((window as Window & { __cqDuplexSent?: unknown[] }).__cqDuplexSent ??
        []) as never,
  );
}

export async function setPeerState(
  page: Page,
  state: RTCPeerConnectionState,
): Promise<void> {
  await page.evaluate((s) => {
    (
      window as Window & { __cqDuplexState?: (x: string) => void }
    ).__cqDuplexState?.(s);
  }, state);
}
