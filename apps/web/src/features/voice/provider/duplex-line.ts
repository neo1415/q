import type {
  QVoiceDuplexCredential,
  QVoiceDuplexEnd,
  QVoiceDuplexHeard,
  QVoiceDuplexHeardResult,
  QVoiceDuplexLineStats,
  QVoiceDuplexNarrationResult,
  QVoiceDuplexRejoin,
  QVoiceDuplexRejoinResult,
  QVoiceDuplexSaid,
  QVoiceDuplexToolCall,
  QVoiceDuplexToolResult,
  QVoiceDuplexTurnReport,
  QVoiceDuplexUsageReport,
  QVoiceDuplexUsageResult,
  QVoiceListeningLevel,
  QSilenceBeat,
  QFailureClass,
  QTurnDisposition,
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

/**
 * RECOVERY A4 (C-06): the longest a turn may stay "Thinking" before the
 * line gives up on it out loud. Past the server's ask_q deadline (30 s)
 * plus a relay's worth of slack, so the server's own words come first.
 */
export const THINKING_WATCHDOG_MS = 40_000;
/** An answer handed to the voice must start being heard within this. */
export const ANSWER_AUDIO_WATCHDOG_MS = 12_000;
/** How long a blip over Q waits for its words before it is let go (C-11). */
const BLIP_WORDS_WAIT_MS = 2_500;
/** Sounds that are not words: a blip of only these is let go. */
const NOT_WORDS = new Set([
  "mm",
  "mmm",
  "mhm",
  "mm-hmm",
  "hmm",
  "hm",
  "uh",
  "um",
  "er",
  "ah",
  "oh",
  "huh",
]);
/**
 * What the person sees (and, for a failure, hears) when a turn ends
 * without an answer. Plain words; never a provider error string.
 */
export const IGNORED_NOTICE =
  "Not answered: that didn't sound meant for me. Say it again if it was.";
export const TIMEOUT_REPAIR =
  "Sorry, that took too long on my side. Ask me again?";
export const DELIVERY_REPAIR = "Sorry, I lost my words there. Ask me again?";
const NOISE_RESUME =
  "A noise interrupted you; it was not the person speaking. Carry on with your answer from where you stopped, without repeating what you already said and without mentioning the noise.";
/**
 * C-03: small talk is answered by the voice, and only as small talk. Per
 * response, so the voice cannot drift into an answer of its own.
 */
const SMALLTALK_REPLY =
  "You are Q, the person's investment analyst, on a live call. They said something social (a greeting, thanks, an acknowledgement). Reply in a few warm, natural words, then stop. No facts, figures, names, advice or offers of your own.";

/** How one turn on the line ended (RECOVERY A4), with its timings. */
export type DuplexTurnOutcome = {
  readonly turnId: string;
  readonly disposition: QTurnDisposition;
  readonly failure?: QFailureClass | undefined;
  /** What the person is shown, when the turn ended without an answer. */
  readonly notice?: string | undefined;
  /** End of their turn to Q's first audio (answered turns). */
  readonly firstAudioMs?: number | undefined;
  /** The server relay's round trip (routed turns). */
  readonly relayMs?: number | undefined;
};

/** One accepted turn, until its terminal disposition. */
type OpenTurn = {
  readonly id: string;
  readonly seq: number;
  readonly openedAt: number;
  /** When the person's turn ended (for time to first audio). */
  readonly endedAt: number;
  /** What the server said this turn is, once its answer is handed over. */
  expected: {
    readonly disposition: QTurnDisposition;
    readonly failure?: QFailureClass | undefined;
  } | null;
  /** Its answer was asked for and must now be heard. */
  awaitingAudio: boolean;
  /** The answer's client event id, to match a provider error to it. */
  createEventId: string | null;
  /** The answer's response, once the provider created it. */
  responseId: string | null;
  /** Its answer was cancelled by a barge-in before anyone heard it. */
  interrupted: boolean;
  watchdog: unknown;
  relayMs?: number | undefined;
};

let turnCounter = 0;
function newTurnId(now: number): string {
  turnCounter += 1;
  return `turn_${now.toString(36)}${turnCounter.toString(36).padStart(4, "0")}`;
}

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
  /**
   * A tool answered in the browser, where what it acts on is (the arrival
   * briefing's card in focus). `heard` is the provider's transcript of the
   * person's own last turn, never the model's paraphrase. Null: not
   * handled here, relayed to the server as any other tool.
   */
  readonly onClientTool?:
    | ((call: {
        readonly name: string;
        readonly arguments: string;
        readonly heard: string | null;
      }) => Promise<string | null>)
    | undefined;
  /** VOICE-BRAIN: a decision card is in focus on their screen now. */
  readonly cardInFocus?: (() => boolean) | undefined;
  /** RECOVERY A4: a turn reached its terminal disposition. */
  readonly onTurnOutcome?: ((outcome: DuplexTurnOutcome) => void) | undefined;
};

/**
 * VOICE-BRAIN: how long a finished turn waits for its transcript before
 * the voice is made to hand the turn to Q (ask_q) without it.
 */
export const TRANSCRIPT_WAIT_MS = 2_500;

/** Tools the browser answers, when a handler for them is given. */
const CLIENT_TOOLS: ReadonlySet<string> = new Set(["decide_card"]);
/** How long a client tool waits for the person's own transcript. */
const OWN_WORDS_WAIT_MS = 1_500;

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
  /**
   * VOICE-BRAIN: one finished turn of theirs; the server decides who
   * answers it and returns Q's answer for a substantive one. Null: the
   * relay did not get through.
   */
  readonly heard?:
    | ((heard: QVoiceDuplexHeard) => Promise<QVoiceDuplexHeardResult | null>)
    | undefined;
  /** VOICE-BRAIN: what the voice said in one response (the transcript). */
  readonly said?: ((said: QVoiceDuplexSaid) => Promise<void>) | undefined;
  /** RECOVERY A4: each turn's disposition and timings, for the server log. */
  readonly outcome?:
    ((outcome: QVoiceDuplexTurnReport) => Promise<void>) | undefined;
  /**
   * SIDEBAND (A8): the call's id, from the SDP answer's Location header,
   * so the server can attach to the call. Absent: no sideband.
   */
  readonly attach?: ((callId: string) => Promise<void>) | undefined;
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
  /** The person's last committed audio item (their own words' key). */
  #lastCommitted: string | null = null;
  /** The provider's transcripts of the person's latest turns. */
  readonly #heard: string[] = [];
  #lastQSaid = "";
  #toolsInFlight = 0;
  /**
   * VOICE-BRAIN (founder live 2026-10-08): the server decides who answers
   * each turn; the model never answers one by itself (minted so).
   */
  readonly #routeTurns: boolean;
  /** Items already sent as part of a finished turn. */
  readonly #routedItems = new Set<string>();
  /** A finished turn waiting for its transcripts. */
  #pendingTurn: { items: string[]; last: string; timer: unknown } | null = null;
  /** Bumped by every routed turn: an older turn's answer is not said. */
  #turnSeq = 0;
  /** The voice was made to call ask_q without a transcript. */
  #forcedAskQ = false;
  readonly #recentBridges: string[] = [];
  /** Q's answer, held while a bridge finishes. */
  #heldAnswer: { send: () => void; timer: unknown } | null = null;
  /** RECOVERY A4: the turn being answered now, until it has ended. */
  #turn: OpenTurn | null = null;
  /** The person is mid-utterance (between speech_started and _stopped). */
  #userSpeaking = false;
  /**
   * An answer that came back while the person was making a sound: said
   * once the sound turns out to be noise, dropped when it is a new turn.
   */
  #heldForSpeech: {
    readonly seq: number;
    readonly generation: number;
    readonly send: () => void;
  } | null = null;
  /** A barge-in cut Q's answer: resumed if it was only a noise (C-07). */
  #cutAnswer = false;
  /** C-07: resume the cut answer once the cancel has landed. */
  #resumeAfterDone = false;
  /** A response.create refused because another was active, sent after it. */
  #queuedCreate: Record<string, unknown> | null = null;
  #createCount = 0;
  /** C-11: short sounds over Q, waiting for their words. */
  readonly #blips = new Map<string, unknown>();
  #outputMeter: LevelMeter | null = null;

  constructor(input: {
    readonly credential: QVoiceDuplexCredential;
    readonly relays: DuplexRelays;
    readonly events: DuplexLineEvents;
    readonly environment: DuplexEnvironment;
    /** BACKCHANNEL: the level to start with (device or remembered). */
    readonly listening?: QVoiceListeningLevel | undefined;
  }) {
    this.#credential = input.credential;
    this.#routeTurns =
      input.credential.routeTurns === true && input.relays.heard !== undefined;
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
      if (stream !== undefined) {
        audio.srcObject = stream;
        // C-09: Q's own level, for the presence.
        this.#outputMeter?.close();
        this.#outputMeter = this.#env.createLevelMeter?.(stream) ?? null;
      }
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
    // SIDEBAND (A8): the call's id is the last segment of the Location
    // header (/v1/realtime/calls/rtc_…); the server attaches with it.
    const callId = answered.headers.get("location")?.split("/").pop()?.trim();
    const sdp = await answered.text();
    await peer.setRemoteDescription({ type: "answer", sdp });
    await this.#withTimeout(this.#channelOpen(channel));
    if (
      callId !== undefined &&
      /^rtc_[A-Za-z0-9_-]{1,120}$/.test(callId) &&
      this.#relays.attach !== undefined
    ) {
      void this.#relays.attach(callId).catch(() => undefined);
    }
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
    this.#queuedCreate = null;
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
    if (results.length > 0) {
      this.#createResponse({});
      if (this.#turn !== null) this.#expectAnswer(this.#turn, null);
    }
  }

  #remember(role: "user" | "q", text: string): void {
    const trimmed = text.trim().slice(0, REPLAY_CHARS);
    if (trimmed.length === 0) return;
    this.#replay.push({ role, text: trimmed });
    if (this.#replay.length > REPLAY_MAX) this.#replay.shift();
  }

  /**
   * The provider's transcript of the person's last turn, waiting briefly
   * for it when the model called a tool before the transcript landed.
   */
  async #ownWords(timeoutMs: number): Promise<string | null> {
    const item = this.#lastCommitted;
    if (item === null) return this.#heard.at(-1) ?? null;
    for (let waited = 0; waited <= timeoutMs; waited += 100) {
      const said = this.#transcripts.get(item);
      if (said !== undefined) return said;
      if (this.#over) return null;
      await this.#wait(100);
    }
    return null;
  }

  /**
   * A note from the screen (the arrival briefing: a card came into focus,
   * a card was decided). Context only, never the person's words; with
   * `respond`, Q says something about it now, unless it is already
   * speaking or the person is (then it waits for the next turn).
   */
  note(text: string, respond: boolean): void {
    const words = text.trim().slice(0, 2_000);
    if (words.length === 0 || !this.#connected || this.#over) return;
    this.#send({ type: "conversation.item.create", item: systemItem(words) });
    if (
      respond &&
      !this.#responseActive &&
      !this.#speaking &&
      this.#toolsInFlight === 0
    ) {
      this.#send({ type: "response.create" });
      this.#touch();
    }
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
              // VOICE-BRAIN: on a routed line the server decides who answers.
              create_response: !this.#routeTurns,
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
        // C-17 (founder: "it sounds mechanical"): the opening's content, in
        // Q's own natural voice, never read out word for word.
        instructions: `Open the call by saying this to the person in your own natural voice, as Q. Keep every name, fact and its meaning, add nothing, and keep it about as short; then stop and listen: ${JSON.stringify(words)}`,
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
    if (this.#routeTurns) void this.#routeHeard(trimmed, null, true);
    else this.#send({ type: "response.create" });
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
    if (this.#speaking && this.#audio !== null && !this.#speakingSilenced) {
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
    this.#releaseHeld();
  }

  /** Q's audio stops now: the person is speaking. */
  #bargeIn(): void {
    if (this.#bargePending !== null) {
      this.#env.clearTimeout(this.#bargePending.timer);
      this.#bargePending = null;
    }
    this.#generation += 1;
    // C-07: what was cut is resumed if the "speech" turns out to be noise.
    const turn = this.#turn;
    if (turn !== null && turn.awaitingAudio) turn.interrupted = true;
    if (this.#speaking || this.#responseActive) this.#cutAnswer = true;
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
        // A blip that produced no commit must not delete the next real
        // turn (audit A2).
        this.#dropNextCommit = false;
        this.#userSpeaking = true;
        // C-07: a sound while Q's answer is still being generated (not yet
        // audible) is confirmed like one over Q's voice: a cough no longer
        // cancels an answer nobody has heard yet.
        if (this.#speaking || this.#responseActive) this.#maybeBargeIn();
        else this.#events.onState("USER_SPEAKING");
        this.#updateBusy();
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.#userSpeaking = false;
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
        // An unrouted line has no flush to decide: the model answers.
        if (!this.#routeTurns) this.#releaseHeld();
        break;
      case "input_audio_buffer.committed": {
        const itemId = text(event, "item_id");
        if (this.#dropNextCommit && this.#awaitingCommit === null) {
          this.#dropNextCommit = false;
          if (itemId !== undefined) this.#awaitBlipWords(itemId);
          break;
        }
        // A commit the line asked for (a reaction mid-turn) is not the
        // end of their turn; one the turn detector made is.
        const reaction = this.#awaitingCommit !== null;
        if (itemId !== undefined) {
          this.#turnItems.push(itemId);
          if (this.#turnItems.length > TURN_ITEMS_MAX) this.#turnItems.shift();
          this.#lastCommitted = itemId;
        }
        this.#committed(itemId);
        if (this.#routeTurns && !reaction && itemId !== undefined) {
          this.#turnFinished(itemId);
        } else if (!this.#routeTurns && !reaction) {
          // Unrouted: the provider answers this turn itself.
          const turn = this.#openTurn();
          this.#expectAnswer(turn, null);
        }
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
        // An empty transcript is noise: known, and nothing to answer.
        if (itemId !== undefined && !this.#transcripts.has(itemId)) {
          this.#transcripts.set(itemId, "");
        }
        if (itemId !== undefined && this.#blips.has(itemId)) {
          this.#blipWords(itemId, said);
          break;
        }
        this.#tryFlushTurn();
        break;
      }
      case "conversation.item.input_audio_transcription.failed": {
        // Not heard: the turn goes to Q without words once it times out.
        const itemId = text(event, "item_id");
        const code = text(field(event, "error"), "code");
        console.warn("[q-voice] transcription failed", { code });
        if (itemId !== undefined && this.#blips.has(itemId)) {
          this.#blipWords(itemId, "");
        }
        break;
      }
      case "response.created": {
        this.#responseActive = true;
        this.#unsilence();
        this.#updateBusy();
        const turn = this.#turn;
        const id = text(field(event, "response"), "id");
        if (turn !== null && turn.awaitingAudio && turn.responseId === null) {
          turn.responseId = id ?? null;
        }
        break;
      }
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
        this.#cutAnswer = false;
        this.#answerHeard();
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
          // VOICE-BRAIN: the line's transcript, Q's side.
          const responseId = text(event, "response_id");
          const words = said.trim().slice(0, 4_000);
          if (
            this.#relays.said !== undefined &&
            responseId !== undefined &&
            words.length > 0
          ) {
            void this.#relays
              .said({ responseId: responseId.slice(0, 128), text: words })
              .catch(() => undefined);
          }
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
        this.#responseDone(id, response);
        break;
      }
      case "error":
        this.#providerError(field(event, "error"));
        break;
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
    // C-05: a newer routed turn makes this answer stale, as a barge-in does.
    const seq = this.#turnSeq;
    const turn =
      this.#turn !== null && this.#turn.seq === seq
        ? this.#turn
        : this.#openTurn();
    turn.awaitingAudio = false;
    turn.responseId = null;
    this.#touch();
    this.#events.onState("THINKING");
    let bridge: unknown = null;
    // The person's own words, as the model passed them to Q.
    if (name === "ask_q") {
      try {
        const asked: unknown = JSON.parse(args);
        const words = text(asked, "request");
        if (words !== undefined) {
          // A routed line already showed their own words.
          if (!this.#routeTurns || this.#forcedAskQ) {
            this.#events.onLine("user", words);
          }
          this.#forcedAskQ = false;
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
      const onClientTool = this.#events.onClientTool;
      const local =
        onClientTool !== undefined && CLIENT_TOOLS.has(name)
          ? await onClientTool({
              name,
              arguments: args.slice(0, 8_000),
              heard: await this.#ownWords(OWN_WORDS_WAIT_MS),
            }).catch(() => null)
          : null;
      result =
        local !== null
          ? { output: local, approvalPending: false }
          : await this.#relays.tool({
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
    const stale = seq !== this.#turnSeq;
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
      if (generation === this.#generation && !stale) {
        this.#pendingResults.push(output);
      }
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
    // Talked over while it worked, or a newer turn came: the result is
    // kept on the line, but not said.
    if (stale) {
      if (this.#turn === turn) this.#closeTurn("SUPERSEDED");
      return;
    }
    if (generation !== this.#generation) {
      if (this.#turn === turn) this.#closeTurn("CANCELLED");
      return;
    }
    // Q chose silence: nothing for the voice to say, and it must not make
    // something up (C-01/C-03).
    if (result?.silent === true) {
      this.#ignored(turn);
      return;
    }
    const expected =
      result === null
        ? { disposition: "FAILED" as const, failure: "NETWORK" as const }
        : name === "ask_q"
          ? result.disposition === undefined
            ? null
            : { disposition: result.disposition, failure: result.failure }
          : { disposition: "ACTED" as const };
    this.#deliver(seq, generation, () => {
      this.#afterBridge(() => {
        if (this.#over || generation !== this.#generation) return;
        if (seq !== this.#turnSeq) return;
        this.#createResponse({});
        if (this.#turn === turn) this.#expectAnswer(turn, expected);
        this.#touch();
      });
    });
  }

  // -------------------------------------------------------------------
  // VOICE-BRAIN: who answers a turn is the server's decision
  // -------------------------------------------------------------------

  /** The turn detector ended their turn: route it once its words are in. */
  #turnFinished(itemId: string): void {
    const earlier = this.#pendingTurn;
    if (earlier !== null) this.#env.clearTimeout(earlier.timer);
    const items = [
      ...(earlier?.items ?? []),
      ...this.#turnItems.filter(
        (id) =>
          !this.#routedItems.has(id) && !(earlier?.items ?? []).includes(id),
      ),
    ];
    if (!items.includes(itemId)) items.push(itemId);
    for (const id of items) this.#routedItems.add(id);
    const timer = this.#env.setTimeout(() => {
      this.#flushTurn(true);
    }, TRANSCRIPT_WAIT_MS);
    this.#pendingTurn = { items, last: itemId, timer };
    this.#tryFlushTurn();
  }

  #tryFlushTurn(): void {
    const pending = this.#pendingTurn;
    if (pending === null) return;
    if (pending.items.every((id) => this.#transcripts.has(id))) {
      this.#flushTurn(false);
    }
  }

  #flushTurn(timedOut: boolean): void {
    const pending = this.#pendingTurn;
    if (pending === null) return;
    this.#pendingTurn = null;
    this.#env.clearTimeout(pending.timer);
    const words = pending.items
      .map((id) => this.#transcripts.get(id) ?? "")
      .filter((said) => said.trim().length > 0)
      .join(" ")
      .trim();
    if (words.length > 0) {
      void this.#routeHeard(words, pending.last, false);
      return;
    }
    if (!timedOut) {
      // Transcribed as nothing: noise, not a turn. Q stays quiet, unless
      // the noise cut Q's answer: then Q carries on (C-07; the standard
      // line's "[continue]" repair).
      if (this.#cutAnswer) {
        this.#resumeAfterNoise();
        return;
      }
      if (this.#heldForSpeech !== null) {
        this.#releaseHeld();
        return;
      }
      if (!this.#speaking && !this.#responseActive) {
        this.#events.onState(this.#turn === null ? "LISTENING" : "THINKING");
      }
      return;
    }
    // Their words never came: the voice must hand the turn to Q.
    this.#forceAskQ();
  }

  /** The voice may answer only by passing the turn to Q (ask_q). */
  #forceAskQ(): void {
    if (this.#over) return;
    this.#forcedAskQ = true;
    if (this.#turn === null) {
      this.#turnSeq += 1;
      this.#openTurn();
    }
    this.#createResponse({
      tool_choice: { type: "function", name: "ask_q" },
    });
    this.#touch();
  }

  async #routeHeard(
    words: string,
    itemId: string | null,
    typed: boolean,
  ): Promise<void> {
    const heard = this.#relays.heard;
    if (heard === undefined || this.#over) return;
    this.#turnSeq += 1;
    const seq = this.#turnSeq;
    // A newer turn: whatever was held for the older one is not said.
    this.#heldForSpeech = null;
    this.#cutAnswer = false;
    const turn = this.#openTurn();
    const generation = this.#generation;
    const transport = this.#transport;
    if (!typed) this.#events.onLine("user", words);
    this.#events.onState("THINKING");
    this.#touch();
    this.#toolsInFlight += 1;
    this.#updateBusy();
    // ADR 0062: a slow answer is filled by the silence ladder.
    if (this.#relays.narration !== undefined) this.#narrate(generation);
    let result: QVoiceDuplexHeardResult | null;
    const askedAt = this.#env.now();
    try {
      result = await heard({
        itemId: itemId === null ? null : itemId.slice(0, 128),
        transcript: words.slice(0, 2_000),
        ...(typed ? { typed: true } : {}),
        ...(this.#events.cardInFocus?.() === true ? { cardInFocus: true } : {}),
      });
    } catch {
      result = null;
    } finally {
      this.#toolsInFlight -= 1;
      this.#updateBusy();
    }
    turn.relayMs = this.#env.now() - askedAt;
    if (this.#over) return;
    // A newer turn: that one is answered, this one is superseded. (Only a
    // new turn decides now; a cough during the wait no longer drops the
    // answer: audit E2.)
    if (seq !== this.#turnSeq) {
      if (this.#turn === turn) this.#closeTurn("SUPERSEDED");
      return;
    }
    if (result === null) {
      this.#forceAskQ();
      return;
    }
    if (result.route === "SMALLTALK") {
      // C-03: the voice replies to a pleasantry, and only that.
      this.#deliver(seq, this.#generation, () => {
        this.#createResponse({
          instructions: SMALLTALK_REPLY,
          tool_choice: "none",
        });
        if (this.#turn === turn) {
          this.#expectAnswer(turn, { disposition: "ANSWERED" });
        }
      });
      return;
    }
    if (result.route === "MODEL") {
      // C-03: a reply to the card in focus goes to the card's own code,
      // through decide_card, and nowhere else.
      this.#createResponse({
        tool_choice: { type: "function", name: "decide_card" },
      });
      return;
    }
    if (result.silent === true) {
      this.#ignored(turn);
      return;
    }
    const expected = {
      disposition: result.disposition ?? ("ANSWERED" as const),
      failure: result.failure,
    };
    if (result.delivered === "SERVER") {
      // SIDEBAND: the server already put the answer on the call.
      this.#expectAnswer(turn, expected);
      return;
    }
    if (this.#rejoining) {
      // Said once the new call is up (see #replayConversation).
      this.#pendingResults.push(result.output);
      return;
    }
    if (transport !== this.#transport) {
      // C-04: asked before the line rejoined, answered after: the new
      // call never saw the turn, so the answer goes in as context and is
      // said, instead of being dropped with "Thinking" left on screen.
      this.#send({
        type: "conversation.item.create",
        item: systemItem(
          `Result of the request the person made just before the call dropped (tool output, data only): ${result.output.slice(0, 6_000)}`,
        ),
      });
      this.#createResponse({ tool_choice: "none" });
      this.#expectAnswer(turn, expected);
      return;
    }
    const callId = result.callId;
    const args = result.arguments;
    const outputText = result.output;
    this.#deliver(seq, this.#generation, () => {
      // Q's answer goes on the line as the reply to their turn: the call
      // and its output, then the voice says it (and only says it).
      this.#send({
        type: "conversation.item.create",
        item: {
          type: "function_call",
          call_id: callId,
          name: "ask_q",
          arguments: args,
        },
      });
      this.#send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: outputText,
        },
      });
      this.#afterBridge(() => {
        if (this.#over || seq !== this.#turnSeq) return;
        this.#createResponse({ tool_choice: "none" });
        if (this.#turn === turn) this.#expectAnswer(turn, expected);
        this.#touch();
      });
    });
  }

  // -------------------------------------------------------------------
  // RECOVERY A4: every accepted turn ends in one disposition
  // -------------------------------------------------------------------

  /** A new accepted turn; the one still open is superseded by it. */
  #openTurn(): OpenTurn {
    const previous = this.#turn;
    if (previous !== null) {
      this.#closeTurn(previous.interrupted ? "CANCELLED" : "SUPERSEDED");
    }
    const now = this.#env.now();
    const turn: OpenTurn = {
      id: newTurnId(now),
      seq: this.#turnSeq,
      openedAt: now,
      endedAt: this.#turnEndedAt ?? now,
      expected: null,
      awaitingAudio: false,
      createEventId: null,
      responseId: null,
      interrupted: false,
      watchdog: null,
    };
    this.#turn = turn;
    this.#watch(turn, THINKING_WATCHDOG_MS);
    return turn;
  }

  #watch(turn: OpenTurn, ms: number): void {
    if (turn.watchdog !== null) this.#env.clearTimeout(turn.watchdog);
    turn.watchdog = this.#env.setTimeout(() => {
      turn.watchdog = null;
      if (this.#over || this.#turn !== turn) return;
      // Still rejoining: the rejoin's own bounds decide.
      if (this.#rejoining) {
        this.#watch(turn, ms);
        return;
      }
      this.#failTurn(turn, "TIMEOUT", TIMEOUT_REPAIR);
    }, ms);
  }

  /** The answer was handed to the voice: it must now be heard. */
  #expectAnswer(turn: OpenTurn, expected: OpenTurn["expected"]): void {
    turn.expected = expected ?? turn.expected;
    turn.awaitingAudio = true;
    turn.interrupted = false;
    turn.createEventId = this.#lastCreateEventId;
    this.#watch(turn, ANSWER_AUDIO_WATCHDOG_MS);
  }

  /** Q's audio started: the turn waiting on it is answered. */
  #answerHeard(): void {
    const turn = this.#turn;
    if (turn === null || !turn.awaitingAudio) return;
    this.#closeTurn(
      turn.expected?.disposition ?? "ANSWERED",
      turn.expected?.failure,
      undefined,
      true,
    );
  }

  #ignored(turn: OpenTurn): void {
    // Q chose silence: the voice is not asked to speak (it would make up
    // a reply of its own), and the person sees why nothing was said.
    if (this.#turn === turn) {
      this.#closeTurn("IGNORED", undefined, IGNORED_NOTICE);
    }
    if (!this.#speaking && !this.#responseActive) {
      this.#events.onState("LISTENING");
    }
    this.#touch();
  }

  /** The turn could not be answered: said briefly, shown, and closed. */
  #failTurn(turn: OpenTurn, failure: QFailureClass, repair: string): void {
    if (this.#turn !== turn) return;
    this.#closeTurn("FAILED", failure, repair);
    this.#sayRepair(repair);
    if (!this.#speaking && !this.#responseActive) {
      this.#events.onState("LISTENING");
    }
  }

  #closeTurn(
    disposition: QTurnDisposition,
    failure?: QFailureClass,
    notice?: string,
    heard = false,
  ): void {
    const turn = this.#turn;
    if (turn === null) return;
    this.#turn = null;
    if (turn.watchdog !== null) this.#env.clearTimeout(turn.watchdog);
    const now = this.#env.now();
    const outcome: DuplexTurnOutcome = {
      turnId: turn.id,
      disposition,
      ...(failure === undefined ? {} : { failure }),
      ...(notice === undefined ? {} : { notice }),
      ...(heard ? { firstAudioMs: Math.max(0, now - turn.endedAt) } : {}),
      ...(turn.relayMs === undefined ? {} : { relayMs: turn.relayMs }),
    };
    // Latency per turn, in the console and on the server log (A4).
    console.info("[q-voice] turn", outcome);
    this.#events.onTurnOutcome?.(outcome);
    const report = this.#relays.outcome;
    if (report !== undefined) {
      const cap = (ms: number | undefined) =>
        ms === undefined ? undefined : Math.min(600_000, Math.round(ms));
      void report({
        turnId: outcome.turnId,
        disposition,
        ...(failure === undefined ? {} : { failure }),
        ...(outcome.firstAudioMs === undefined
          ? {}
          : { firstAudioMs: cap(outcome.firstAudioMs) }),
        ...(outcome.relayMs === undefined
          ? {}
          : { relayMs: cap(outcome.relayMs) }),
      }).catch(() => undefined);
    }
  }

  #lastCreateEventId: string | null = null;

  /** Every main response the line asks for, with an id to match errors. */
  #createResponse(response: Record<string, unknown>): void {
    this.#createCount += 1;
    const eventId = `cq_rc_${String(this.#createCount)}`;
    this.#lastCreateEventId = eventId;
    const event = {
      type: "response.create",
      event_id: eventId,
      ...(Object.keys(response).length === 0 ? {} : { response }),
    };
    this.#send(event);
  }

  /**
   * An answer that came back while the person was making a sound waits:
   * a new turn drops it, noise releases it (and Q never talks over them).
   */
  #deliver(seq: number, generation: number, send: () => void): void {
    if (this.#userSpeaking || this.#bargePending !== null) {
      this.#heldForSpeech = { seq, generation, send };
      return;
    }
    send();
  }

  #releaseHeld(): void {
    const held = this.#heldForSpeech;
    if (held === null) return;
    this.#heldForSpeech = null;
    if (this.#over || held.seq !== this.#turnSeq) return;
    // A confirmed barge-in on an unrouted line: their turn, not noise.
    if (!this.#routeTurns && held.generation !== this.#generation) return;
    held.send();
  }

  /** C-07: a noise cut Q: Q carries on, or says its held answer. */
  #resumeAfterNoise(): void {
    this.#cutAnswer = false;
    if (this.#heldForSpeech !== null) {
      this.#releaseHeld();
      return;
    }
    if (this.#speaking) return;
    if (this.#responseActive) {
      // The cancel is still landing: carry on once it has.
      this.#resumeAfterDone = true;
      return;
    }
    this.#send({
      type: "conversation.item.create",
      item: systemItem(NOISE_RESUME),
    });
    this.#createResponse({ tool_choice: "none" });
    const turn = this.#turn;
    if (turn !== null && turn.interrupted) this.#expectAnswer(turn, null);
    this.#events.onState("THINKING");
    this.#touch();
  }

  /** A main response finished: was the turn's answer ever going to be heard? */
  #responseDone(id: string | undefined, response: unknown): void {
    if (this.#resumeAfterDone) {
      this.#resumeAfterDone = false;
      this.#resumeAfterNoise();
      return;
    }
    const queued = this.#queuedCreate;
    if (queued !== null) {
      // Refused while another response was active: sent now it is done.
      this.#queuedCreate = null;
      this.#send(queued);
    }
    const turn = this.#turn;
    if (turn === null || !turn.awaitingAudio) return;
    // Only the answer's own response decides; one created before it (or a
    // refused create, which the error event reports) does not.
    if (turn.responseId === null) return;
    if (id !== undefined && turn.responseId !== id) return;
    const status = text(response, "status");
    const outputs = field(response, "output");
    const items = Array.isArray(outputs) ? (outputs as unknown[]) : [];
    const spoke = items.some((item) => text(item, "type") === "message");
    const called = items.some((item) => text(item, "type") === "function_call");
    if (status === "completed" || status === "incomplete") {
      // Audio follows the text; a tool call continues the turn.
      if (spoke) return;
      if (called) {
        turn.awaitingAudio = false;
        turn.responseId = null;
        return;
      }
    }
    if (status === "cancelled" && turn.interrupted) return;
    const reason = text(field(response, "status_details"), "reason");
    console.warn("[q-voice] response ended without speech", { status, reason });
    this.#failTurn(turn, "RESULT_DELIVERY", DELIVERY_REPAIR);
  }

  /** A realtime `error` event (C-06): never dropped silently. */
  #providerError(error: unknown): void {
    const code = text(error, "code");
    const eventId = text(error, "event_id");
    console.warn("[q-voice] realtime error", {
      type: text(error, "type"),
      code,
    });
    const turn = this.#turn;
    if (turn === null || !turn.awaitingAudio) return;
    if (eventId !== undefined && eventId !== turn.createEventId) return;
    if (eventId === undefined && turn.responseId !== null) return;
    if (code === "conversation_already_has_active_response") {
      // Asked while another response was still running: ask again once
      // it is done, rather than losing the answer.
      this.#queuedCreate = {
        type: "response.create",
        response: { tool_choice: "none" },
      };
      return;
    }
    this.#failTurn(turn, "RESULT_DELIVERY", DELIVERY_REPAIR);
  }

  /** A short repair line, out of band: never into a reply or over them. */
  #sayRepair(words: string): void {
    if (this.#over || this.#speaking || this.#responseActive) return;
    if (this.#userSpeaking) return;
    const oob = this.#newOutOfBand("BRIDGE");
    this.#sendOutOfBand(oob, {
      instructions: `Say this to the person briefly, in your own natural voice, and nothing else: "${words.replace(/"/g, "'")}"`,
      maxOutputTokens: BRIDGE_MAX_OUTPUT_TOKENS,
      input: [],
    });
  }

  /** C-11: a short sound over Q waits for its words before it is let go. */
  #awaitBlipWords(itemId: string): void {
    const said = this.#transcripts.get(itemId);
    if (said !== undefined) {
      this.#blips.set(itemId, null);
      this.#blipWords(itemId, said);
      return;
    }
    const timer = this.#env.setTimeout(() => {
      if (this.#blips.has(itemId)) this.#blipWords(itemId, "");
    }, BLIP_WORDS_WAIT_MS);
    this.#blips.set(itemId, timer);
  }

  #blipWords(itemId: string, said: string): void {
    const timer = this.#blips.get(itemId);
    this.#blips.delete(itemId);
    if (timer !== null && timer !== undefined) this.#env.clearTimeout(timer);
    if (this.#over) return;
    const words = said
      .toLowerCase()
      .replace(/[^a-z0-9'\s-]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const real = words.some((w) => !NOT_WORDS.has(w));
    if (!real) {
      // Noise or a hum: never something Q answers.
      this.#send({ type: "conversation.item.delete", item_id: itemId });
      return;
    }
    // A short real word over Q ("no", "stop", "wait"): their turn.
    if (this.#speaking || this.#responseActive) this.#bargeIn();
    this.#lastCommitted = itemId;
    if (this.#routeTurns) {
      this.#routedItems.add(itemId);
      void this.#routeHeard(said.trim(), itemId, false);
    } else {
      this.#createResponse({});
      this.#expectAnswer(this.#openTurn(), null);
    }
  }

  /** C-09: the presence's levels, 0..1. */
  inputLevel(): number {
    if (this.#muted || this.#over) return 0;
    return Math.min(1, (this.#meter?.read() ?? 0) * 4);
  }

  outputLevel(): number {
    if (this.#over || !this.#speaking) return 0;
    return Math.min(1, (this.#outputMeter?.read() ?? 0) * 4);
  }

  // -------------------------------------------------------------------
  // BACKCHANNEL
  // -------------------------------------------------------------------

  #startListening(): void {
    const microphone = this.#microphone;
    const create = this.#env.createLevelMeter;
    if (microphone === null || create === undefined) return;
    // C-09: the meter feeds the presence on every line; the pause
    // detector below only when the line listens like a person.
    this.#meter = create(microphone);
    if (this.#meter === null) return;
    if (this.#credential.listening === undefined) return;
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
          : // C-17: the beat's meaning in Q's own voice, never read out.
            `Say this softly, as a short aside while you work, in your own natural words and no longer: "${words}"`,
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
    this.#outputMeter?.close();
    this.#outputMeter = null;
    for (const timer of this.#blips.values()) {
      if (timer !== null) this.#env.clearTimeout(timer);
    }
    this.#blips.clear();
    this.#heldForSpeech = null;
    // A turn still open when the line ends is cut off with it.
    if (this.#turn !== null) this.#closeTurn("CANCELLED");
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
