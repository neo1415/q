import { randomBytes, randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  CreateQSpeechRequestSchema,
  CreateQVoiceSessionRequestSchema,
  CreateQVoiceSessionResponseSchema,
  parseContract,
  Q_VOICE_SESSIONS_PATH,
  Q_VOICE_SPEECH_PATH,
  Q_VOICE_TURN_PATH,
  QVoiceTurnStateSchema,
} from "@capital-q/contracts";
import { fetchMe } from "@capital-q/api-client";
import { createCorrelationId, getMeter } from "@capital-q/observability";
import { AuthenticationRequiredError } from "@capital-q/security";
import { signupContextFromToken } from "./interviewer.js";
import { extractBearerToken } from "@capital-q/security/supabase";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import {
  VOICE_CONNECT_WINDOW_MS,
  VoiceSessionLimitError,
  type VoiceSessionBindings,
} from "./bindings.js";
import type { Interviewer } from "./interviewer.js";
import type { RealtimeVoiceProvider } from "./provider.js";
import type {
  DeepgramAgentSettings,
  DeepgramVoiceProvider,
} from "./providers/deepgram.js";
import {
  SpeechSynthesisError,
  createSpeechThrottle,
  type SpeechSynthesisPort,
  type SpeechThrottle,
} from "./synthesis.js";
import type { VoiceTurnBoard } from "./turn-board.js";
import type { WelcomeHost } from "./welcome.js";
import type { ActorContext } from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

/**
 * `POST /v1/q/voice/sessions` (CQ-Q-VOICE-001 C §31, §34; doc 12 §7.2,
 * §36.3).
 *
 * A normal protected request: the session is verified, the actor and
 * tenant are resolved on the server, the body is the strict public
 * contract. Then, before the microphone can open, the provider issues one
 * ephemeral conversation credential and the server binds that conversation
 * to this actor and to the thread the body names. What the browser gets
 * back grants audio transport with the provider and nothing in Capital Q;
 * the provider API key is never in the response, a log, or the token.
 *
 * The person's own bearer token is kept with the binding, in memory, so a
 * spoken interview answer reaches the application API with exactly the
 * authority a typed one has. It is never written anywhere else.
 */

export type QVoiceRoutesDependencies = ActorContextDependencies & {
  /** The ElevenLabs transport, when composed. */
  readonly provider?: RealtimeVoiceProvider | undefined;
  /** The Deepgram transport, when composed; preferred when both exist. */
  readonly deepgram?: DeepgramVoiceProvider | undefined;
  readonly bindings: VoiceSessionBindings;
  /** Composes Q's opening line for an interview session, when present. */
  readonly interviewer?: Interviewer | undefined;
  /** The application API origin, needed for the opening line. */
  readonly apiBaseUrl?: string | undefined;
  /** The turn board, for the screen to read what Q is asking. */
  readonly board?: VoiceTurnBoard | undefined;
  /** Q's first minute with a new person. */
  readonly welcome?: WelcomeHost | undefined;
  /** One-way synthesis, when composed: Q reads a line, nothing listens. */
  readonly speech?: SpeechSynthesisPort | undefined;
  /** How often one person may ask for that; composed here so a test can drive it. */
  readonly speechThrottle?: SpeechThrottle | undefined;
  readonly now?: (() => number) | undefined;
  /**
   * When present, a person with no organisation yet may still talk with Q
   * (arrival, the open thread) under a personal context; the interview and
   * subject-bound threads resolve their organisation as everywhere else.
   */
  readonly identity?: ApplicationIdentityLookup | undefined;
  /** Names this person taught Q to hear (ADR 0012), for the recogniser. */
  readonly memory?:
    | { readonly termsFor: (actor: ActorContext) => Promise<readonly string[]> }
    | undefined;
};

export function registerQVoiceRoutes(
  app: FastifyInstance,
  dependencies: QVoiceRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  const now = dependencies.now ?? Date.now;
  const meter = getMeter("@capital-q/q-api");
  const started = meter.createCounter("q.voice.session.issued", {
    description: "Voice session credentials issued, by voice",
  });
  const spokenLines = meter.createCounter("q.voice.speech.synthesised", {
    description: "One-way spoken lines synthesised, by voice",
  });
  const throttle = dependencies.speechThrottle ?? createSpeechThrottle();

  // What Q is asking after its latest spoken turn: the owner's own
  // session only; anyone else sees the same 404 as a session that does
  // not exist.
  app.get(
    Q_VOICE_TURN_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const params = request.params as { voiceSessionId?: string };
      const id = params.voiceSessionId ?? "";
      const binding = dependencies.bindings.byVoiceSessionId(id);
      if (binding === null || binding.actor.userId !== actor.userId) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Not found",
          status: 404,
          detail: "No such voice session.",
        });
      }
      const state = dependencies.board?.read(id) ?? {
        sequence: 0,
        asking: null,
        navigate: null,
        handoff: null,
        degraded: false,
      };
      return reply.code(200).send(QVoiceTurnStateSchema.parse(state));
    },
  );

  /**
   * `POST /v1/q/voice/speech` — Q reads one line aloud
   * (Q-FIRST-RUN-TTS-001).
   *
   * A normal protected request that happens to answer with audio. It
   * opens nothing, binds nothing and records nothing: there is no
   * session, no thread, no conversation and no microphone anywhere in
   * this path, which is the entire reason it exists separately from the
   * voice session above.
   *
   * The body is the strict public contract, so the text is bounded before
   * a provider is addressed, and the allowance is charged against the
   * server-resolved actor rather than anything the caller chose. What
   * comes back is bytes and a media type. What never does is the
   * provider's name, status or complaint.
   */
  app.post(
    Q_VOICE_SPEECH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const speech = dependencies.speech;
      if (speech === undefined) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Q can't speak on this build.",
        });
      }
      const actor = getActorContext(request);
      const input = parseContract(
        CreateQSpeechRequestSchema,
        request.body ?? {},
        "The speech request is not valid.",
      );
      if (!throttle.charge(`${actor.tenantId}:${actor.userId}`)) {
        return reply.code(429).send({
          type: "about:blank",
          title: "Too Many Requests",
          status: 429,
          detail: "That is more speech than Q will read out just now.",
        });
      }
      const voice = speech.voices.includes(input.voice)
        ? input.voice
        : "FEMALE";
      try {
        const spoken = await speech.synthesise({ text: input.text, voice });
        spokenLines.add(1, { voice });
        return (
          reply
            .code(200)
            .header("content-type", spoken.mediaType)
            // Audio of whatever this person asked to hear, under their own
            // session: never a shared cache's to keep.
            .header("cache-control", "no-store")
            .send(Buffer.from(spoken.audio))
        );
      } catch (error) {
        if (error instanceof SpeechSynthesisError) {
          // Hearing Q is an offer, and a refused offer is not an error a
          // person has to do anything about. The screen keeps the words.
          return reply.code(503).send({
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
            detail: "Q can't speak right now.",
          });
        }
        throw error;
      }
    },
  );

  app.post(
    Q_VOICE_SESSIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const input = parseContract(
        CreateQVoiceSessionRequestSchema,
        request.body ?? {},
        "The voice session request is not valid.",
      );
      const header = request.headers.authorization;
      const accessToken = extractBearerToken(
        typeof header === "string" ? header : undefined,
      );
      if (accessToken === null) {
        // The hook already authenticated; a missing bearer here would be a
        // hook that changed. Fail closed rather than bind without authority.
        throw new AuthenticationRequiredError();
      }
      const deepgram = dependencies.deepgram;
      const elevenLabs = dependencies.provider;
      const transport = deepgram ?? elevenLabs;
      if (transport === undefined) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Voice isn't available on this build.",
        });
      }
      const voice = transport.voices.includes(input.voice)
        ? input.voice
        : "FEMALE";

      // Q opens the interview in its own words: a greeting and the live
      // question, from the session's state. Composed here so the browser
      // can hand it to the provider as the first thing Q says.
      let firstMessage: string | undefined;
      const interviewer = dependencies.interviewer;
      const apiBaseUrl = dependencies.apiBaseUrl;
      let knownName: string | null = null;
      if (apiBaseUrl !== undefined && input.onboarding === undefined) {
        try {
          const me = await fetchMe({ baseUrl: apiBaseUrl, accessToken });
          knownName = me.user.displayName;
        } catch {
          // Unknown name is a fine state to open from.
        }
      }
      if (input.welcome === true && dependencies.welcome !== undefined) {
        try {
          const opening = await dependencies.welcome.turn({
            attribution: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              correlationId: createCorrelationId(),
            },
            knownName,
            knownOrganisation: input.organisationHint ?? null,
            utterance: "",
            recentTurns: [],
          });
          firstMessage = opening.reply;
        } catch (error: unknown) {
          request.log.warn({ err: error }, "welcome opening line unavailable");
        }
      } else if (
        input.onboarding !== undefined &&
        interviewer !== undefined &&
        apiBaseUrl !== undefined
      ) {
        try {
          const opening = await interviewer.turn({
            session: { baseUrl: apiBaseUrl, accessToken },
            onboardingSessionId: input.onboarding.sessionId,
            // The opening line is where sign-up context matters most:
            // greeting somebody by name and offering the organisation
            // they registered with, rather than asking cold.
            signup: signupContextFromToken(accessToken),
            journeyType: input.onboarding.journeyType,
            channel: "voice",
            attribution: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              correlationId: createCorrelationId(),
            },
            utterance: "",
            recentTurns: [],
          });
          firstMessage = opening.reply;
        } catch (error: unknown) {
          request.log.warn({ err: error }, "voice opening line unavailable");
        }
      }

      if (firstMessage === undefined) {
        // Q always speaks first. On the open thread there is no interview
        // state to open from, so the line is a plain greeting.
        const first = knownName?.trim().split(/\s+/)[0];
        firstMessage =
          first !== undefined && first.length > 0
            ? `Hi ${first}. I'm listening; what would you like to look at?`
            : "I'm listening. What would you like to look at?";
      }

      // Names the person has taught Q to hear, before the recogniser
      // hears them again. Best effort: no memory is an empty list.
      let rememberedTerms: readonly string[] = [];
      if (dependencies.memory !== undefined) {
        try {
          rememberedTerms = await dependencies.memory.termsFor(actor);
        } catch (error: unknown) {
          request.log.debug({ err: error }, "remembered terms unavailable");
        }
      }
      const issuedAt = now();
      const voiceSessionId = randomUUID();
      let credentials: {
        readonly token: string;
        readonly providerConversationId: string;
        readonly thinkToken?: string | undefined;
        readonly settings?: DeepgramAgentSettings | undefined;
      };
      if (deepgram !== undefined) {
        // One voice session per person on this transport: a new one
        // replaces whatever was left open.
        dependencies.bindings.releaseFor(actor.userId);
        const thinkToken = randomBytes(32).toString("base64url");
        credentials = {
          token: await deepgram.mintToken(),
          providerConversationId: `dg_${voiceSessionId}`,
          thinkToken,
          settings: deepgram.settingsFor({
            voice,
            greeting: firstMessage,
            thinkToken,
            // The organisation they typed at sign-up: the one name in this
            // conversation the recogniser could not know.
            terms: [
              ...(input.organisationHint === undefined
                ? []
                : [input.organisationHint]),
              ...rememberedTerms,
            ],
          }),
        };
      } else if (elevenLabs !== undefined) {
        const issued = await elevenLabs.createSession({ voice });
        credentials = {
          token: issued.token,
          providerConversationId: issued.providerConversationId,
        };
      } else {
        throw new Error("unreachable: no voice transport");
      }
      const accepted = dependencies.bindings.issue({
        voiceSessionId,
        providerConversationId: credentials.providerConversationId,
        actor,
        accessToken,
        voice,
        thread: {
          conversationId: input.conversationId,
          subjects: input.subjects,
          onboarding: input.onboarding,
          welcome: input.welcome === true,
          ...(input.organisationHint === undefined
            ? {}
            : { organisationHint: input.organisationHint }),
        },
        issuedAt,
        connectBy: issuedAt + VOICE_CONNECT_WINDOW_MS,
        connectedAt: undefined,
        ...(credentials.thinkToken === undefined
          ? {}
          : { thinkToken: credentials.thinkToken }),
      });
      if (!accepted) {
        throw new VoiceSessionLimitError();
      }
      started.add(1, { voice });

      // Identifiers only: never the token, never the bearer.
      request.log.info(
        {
          qVoiceSessionId: voiceSessionId,
          voice,
          thread: input.onboarding === undefined ? "conversation" : "interview",
        },
        "voice session issued",
      );
      return reply
        .code(201)
        .header("Cache-Control", "no-store")
        .send(
          CreateQVoiceSessionResponseSchema.parse({
            voiceSessionId,
            providerConversationId: credentials.providerConversationId,
            token: credentials.token,
            voice,
            expiresAt: new Date(
              issuedAt + VOICE_CONNECT_WINDOW_MS,
            ).toISOString(),
            ...(firstMessage === undefined ? {} : { firstMessage }),
            provider:
              credentials.settings === undefined ? "elevenlabs" : "deepgram",
            ...(credentials.settings === undefined
              ? {}
              : { deepgram: credentials.settings }),
          }),
        );
    },
  );
}
