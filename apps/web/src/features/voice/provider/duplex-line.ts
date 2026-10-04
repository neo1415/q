import type {
  QVoiceDuplexCredential,
  QVoiceDuplexToolCall,
  QVoiceDuplexToolResult,
  QVoiceDuplexUsageReport,
  QVoiceDuplexUsageResult,
  QVoiceListeningLevel,
} from "@capital-q/contracts";

import type { VoiceState } from "../session";
import {
  BackchannelPolicy,
  LEVEL_FRAME_MS,
  overlongReaction,
  PauseDetector,
} from "./backchannel";

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
 *
 * BACKCHANNEL (when the credential carries `listening`): Q listens like a
 * person. A local pause detector on the microphone and the provider's
 * turn detector feed `BackchannelPolicy`; when it says a mid-turn pause
 * has earned a reaction, the audio so far is committed (so the model can
 * hear it) and one out-of-band response (`conversation: "none"`, so
 * nothing enters the conversation) is asked for: audio only, a tiny
 * output cap, no tools, played quieter. The person resuming cancels it at
 * once. While a substantive answer is slow, a bridging line is asked for
 * the same way, from their own request. Neither is ever shown as a line,
 * relayed as a tool call, or treated as Q's turn; both are reported for
 * the spend cap like every other response.
 */

/** A reaction or a bridge in flight, out of band. */
type OutOfBand = {
  readonly id: string;
  readonly kind: "BACKCHANNEL" | "BRIDGE";
  responseId: string | null;
  cancelled: boolean;
  audioStarted: boolean;
  audioDone: boolean;
  done: boolean;
  text: string;
};

/** Measures the microphone's level, locally; injected so a test can fake it. */
export type LevelMeter = {
  /** RMS of the latest frame, 0..1. */
  readonly read: () => number;
  readonly close: () => void;
};

/** A slow answer gets a bridging line after this long. */
export const BRIDGE_AFTER_MS = 700;
/** Reactions play quieter than Q's turns. */
export const BACKCHANNEL_GAIN = 0.6;
/** Output caps: a reaction is under a second, a bridge a short clause. */
export const BACKCHANNEL_MAX_OUTPUT_TOKENS = 40;
export const BRIDGE_MAX_OUTPUT_TOKENS = 90;
/** The commit a reaction waits on; past this it is dropped. */
const COMMIT_WAIT_MS = 400;
/** The longest a bridge may hold Q's answer back. */
const BRIDGE_HOLD_MS = 2_500;
const TURN_ITEMS_MAX = 3;
const HEARD_MAX = 4;

export type DuplexFallbackCause =
  "CONNECT" | "NETWORK" | "RELAY" | "CAP" | "MAX_LENGTH";

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
  /** BACKCHANNEL: the person changed the level by voice. */
  readonly onListening?: ((level: QVoiceListeningLevel) => void) | undefined;
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
  /** BACKCHANNEL: the local level meter; absent means no reactions. */
  readonly createLevelMeter?:
    ((stream: MediaStream) => LevelMeter | null) | undefined;
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
    createLevelMeter: (stream) => {
      const Context = window.AudioContext as typeof AudioContext | undefined;
      if (Context === undefined) return null;
      try {
        const context = new Context();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const frame = new Float32Array(analyser.fftSize);
        return {
          read: () => {
            analyser.getFloatTimeDomainData(frame);
            let sum = 0;
            for (const sample of frame) sum += sample * sample;
            return Math.sqrt(sum / frame.length);
          },
          close: () => {
            source.disconnect();
            void context.close().catch(() => undefined);
          },
        };
      } catch {
        return null;
      }
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
  kind?: "BACKCHANNEL" | "BRIDGE",
): QVoiceDuplexUsageReport {
  const input = field(usage, "input_token_details");
  const cached = field(input, "cached_tokens_details");
  const output = field(usage, "output_token_details");
  return {
    responseId,
    ...(kind === undefined ? {} : { kind }),
    inputTextTokens: tokens(input, "text_tokens"),
    inputAudioTokens: tokens(input, "audio_tokens"),
    cachedTextTokens: tokens(cached, "text_tokens"),
    cachedAudioTokens: tokens(cached, "audio_tokens"),
    outputTextTokens: tokens(output, "text_tokens"),
    outputAudioTokens: tokens(output, "audio_tokens"),
  };
}

/** The transcriber's usage for one item (token-billed models). */
export function transcriptionReportOf(
  itemId: string,
  usage: unknown,
): QVoiceDuplexUsageReport {
  const input = field(usage, "input_token_details");
  return {
    responseId: `tx_${itemId}`.slice(0, 128),
    kind: "TRANSCRIPTION",
    inputTextTokens: tokens(input, "text_tokens"),
    inputAudioTokens: tokens(input, "audio_tokens"),
    cachedTextTokens: 0,
    cachedAudioTokens: 0,
    outputTextTokens: tokens(usage, "output_tokens"),
    outputAudioTokens: 0,
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
  // BACKCHANNEL
  readonly #policy: BackchannelPolicy;
  readonly #detector = new PauseDetector();
  #meter: LevelMeter | null = null;
  #meterTimer: unknown = null;
  #oobCount = 0;
  readonly #oob = new Map<string, OutOfBand>();
  readonly #oobByResponse = new Map<string, OutOfBand>();
  /** A reaction waiting for its commit's item id. */
  #awaitingCommit: { oob: OutOfBand; timer: unknown } | null = null;
  /** The person's items in this turn, for a reaction's context. */
  #turnItems: string[] = [];
  readonly #transcripts = new Map<string, string>();
  /** The provider's transcripts of the person's latest turns. */
  readonly #heard: string[] = [];
  #lastQSaid = "";
  #toolsInFlight = 0;
  readonly #recentBridges: string[] = [];
  /** Q's answer, held while a bridge finishes. */
  #heldAnswer: { send: () => void; timer: unknown } | null = null;

  constructor(input: {
    readonly credential: QVoiceDuplexCredential;
    readonly relays: DuplexRelays;
    readonly events: DuplexLineEvents;
    readonly environment: DuplexEnvironment;
    /** BACKCHANNEL: the level to start with (device or remembered). */
    readonly listening?: QVoiceListeningLevel | undefined;
  }) {
    this.#credential = input.credential;
    this.#relays = input.relays;
    this.#events = input.events;
    this.#env = input.environment;
    this.#policy = new BackchannelPolicy(
      input.credential.listening === undefined
        ? "OFF"
        : (input.listening ?? input.credential.listening.level),
    );
  }

  /** BACKCHANNEL: the level in use now. */
  get listening(): QVoiceListeningLevel {
    return this.#policy.level;
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
    this.#startListening();
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

  /**
   * BACKCHANNEL: change the level now (the Settings toggle, or the
   * person's own words through set_listening). OFF cancels anything in
   * flight; the turn detector is told to answer sooner when nothing is
   * listening for mid-turn pauses.
   */
  setListening(level: QVoiceListeningLevel): void {
    if (this.#credential.listening === undefined) return;
    const was = this.#policy.level;
    this.#policy.setLevel(level);
    if (level === "OFF") this.#cutOutOfBand(null);
    if ((was === "OFF") === (level === "OFF") || !this.#connected) return;
    this.#send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: level === "OFF" ? "high" : "auto",
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
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
    if (type === undefined) return;
    // Q's out-of-band reactions and bridges: never a turn, never a line.
    if (this.#receiveOutOfBand(type, event)) return;
    switch (type) {
      case "input_audio_buffer.speech_started": {
        this.#touch();
        // The person talking cancels any reaction or bridge at once.
        this.#cutOutOfBand(null);
        if (this.#policy.turnStarted(this.#env.now())) this.#turnItems = [];
        if (this.#speaking || this.#responseActive) this.#bargeIn();
        else this.#events.onState("USER_SPEAKING");
        this.#updateBusy();
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.#touch();
        this.#policy.turnEnded(this.#env.now());
        this.#events.onState("THINKING");
        break;
      case "input_audio_buffer.committed": {
        const itemId = text(event, "item_id");
        if (itemId !== undefined) {
          this.#turnItems.push(itemId);
          if (this.#turnItems.length > TURN_ITEMS_MAX) this.#turnItems.shift();
        }
        this.#committed(itemId);
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const itemId = text(event, "item_id");
        const said = text(event, "transcript")?.trim() ?? "";
        if (itemId !== undefined && said.length > 0) {
          this.#transcripts.set(itemId, said.slice(0, 600));
          this.#heard.push(said.slice(0, 600));
          if (this.#heard.length > HEARD_MAX) this.#heard.shift();
        }
        const usage = field(event, "usage");
        if (itemId !== undefined && usage !== undefined) {
          void this.#report(transcriptionReportOf(itemId, usage));
        }
        break;
      }
      case "response.created":
        this.#responseActive = true;
        this.#unsilence();
        this.#updateBusy();
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
        this.#updateBusy();
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.#speaking = false;
        this.#events.onState("LISTENING");
        this.#touch();
        this.#updateBusy();
        break;
      case "response.output_audio_transcript.done": {
        const said = text(event, "transcript");
        if (said !== undefined) {
          this.#events.onLine("q", said);
          this.#lastQSaid = said.slice(-240);
        }
        break;
      }
      case "response.function_call_arguments.done":
        void this.#relayTool(event);
        break;
      case "response.done": {
        this.#responseActive = false;
        this.#updateBusy();
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
    let bridge: unknown = null;
    // The person's own words, as the model passed them to Q.
    if (name === "ask_q") {
      try {
        const asked: unknown = JSON.parse(args);
        const words = text(asked, "request");
        if (words !== undefined) {
          this.#events.onLine("user", words);
          // A slow answer gets a bridging line; a fast one gets silence.
          if (this.#bridgesAllowed()) {
            bridge = this.#env.setTimeout(() => {
              if (generation === this.#generation) this.#fireBridge(words);
            }, BRIDGE_AFTER_MS);
          }
        }
      } catch {
        // Not shown; the server validates it anyway.
      }
    }
    const listening = name === "set_listening";
    this.#toolsInFlight += 1;
    this.#updateBusy();
    let result: QVoiceDuplexToolResult | null;
    try {
      result = await this.#relays.tool({
        callId: callId.slice(0, 128),
        name: name.slice(0, 64),
        arguments: args.slice(0, 8_000),
        ...(listening
          ? { heard: [...this.#heard], listening: this.#policy.level }
          : {}),
      });
    } catch {
      result = null;
    } finally {
      this.#toolsInFlight -= 1;
      if (bridge !== null) this.#env.clearTimeout(bridge);
      this.#updateBusy();
    }
    if (this.#over) return;
    if (result?.listening !== undefined) {
      this.setListening(result.listening);
      this.#events.onListening?.(result.listening);
    }
    if (result === null) {
      this.#fallback("RELAY", null);
      return;
    }
    this.#send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: result.output,
      },
    });
    // Talked over while it worked: the result is kept, but not said.
    if (generation !== this.#generation) return;
    this.#afterBridge(() => {
      if (this.#over || generation !== this.#generation) return;
      this.#send({ type: "response.create" });
      this.#touch();
    });
  }

  // -------------------------------------------------------------------
  // BACKCHANNEL
  // -------------------------------------------------------------------

  #startListening(): void {
    if (this.#credential.listening === undefined) return;
    const microphone = this.#microphone;
    const create = this.#env.createLevelMeter;
    if (microphone === null || create === undefined) return;
    this.#meter = create(microphone);
    if (this.#meter === null) return;
    const frame = () => {
      if (this.#over || this.#meter === null) return;
      const at = this.#env.now();
      const heard = this.#detector.feed(this.#meter.read());
      if (heard === "VOICE") {
        this.#policy.voiceStarted(at);
        // Resumed before or over a reaction: it goes, at once.
        this.#cutOutOfBand("BACKCHANNEL");
      } else if (heard === "PAUSE") {
        this.#policy.pauseStarted(at);
      }
      if (this.#policy.due(at)) this.#fireBackchannel(at);
      this.#meterTimer = this.#env.setTimeout(frame, LEVEL_FRAME_MS);
    };
    this.#meterTimer = this.#env.setTimeout(frame, LEVEL_FRAME_MS);
  }

  #updateBusy(): void {
    let bridging = false;
    for (const oob of this.#oob.values()) {
      if (oob.kind === "BRIDGE" && !oob.done) bridging = true;
    }
    this.#policy.setBusy(
      this.#speaking ||
        this.#responseActive ||
        this.#toolsInFlight > 0 ||
        bridging,
    );
  }

  #bridgesAllowed(): boolean {
    return (
      this.#credential.listening !== undefined && this.#policy.level !== "OFF"
    );
  }

  #newOutOfBand(kind: OutOfBand["kind"]): OutOfBand {
    this.#oobCount += 1;
    const oob: OutOfBand = {
      id: `${kind === "BACKCHANNEL" ? "bc" : "br"}_${String(this.#oobCount)}`,
      kind,
      responseId: null,
      cancelled: false,
      audioStarted: false,
      audioDone: false,
      done: false,
      text: "",
    };
    this.#oob.set(oob.id, oob);
    return oob;
  }

  /** A mid-turn pause earned a reaction: let the model hear what was said. */
  #fireBackchannel(at: number): void {
    const listening = this.#credential.listening;
    if (listening === undefined || this.#awaitingCommit !== null) return;
    this.#policy.fired(at);
    const oob = this.#newOutOfBand("BACKCHANNEL");
    const timer = this.#env.setTimeout(() => {
      if (this.#awaitingCommit?.oob !== oob) return;
      this.#awaitingCommit = null;
      this.#forget(oob);
      this.#policy.dropped();
    }, COMMIT_WAIT_MS);
    this.#awaitingCommit = { oob, timer };
    // The in-progress audio becomes an item the reaction can reference.
    // A manual commit starts no response of the conversation's own.
    this.#send({ type: "input_audio_buffer.commit" });
  }

  #committed(itemId: string | undefined): void {
    const waiting = this.#awaitingCommit;
    if (waiting === null) return;
    this.#awaitingCommit = null;
    this.#env.clearTimeout(waiting.timer);
    const { oob } = waiting;
    const listening = this.#credential.listening;
    if (oob.cancelled || itemId === undefined || listening === undefined) {
      this.#forget(oob);
      if (!oob.cancelled) this.#policy.dropped();
      return;
    }
    const sofar = this.#turnItems
      .map((id) => this.#transcripts.get(id))
      .filter((said): said is string => said !== undefined)
      .join(" ")
      .slice(-400);
    const context = [
      this.#lastQSaid.length > 0
        ? `What you last said: "${this.#lastQSaid}"`
        : "You have not spoken yet.",
      sofar.length > 0
        ? `Their words so far this turn, transcribed (may lag behind the audio): "${sofar}"`
        : null,
      this.#policy.recent.length > 0
        ? `Reactions you used recently: ${this.#policy.recent.map((said) => `"${said}"`).join(", ")}`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    this.#sendOutOfBand(oob, {
      instructions: listening.backchannelInstructions,
      maxOutputTokens: BACKCHANNEL_MAX_OUTPUT_TOKENS,
      input: [
        systemItem(context),
        // Only this turn's audio: bounded, and what the reaction is to.
        ...this.#turnItems.map((id) => ({ type: "item_reference", id })),
      ],
    });
  }

  /** The answer is slow: one short line, from their own request. */
  #fireBridge(request: string): void {
    const listening = this.#credential.listening;
    if (listening === undefined || !this.#bridgesAllowed() || this.#over) {
      return;
    }
    if (this.#speaking || this.#responseActive) return;
    const oob = this.#newOutOfBand("BRIDGE");
    const recent =
      this.#recentBridges.length > 0
        ? `\nBridging lines you used recently: ${this.#recentBridges.map((said) => `"${said}"`).join(", ")}`
        : "";
    this.#sendOutOfBand(oob, {
      instructions: listening.bridgeInstructions,
      maxOutputTokens: BRIDGE_MAX_OUTPUT_TOKENS,
      input: [systemItem(`Their request: "${request.slice(0, 300)}"${recent}`)],
    });
    this.#updateBusy();
  }

  #sendOutOfBand(
    oob: OutOfBand,
    input: {
      readonly instructions: string;
      readonly maxOutputTokens: number;
      readonly input: readonly Record<string, unknown>[];
    },
  ): void {
    this.#send({
      type: "response.create",
      response: {
        // Out of band: nothing it says enters the conversation.
        conversation: "none",
        output_modalities: ["audio"],
        instructions: input.instructions,
        max_output_tokens: input.maxOutputTokens,
        // Never a tool, whatever the model makes of the moment.
        tools: [],
        tool_choice: "none",
        metadata: { cq_kind: oob.kind, cq_id: oob.id },
        input: input.input,
      },
    });
  }

  #outOfBandOf(event: unknown): OutOfBand | undefined {
    const response = field(event, "response");
    const responseId = text(event, "response_id") ?? text(response, "id");
    if (responseId !== undefined) {
      const known = this.#oobByResponse.get(responseId);
      if (known !== undefined) return known;
    }
    const id = text(field(response, "metadata"), "cq_id");
    return id === undefined ? undefined : this.#oob.get(id);
  }

  /** True when the event belonged to a reaction or a bridge. */
  #receiveOutOfBand(type: string, event: unknown): boolean {
    if (
      !type.startsWith("response.") &&
      !type.startsWith("output_audio_buffer.")
    ) {
      return false;
    }
    const oob = this.#outOfBandOf(event);
    if (oob === undefined) {
      // A cleared buffer without an id silences whatever was playing.
      if (type === "output_audio_buffer.cleared") {
        for (const each of this.#oob.values()) each.audioDone = true;
      }
      return false;
    }
    switch (type) {
      case "response.created": {
        const id = text(field(event, "response"), "id");
        if (id !== undefined) {
          oob.responseId = id;
          this.#oobByResponse.set(id, oob);
          // Cut before it started: cancel it the moment it has an id.
          if (oob.cancelled) {
            this.#send({ type: "response.cancel", response_id: id });
          }
        }
        break;
      }
      case "output_audio_buffer.started":
        oob.audioStarted = true;
        if (oob.cancelled) {
          this.#send({ type: "output_audio_buffer.clear" });
        } else if (this.#audio !== null && !this.#speakingSilenced) {
          this.#audio.volume =
            oob.kind === "BACKCHANNEL"
              ? this.#volume * BACKCHANNEL_GAIN
              : this.#volume;
        }
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        oob.audioDone = true;
        if (this.#audio !== null && !this.#speakingSilenced) {
          this.#audio.volume = this.#volume;
        }
        this.#settle(oob);
        break;
      case "response.output_audio_transcript.delta": {
        oob.text += text(event, "delta") ?? "";
        // Not a reaction any more (a sentence, a number): cut it.
        if (
          !oob.cancelled &&
          overlongReaction(oob.text, oob.kind === "BACKCHANNEL" ? 4 : 12)
        ) {
          this.#cancel(oob);
          if (oob.kind === "BACKCHANNEL") this.#policy.cut();
        }
        break;
      }
      case "response.output_audio_transcript.done":
        oob.text = text(event, "transcript") ?? oob.text;
        break;
      case "response.done": {
        oob.done = true;
        const response = field(event, "response");
        const id = text(response, "id");
        const usage = field(response, "usage");
        if (id !== undefined && usage !== undefined) {
          void this.#report(usageReportOf(id, usage, oob.kind));
        }
        const completed = text(response, "status") === "completed";
        if (!oob.cancelled) {
          if (oob.kind === "BACKCHANNEL") {
            if (completed) this.#policy.landed(oob.text);
            else this.#policy.dropped();
          } else if (completed && oob.text.trim().length > 0) {
            this.#recentBridges.push(oob.text.trim().slice(0, 80));
            if (this.#recentBridges.length > 3) this.#recentBridges.shift();
          }
        }
        // No audio ever came: nothing to wait for.
        if (!oob.audioStarted) oob.audioDone = true;
        this.#settle(oob);
        break;
      }
      default:
        // Function calls and everything else from a reaction are ignored.
        break;
    }
    return true;
  }

  /** Done and heard (or cut): forget it, and release a held answer. */
  #settle(oob: OutOfBand): void {
    if (!(oob.done && oob.audioDone)) return;
    this.#forget(oob);
    this.#updateBusy();
    if (oob.kind === "BRIDGE") this.#releaseAnswer();
  }

  #forget(oob: OutOfBand): void {
    this.#oob.delete(oob.id);
    if (oob.responseId !== null) this.#oobByResponse.delete(oob.responseId);
  }

  #cancel(oob: OutOfBand): void {
    oob.cancelled = true;
    if (oob.responseId !== null) {
      this.#send({ type: "response.cancel", response_id: oob.responseId });
    }
    if (oob.audioStarted && !oob.audioDone) {
      // Silenced here at once; the next turn of Q's restores it.
      if (this.#audio !== null) {
        this.#speakingSilenced = true;
        this.#audio.volume = 0;
      }
      this.#send({ type: "output_audio_buffer.clear" });
    }
  }

  /** Cut reactions (or all out-of-band speech): the person is talking. */
  #cutOutOfBand(kind: OutOfBand["kind"] | null): void {
    const waiting = this.#awaitingCommit;
    if (waiting !== null && (kind === null || kind === "BACKCHANNEL")) {
      waiting.oob.cancelled = true;
    }
    let cut = false;
    let bridgeCut = false;
    for (const oob of this.#oob.values()) {
      if (oob.cancelled || oob.done || (kind !== null && oob.kind !== kind)) {
        continue;
      }
      this.#cancel(oob);
      if (oob.kind === "BACKCHANNEL") cut = true;
      else bridgeCut = true;
    }
    if (waiting !== null && waiting.oob.cancelled) cut = true;
    if (cut && this.#policy.pending) this.#policy.cut();
    // A bridge that was cut no longer holds Q's answer back.
    if (bridgeCut) this.#releaseAnswer();
  }

  /** Q's answer waits for a bridge that is still being said. */
  #afterBridge(send: () => void): void {
    let bridging = false;
    for (const oob of this.#oob.values()) {
      if (oob.kind === "BRIDGE" && !oob.cancelled) bridging = true;
    }
    if (!bridging) {
      send();
      return;
    }
    const timer = this.#env.setTimeout(() => {
      this.#releaseAnswer();
    }, BRIDGE_HOLD_MS);
    this.#heldAnswer = { send, timer };
  }

  #releaseAnswer(): void {
    const held = this.#heldAnswer;
    if (held === null) return;
    this.#heldAnswer = null;
    this.#env.clearTimeout(held.timer);
    held.send();
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
    if (this.#meterTimer !== null) this.#env.clearTimeout(this.#meterTimer);
    this.#idleTimer = null;
    this.#maxTimer = null;
    this.#meterTimer = null;
    this.#meter?.close();
    this.#meter = null;
    if (this.#heldAnswer !== null) {
      this.#env.clearTimeout(this.#heldAnswer.timer);
      this.#heldAnswer = null;
    }
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

/** A context note for an out-of-band response: data, never the person's words. */
function systemItem(note: string): Record<string, unknown> {
  return {
    type: "message",
    role: "system",
    content: [{ type: "input_text", text: note }],
  };
}
