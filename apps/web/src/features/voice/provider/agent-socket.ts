import { z } from "zod";

/**
 * The Deepgram Voice Agent socket, without the SDK's audio hop (R22).
 *
 * `@deepgram/agents`' `AgentSession` received every 20 ms frame of Q's
 * voice as an ArrayBuffer, wrapped it in a `Blob`, and then read it back
 * with `await blob.arrayBuffer()` — one frame at a time, each read waiting
 * for the one before. A Blob read is a round trip through the browser's
 * blob store that resolves on a task of its own, so how fast Q's voice
 * reached the speaker became "how often does this page have an idle
 * moment". Measured against the live agent's delivery timing on a page
 * busy rendering (scratch harness, 2026-09-26): frames reached the player
 * a median 2.8 s after they reached the browser (p95 4.8 s), and the voice
 * broke 67 times in 34 s of speech — the "game at 2 fps". Read here
 * straight off the socket, the same frames arrive with no lag at all.
 *
 * The protocol is the provider's own and small: Settings on Welcome,
 * microphone frames held until SettingsApplied, a KeepAlive, and events.
 * There is no reconnect inside this class on purpose: a line that drops is
 * reported as `disconnected`, and the interview above reconnects on the
 * same thread (`use-voice-interview`), which is the one recovery path.
 * Server messages are data and are validated before anything reads them.
 */

export const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

const KEEP_ALIVE_MS = 8_000;
/** Microphone frames kept while the agent applies its settings (~2 s). */
const MAX_HELD_FRAMES = 256;
const OPEN_TIMEOUT_MS = 10_000;
/** `WebSocket.OPEN`, without reading a global a test may not have. */
const OPEN = 1;

const Envelope = z.object({ type: z.string() }).passthrough();
const ConversationText = z.object({
  role: z.string(),
  content: z.string(),
});
const Problem = z.object({
  code: z.string().optional(),
  description: z.string().optional(),
});
const LatencyReport = z.object({
  stt_latency: z.number().nullish(),
  ttt_text_latency: z.number().nullish(),
  tts_latency: z.number().nullish(),
  total_latency: z.number().nullish(),
});

export type AgentConversationText = z.infer<typeof ConversationText>;
export type AgentProblem = z.infer<typeof Problem>;
export type AgentLatencyReport = z.infer<typeof LatencyReport>;

type AgentEvents = {
  readonly connected: [];
  readonly "settings-applied": [];
  readonly warning: [AgentProblem];
  readonly error: [AgentProblem];
  readonly "conversation-text": [AgentConversationText];
  readonly "user-started-speaking": [];
  readonly "agent-thinking": [];
  readonly "agent-started-speaking": [];
  readonly "agent-audio-done": [];
  readonly "latency-report": [AgentLatencyReport];
  readonly audio: [ArrayBuffer];
  readonly disconnected: [string];
};

type Handler<K extends keyof AgentEvents> = (...args: AgentEvents[K]) => void;

export type AgentAudioFormat = {
  readonly encoding: string;
  readonly sampleRate: number;
};

export type AgentSocketOptions = {
  /** The short-lived grant the Q API issued; never an account key. */
  readonly token: string;
  /** The agent block of the settings, composed by the Q API. */
  readonly agent: Record<string, unknown>;
  readonly input: AgentAudioFormat;
  readonly output: AgentAudioFormat;
  readonly url?: string | undefined;
  /** For tests. */
  readonly WebSocket?: typeof WebSocket | undefined;
};

export class AgentSocket {
  private readonly options: AgentSocketOptions;
  private readonly handlers = new Map<
    keyof AgentEvents,
    Set<(...args: never[]) => void>
  >();
  private socket: WebSocket | null = null;
  private applied = false;
  private held: ArrayBuffer[] = [];
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  /** Set when this side closed the line, so its close is not a drop. */
  private closing = false;

  constructor(options: AgentSocketOptions) {
    this.options = options;
  }

  on<K extends keyof AgentEvents>(event: K, handler: Handler<K>): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (...args: never[]) => void);
    this.handlers.set(event, set);
  }

  /** Resolves when the socket is open; rejects if it never opens. */
  connect(): Promise<void> {
    this.disconnect();
    this.closing = false;
    const Socket = this.options.WebSocket ?? WebSocket;
    const socket = new Socket(this.options.url ?? DEEPGRAM_AGENT_URL, [
      "bearer",
      this.options.token,
    ]);
    // Audio as ArrayBuffer: read on the message itself, never a Blob.
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const timeout = setTimeout(() => {
        if (opened) return;
        this.drop(socket);
        reject(new Error("The voice line did not open."));
      }, OPEN_TIMEOUT_MS);
      socket.onopen = () => {
        opened = true;
        clearTimeout(timeout);
        this.emit("connected");
        resolve();
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        if (this.socket !== socket) return;
        this.receive(socket, event.data);
      };
      socket.onerror = () => {
        // A close always follows; that is where the line is judged.
      };
      socket.onclose = (event) => {
        clearTimeout(timeout);
        if (!opened) reject(new Error("The voice line did not open."));
        if (this.socket !== socket) return;
        this.stop();
        this.socket = null;
        if (opened && !this.closing) {
          this.emit("disconnected", `closed ${String(event.code)}`);
        }
      };
    });
  }

  disconnect(): void {
    const socket = this.socket;
    if (socket === null) return;
    this.closing = true;
    this.drop(socket);
  }

  /** A microphone frame; held until the agent is listening. */
  sendAudio(frame: ArrayBuffer): void {
    const socket = this.socket;
    if (socket === null) return;
    if (!this.applied || socket.readyState !== OPEN) {
      this.held.push(frame);
      if (this.held.length > MAX_HELD_FRAMES) this.held.shift();
      return;
    }
    socket.send(frame);
  }

  injectUserMessage(content: string): void {
    this.sendJson({ type: "InjectUserMessage", content });
  }

  private receive(socket: WebSocket, data: unknown): void {
    if (data instanceof ArrayBuffer) {
      this.emit("audio", data);
      return;
    }
    if (typeof data !== "string") return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const envelope = Envelope.safeParse(raw);
    if (!envelope.success) return;
    const message = envelope.data;
    switch (message.type) {
      case "Welcome":
        this.sendJson({
          type: "Settings",
          audio: {
            input: {
              encoding: this.options.input.encoding,
              sample_rate: this.options.input.sampleRate,
            },
            output: {
              encoding: this.options.output.encoding,
              sample_rate: this.options.output.sampleRate,
              container: "none",
            },
          },
          agent: this.options.agent,
        });
        break;
      case "SettingsApplied": {
        this.applied = true;
        const held = this.held;
        this.held = [];
        for (const frame of held) socket.send(frame);
        this.keepAlive ??= setInterval(() => {
          this.sendJson({ type: "KeepAlive" });
        }, KEEP_ALIVE_MS);
        this.emit("settings-applied");
        break;
      }
      case "ConversationText": {
        const parsed = ConversationText.safeParse(message);
        if (parsed.success) this.emit("conversation-text", parsed.data);
        break;
      }
      case "UserStartedSpeaking":
        this.emit("user-started-speaking");
        break;
      case "AgentThinking":
        this.emit("agent-thinking");
        break;
      case "AgentStartedSpeaking":
        this.emit("agent-started-speaking");
        break;
      case "AgentAudioDone":
        this.emit("agent-audio-done");
        break;
      case "LatencyReport": {
        const parsed = LatencyReport.safeParse(message);
        if (parsed.success) this.emit("latency-report", parsed.data);
        break;
      }
      case "Warning":
        this.emit("warning", Problem.catch({}).parse(message));
        break;
      case "Error":
        this.emit("error", Problem.catch({}).parse(message));
        break;
      default:
        break;
    }
  }

  private sendJson(message: Record<string, unknown>): void {
    const socket = this.socket;
    if (socket?.readyState !== OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private emit<K extends keyof AgentEvents>(
    event: K,
    ...args: AgentEvents[K]
  ): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as Handler<K>)(...args);
    }
  }

  private drop(socket: WebSocket): void {
    this.stop();
    this.socket = null;
    try {
      socket.close(1000);
    } catch {
      // Already closed.
    }
  }

  private stop(): void {
    this.applied = false;
    this.held = [];
    if (this.keepAlive !== null) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }
}
