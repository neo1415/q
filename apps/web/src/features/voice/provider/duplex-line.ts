import type {
  QVoiceDuplexCredential,
  QVoiceDuplexToolCall,
  QVoiceDuplexToolResult,
  QVoiceDuplexUsageReport,
  QVoiceDuplexUsageResult,
} from "@capital-q/contracts";

import type { VoiceState } from "../session";

/**
 * The browser side of a full-duplex line (DUPLEX; flag CQ_VOICE_REALTIME).
 *
 * The only browser code that speaks the realtime provider's event dialect.
 * It holds a short-lived client secret the Q API minted, never a key; it
 * opens WebRTC with it, plays Q's audio through one element, and sends
 * nothing to Capital Q but what the server asked for: every function call
 * the model proposes (run on the server, through the Tool Registry) and
 * each response's usage (for the spend cap).
 *
 * Barge-in: the moment the provider hears the person start speaking, Q's
 * audio is silenced here, the response is cancelled, the unplayed audio
 * cleared, and the item truncated to what was actually heard, so Q's
 * memory of the conversation matches the person's.
 *
 * Any failure — no microphone, no connection, a refused relay, the cap,
 * the maximum length — ends the line with `fallback`, and the caller
 * carries on with the standard voice. Silence for the idle window ends it
 * plainly. Nothing here changes reduced motion or accessibility: audio is
 * unaffected by them, and the transcript is the same lines as before.
 */

export type DuplexFallbackCause =
  | "CONNECT"
  | "NETWORK"
  | "RELAY"
  | "CAP"
  | "MAX_LENGTH";

export type DuplexLineEvents = {
  readonly onState: (state: VoiceState) => void;
  readonly onLine: (role: "user" | "q", text: string) => void;
  readonly onInterrupted: () => void;
  /** The line is over and the standard voice should take over. */
  readonly onFallback: (input: {
    readonly cause: DuplexFallbackCause;
    /** One sentence for the person, when they should know why. */
    readonly notice: string | null;
    /** Whether the line had come up before it fell back. */
    readonly connected: boolean;
  }) => void;
  /** The line ended without fallback (idle, or the person ended it). */
  readonly onEnded: (reason: "IDLE" | "ENDED") => void;
};

/** The server-side relays, as server actions; null means "the line is gone". */
export type DuplexRelays = {
  readonly tool: (
    call: QVoiceDuplexToolCall,
  ) => Promise<QVoiceDuplexToolResult | null>;
  readonly usage: (
    report: QVoiceDuplexUsageReport,
  ) => Promise<QVoiceDuplexUsageResult | null>;
  readonly end: (
    reason: "ENDED" | "IDLE" | "MAX_LENGTH" | "FALLBACK",
  ) => Promise<void>;
};

/** What the line needs from the browser; injected so a test can fake it. */
export type DuplexEnvironment = {
  readonly createPeer: () => RTCPeerConnection;
  readonly getMicrophone: () => Promise<MediaStream>;
  readonly fetch: typeof fetch;
  readonly createAudio: () => HTMLAudioElement;
  readonly now: () => number;
  readonly setTimeout: (handler: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export function browserDuplexEnvironment(): DuplexEnvironment {
  return {
    createPeer: () => new RTCPeerConnection(),
    getMicrophone: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      }),
    fetch: (input, init) => fetch(input, init),
    createAudio: () => {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      return audio;
    },
    now: () => Date.now(),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => {
      window.clearTimeout(handle as number);
    },
  };
}

/** How long the provider has to answer the session offer. */
export const DUPLEX_CONNECT_MS = 8_000;

/** Read a field of an untrusted event without trusting its shape. */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
function text(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === "string" ? found : undefined;
}
function tokens(value: unknown, key: string): number {
  const found = field(value, key);
  return typeof found === "number" && Number.isFinite(found) && found > 0
    ? Math.floor(found)
    : 0;
}

/** The provider's usage block, as Capital Q's modality-split report. */
export function usageReportOf(
  responseId: string,
  usage: unknown,
): QVoiceDuplexUsageReport {
  const input = field(usage, "input_token_details");
  const cached = field(input, "cached_tokens_details");
  const output = field(usage, "output_token_details");
  return {
    responseId,
    inputTextTokens: tokens(input, "text_tokens"),
    inputAudioTokens: tokens(input, "audio_tokens"),
    cachedTextTokens: tokens(cached, "text_tokens"),
    cachedAudioTokens: tokens(cached, "audio_tokens"),
    outputTextTokens: tokens(output, "text_tokens"),
    outputAudioTokens: tokens(output, "audio_tokens"),
  };
}

export class DuplexLine {
  readonly #credential: QVoiceDuplexCredential;
  readonly #relays: DuplexRelays;
  readonly #events: DuplexLineEvents;
  readonly #env: DuplexEnvironment;
  #peer: RTCPeerConnection | null = null;
  #channel: RTCDataChannel | null = null;
  #microphone: MediaStream | null = null;
  #audio: HTMLAudioElement | null = null;
  #connected = false;
  #over = false;
  #volume = 1;
  /** Q's audio was silenced locally by a barge-in, until the next reply. */
  #speakingSilenced = false;
  /** Q's audio is playing: the person speaking now is a barge-in. */
  #speaking = false;
  /** The response being produced, if any (to cancel it). */
  #responseActive = false;
  /** The audio item Q is saying and when its playback started. */
  #item: { id: string; startedAt: number } | null = null;
  /** Bumped by every barge-in: a tool result from before it is stale. */
  #generation = 0;
  #idleTimer: unknown = null;
  #maxTimer: unknown = null;

  constructor(input: {
    readonly credential: QVoiceDuplexCredential;
    readonly relays: DuplexRelays;
    readonly events: DuplexLineEvents;
    readonly environment: DuplexEnvironment;
  }) {
    this.#credential = input.credential;
    this.#relays = input.relays;
    this.#events = input.events;
    this.#env = input.environment;
  }

  get connected(): boolean {
    return this.#connected;
  }

  /** Opens the line; false (and a fallback) when it did not come up. */
  async open(): Promise<boolean> {
    this.#events.onState("CONNECTING");
    try {
      if (Date.parse(this.#credential.expiresAt) <= this.#env.now()) {
        throw new Error("secret expired");
      }
      const microphone = await this.#env.getMicrophone();
      if (this.#over) {
        for (const track of microphone.getTracks()) track.stop();
        return false;
      }
      this.#microphone = microphone;
      const peer = this.#env.createPeer();
      this.#peer = peer;
      const audio = this.#env.createAudio();
      audio.volume = this.#volume;
      this.#audio = audio;
      peer.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream !== undefined) audio.srcObject = stream;
      };
      for (const track of microphone.getTracks()) {
        peer.addTrack(track, microphone);
      }
      const channel = peer.createDataChannel("oai-events");
      this.#channel = channel;
      channel.onmessage = (message: MessageEvent) => {
        this.#receive(message.data);
      };
      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        if (state === "failed" || state === "disconnected") {
          this.#fallback("NETWORK", null);
        }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answered = await this.#withTimeout(
        this.#env.fetch(this.#credential.callsUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#credential.clientSecret}`,
            "content-type": "application/sdp",
          },
          body: offer.sdp ?? "",
        }),
      );
      if (!answered.ok) throw new Error("offer refused");
      const sdp = await answered.text();
      await peer.setRemoteDescription({ type: "answer", sdp });
      await this.#withTimeout(this.#channelOpen(channel));
    } catch {
      this.#fallback("CONNECT", null);
      return false;
    }
    if (this.#over) return false;
    this.#connected = true;
    this.#events.onState("LISTENING");
    this.#touch();
    this.#maxTimer = this.#env.setTimeout(() => {
      this.#fallback("MAX_LENGTH", null);
    }, this.#credential.maxSessionMs);
    return true;
  }

  /** The person ended it. */
  close(): void {
    if (this.#over) return;
    this.#finish();
    void this.#relays.end("ENDED").catch(() => undefined);
    this.#events.onEnded("ENDED");
  }

  setMuted(muted: boolean): void {
    for (const track of this.#microphone?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  setVolume(volume: number): void {
    this.#volume = Math.min(1, Math.max(0, volume));
    if (this.#audio !== null && !this.#speakingSilenced) {
      this.#audio.volume = this.#volume;
    }
  }

  /** Typed while the line is open: the same turn, answered aloud. */
  sendText(words: string): void {
    const trimmed = words.trim();
    if (trimmed.length === 0 || !this.#connected) return;
    this.#send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: trimmed }],
      },
    });
    this.#send({ type: "response.create" });
    this.#events.onLine("user", trimmed);
    this.#events.onState("THINKING");
    this.#touch();
  }


  #channelOpen(channel: RTCDataChannel): Promise<void> {
    if (channel.readyState === "open") return Promise.resolve();
    return new Promise((resolve, reject) => {
      channel.onopen = () => {
        resolve();
      };
      channel.onerror = () => {
        reject(new Error("channel failed"));
      };
    });
  }

  #withTimeout<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.#env.setTimeout(() => {
        reject(new Error("timed out"));
      }, DUPLEX_CONNECT_MS);
      work.then(
        (value) => {
          this.#env.clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          this.#env.clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("failed"));
        },
      );
    });
  }

  #send(event: Record<string, unknown>): void {
    const channel = this.#channel;
    if (channel === null || channel.readyState !== "open") return;
    try {
      channel.send(JSON.stringify(event));
    } catch {
      // A closed channel is noticed by the connection state.
    }
  }

  /** Activity: the idle window starts again. */
  #touch(): void {
    if (this.#idleTimer !== null) this.#env.clearTimeout(this.#idleTimer);
    this.#idleTimer = this.#env.setTimeout(() => {
      // Never while Q is talking or a turn is working.
      if (this.#speaking || this.#responseActive) {
        this.#touch();
        return;
      }
      if (this.#over) return;
      this.#finish();
      void this.#relays.end("IDLE").catch(() => undefined);
      this.#events.onEnded("IDLE");
    }, this.#credential.idleMs);
  }

  /** Q's audio stops now: the person is speaking. */
  #bargeIn(): void {
    this.#generation += 1;
    const item = this.#item;
    if (this.#audio !== null) {
      // Silenced at once, locally, before any round trip.
      this.#speakingSilenced = true;
      this.#audio.volume = 0;
    }
    if (this.#responseActive) this.#send({ type: "response.cancel" });
    this.#send({ type: "output_audio_buffer.clear" });
    if (item !== null) {
      this.#send({
        type: "conversation.item.truncate",
        item_id: item.id,
        content_index: 0,
        audio_end_ms: Math.max(0, Math.round(this.#env.now() - item.startedAt)),
      });
    }
    this.#item = null;
    this.#speaking = false;
    this.#events.onInterrupted();
    this.#events.onState("USER_SPEAKING");
  }

  #unsilence(): void {
    if (this.#speakingSilenced && this.#audio !== null) {
      this.#audio.volume = this.#volume;
    }
    this.#speakingSilenced = false;
  }

  #receive(data: unknown): void {
    if (this.#over || typeof data !== "string") return;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    const type = text(event, "type");
    switch (type) {
      case "input_audio_buffer.speech_started":
        this.#touch();
        if (this.#speaking || this.#responseActive) this.#bargeIn();
        else this.#events.onState("USER_SPEAKING");
        break;
      case "input_audio_buffer.speech_stopped":
        this.#touch();
        this.#events.onState("THINKING");
        break;
      case "response.created":
        this.#responseActive = true;
        this.#unsilence();
        break;
      case "response.output_item.added": {
        const item = field(event, "item");
        const id = text(item, "id");
        if (id !== undefined && text(item, "type") === "message") {
          this.#item = { id, startedAt: this.#env.now() };
        }
        break;
      }
      case "output_audio_buffer.started":
        this.#speaking = true;
        this.#unsilence();
        if (this.#item !== null) this.#item.startedAt = this.#env.now();
        this.#events.onState("Q_SPEAKING");
        this.#touch();
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.#speaking = false;
        this.#events.onState("LISTENING");
        this.#touch();
        break;
      case "response.output_audio_transcript.done": {
        const said = text(event, "transcript");
        if (said !== undefined) this.#events.onLine("q", said);
        break;
      }
      case "response.function_call_arguments.done":
        void this.#relayTool(event);
        break;
      case "response.done": {
        this.#responseActive = false;
        const response = field(event, "response");
        const id = text(response, "id");
        const usage = field(response, "usage");
        if (id !== undefined && usage !== undefined) {
          void this.#report(usageReportOf(id, usage));
        }
        break;
      }
      default:
        break;
    }
  }

  async #relayTool(event: unknown): Promise<void> {
    const callId = text(event, "call_id");
    const name = text(event, "name");
    const args = text(event, "arguments") ?? "{}";
    if (callId === undefined || name === undefined) return;
    const generation = this.#generation;
    this.#touch();
    this.#events.onState("THINKING");
    // The person's own words, as the model passed them to Q.
    if (name === "ask_q") {
      try {
        const asked: unknown = JSON.parse(args);
        const words = text(asked, "request");
        if (words !== undefined) this.#events.onLine("user", words);
      } catch {
        // Not shown; the server validates it anyway.
      }
    }
    let result: QVoiceDuplexToolResult | null;
    try {
      result = await this.#relays.tool({
        callId: callId.slice(0, 128),
        name: name.slice(0, 64),
        arguments: args.slice(0, 8_000),
      });
    } catch {
      result = null;
    }
    if (this.#over) return;
    if (result === null) {
      this.#fallback("RELAY", null);
      return;
    }
    this.#send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: result.output },
    });
    // Talked over while it worked: the result is kept, but not said.
    if (generation !== this.#generation) return;
    this.#send({ type: "response.create" });
    this.#touch();
  }

  async #report(report: QVoiceDuplexUsageReport): Promise<void> {
    let result: QVoiceDuplexUsageResult | null;
    try {
      result = await this.#relays.usage(report);
    } catch {
      result = null;
    }
    if (this.#over) return;
    if (result === null) {
      // Usage that cannot be counted cannot be capped.
      this.#fallback("RELAY", null);
      return;
    }
    if (!result.continue) {
      this.#fallback(
        result.notice === undefined ? "MAX_LENGTH" : "CAP",
        result.notice ?? null,
      );
    }
  }

  #fallback(cause: DuplexFallbackCause, notice: string | null): void {
    if (this.#over) return;
    const connected = this.#connected;
    this.#finish();
    void this.#relays
      .end(cause === "MAX_LENGTH" ? "MAX_LENGTH" : "FALLBACK")
      .catch(() => undefined);
    this.#events.onFallback({ cause, notice, connected });
  }

  #finish(): void {
    this.#over = true;
    this.#connected = false;
    if (this.#idleTimer !== null) this.#env.clearTimeout(this.#idleTimer);
    if (this.#maxTimer !== null) this.#env.clearTimeout(this.#maxTimer);
    this.#idleTimer = null;
    this.#maxTimer = null;
    if (this.#audio !== null) {
      this.#audio.volume = 0;
      this.#audio.srcObject = null;
    }
    for (const track of this.#microphone?.getTracks() ?? []) track.stop();
    try {
      this.#channel?.close();
    } catch {
      // Already closed.
    }
    try {
      this.#peer?.close();
    } catch {
      // Already closed.
    }
    this.#events.onState("IDLE");
  }
}
