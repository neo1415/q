import { z } from "zod";

/**
 * Tavus CVI behind a port (ADR 0066). The provider SDK is never used from
 * feature code; this adapter speaks the documented REST API with one
 * server-side key per client, and returns only what callers need. The key
 * is never logged, returned or sent anywhere but Tavus.
 *
 * Contract verified 2026-10-12 against docs.tavus.io/openapi.yaml and the
 * live API (read-only lists plus one test_mode lifecycle): PALs are
 * `/v2/pals` with `pal_id` and `default_face_id` (`/v2/personas`,
 * `persona_id` and `default_replica_id` are the older names and still
 * answer); a conversation takes `pal_id` + `face_id`; `require_auth`
 * returns a `meeting_token` for a private room on `tavus.daily.co`; ending
 * is `POST /v2/conversations/{id}/end`; deleting a PAL answers 204.
 */

const BASE_URL = "https://tavusapi.com";

/** The longest a meeting face may stay, whatever the caller asks. */
export const TAVUS_MEETING_MAX_SECONDS = 1_800;
const MEETING_MAX_SECONDS = TAVUS_MEETING_MAX_SECONDS;
const GOOGLE_MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}$/u;

const ConversationSchema = z
  .object({
    conversation_id: z.string().min(1).max(128),
    conversation_url: z.string().url().optional(),
    status: z.string().max(40).optional(),
  })
  .passthrough();

const ConversationCreatedSchema = ConversationSchema.extend({
  meeting_token: z.string().min(1).max(4_000).optional(),
});

const PalSchema = z
  .object({
    pal_id: z.string().min(1).max(128).optional(),
    persona_id: z.string().min(1).max(128).optional(),
  })
  .passthrough();

const FaceListSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            face_id: z.string().max(128).optional(),
            replica_id: z.string().max(128).optional(),
            face_name: z.string().max(200).optional(),
            replica_name: z.string().max(200).optional(),
            model_name: z.string().max(80).optional(),
            status: z.string().max(40).optional(),
          })
          .passthrough(),
      )
      .max(2_000),
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

export type TavusCreatedConversation = TavusConversation & {
  /** Present for a private room (`requireAuth`); joins as `?t=`. */
  readonly meetingToken: string | null;
};

export type TavusFace = {
  readonly faceId: string;
  readonly name: string;
  readonly model: string | null;
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

/**
 * Why a call failed, as far as choosing a key goes: the key is refused
 * (AUTH), its account is out of credit (CREDIT), or at a usage or
 * concurrency limit (QUOTA); anything else is OTHER.
 */
export type TavusFailureKind = "AUTH" | "CREDIT" | "QUOTA" | "OTHER";

export class TavusError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly kind: TavusFailureKind;

  constructor(
    operation: string,
    status: number,
    kind: TavusFailureKind = "OTHER",
  ) {
    // The body is never echoed: it can carry request details.
    super(`Tavus ${operation} failed with HTTP ${String(status)}`);
    this.name = "TavusError";
    this.operation = operation;
    this.status = status;
    this.kind = kind;
  }
}

/**
 * Classifies a refusal from its status and, for a 400, the provider's
 * message words ("User has reached maximum concurrent conversations"). The
 * words are matched here and dropped; they never reach a log or an error.
 */
export function tavusFailureKind(
  status: number,
  body: string,
): TavusFailureKind {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 402) return "CREDIT";
  if (status === 429) return "QUOTA";
  if (status === 400 || status === 422) {
    const words = body.slice(0, 2_000).toLowerCase();
    if (/\b(credits?|balance|payment|billing|insufficient)\b/u.test(words)) {
      return "CREDIT";
    }
    if (/\b(concurrent|quota|limit|exceeded|maximum)\b/u.test(words)) {
      return "QUOTA";
    }
  }
  return "OTHER";
}

export type TavusClient = {
  readonly createPal: (input: {
    readonly name: string;
    readonly systemPrompt: string;
    readonly faceId: string;
    readonly layers: TavusPalLayers;
    /** Spoken before the greeting and shown on screen, every call. */
    readonly disclosure?:
      { readonly spoken: string; readonly shown: string } | undefined;
    /**
     * A meeting identity (`<username>@tavusinvite.com`), required before
     * the PAL can be sent into a Google Meet. The allowlist decides who may
     * invite it by email; dispatch by API is authorised by the key alone.
     */
    readonly conferencing?:
      | {
          readonly username: string;
          readonly allowlist: readonly string[];
        }
      | undefined;
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
    /** A private room: only the holder of the returned token joins. */
    readonly requireAuth?: boolean | undefined;
  }) => Promise<TavusCreatedConversation>;
  /**
   * Sends the PAL into an existing Google Meet as a participant (Tavus
   * `meeting_url`). Its own bound: a meeting face is longer than a
   * rehearsal, so it never shares the 180 s cap above.
   */
  readonly joinMeeting: (input: {
    readonly palId: string;
    readonly faceId: string;
    readonly name: string;
    readonly meetingUrl: string;
    readonly maxCallSeconds: number;
  }) => Promise<TavusConversation>;
  /** Recovery only, on this same account; unrelated rooms never escape. */
  readonly findConversationsForPal: (
    palId: string,
  ) => Promise<readonly TavusConversation[]>;
  readonly endConversation: (conversationId: string) => Promise<void>;
  readonly getConversation: (
    conversationId: string,
  ) => Promise<TavusConversation>;
  readonly listVoices: () => Promise<readonly TavusVoice[]>;
  /** Stock (system) faces, read-only. */
  readonly listStockFaces: () => Promise<readonly TavusFace[]>;
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
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new TavusError(
        operation,
        response.status,
        tavusFailureKind(response.status, text),
      );
    }
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
        pipeline_mode: "full",
        default_face_id: input.faceId,
        ...(input.disclosure === undefined
          ? {}
          : {
              disclosure_type: "always",
              verbal_disclosure: input.disclosure.spoken,
              visual_disclosure: input.disclosure.shown,
            }),
        layers: {
          ...input.layers,
          ...(input.conferencing === undefined
            ? {}
            : {
                conferencing: {
                  username: input.conferencing.username,
                  allowlist: [...input.conferencing.allowlist],
                },
              }),
        },
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
      const raw = await call(
        "create conversation",
        "POST",
        "/v2/conversations",
        {
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
          ...(input.requireAuth === true
            ? { require_auth: true, max_participants: 2 }
            : {}),
          properties: {
            // The provider's own backstop: the call cannot outlive this.
            max_call_duration: input.maxCallSeconds,
            participant_left_timeout: 10,
            participant_absent_timeout: 90,
            enable_closed_captions: true,
          },
        },
      );
      const created = ConversationCreatedSchema.parse(raw);
      return {
        ...conversationOf(created),
        meetingToken: created.meeting_token ?? null,
      };
    },
    joinMeeting: async (input) => {
      if (
        !Number.isInteger(input.maxCallSeconds) ||
        input.maxCallSeconds < 60 ||
        input.maxCallSeconds > MEETING_MAX_SECONDS
      ) {
        throw new TavusError("meeting duration", 400);
      }
      // Only a Google Meet link leaves Capital Q: never an arbitrary URL.
      if (!GOOGLE_MEET_URL.test(input.meetingUrl)) {
        throw new TavusError("meeting link", 400);
      }
      const raw = await call("join meeting", "POST", "/v2/conversations", {
        pal_id: input.palId,
        face_id: input.faceId,
        conversation_name: input.name,
        meeting_url: input.meetingUrl,
        properties: {
          // The provider's own backstop: the face cannot outlive this.
          max_call_duration: input.maxCallSeconds,
          participant_left_timeout: 30,
          participant_absent_timeout: 120,
        },
      });
      return conversationOf(raw);
    },
    findConversationsForPal: async (palId) => {
      const schema = z.object({
        data: z
          .array(
            ConversationSchema.extend({
              pal_id: z.string().optional(),
              persona_id: z.string().optional(),
            }),
          )
          .max(100),
        total_count: z.number().int().nonnegative().optional(),
      });
      const found: TavusConversation[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const response = schema.parse(
          await call(
            "conversation recovery",
            "GET",
            `/v2/conversations?limit=100&page=${String(page)}`,
          ),
        );
        if ((response.total_count ?? 0) > 2000)
          throw new TavusError("conversation recovery bound", 503);
        found.push(
          ...response.data
            .filter((item) => (item.pal_id ?? item.persona_id) === palId)
            .map(conversationOf),
        );
        if (
          response.data.length < 100 ||
          (response.total_count !== undefined &&
            page * 100 >= response.total_count)
        )
          return found;
      }
      throw new TavusError("conversation recovery incomplete", 503);
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
    listStockFaces: async () => {
      const parsed = FaceListSchema.parse(
        await call(
          "list faces",
          "GET",
          "/v2/faces?face_type=system&verbose=true&limit=200",
        ),
      );
      return parsed.data.flatMap((face) => {
        const faceId = face.face_id ?? face.replica_id;
        if (faceId === undefined) return [];
        return [
          {
            faceId,
            name: (face.face_name ?? face.replica_name ?? "face").trim(),
            model: face.model_name ?? null,
            status: face.status ?? null,
          },
        ];
      });
    },
  };
}
