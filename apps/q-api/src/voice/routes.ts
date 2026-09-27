import type { InterviewAgent } from "./interview-agent.js";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import type { FastifyInstance } from "fastify";
import {
  CreateQSpeechRequestSchema,
  CreateQVoiceSessionRequestSchema,
  CreateQVoiceSessionResponseSchema,
  parseContract,
  Q_VOICE_SESSIONS_PATH,
  Q_VOICE_SPEECH_PATH,
  Q_VOICE_SCREEN_PATH,
  Q_VOICE_TURN_PATH,
  QScreenContextSchema,
  QVoiceTurnStateSchema,
} from "@capital-q/contracts";
import { fetchMe } from "@capital-q/api-client";
import { createCorrelationId, getMeter } from "@capital-q/observability";
import { AuthenticationRequiredError } from "@capital-q/security";
import { signupContextFromToken } from "./interview-steps.js";
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
import type { RealtimeVoiceProvider } from "./provider.js";
import { bounded, speakable } from "./speech.js";

/**
 * The most the speak relay voices in one request: a whole spoken answer
 * (`SPOKEN_MAX_CHARS`, 1,200) and a line after it, such as a look-up
 * offered and the question it returns to. 2,000 is also the most Aura-2,
 * the last-resort voice, takes in one request.
 */
const RELAY_MAX_CHARS = 2_000;
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

/**
 * Where the Deepgram Voice Agent fetches Q's voice (QX-004 SPEAK rework).
 *
 * Not in `@capital-q/contracts` with the other voice paths on purpose:
 * this is not part of Capital Q's public API. It is an integration
 * detail between this service and one speech transport, reachable only
 * with a per-session secret, and it speaks a vendor's dialect rather
 * than ours.
 */
export const Q_VOICE_SPEAK_RELAY_PATH = "/v1/q/voice/speak" as const;

/** What `CreateQVoiceSessionResponseSchema` allows for an opening line. */
const FIRST_MESSAGE_MAX = 700;

export type QVoiceRoutesDependencies = ActorContextDependencies & {
  /** The ElevenLabs transport, when composed. */
  readonly provider?: RealtimeVoiceProvider | undefined;
  /** The Deepgram transport, when composed; preferred when both exist. */
  readonly deepgram?: DeepgramVoiceProvider | undefined;
  readonly bindings: VoiceSessionBindings;
  /**
   * The interview as a tool-calling Q run (ADR 0016): composes Q's
   * opening line for an interview session, when present.
   */
  readonly interviewAgent?: InterviewAgent | undefined;
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
  /**
   * The names on the person's own records — their company (canonical and
   * legal), their firm, their own name — for the recogniser, so it hears
   * "Zino Aviation" rather than "Zener Aviation" (founder live
   * 2026-09-27, #6). Read for the resolved actor's own organisation only.
   */
  readonly ownNames?:
    | { readonly namesFor: (actor: ActorContext) => Promise<readonly string[]> }
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
        // The browser reads this as "the line is gone" and reconnects, so
        // which of the two it was decides whether a reconnect loop is the
        // server letting sessions go or somebody reading another person's.
        request.log.warn(
          {
            reason: binding === null ? "NO_BINDING" : "NOT_THIS_PERSON",
            boundCount: dependencies.bindings.size(),
          },
          "voice turn state refused",
        );
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
   * `POST /v1/q/voice/sessions/:voiceSessionId/screen` — where the person
   * is now, while the line is open (R21). Spoken turns reach the planner
   * with the screen exactly as typed ones do. Owner only: another person's
   * session is not found. What is recorded is only the validated shape;
   * each turn's run resolves its entities for the asker or drops them.
   */
  app.post(
    Q_VOICE_SCREEN_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const params = request.params as { voiceSessionId?: string };
      const binding = dependencies.bindings.byVoiceSessionId(
        params.voiceSessionId ?? "",
      );
      if (binding === null || binding.actor.userId !== actor.userId) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Not found",
          status: 404,
          detail: "No such voice session.",
        });
      }
      const screen = QScreenContextSchema.safeParse(request.body);
      if (!screen.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Bad request",
          status: 400,
          detail: "That is not a screen.",
        });
      }
      binding.thread.screen = screen.data;
      return reply.code(204).send();
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

  /**
   * `POST /v1/q/voice/speak` — Q's voice, for the Voice Agent
   * (QX-004 SPEAK rework).
   *
   * Not a person's route. The Deepgram Voice Agent calls this for the
   * audio of each sentence it has been given, in ElevenLabs' own request
   * dialect, and this asks ElevenLabs under the account key and streams
   * the bytes straight back. It exists so that the key does not have to
   * travel to the browser inside the agent settings.
   *
   * Authorised exactly as the think endpoint is: the bearer is the
   * per-session secret minted with the session, and the binding it names
   * was tied to a person before the microphone opened. The voice comes
   * from that binding, never from the request.
   */
  const speakRelay = dependencies.deepgram?.speakRelay;
  if (speakRelay !== undefined) {
    app.post(Q_VOICE_SPEAK_RELAY_PATH, async (request, reply) => {
      const header = request.headers.authorization;
      const token =
        typeof header === "string" && header.startsWith("Bearer ")
          ? header.slice("Bearer ".length).trim()
          : "";
      const binding =
        token.length === 0 ? null : dependencies.bindings.byThinkToken(token);
      if (binding === null) {
        request.log.warn(
          {
            reason: "NO_BINDING_FOR_TOKEN",
            boundCount: dependencies.bindings.size(),
            presented: token.slice(0, 8),
          },
          "voice speak relay refused",
        );
        return reply.code(401).send({
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No voice session for this request.",
        });
      }
      const body = request.body;
      const text =
        body !== null &&
        typeof body === "object" &&
        typeof (body as { text?: unknown }).text === "string"
          ? (body as { text: string }).text
          : "";
      // Bounded by what Q can say in one turn, not by the one-way speech
      // route's per-request limit. The agent decides how much text it asks
      // for at once, and a whole spoken answer (up to SPOKEN_MAX_CHARS) sent
      // as one request used to be refused here: Q's words on screen, no
      // sound, and nothing in the log.
      if (text.trim().length === 0 || text.length > RELAY_MAX_CHARS) {
        request.log.warn(
          { reason: "SPEAK_TEXT_OUT_OF_BOUNDS", characters: text.length },
          "voice speak relay refused",
        );
        return reply.code(400).send({
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "There is nothing to say.",
        });
      }
      const query = request.query;
      const outputFormat =
        query !== null &&
        typeof query === "object" &&
        typeof (query as { output_format?: unknown }).output_format === "string"
          ? (query as { output_format: string }).output_format
          : undefined;

      /**
       * The agent hangs up on Q mid-sentence every time the person speaks
       * over it, which is barge-in working, not a fault. Left unhandled
       * that arrives here as an unhandled `ERR_STREAM_PREMATURE_CLOSE`,
       * the connection dies, and the agent reports it to the browser as
       * INTERNAL_SERVER_ERROR and drops the line (seen live). So the
       * request going away cancels the vendor call instead: the sentence
       * nobody is listening to any more is not paid for or waited on.
       */
      const gone = new AbortController();
      // The *response* closing unfinished is the agent dropping the
      // request. Not the request stream's own close, which fires as soon
      // as the body has been read and would cancel every sentence before
      // a byte of it was sent — the same trap the think route documents.
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) gone.abort();
      });

      let upstream: Response;
      try {
        upstream = await speakRelay.stream({
          voice: binding.voice,
          text,
          outputFormat,
          signal: gone.signal,
          // Keys this sentence's delivery cues and timing (CQ-VOICE-010);
          // from the binding, like the voice, never from the request.
          session: binding.voiceSessionId,
        });
      } catch (error: unknown) {
        if (gone.signal.aborted) {
          // Interrupted before the vendor answered. Nobody to tell.
          return reply;
        }
        request.log.warn({ err: error }, "voice speak relay unreachable");
        return reply.code(502).send({
          type: "about:blank",
          title: "Bad Gateway",
          status: 502,
          detail: "Q can't speak right now.",
        });
      }
      if (!upstream.ok || upstream.body === null) {
        // The vendor's status is for this log and nowhere else; the agent
        // is told only that the audio did not come.
        request.log.warn(
          { status: upstream.status },
          "voice speak relay refused upstream",
        );
        return reply.code(502).send({
          type: "about:blank",
          title: "Bad Gateway",
          status: 502,
          detail: "Q can't speak right now.",
        });
      }
      spokenLines.add(1, { voice: binding.voice });
      const audio = Readable.fromWeb(
        upstream.body as WebReadableStream<Uint8Array>,
      );
      // A sentence cut off in the middle is the ordinary shape of a
      // conversation, not something to log as a failure or to let bubble
      // out of this handler.
      audio.on("error", (error: NodeJS.ErrnoException) => {
        if (
          gone.signal.aborted ||
          error.code === "ERR_STREAM_PREMATURE_CLOSE"
        ) {
          return;
        }
        request.log.warn(
          { err: error },
          "voice speak relay stream ended early",
        );
      });
      gone.signal.addEventListener("abort", () => audio.destroy(), {
        once: true,
      });
      return (
        reply
          .code(200)
          .header(
            "content-type",
            upstream.headers.get("content-type") ?? "application/octet-stream",
          )
          // Audio of one sentence in one person's live conversation.
          .header("cache-control", "no-store")
          .send(audio)
      );
    });
  }

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
      // A thread that is already open is not opened again (resume): no
      // opening line is composed, none is recorded, and Q greets nobody a
      // second time. What Q says first, if anything, is the line the
      // person already has on screen, which the browser hands the provider.
      const resume = input.resume === true;
      let firstMessage: string | undefined;
      const agent = dependencies.interviewAgent;
      const apiBaseUrl = dependencies.apiBaseUrl;
      let knownName: string | null = null;
      if (
        !resume &&
        apiBaseUrl !== undefined &&
        input.onboarding === undefined
      ) {
        try {
          const me = await fetchMe({ baseUrl: apiBaseUrl, accessToken });
          knownName = me.user.displayName;
        } catch {
          // Unknown name is a fine state to open from.
        }
      }
      if (
        !resume &&
        input.welcome === true &&
        dependencies.welcome !== undefined
      ) {
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
        !resume &&
        input.onboarding !== undefined &&
        agent !== undefined &&
        apiBaseUrl !== undefined
      ) {
        try {
          const opening = await agent.turn({
            actor,
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

      // Q's opening line goes to the speaker like any other, so it gets
      // the same treatment: a greeting that named a raise target read out
      // "two zero zero zero zero zero zero zero zero N G N", because every
      // other spoken path runs through `speakable` and this one did not.
      if (firstMessage !== undefined) {
        const spoken = bounded(speakable(firstMessage), FIRST_MESSAGE_MAX);
        // An opening line that was nothing but markup is no opening line:
        // fall through to the plain greeting below rather than send the
        // provider an empty string to say.
        firstMessage = spoken.length === 0 ? undefined : spoken;
      }

      if (firstMessage === undefined && !resume) {
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
      // Their own records' names, likewise best effort.
      let ownNames: readonly string[] = [];
      if (dependencies.ownNames !== undefined) {
        try {
          ownNames = await dependencies.ownNames.namesFor(actor);
        } catch (error: unknown) {
          request.log.debug({ err: error }, "own record names unavailable");
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
              ...ownNames,
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
          ...(input.screen === undefined ? {} : { screen: input.screen }),
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
          resume,
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
