import { ModelProviderFailure } from "../errors.js";
import type {
  RealtimePrices,
  RealtimeSessionGrant,
  RealtimeSessionProvider,
} from "./index.js";

/**
 * OpenAI's Realtime API behind the realtime adapter (DUPLEX).
 *
 * The server mints a client secret (`POST /v1/realtime/client_secrets`)
 * with the whole session configured on it: model, instructions, the tools
 * the Tool Registry offered for this plan, the voice, turn detection that
 * interrupts Q when the person speaks, and a per-response output cap. The
 * browser opens WebRTC with that secret against `/v1/realtime/calls` and
 * never sees the API key. Input transcription (a small second model) is
 * requested only when the line listens like a person (BACKCHANNEL): the
 * transcripts give Q's reactions their context and give the memory Write
 * Gate the person's own words to check a spoken preference against. Its
 * usage is reported per item and priced at its own rates.
 *
 * Prompt caching is the provider's automatic prefix cache: the
 * instructions put the stable charter first and the per-line context last,
 * and tools keep the registry's order, so the prefix repeats.
 */
export const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
const CLIENT_SECRETS_ENDPOINT =
  "https://api.openai.com/v1/realtime/client_secrets";
export const OPENAI_REALTIME_CALLS_URL =
  "https://api.openai.com/v1/realtime/calls";

/** USD per million tokens (developers.openai.com/api/docs/pricing, 2026-10-04). */
export const OPENAI_REALTIME_MINI_PRICES: RealtimePrices = {
  textInput: 0.6,
  cachedTextInput: 0.06,
  textOutput: 2.4,
  audioInput: 10,
  cachedAudioInput: 0.3,
  audioOutput: 20,
};

/**
 * The input transcription model, and its prices (2026-10-08). On a routed
 * line every word Q acts on comes from this transcript, so it is the full
 * model, not mini: the founder's "find anything that needs my attention"
 * came back from mini as "Fidiani inanituma attention" (live 11:13 UTC).
 */
export const OPENAI_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
export const OPENAI_TRANSCRIBE_PRICES: RealtimePrices = {
  textInput: 2.5,
  cachedTextInput: 2.5,
  textOutput: 10,
  audioInput: 6,
  cachedAudioInput: 6,
  audioOutput: 0,
};

/** Q's two voices, in the provider's catalogue. */
const VOICES = { FEMALE: "marin", MALE: "cedar" } as const;

export function createOpenAIRealtimeProvider(options: {
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly modelCode?: string | undefined;
  readonly prices?: RealtimePrices | undefined;
}): RealtimeSessionProvider {
  const call = options.fetch ?? fetch;
  return {
    code: "openai",
    modelCode: options.modelCode ?? OPENAI_REALTIME_MODEL,
    providerId: "a1000000-0000-4000-8000-000000000003",
    // 20261203090000_model_usage_voice_realtime.sql
    modelId: "a2000000-0000-4000-8000-000000000022",
    prices: options.prices ?? OPENAI_REALTIME_MINI_PRICES,
    transcription: {
      modelCode: OPENAI_REALTIME_TRANSCRIBE_MODEL,
      prices: OPENAI_TRANSCRIBE_PRICES,
    },
    mint: async (request, context): Promise<RealtimeSessionGrant> => {
      let response: Response;
      try {
        response = await call(CLIENT_SECRETS_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expires_after: {
              anchor: "created_at",
              seconds: request.secretTtlSeconds,
            },
            session: {
              type: "realtime",
              model: request.modelCode,
              instructions: request.instructions,
              output_modalities: ["audio"],
              max_output_tokens: request.maxOutputTokens,
              tool_choice: "auto",
              tools: request.tools.map((tool) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.inputJsonSchema,
              })),
              audio: {
                input: {
                  // AUTO waits a little longer on a turn that sounds
                  // unfinished, which is where Q's reactions go.
                  turn_detection: {
                    type: "semantic_vad",
                    eagerness:
                      request.turnEagerness === "AUTO" ? "auto" : "high",
                    // VOICE-BRAIN: on a routed line the server decides who
                    // answers each turn; the model never answers by itself.
                    create_response: request.routeTurns !== true,
                    // Not the provider: the browser confirms a barge-in after
                    // sustained speech (BARGE_CONFIRM_MS) and then cancels and
                    // truncates itself, so a cough or echo never cuts Q
                    // mid-sentence (founder live 2026-10-07).
                    interrupt_response: false,
                  },
                  ...(request.transcribeInput === true
                    ? {
                        transcription: {
                          model: OPENAI_REALTIME_TRANSCRIBE_MODEL,
                          ...(request.transcriptionHint?.language === undefined
                            ? {}
                            : {
                                language: request.transcriptionHint.language,
                              }),
                          ...(request.transcriptionHint?.prompt === undefined
                            ? {}
                            : { prompt: request.transcriptionHint.prompt }),
                        },
                      }
                    : {}),
                },
                output: {
                  voice: VOICES[request.voice],
                  ...(request.speechSpeed === undefined
                    ? {}
                    : {
                        speed: Math.min(
                          1.5,
                          Math.max(0.25, request.speechSpeed),
                        ),
                      }),
                },
              },
            },
          }),
          signal: context.signal,
        });
      } catch (error) {
        throw new ModelProviderFailure(
          "openai realtime secret request failed",
          {
            failureClass: "TRANSIENT",
            providerCode: "openai",
            cause: error,
          },
        );
      }
      if (!response.ok) {
        throw new ModelProviderFailure("openai realtime secret refused", {
          failureClass:
            response.status === 429
              ? "RATE_LIMIT"
              : response.status === 401 || response.status === 403
                ? "AUTHENTICATION"
                : response.status === 400
                  ? "INVALID_REQUEST"
                  : "PROVIDER_OUTAGE",
          providerCode: "openai",
          providerStatus: response.status,
        });
      }
      const body: unknown = await response.json().catch(() => null);
      const value: unknown = Reflect.get(Object(body), "value");
      const expiresAt: unknown = Reflect.get(Object(body), "expires_at");
      if (typeof value !== "string" || value.length === 0) {
        throw new ModelProviderFailure("openai realtime secret was empty", {
          failureClass: "INVALID_MODEL_OUTPUT",
          providerCode: "openai",
        });
      }
      return {
        clientSecret: value,
        expiresAt:
          typeof expiresAt === "number" && Number.isFinite(expiresAt)
            ? new Date(expiresAt * 1000)
            : new Date(Date.now() + request.secretTtlSeconds * 1000),
        callsUrl: OPENAI_REALTIME_CALLS_URL,
      };
    },
  };
}

/**
 * SIDEBAND (RECOVERY A8; developers.openai.com/api/docs/guides/
 * realtime-server-controls, read 2026-10-08). The browser's SDP answer
 * carries the call's id in its Location header (`/v1/realtime/calls/
 * rtc_…`); the server attaches to that call over a WebSocket with its own
 * key and receives the call's events, and can add items and ask for
 * responses. The key never leaves the server. NOT VERIFIED ON A LIVE CALL:
 * the guide documents `session.update` and tool results on this socket;
 * `conversation.item.create` and `response.create` are the same events the
 * data channel carries and are assumed to behave the same.
 */
export const OPENAI_REALTIME_SIDEBAND_URL = "wss://api.openai.com/v1/realtime";

/** One attached sideband socket, as the broker sees it. */
export type RealtimeSidebandSocket = {
  readonly send: (event: Readonly<Record<string, unknown>>) => void;
  readonly close: () => void;
};

export type RealtimeSidebandHandlers = {
  readonly onEvent: (event: unknown) => void;
  /** The socket closed; `clean` when this side closed it. */
  readonly onClose: (clean: boolean) => void;
};

/** Attaches to one call by its id; rejects when the socket never opens. */
export type RealtimeSidebandConnector = (
  callId: string,
  handlers: RealtimeSidebandHandlers,
) => Promise<RealtimeSidebandSocket>;

/** The few WebSocket members used, so a test can pass a fake. */
export type SidebandWebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
};

export type SidebandWebSocketFactory = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => SidebandWebSocketLike;

const OPEN = 1;
const SIDEBAND_OPEN_MS = 10_000;
const CALL_ID = /^rtc_[A-Za-z0-9_-]{1,120}$/;

function isSocketLike(value: unknown): value is SidebandWebSocketLike {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof Reflect.get(value, "send") === "function" &&
    typeof Reflect.get(value, "close") === "function" &&
    typeof Reflect.get(value, "addEventListener") === "function"
  );
}

/**
 * Node's own WebSocket (undici), which accepts request headers as a second
 * argument; no new dependency.
 */
export const nodeSidebandWebSocket: SidebandWebSocketFactory = (
  url,
  headers,
) => {
  const Ctor: unknown = Reflect.get(globalThis, "WebSocket");
  if (typeof Ctor !== "function") throw new Error("no WebSocket here");
  const socket: unknown = Reflect.construct(Ctor, [url, { headers }]);
  if (!isSocketLike(socket)) throw new Error("not a WebSocket");
  return socket;
};

export function createOpenAISidebandConnector(options: {
  readonly apiKey: string;
  readonly url?: string | undefined;
  readonly webSocket?: SidebandWebSocketFactory | undefined;
  readonly openTimeoutMs?: number | undefined;
}): RealtimeSidebandConnector {
  const create = options.webSocket ?? nodeSidebandWebSocket;
  return (callId, handlers) => {
    if (!CALL_ID.test(callId)) {
      return Promise.reject(new Error("not a realtime call id"));
    }
    const url = `${options.url ?? OPENAI_REALTIME_SIDEBAND_URL}?call_id=${encodeURIComponent(callId)}`;
    let socket: SidebandWebSocketLike;
    try {
      socket = create(url, { authorization: `Bearer ${options.apiKey}` });
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : new Error("sideband not opened"),
      );
    }
    let closedHere = false;
    return new Promise<RealtimeSidebandSocket>((resolve, reject) => {
      let opened = false;
      const timer = setTimeout(() => {
        if (opened) return;
        closedHere = true;
        socket.close();
        reject(new Error("sideband did not open"));
      }, options.openTimeoutMs ?? SIDEBAND_OPEN_MS);
      socket.addEventListener("open", () => {
        opened = true;
        clearTimeout(timer);
        resolve({
          send: (event) => {
            if (socket.readyState === OPEN) socket.send(JSON.stringify(event));
          },
          close: () => {
            closedHere = true;
            socket.close();
          },
        });
      });
      socket.addEventListener("message", (message) => {
        const data: unknown = Reflect.get(Object(message), "data");
        if (typeof data !== "string") return;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }
        handlers.onEvent(event);
      });
      socket.addEventListener("close", () => {
        clearTimeout(timer);
        if (!opened) {
          reject(new Error("sideband closed before it opened"));
          return;
        }
        handlers.onClose(closedHere);
      });
      socket.addEventListener("error", () => {
        // The close event follows and decides.
      });
    });
  };
}
