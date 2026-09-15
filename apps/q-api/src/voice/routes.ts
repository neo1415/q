import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  CreateQVoiceSessionRequestSchema,
  CreateQVoiceSessionResponseSchema,
  parseContract,
  Q_VOICE_SESSIONS_PATH,
} from "@capital-q/contracts";
import { getMeter } from "@capital-q/observability";
import { AuthenticationRequiredError } from "@capital-q/security";
import { extractBearerToken } from "@capital-q/security/supabase";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import {
  VOICE_CONNECT_WINDOW_MS,
  VoiceSessionLimitError,
  type VoiceSessionBindings,
} from "./bindings.js";
import type { RealtimeVoiceProvider } from "./provider.js";

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
  readonly provider: RealtimeVoiceProvider;
  readonly bindings: VoiceSessionBindings;
  readonly now?: (() => number) | undefined;
};

export function registerQVoiceRoutes(
  app: FastifyInstance,
  dependencies: QVoiceRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const now = dependencies.now ?? Date.now;
  const meter = getMeter("@capital-q/q-api");
  const started = meter.createCounter("q.voice.session.issued", {
    description: "Voice session credentials issued, by voice",
  });

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
      const voice = dependencies.provider.voices.includes(input.voice)
        ? input.voice
        : "FEMALE";

      const issuedAt = now();
      const credentials = await dependencies.provider.createSession({ voice });
      const voiceSessionId = randomUUID();
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
        },
        issuedAt,
        connectBy: issuedAt + VOICE_CONNECT_WINDOW_MS,
        connectedAt: undefined,
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
          }),
        );
    },
  );
}
