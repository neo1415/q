import { z } from "zod";

/**
 * OpenAI GPT-Live (`gpt-live-1`) as a voice provider (workstream V).
 *
 * A provider of its own, not the realtime adapter with another model id:
 * GPT-Live has a different session API (`/v1/live/sessions`), manages
 * turn-taking itself over a continuous audio stream, and hands backend
 * work to the client through delegation events instead of tool calls.
 *
 * WebRTC (docs: voice-webrtc?api=live): our server POSTs the browser's SDP
 * offer with the session config, and returns the SDP answer. There is no
 * ephemeral secret: the project key never leaves this process, never
 * appears in a log, an error or a response.
 */

export const GPT_LIVE_MODEL = "gpt-live-1" as const;
export const GPT_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
/** USD per second of session (gpt-live-1: $0.05/min, billed per second). */
export const GPT_LIVE_USD_PER_SECOND = 0.05 / 60;
/** Voices this line may ask for; the provider's catalogue names. */
export const GPT_LIVE_VOICES = ["marin", "cedar"] as const;
export type GptLiveVoice = (typeof GPT_LIVE_VOICES)[number];

export type LiveSessionConfig = {
  readonly instructions: string;
  readonly voice: GptLiveVoice;
};

export type LiveWebRtcSession = {
  /** The provider's opaque session id. */
  readonly sessionId: string;
  /** The SDP answer for the browser's peer connection. */
  readonly sdp: string;
  /** As the provider's create response named it; null when it did not. */
  readonly model: string | null;
};

export class LiveProviderError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "LiveProviderError";
    this.status = status;
  }
}

/**
 * The ai_ops ledger rows usage is written against (model_usage references
 * ai_ops.providers/models by id). gpt-live-1 has no model row yet: until
 * the lead's migration adds one, its seconds are written against the
 * OpenAI realtime voice row (20261203090000), priced at GPT-Live's own
 * per-second rate, with a `live_` correlation id that tells them apart.
 */
export const GPT_LIVE_LEDGER_PROVIDER_ID =
  "a1000000-0000-4000-8000-000000000003";
export const GPT_LIVE_LEDGER_MODEL_ID = "a2000000-0000-4000-8000-000000000023";

export type LiveVoiceProvider = {
  /** Ledger ids (ai_ops), not the provider's names. */
  readonly providerId: string;
  readonly modelId: string;
  readonly createWebRtcSession: (input: {
    readonly config: LiveSessionConfig;
    readonly sdp: string;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<LiveWebRtcSession>;
  /**
   * Ends a session from the server, whatever its browser did: attached
   * over the documented sideband and `session.close` sent. Resolves true
   * once the provider confirmed (`session.closed`), false otherwise; never
   * throws.
   */
  readonly closeSession?: ((sessionId: string) => Promise<boolean>) | undefined;
};

/**
 * The WebSocket the sideband uses (Node's own, undici): request headers as
 * a second argument. Injected in tests: no network.
 */
export type LiveSidebandSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
};
export type LiveSidebandFactory = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => LiveSidebandSocket;

function isSidebandSocket(value: unknown): value is LiveSidebandSocket {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "send") === "function" &&
    typeof Reflect.get(value, "close") === "function" &&
    typeof Reflect.get(value, "addEventListener") === "function"
  );
}

const nodeSideband: LiveSidebandFactory = (url, headers) => {
  const Ctor: unknown = Reflect.get(globalThis, "WebSocket");
  if (typeof Ctor !== "function") throw new Error("no WebSocket here");
  const socket: unknown = Reflect.construct(Ctor, [url, { headers }]);
  if (!isSidebandSocket(socket)) throw new Error("not a WebSocket");
  return socket;
};

/** Provider session ids are opaque; bounded and printable (path-safe). */
const SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/u;
const CLOSE_CONFIRM_MS = 10_000;

/** The provider's answer, validated: external data starts as unknown. */
const CreatedSchema = z.object({
  session: z.object({
    id: z.string().min(1).max(200),
    model: z.string().max(100).optional(),
  }),
  transport: z.object({ sdp: z.string().min(10).max(100_000) }),
});

/** The session body both transports share (delegation stays on the client). */
export function liveSessionBody(config: LiveSessionConfig) {
  return {
    model: GPT_LIVE_MODEL,
    instructions: config.instructions,
    // Over WebRTC the SDP negotiates the audio format; only the voice is set.
    audio: { output: { voice: config.voice } },
    delegation: { type: "client" },
  } as const;
}

export function createGptLiveProvider(options: {
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly url?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly sideband?: LiveSidebandFactory | undefined;
}): LiveVoiceProvider {
  const sideband = options.sideband ?? nodeSideband;
  const doFetch = options.fetch ?? fetch;
  const url = options.url ?? GPT_LIVE_SESSIONS_URL;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    providerId: GPT_LIVE_LEDGER_PROVIDER_ID,
    modelId: GPT_LIVE_LEDGER_MODEL_ID,
    createWebRtcSession: async ({ config, sdp, signal }) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: liveSessionBody(config),
          transport: { type: "webrtc", sdp },
        }),
        signal:
          signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
      if (response.status !== 201 && response.status !== 200) {
        // The body is the provider's and may echo request details: it is
        // never surfaced; the status is enough to act on.
        await response.body?.cancel().catch(() => undefined);
        throw new LiveProviderError(
          `live session not created (${String(response.status)})`,
          response.status,
        );
      }
      const parsed = CreatedSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new LiveProviderError("live session answer unreadable", null);
      }
      return {
        sessionId: parsed.data.session.id,
        sdp: parsed.data.transport.sdp,
        // Never filled in from what we asked for: the preview shows what the
        // provider reported, or that it reported nothing.
        model: parsed.data.session.model ?? null,
      };
    },
    // GPT-Live documents no server hangup for WebRTC sessions (the hangup
    // endpoint is for SIP calls) and no session length setting; it does
    // document attaching to a session by id over a sideband WebSocket and
    // ending it there with session.close (guides/voice-server-controls).
    closeSession: (sessionId) =>
      new Promise<boolean>((resolve) => {
        if (!SESSION_ID.test(sessionId)) {
          resolve(false);
          return;
        }
        const attach = `${url.replace(/^http/u, "ws")}/${sessionId}/attach`;
        let socket: LiveSidebandSocket;
        try {
          socket = sideband(attach, {
            authorization: `Bearer ${options.apiKey}`,
          });
        } catch {
          resolve(false);
          return;
        }
        let settled = false;
        const finish = (confirmed: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            socket.close();
          } catch {
            // Already closing.
          }
          resolve(confirmed);
        };
        const timer = setTimeout(() => {
          finish(false);
        }, CLOSE_CONFIRM_MS);
        socket.addEventListener("open", () => {
          socket.send(JSON.stringify({ type: "session.close" }));
        });
        socket.addEventListener("message", (message) => {
          const data: unknown = Reflect.get(Object(message), "data");
          if (typeof data !== "string") return;
          try {
            const event: unknown = JSON.parse(data);
            if (Reflect.get(Object(event), "type") === "session.closed") {
              finish(true);
            }
          } catch {
            // Not an event we read.
          }
        });
        socket.addEventListener("close", () => {
          finish(false);
        });
        socket.addEventListener("error", () => {
          // The close event follows.
        });
      }),
  };
}
