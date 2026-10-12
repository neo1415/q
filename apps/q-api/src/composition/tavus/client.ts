import { z } from "zod";

/**
 * Tavus CVI behind a port (ADR 0066). The provider SDK is never used from
 * feature code; this adapter speaks the documented REST API
 * (docs.tavus.io, OpenAPI read 2026-10-12) with one server-side key, and
 * returns only what callers need. The key is never logged, returned or
 * sent anywhere but Tavus.
 */

const BASE_URL = "https://tavusapi.com";

const ConversationSchema = z
  .object({
    conversation_id: z.string().min(1).max(128),
    conversation_url: z.string().url().optional(),
    status: z.string().max(40).optional(),
  })
  .passthrough();

const PalSchema = z
  .object({
    pal_id: z.string().min(1).max(128).optional(),
    persona_id: z.string().min(1).max(128).optional(),
  })
  .passthrough();

const VoiceListSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            voice_id: z.string().max(128).optional(),
            voice_name: z.string().max(200).optional(),
            name: z.string().max(200).optional(),
            language: z.string().max(80).optional(),
            languages: z.array(z.string().max(40)).optional(),
            accent: z.string().max(120).optional(),
            gender: z.string().max(40).optional(),
          })
          .passthrough(),
      )
      .max(2_000),
  })
  .passthrough();

export type TavusConversation = {
  readonly conversationId: string;
  readonly conversationUrl: string | null;
  readonly status: string | null;
};

export type TavusVoice = {
  readonly voiceId: string | null;
  readonly name: string;
  readonly language: string | null;
  readonly accent: string | null;
  readonly gender: string | null;
};

export type TavusPalLayers = {
  readonly llm: {
    readonly model: string;
    readonly base_url: string;
    readonly api_key: string;
    readonly headers?: Readonly<Record<string, string>> | undefined;
    readonly speculative_inference?: boolean | undefined;
  };
  readonly tts?: { readonly voice_id?: string | undefined } | undefined;
  readonly perception?:
    { readonly perception_model: "raven-1" | "off" } | undefined;
  readonly conversational_flow?:
    | {
        readonly turn_detection_model: "sparrow-2" | "sparrow-1";
        readonly turn_taking_patience?: "low" | "medium" | "high" | undefined;
      }
    | undefined;
};

export class TavusError extends Error {
  readonly operation: string;
  readonly status: number;

  constructor(operation: string, status: number) {
    // The body is never echoed: it can carry request details.
    super(`Tavus ${operation} failed with HTTP ${String(status)}`);
    this.name = "TavusError";
    this.operation = operation;
    this.status = status;
  }
}

export type TavusClient = {
  readonly createPal: (input: {
    readonly name: string;
    readonly systemPrompt: string;
    readonly faceId: string;
    readonly layers: TavusPalLayers;
  }) => Promise<{ readonly palId: string }>;
  readonly deletePal: (palId: string) => Promise<void>;
  readonly createConversation: (input: {
    readonly palId: string;
    readonly faceId: string;
    readonly name: string;
    readonly callbackUrl: string | null;
    readonly greeting: string | null;
    readonly context: string | null;
    readonly maxCallSeconds: number;
    readonly testMode: boolean;
  }) => Promise<TavusConversation>;
  readonly endConversation: (conversationId: string) => Promise<void>;
  readonly getConversation: (
    conversationId: string,
  ) => Promise<TavusConversation>;
  readonly listVoices: () => Promise<readonly TavusVoice[]>;
};

export function createTavusClient(dependencies: {
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
}): TavusClient {
  const doFetch = dependencies.fetch ?? fetch;
  const base = dependencies.baseUrl ?? BASE_URL;
  const timeoutMs = dependencies.timeoutMs ?? 15_000;

  async function call(
    operation: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        "x-api-key": dependencies.apiKey,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new TavusError(operation, response.status);
    const text = await response.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  const conversationOf = (raw: unknown): TavusConversation => {
    const parsed = ConversationSchema.parse(raw);
    return {
      conversationId: parsed.conversation_id,
      conversationUrl: parsed.conversation_url ?? null,
      status: parsed.status ?? null,
    };
  };

  return {
    createPal: async (input) => {
      const raw = await call("create PAL", "POST", "/v2/pals", {
        pal_name: input.name,
        system_prompt: input.systemPrompt,
        face_id: input.faceId,
        layers: input.layers,
      });
      const parsed = PalSchema.parse(raw);
      const palId = parsed.pal_id ?? parsed.persona_id;
      if (palId === undefined) throw new TavusError("create PAL", 502);
      return { palId };
    },
    deletePal: async (palId) => {
      await call(
        "delete PAL",
        "DELETE",
        `/v2/pals/${encodeURIComponent(palId)}`,
      );
    },
    createConversation: async (input) => {
      // Guard the paid provider boundary even if a caller's configuration
      // or request validation is wrong. Reconnects cannot raise this cap.
      if (
        !Number.isInteger(input.maxCallSeconds) ||
        input.maxCallSeconds < 1 ||
        input.maxCallSeconds > 180
      ) {
        throw new TavusError("conversation duration", 400);
      }
      return conversationOf(
        await call("create conversation", "POST", "/v2/conversations", {
          pal_id: input.palId,
          face_id: input.faceId,
          conversation_name: input.name,
          ...(input.callbackUrl === null
            ? {}
            : { callback_url: input.callbackUrl }),
          ...(input.greeting === null
            ? {}
            : { custom_greeting: input.greeting }),
          ...(input.context === null
            ? {}
            : { conversational_context: input.context }),
          test_mode: input.testMode,
          properties: {
            // The provider's own backstop: the call cannot outlive this.
            max_call_duration: input.maxCallSeconds,
            participant_left_timeout: 10,
            participant_absent_timeout: 90,
            enable_closed_captions: true,
          },
        }),
      );
    },
    endConversation: async (conversationId) => {
      await call(
        "end conversation",
        "POST",
        `/v2/conversations/${encodeURIComponent(conversationId)}/end`,
      );
    },
    getConversation: async (conversationId) =>
      conversationOf(
        await call(
          "read conversation",
          "GET",
          `/v2/conversations/${encodeURIComponent(conversationId)}`,
        ),
      ),
    listVoices: async () => {
      const parsed = VoiceListSchema.parse(
        await call("list voices", "GET", "/v2/voices?source=system"),
      );
      return parsed.data.map((voice) => ({
        voiceId: voice.voice_id ?? null,
        name: voice.name ?? voice.voice_name ?? "voice",
        language: voice.language ?? voice.languages?.[0] ?? null,
        accent: voice.accent ?? null,
        gender: voice.gender ?? null,
      }));
    },
  };
}
