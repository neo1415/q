import type {
  QVoiceDuplexCredential,
  QVoiceDuplexEnd,
  QVoiceDuplexLineStats,
  QVoiceDuplexNarrationResult,
  QVoiceDuplexRejoin,
  QVoiceDuplexRejoinResult,
  QVoiceDuplexToolCall,
  QVoiceDuplexToolResult,
  QVoiceDuplexUsageReport,
  QVoiceDuplexUsageResult,
  QVoiceListeningLevel,
  QSilenceBeat,
} from "@capital-q/contracts";

import type { VoiceState } from "../session";
import {
  countersOf,
  DISCONNECTED_GRACE_MS,
  HEALTH_SAMPLE_MS,
  LINE_LOST_NOTICE,
  LineHealth,
  RECONNECTING_NOTICE,
  WEAK_LINE_NOTICE,
} from "./line-health";
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
 * Resilience (I1, Dubai demo 2026-10-05: the line handed over to the
 * slower standard voice on a hotel network; founder: "even if it has a
 * bad network, it still needs to work"). A weak line (loss, jitter, round
 * trip) is never a reason to leave: Opus FEC and a deeper playout buffer
 * carry it, and the person sees a calm notice. A transport that drops is
 * given DISCONNECTED_GRACE_MS to heal on its own, then the line REJOINS:
 * the server mints a fresh realtime call for the same line (same voice,
 * same instructions, same cap), the microphone and the speaker are kept,
 * and the recent conversation is replayed so Q carries on mid-thought.
 * The length limit rejoins the same way. Only a cap, a line the server no
 * longer knows, or MAX_REJOINS drops in one line end it with `fallback`,
 * and the caller carries on with the standard voice. Silence for the
 * idle window ends it plainly. Nothing here changes reduced motion or accessibility: audio is
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

/**
 * A slow answer gets a bridging line after this long (SUBTLE). voiceq-63
 * (founder, live 2026-10-04: "it was always talking"): at 700 ms nearly
 * every answer (3-8 s on the line) was preceded by a bridge, so Q spoke
 * before every reply. A bridge is for a pause the person has noticed.
 */
export const BRIDGE_AFTER_MS = 2_500;
/** NATURAL listening bridges a little sooner. */
export const BRIDGE_AFTER_NATURAL_MS = 1_600;
/** Reactions play quieter than Q's turns. */
export const BACKCHANNEL_GAIN = 0.6;
/** Output caps: a reaction is under a second, a bridge a short clause. */
export const BACKCHANNEL_MAX_OUTPUT_TOKENS = 40;
export const BRIDGE_MAX_OUTPUT_TOKENS = 90;
/** ADR 0062: long polls for one ask_q's beats, at most. */
const NARRATION_MAX_POLLS = 12;
const NARRATION_FIRST_POLL_MS = 600;
/** R9: reconnects in a row after a dropped poll, and the first wait. */
const NARRATION_MAX_RECONNECTS = 3;
const NARRATION_RECONNECT_MS = 800;
/**
 * W7: offline, the poll waits for the connection rather than giving up;
 * it looks again this often whether the ask_q is still running, and waits
 * at most this long in all.
 */
const NARRATION_OFFLINE_LOOK_MS = 1_000;
const NARRATION_OFFLINE_WAIT_MS = 120_000;
/** The commit a reaction waits on; past this it is dropped. */
const COMMIT_WAIT_MS = 400;
/**
 * Speech over Q must last this long to stop Q (founder live 2026-10-07:
 * the voice cut on blips). Shorter than Hume's 800 ms default: an analyst
 * on a call yields quickly to a real interjection.
 */
export const BARGE_CONFIRM_MS = 450;
/** Q's volume while it checks whether the sound is a real interruption. */
export const BARGE_DUCK_GAIN = 0.3;
/** The longest a bridge may hold Q's answer back. */
const BRIDGE_HOLD_MS = 2_500;
const TURN_ITEMS_MAX = 3;
const HEARD_MAX = 4;
/** What a line accepts as its opening; the contract caps firstMessage at 700. */
const OPENING_MAX = 700;

export type DuplexFallbackCause =
  "CONNECT" | "NETWORK" | "RELAY" | "CAP" | "MAX_LENGTH";
type RejoinCause = QVoiceDuplexRejoin["cause"];

/** Rejoins one line may make before it hands over for good. */
export const MAX_REJOINS = 6;
/** Fresh calls tried per rejoin, with a growing pause between them. */
export const REJOIN_ATTEMPTS = 4;
export const REJOIN_BACKOFF_MS = 1_000;
/** Usage reports retried before the relay counts as down. */
const REPORT_ATTEMPTS = 3;
const REPORT_BACKOFF_MS = 600;
/** Recent lines replayed into a rejoined call. */
const REPLAY_MAX = 8;
const REPLAY_CHARS = 400;
/**
 * Playout buffer on a WEAK line, in ms: words arrive a little later and
 * whole, rather than on time and clipped.
 */
export const WEAK_PLAYOUT_BUFFER_MS = 400;

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
  /**
   * I1: a calm status while the line carries on (weak, reconnecting);
   * null when it is fine again. Never a reason to switch voices.
   */
  readonly onLinkStatus?: ((status: string | null) => void) | undefined;
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
    detail?: Pick<QVoiceDuplexEnd, "cause" | "stats">,
  ) => Promise<void>;
  /**
   * I1: a fresh call for this line. Null: the server no longer knows the
   * line. Rejects: the request did not get through (try again).
   */
  readonly rejoin?:
    | ((cause: RejoinCause) => Promise<QVoiceDuplexRejoinResult | null>)
    | undefined;
  /**
   * ADR 0062: the silence ladder's beats while ask_q works (a long poll).
   * Present: they replace the model's bridging line.
   */
  readonly narration?:
    | ((after: number) => Promise<QVoiceDuplexNarrationResult | null>)
    | undefined;
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
  /** A microphone was plugged in or out; returns the unsubscribe. */
  readonly onDeviceChange?: ((handler: () => void) => () => void) | undefined;
  /** The tab came back to the foreground; returns the unsubscribe. */
  readonly onVisible?: ((handler: () => void) => () => void) | undefined;
  /** W7: whether the browser has a connection; absent means it does. */
  readonly isOnline?: (() => boolean) | undefined;
  /** W7: the connection came back; returns the unsubscribe. */
  readonly onOnline?: ((handler: () => void) => () => void) | undefined;
};

/**
 * How much audio the browser holds before playing Q's voice, in ms. A
 * little more than WebRTC's adaptive default, so a jittery line costs a
 * fraction of a second of latency rather than clipped words. Ignored by a
 * browser without the knob.
 */
export const PLAYOUT_BUFFER_MS = 150;

export function browserDuplexEnvironment(): DuplexEnvironment {
  return {
    createPeer: () => new RTCPeerConnection(),
    getMicrophone: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      }),
    fetch: (input, init) => fetch(input, init),
    onDeviceChange: (handler) => {
      const devices = navigator.mediaDevices as MediaDevices | undefined;
      if (devices === undefined) return () => undefined;
      devices.addEventListener("devicechange", handler);
      return () => {
        devices.removeEventListener("devicechange", handler);
      };
    },
    onVisible: (handler) => {
      const listener = () => {
        if (document.visibilityState === "visible") handler();
      };
      document.addEventListener("visibilitychange", listener);
      return () => {
        document.removeEventListener("visibilitychange", listener);
      };
    },
    isOnline: () => navigator.onLine !== false,
    onOnline: (handler) => {
      window.addEventListener("online", handler);
      return () => {
        window.removeEventListener("online", handler);
      };
    },
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

/** How long the provider has to answer the session offer (a slow line too). */
export const DUPLEX_CONNECT_MS = 10_000;

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
  #credential: QVoiceDuplexCredential;
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
  /** Speech started over Q; a barge-in once it lasts (BARGE_CONFIRM_MS). */
  #bargePending: { readonly timer: unknown } | null = null;
  /** The next committed input was a blip over Q: delete it, never answer it. */
  #dropNextCommit = false;
  /** The audio item Q is saying and when its playback started. */
  #item: { id: string; startedAt: number } | null = null;
  /** Bumped by every barge-in: a tool result from before it is stale. */
  #generation = 0;
  #idleTimer: unknown = null;
  #maxTimer: unknown = null;
  // Line health (founder: "the voice starts to break").
  #muted = false;
  #sender: RTCRtpSender | null = null;
  readonly #health = new LineHealth();
  #healthTimer: unknown = null;
  #graceTimer: unknown = null;
  #reacquiring = false;
  // I1: rejoining a dropped transport, and what the line measured.
  #receiver: (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | null =
    null;
  #rejoining = false;
  #rejoins = 0;
  /** Bumped by every new transport: a tool result from before it is replayed. */
  #transport = 0;
  readonly #replay: { role: "user" | "q"; text: string }[] = [];
  #turnEndedAt: number | null = null;
  readonly #firstAudio: number[] = [];
  /** Tool results that came back while the line was rejoining. */
  readonly #pendingResults: string[] = [];
  readonly #unsubscribe: (() => void)[] = [];
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
      const microphone = await this.#env.getMicrophone();
      if (this.#over) {
        for (const track of microphone.getTracks()) track.stop();
        return false;
      }
      this.#microphone = microphone;
      for (const track of microphone.getTracks()) this.#watchTrack(track);
      this.#audio = this.#env.createAudio();
      this.#audio.volume = this.#volume;
    } catch {
      this.#fallback("CONNECT", null);
      return false;
    }
    // A slow first connect gets a second chance on a fresh call before
    // the standard voice is used (the secret lives a minute at most).
    let up = false;
    if (Date.parse(this.#credential.expiresAt) > this.#env.now()) {
      up = await this.#tryConnect();
    }
    if (!up && !this.#over && this.#relays.rejoin !== undefined) {
      const fresh = await this.#relays.rejoin("NETWORK").catch(() => null);
      if (!this.#over && fresh?.credential !== undefined) {
        this.#credential = fresh.credential;
        up = await this.#tryConnect();
      }
    }
    if (!up) {
      this.#fallback("CONNECT", null);
      return false;
    }
    if (this.#over) return false;
    this.#connected = true;
    this.#events.onState("LISTENING");
    this.#touch();
    this.#transportUp();
    this.#startListening();
    const onDeviceChange = this.#env.onDeviceChange?.(() => {
      void this.#reacquireMicrophone();
    });
    if (onDeviceChange !== undefined) this.#unsubscribe.push(onDeviceChange);
    const onVisible = this.#env.onVisible?.(() => {
      this.#onVisible();
    });
    if (onVisible !== undefined) this.#unsubscribe.push(onVisible);
    return true;
  }

  async #tryConnect(): Promise<boolean> {
    try {
      await this.#connect();
      return !this.#over;
    } catch {
      this.#dropTransport();
      return false;
    }
  }

  /**
   * One realtime call on the current credential: a new peer carrying the
   * same microphone and playing into the same element. Used by `open` and
   * by every rejoin.
   */
  async #connect(): Promise<void> {
    const microphone = this.#microphone;
    const audio = this.#audio;
    if (microphone === null || audio === null) throw new Error("no media");
    const peer = this.#env.createPeer();
    this.#peer = peer;
    this.#transport += 1;
    peer.ontrack = (event) => {
      if (this.#peer !== peer) return;
      const [stream] = event.streams;
      if (stream !== undefined) audio.srcObject = stream;
      // A slightly deeper playout buffer: words are delayed, not cut.
      const receiver = event.receiver as
        (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | undefined;
      if (receiver !== undefined && "jitterBufferTarget" in receiver) {
        this.#receiver = receiver;
        this.#setPlayoutBuffer(
          this.#health.verdict === "WEAK"
            ? WEAK_PLAYOUT_BUFFER_MS
            : PLAYOUT_BUFFER_MS,
        );
      }
    };
    for (const track of microphone.getTracks()) {
      const sender = peer.addTrack(track, microphone) as
        RTCRtpSender | undefined;
      if (track.kind === "audio" && sender !== undefined) {
        this.#sender = sender;
      }
    }
    const channel = peer.createDataChannel("oai-events");
    this.#channel = channel;
    channel.onmessage = (message: MessageEvent) => {
      if (this.#channel === channel) this.#receive(message.data);
    };
    peer.onconnectionstatechange = () => {
      if (this.#peer === peer) this.#onConnectionState(peer.connectionState);
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
  }

  /** A call is up: its length limit and its health sampling start. */
  #transportUp(): void {
    this.#health.restart();
    if (this.#maxTimer !== null) this.#env.clearTimeout(this.#maxTimer);
    this.#maxTimer = this.#env.setTimeout(() => {
      this.#maxTimer = null;
      void this.#rejoin("MAX_LENGTH");
    }, this.#credential.maxSessionMs);
    this.#sampleHealth();
  }

  /** The current call is let go; the microphone and the speaker are kept. */
  #dropTransport(): void {
    for (const timer of [this.#healthTimer, this.#graceTimer, this.#maxTimer]) {
      if (timer !== null) this.#env.clearTimeout(timer);
    }
    this.#healthTimer = null;
    this.#graceTimer = null;
    this.#maxTimer = null;
    this.#cutOutOfBand(null);
    if (this.#heldAnswer !== null) {
      this.#env.clearTimeout(this.#heldAnswer.timer);
      this.#heldAnswer = null;
    }
    const peer = this.#peer;
    const channel = this.#channel;
    this.#peer = null;
    this.#channel = null;
    this.#sender = null;
    this.#receiver = null;
    this.#speaking = false;
    this.#responseActive = false;
    this.#item = null;
    this.#turnEndedAt = null;
    try {
      channel?.close();
    } catch {
      // Already closed.
    }
    try {
      peer?.close();
    } catch {
      // Already closed.
    }
  }

  /**
   * The line dropped, or reached its length: a fresh call for the same
   * line, without a word about it unless the person would notice. Bounded:
   * after MAX_REJOINS, or when the server says no (the cap, a line it no
   * longer knows), the standard voice takes over.
   */
  async #rejoin(cause: RejoinCause): Promise<void> {
    if (this.#over || this.#rejoining) return;
    const rejoin = this.#relays.rejoin;
    if (rejoin === undefined || this.#rejoins >= MAX_REJOINS) {
      this.#fallback(cause, cause === "MAX_LENGTH" ? null : LINE_LOST_NOTICE);
      return;
    }
    this.#rejoining = true;
    this.#rejoins += 1;
    const audible = cause !== "MAX_LENGTH";
    if (audible) {
      this.#events.onLinkStatus?.(RECONNECTING_NOTICE);
      this.#events.onState("CONNECTING");
    }
    this.#dropTransport();
    let up = false;
    let refusal: string | null | undefined;
    for (let attempt = 0; attempt < REJOIN_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await this.#wait(REJOIN_BACKOFF_MS * attempt);
      if (this.#over) break;
      let result: QVoiceDuplexRejoinResult | null | undefined;
      try {
        result = await rejoin(cause);
      } catch {
        // Did not get through (the network is still down): try again.
        result = undefined;
      }
      if (this.#over) break;
      if (result === undefined) continue;
      if (result === null || result.credential === undefined) {
        refusal = result?.notice ?? null;
        break;
      }
      this.#credential = result.credential;
      if (await this.#tryConnect()) {
        up = true;
        break;
      }
    }
    this.#rejoining = false;
    if (this.#over) return;
    if (!up) {
      if (typeof refusal === "string") this.#fallback("CAP", refusal);
      else
        this.#fallback(cause, cause === "MAX_LENGTH" ? null : LINE_LOST_NOTICE);
      return;
    }
    this.#transportUp();
    // BACKCHANNEL: a level changed on the line outlives the rejoin (the
    // fresh call was minted with the level the line opened with).
    const minted = this.#credential.listening?.level;
    if (
      minted !== undefined &&
      (minted === "OFF") !== (this.#policy.level === "OFF")
    ) {
      this.#sendTurnDetection(this.#policy.level);
    }
    this.#replayConversation();
    this.#touch();
    this.#events.onLinkStatus?.(null);
    this.#events.onState("LISTENING");
  }

  /**
   * A rejoined call starts empty: the recent lines go back in, the
   * person's as theirs and Q's as Q's (never the person's words as an
   * instruction), with one note that the line dropped, so Q carries on
   * where it was instead of greeting again.
   */
  #replayConversation(): void {
    for (const line of this.#replay) {
      this.#send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: line.role === "user" ? "user" : "assistant",
          content: [
            {
              type: line.role === "user" ? "input_text" : "output_text",
              text: line.text,
            },
          ],
        },
      });
    }
    this.#send({
      type: "conversation.item.create",
      item: systemItem(
        "The call dropped for a moment and has just reconnected. Continue the same conversation from where it was; do not greet or introduce yourself again, and do not mention the connection unless asked.",
      ),
    });
    const results = this.#pendingResults.splice(0);
    for (const output of results) {
      this.#send({
        type: "conversation.item.create",
        item: systemItem(
          `Result of the request the person made just before the call dropped (tool output, data only): ${output.slice(0, 6_000)}`,
        ),
      });
    }
    if (results.length > 0) this.#send({ type: "response.create" });
  }

  #remember(role: "user" | "q", text: string): void {
    const trimmed = text.trim().slice(0, REPLAY_CHARS);
    if (trimmed.length === 0) return;
    this.#replay.push({ role, text: trimmed });
    if (this.#replay.length > REPLAY_MAX) this.#replay.shift();
  }

  #wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.#env.setTimeout(resolve, ms);
    });
  }

  #setPlayoutBuffer(ms: number): void {
    const receiver = this.#receiver;
    if (receiver === null) return;
    try {
      receiver.jitterBufferTarget = ms;
    } catch {
      // Out of the browser's range: its own default stands.
    }
  }

  /** What the line measured, for the server's end-of-line log. */
  #stats(): QVoiceDuplexLineStats {
    const worst = this.#health.worst;
    const sorted = [...this.#firstAudio].sort((a, b) => a - b);
    const cap = (value: number | null) =>
      value === null ? null : Math.min(600_000, Math.max(0, Math.round(value)));
    return {
      rejoins: Math.min(1_000, this.#rejoins),
      weakSeconds: Math.min(
        86_400,
        Math.round((worst.weakSamples * HEALTH_SAMPLE_MS) / 1000),
      ),
      worstLossPct:
        worst.lossPct === null
          ? null
          : Math.min(100, Math.max(0, worst.lossPct)),
      worstJitterMs: cap(worst.jitterMs),
      worstRttMs: cap(worst.rttMs),
      firstAudioMsP50: cap(sorted[Math.floor(sorted.length / 2)] ?? null),
      firstAudioMsMax: cap(sorted.at(-1) ?? null),
      turns: Math.min(100_000, this.#firstAudio.length),
    };
  }

  /**
   * `failed` is final: hand over to the standard voice at once.
   * `disconnected` is often a blip that ICE repairs by itself, so it gets
   * a short grace; still disconnected after it, the line is handed over.
   */
  #onConnectionState(state: RTCPeerConnectionState): void {
    // Before the line is up, or while it rejoins, the connect timeout
    // decides; a state change of a call being set up is not a drop.
    if (!this.#connected || this.#rejoining) return;
    if (state === "failed") {
      void this.#rejoin("NETWORK");
      return;
    }
    if (state === "disconnected") {
      if (this.#graceTimer !== null) return;
      this.#events.onLinkStatus?.(RECONNECTING_NOTICE);
      this.#graceTimer = this.#env.setTimeout(() => {
        this.#graceTimer = null;
        const now = this.#peer?.connectionState;
        if (now !== "connected") void this.#rejoin("NETWORK");
      }, DISCONNECTED_GRACE_MS);
      return;
    }
    if (state === "connected" && this.#graceTimer !== null) {
      this.#env.clearTimeout(this.#graceTimer);
      this.#graceTimer = null;
      this.#events.onLinkStatus?.(
        this.#health.verdict === "WEAK" ? WEAK_LINE_NOTICE : null,
      );
    }
  }

  /** Packet loss, jitter and round trip, sampled while the line is up. */
  #sampleHealth(): void {
    const peer = this.#peer;
    if (peer === null || typeof peer.getStats !== "function") return;
    this.#healthTimer = this.#env.setTimeout(() => {
      this.#healthTimer = null;
      if (this.#over) return;
      peer.getStats().then(
        (report) => {
          if (this.#over || this.#peer !== peer) return;
          const was = this.#health.verdict;
          const now = this.#health.observe(countersOf(report));
          if (now !== was) {
            // Weak is ridden out, never left: a deeper buffer and a note.
            this.#setPlayoutBuffer(
              now === "WEAK" ? WEAK_PLAYOUT_BUFFER_MS : PLAYOUT_BUFFER_MS,
            );
            if (this.#graceTimer === null) {
              this.#events.onLinkStatus?.(
                now === "WEAK" ? WEAK_LINE_NOTICE : null,
              );
            }
          }
          this.#sampleHealth();
        },
        () => {
          if (!this.#over && this.#peer === peer) this.#sampleHealth();
        },
      );
    }, HEALTH_SAMPLE_MS);
  }

  /** A microphone track that ends (unplugged, taken by the system) is replaced. */
  #watchTrack(track: MediaStreamTrack): void {
    if (typeof track.addEventListener !== "function") return;
    track.addEventListener("ended", () => {
      if (!this.#over && this.#microphone?.getTracks().includes(track)) {
        void this.#reacquireMicrophone();
      }
    });
  }

  /**
   * A fresh microphone on the same line: the new track replaces the old
   * one on the sender, so the conversation carries on without a new
   * session. Mute is kept. If no microphone can be had, the line is
   * handed to the standard voice, which says so plainly.
   */
  async #reacquireMicrophone(): Promise<void> {
    const sender = this.#sender;
    if (this.#over || this.#reacquiring || sender === null) return;
    this.#reacquiring = true;
    try {
      const fresh = await this.#env.getMicrophone();
      const [track] = fresh.getAudioTracks();
      if (this.#over || track === undefined) {
        for (const old of fresh.getTracks()) old.stop();
        return;
      }
      track.enabled = !this.#muted;
      await sender.replaceTrack(track);
      const previous = this.#microphone;
      this.#microphone = fresh;
      this.#watchTrack(track);
      for (const old of previous?.getTracks() ?? []) old.stop();
    } catch {
      this.#fallback("NETWORK", null);
    } finally {
      this.#reacquiring = false;
    }
  }

  /** Back from the background: repair what broke while away. */
  #onVisible(): void {
    if (this.#over) return;
    const state = this.#peer?.connectionState;
    if (state === "failed" || state === "disconnected") {
      this.#onConnectionState(state);
      return;
    }
    const live = this.#microphone
      ?.getAudioTracks()
      .some((track) => track.readyState !== "ended");
    if (live === false) void this.#reacquireMicrophone();
  }

  /** The person ended it. */
  close(): void {
    if (this.#over) return;
    const stats = this.#stats();
    this.#finish();
    void this.#relays.end("ENDED", { stats }).catch(() => undefined);
    this.#events.onEnded("ENDED");
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
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
    this.#sendTurnDetection(level);
  }

  /** The provider's turn detector, for this listening level. */
  #sendTurnDetection(level: QVoiceListeningLevel): void {
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
              // The browser decides a barge-in (BARGE_CONFIRM_MS), so a blip
              // never cuts Q; it cancels and truncates itself.
              interrupt_response: false,
            },
          },
        },
      },
    });
  }

  /**
   * Q speaks first (founder live 2026-10-05: "I listen and it waits for me
   * to talk"). The opening -- the server's, or the question already on
   * screen -- said as written, as Q's own turn, the moment the line is up.
   * Only into a quiet line: never over the person or over a reply.
   */
  speakFirst(line: string): void {
    const words = line.trim().slice(0, OPENING_MAX);
    if (words.length === 0 || !this.#connected || this.#over) return;
    if (this.#responseActive || this.#speaking) return;
    this.#send({
      type: "response.create",
      response: {
        instructions: `Say exactly this to the person, word for word, and nothing else; then stop and listen: ${JSON.stringify(words)}`,
        tool_choice: "none",
      },
    });
    this.#events.onState("THINKING");
    this.#touch();
  }

  /**
   * Typed while the line is open: the same turn, answered aloud. Typing is
   * the person taking the turn, so a reply in flight is cut first, exactly
   * as if they had spoken over it; a second response is never started on
   * top of one still running.
   */
  sendText(words: string): void {
    const trimmed = words.trim();
    if (trimmed.length === 0 || !this.#connected) return;
    if (this.#speaking || this.#responseActive) this.#bargeIn();
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
    this.#remember("user", trimmed);
    this.#turnEndedAt = this.#env.now();
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
      // Never while Q is talking, a turn is working or the line rejoins.
      // A tool in flight is a turn working: ask_q can take 30 s and more,
      // and the line ended IDLE under the person mid-answer (live,
      // 2026-10-06 21:21:53 and 21:29:49, each ~4 s before Q answered).
      if (
        this.#speaking ||
        this.#responseActive ||
        this.#toolsInFlight > 0 ||
        this.#rejoining
      ) {
        this.#touch();
        return;
      }
      if (this.#over) return;
      const stats = this.#stats();
      this.#finish();
      void this.#relays.end("IDLE", { stats }).catch(() => undefined);
      this.#events.onEnded("IDLE");
    }, this.#credential.idleMs);
  }

  /**
   * The person may be talking over Q. Founder live 2026-10-07: "sometimes
   * the voice just cuts (not a dropped connection)" -- any VAD start (a
   * cough, a door, Q's own echo) cut Q mid-sentence at once. Now Q's
   * volume dips while it listens; only speech that lasts
   * BARGE_CONFIRM_MS is a barge-in (Hume EVI's min_interruption_ms is the
   * same idea, default 800 ms). A blip that stops sooner restores Q.
   */
  #maybeBargeIn(): void {
    if (this.#bargePending !== null) return;
    if (this.#audio !== null && !this.#speakingSilenced) {
      this.#audio.volume = this.#volume * BARGE_DUCK_GAIN;
    }
    const timer = this.#env.setTimeout(() => {
      if (this.#bargePending?.timer !== timer) return;
      this.#bargePending = null;
      this.#bargeIn();
    }, BARGE_CONFIRM_MS);
    this.#bargePending = { timer };
  }

  /** The sound stopped before it was a turn: Q is heard again. */
  #blipEnded(): void {
    const pending = this.#bargePending;
    if (pending === null) return;
    this.#env.clearTimeout(pending.timer);
    this.#bargePending = null;
    this.#dropNextCommit = true;
    if (this.#audio !== null && !this.#speakingSilenced) {
      this.#audio.volume = this.#volume;
    }
  }

  /** Q's audio stops now: the person is speaking. */
  #bargeIn(): void {
    if (this.#bargePending !== null) {
      this.#env.clearTimeout(this.#bargePending.timer);
      this.#bargePending = null;
    }
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
        this.#turnEndedAt = null;
        // The person talking cancels any reaction or bridge at once.
        this.#cutOutOfBand(null);
        if (this.#policy.turnStarted(this.#env.now())) this.#turnItems = [];
        if (this.#speaking) this.#maybeBargeIn();
        else if (this.#responseActive) this.#bargeIn();
        else this.#events.onState("USER_SPEAKING");
        this.#updateBusy();
        break;
      }
      case "input_audio_buffer.speech_stopped":
        if (this.#bargePending !== null) {
          // A blip, not a turn: Q carries on, and the blip's audio
          // never becomes something Q answers.
          this.#blipEnded();
          break;
        }
        this.#touch();
        this.#turnEndedAt = this.#env.now();
        this.#policy.turnEnded(this.#env.now());
        this.#events.onState("THINKING");
        break;
      case "input_audio_buffer.committed": {
        const itemId = text(event, "item_id");
        if (this.#dropNextCommit && this.#awaitingCommit === null) {
          this.#dropNextCommit = false;
          if (itemId !== undefined) {
            this.#send({ type: "conversation.item.delete", item_id: itemId });
          }
          break;
        }
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
          this.#remember("user", said);
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
        // Time to first audio: the end of the person's turn to Q's voice.
        if (this.#turnEndedAt !== null) {
          this.#firstAudio.push(this.#env.now() - this.#turnEndedAt);
          if (this.#firstAudio.length > 500) this.#firstAudio.shift();
          this.#turnEndedAt = null;
        }
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
        if (this.#bargePending !== null) {
          // Q finished while they started: their speech is simply their
          // turn now, nothing to interrupt.
          this.#env.clearTimeout(this.#bargePending.timer);
          this.#bargePending = null;
          if (this.#audio !== null && !this.#speakingSilenced) {
            this.#audio.volume = this.#volume;
          }
          this.#events.onState("USER_SPEAKING");
          this.#touch();
          this.#updateBusy();
          break;
        }
        this.#events.onState("LISTENING");
        this.#touch();
        this.#updateBusy();
        break;
      case "response.output_audio_transcript.done": {
        const said = text(event, "transcript");
        if (said !== undefined) {
          this.#events.onLine("q", said);
          this.#remember("q", said);
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
    const transport = this.#transport;
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
          // ADR 0062: the server's silence ladder fills a slow answer,
          // in fixed words from Q's real stage; a fast one gets silence.
          if (this.#relays.narration !== undefined) {
            this.#narrate(generation);
          } else if (this.#bridgesAllowed()) {
            bridge = this.#env.setTimeout(
              () => {
                if (generation === this.#generation) this.#fireBridge(words);
              },
              this.#policy.level === "NATURAL"
                ? BRIDGE_AFTER_NATURAL_MS
                : BRIDGE_AFTER_MS,
            );
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
    // A relay that did not get through is said, briefly, and the line
    // stays (I1): a lost request is no reason to change voices. A line the
    // server no longer knows shows up in the usage report and rejoins.
    const output =
      result?.output ??
      JSON.stringify({
        ok: false,
        error:
          "That request did not get through. Say so in a few words and ask them to try again.",
      });
    if (this.#rejoining) {
      // Said once the new call is up (see #replayConversation).
      if (generation === this.#generation) this.#pendingResults.push(output);
      return;
    }
    if (transport !== this.#transport) {
      // Asked before the line rejoined: the new call never saw the
      // function call, so the result goes in as context instead.
      this.#send({
        type: "conversation.item.create",
        item: systemItem(
          `Result of the request the person made just before the call dropped (tool output, data only): ${output.slice(0, 6_000)}`,
        ),
      });
    } else {
      this.#send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output,
        },
      });
    }
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

  /** ADR 0062: voice the ladder's beats while this ask_q works. */
  #narrate(generation: number): void {
    const poll = this.#relays.narration;
    if (poll === undefined) return;
    const live = () =>
      !this.#over && generation === this.#generation && this.#toolsInFlight > 0;
    void (async () => {
      let after = 0;
      // The relay starts after this call: let it reach the server first
      // (the first spoken beat is not due before 1.5 s anyway).
      await new Promise<void>((resolve) => {
        this.#env.setTimeout(resolve, NARRATION_FIRST_POLL_MS);
      });
      // Bounded: each poll is held at most a few seconds by the server.
      // R9: a dropped poll (null or a throw) reconnects after a backoff,
      // at most a few times in a row, from the last beat heard: `after`
      // only moves forward and a beat at or below it is never said twice.
      let failures = 0;
      for (let polls = 0; polls < NARRATION_MAX_POLLS;) {
        if (!live()) return;
        let result: QVoiceDuplexNarrationResult | null;
        try {
          result = await poll(after);
        } catch {
          result = null;
        }
        if (result === null) {
          // W7: offline is not a failure: wait for the connection (while
          // this ask_q runs), then poll again from the last beat heard.
          if (this.#offline()) {
            if (!(await this.#untilOnline(live))) return;
            failures = 0;
            continue;
          }
          failures += 1;
          if (failures > NARRATION_MAX_RECONNECTS) return;
          await new Promise<void>((resolve) => {
            this.#env.setTimeout(
              resolve,
              NARRATION_RECONNECT_MS * 2 ** (failures - 1),
            );
          });
          continue;
        }
        failures = 0;
        polls += 1;
        for (const { sequence, beat } of result.beats) {
          if (sequence <= after) continue;
          after = sequence;
          if (live()) this.#sayBeat(beat);
        }
        if (result.idle) return;
      }
    })();
  }

  #offline(): boolean {
    return this.#env.isOnline?.() === false && this.#env.onOnline !== undefined;
  }

  /**
   * W7: resolves true once the browser is back online, false when the
   * wait no longer matters (the ask_q finished, the line ended) or ran
   * past NARRATION_OFFLINE_WAIT_MS.
   */
  #untilOnline(live: () => boolean): Promise<boolean> {
    const subscribe = this.#env.onOnline;
    if (subscribe === undefined) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let handle: unknown = null;
      let stop: () => void = () => undefined;
      const started = this.#env.now();
      const done = (online: boolean) => {
        if (settled) return;
        settled = true;
        stop();
        if (handle !== null) this.#env.clearTimeout(handle);
        resolve(online);
      };
      stop = subscribe(() => done(true));
      if (settled) stop();
      const look = () => {
        if (!live()) return done(false);
        if (this.#env.isOnline?.() !== false) return done(true);
        if (this.#env.now() - started >= NARRATION_OFFLINE_WAIT_MS) {
          return done(false);
        }
        handle = this.#env.setTimeout(look, NARRATION_OFFLINE_LOOK_MS);
      };
      look();
    });
  }

  /** One beat, in fixed words, out of band: nothing enters the conversation. */
  #sayBeat(beat: QSilenceBeat): void {
    if (beat.kind === "TONE") return;
    if (this.#over || this.#speaking || this.#responseActive) return;
    const oob = this.#newOutOfBand("BRIDGE");
    const words = beat.text.replace(/"/g, "'");
    this.#sendOutOfBand(oob, {
      instructions:
        beat.kind === "HUM"
          ? `Hum softly and briefly, like someone thinking while they work ("${words}"). No words.`
          : `Say exactly this, warmly and quietly, and nothing else: "${words}"`,
      maxOutputTokens: BRIDGE_MAX_OUTPUT_TOKENS,
      input: [],
    });
    this.#updateBusy();
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
    // Retried: the server counts each response once, so a report that did
    // not get through on a bad line is simply sent again (I1).
    let result: QVoiceDuplexUsageResult | null = null;
    for (let attempt = 0; attempt < REPORT_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await this.#wait(REPORT_BACKOFF_MS * attempt);
      if (this.#over) return;
      try {
        result = await this.#relays.usage(report);
      } catch {
        result = null;
      }
      if (result !== null) break;
    }
    if (this.#over) return;
    if (result === null) {
      // Usage that cannot be counted cannot be capped: the line rejoins,
      // and the server decides whether it may carry on.
      void this.#rejoin("RELAY");
      return;
    }
    if (!result.continue) {
      // The cap says so in a sentence and ends the line; anything else
      // (its length) is a fresh call on the same line.
      if (result.notice !== undefined) this.#fallback("CAP", result.notice);
      else void this.#rejoin("MAX_LENGTH");
    }
  }

  #fallback(cause: DuplexFallbackCause, notice: string | null): void {
    if (this.#over) return;
    const connected = this.#connected;
    const stats = this.#stats();
    this.#finish();
    void this.#relays
      .end(cause === "MAX_LENGTH" ? "MAX_LENGTH" : "FALLBACK", { cause, stats })
      .catch(() => undefined);
    this.#events.onFallback({ cause, notice, connected });
  }

  #finish(): void {
    this.#over = true;
    this.#connected = false;
    if (this.#bargePending !== null) {
      this.#env.clearTimeout(this.#bargePending.timer);
      this.#bargePending = null;
    }
    if (this.#idleTimer !== null) this.#env.clearTimeout(this.#idleTimer);
    if (this.#maxTimer !== null) this.#env.clearTimeout(this.#maxTimer);
    if (this.#meterTimer !== null) this.#env.clearTimeout(this.#meterTimer);
    if (this.#healthTimer !== null) this.#env.clearTimeout(this.#healthTimer);
    if (this.#graceTimer !== null) this.#env.clearTimeout(this.#graceTimer);
    this.#healthTimer = null;
    this.#graceTimer = null;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
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
