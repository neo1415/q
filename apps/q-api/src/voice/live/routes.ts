import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";

import { parseContract } from "@capital-q/contracts";

import { getActorContext } from "../../security/actor-context.js";
import type { VoiceSessionBinding } from "../bindings.js";
import type { LiveBroker } from "./broker.js";
import {
  LiveDelegationRequestSchema,
  LiveDelegationResultSchema,
  LiveEndSchema,
  LiveOpenRequestSchema,
  LiveOpenResultSchema,
  LiveUsageReportSchema,
  LiveUsageResultSchema,
  Q_VOICE_LIVE_CANCEL_PATH,
  Q_VOICE_LIVE_DELEGATIONS_PATH,
  Q_VOICE_LIVE_END_PATH,
  Q_VOICE_LIVE_PREVIEW_PATH,
  Q_VOICE_LIVE_SESSIONS_PATH,
  Q_VOICE_LIVE_USAGE_PATH,
} from "./contracts.js";

/**
 * The GPT-Live line's routes (workstream V). Normal protected requests:
 * the actor comes from the hook, never the body. A line (or a voice
 * session) that is not this person's is the same 404 as one that does not
 * exist. The SDP exchange happens here so the provider key never reaches
 * the browser.
 */

const problem = (reply: FastifyReply, status: number, detail: string) =>
  reply.code(status).send({
    type: "about:blank",
    title: status === 404 ? "Not found" : "Unavailable",
    status,
    detail,
  });

export function registerLiveVoiceRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly broker: LiveBroker;
    readonly withContext: onRequestHookHandler;
    /** The voice session this person was issued, by id (or null). */
    readonly binding: (
      request: FastifyRequest,
      voiceSessionId: string,
    ) => Promise<VoiceSessionBinding | null>;
    /** A fresh binding for a call not attached to a standard session. */
    readonly issue: (
      request: FastifyRequest,
      voice: "FEMALE" | "MALE",
    ) => VoiceSessionBinding;
    /** The issued binding is now in use: keep it past the connect window. */
    readonly connect: (binding: VoiceSessionBinding) => void;
    /** Developer preview gate (local deployment AND CQ_VOICE_PREVIEW). */
    readonly preview: {
      readonly enabled: boolean;
      readonly providers: () => Readonly<Record<string, boolean>>;
    };
  },
): void {
  const { broker, withContext } = dependencies;
  const params = (request: FastifyRequest) =>
    request.params as { voiceSessionId?: string; delegationId?: string };

  app.post(
    Q_VOICE_LIVE_SESSIONS_PATH,
    { onRequest: withContext, bodyLimit: 256 * 1024 },
    async (request, reply) => {
      const body = parseContract(
        LiveOpenRequestSchema,
        request.body ?? {},
        "That is not a live voice offer.",
      );
      const actor = getActorContext(request);
      const binding =
        body.voiceSessionId === undefined
          ? dependencies.issue(request, body.voice ?? "FEMALE")
          : await dependencies.binding(request, body.voiceSessionId);
      if (
        binding === null ||
        binding.actor.userId !== actor.userId ||
        binding.actor.tenantId !== actor.tenantId
      ) {
        return problem(reply, 404, "No such voice session.");
      }
      const opened = await broker.open({
        binding,
        sdp: body.sdp,
        briefingOpening: body.briefingOpening,
        firstName: body.firstName,
        role: body.role,
        locale: body.locale,
      });
      if (opened.kind === "REFUSED") {
        request.log.info({ reason: opened.reason }, "live voice refused");
        // The browser carries on with the standard line on any refusal.
        return problem(reply, 503, `Live voice unavailable: ${opened.reason}.`);
      }
      dependencies.connect(binding);
      return reply
        .code(201)
        .header("Cache-Control", "no-store")
        .send(LiveOpenResultSchema.parse(opened.result));
    },
  );

  app.post(
    Q_VOICE_LIVE_DELEGATIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const delegation = parseContract(
        LiveDelegationRequestSchema,
        request.body ?? {},
        "That is not a delegation.",
      );
      // Letting go of the request never cancels the run: interrupting the
      // voice is not "cancel" (OpenAI live-delegation guide). Cancel is
      // its own route, confirmed.
      const result = await broker.delegate({
        actor: getActorContext(request),
        voiceSessionId: params(request).voiceSessionId ?? "",
        delegation,
      });
      if (result === null) return problem(reply, 404, "No such voice line.");
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(LiveDelegationResultSchema.parse(result));
    },
  );

  app.post(
    Q_VOICE_LIVE_CANCEL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const { voiceSessionId = "", delegationId = "" } = params(request);
      const cancelled = await broker.cancel({
        actor: getActorContext(request),
        voiceSessionId,
        delegationId,
      });
      if (cancelled === null) return problem(reply, 404, "No such voice line.");
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send({ cancelled });
    },
  );

  app.post(
    Q_VOICE_LIVE_USAGE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const report = parseContract(
        LiveUsageReportSchema,
        request.body ?? {},
        "That usage report is not valid.",
      );
      const result = await broker.usage({
        actor: getActorContext(request),
        voiceSessionId: params(request).voiceSessionId ?? "",
        report,
      });
      if (result === null) return problem(reply, 404, "No such voice line.");
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(LiveUsageResultSchema.parse(result));
    },
  );

  app.post(
    Q_VOICE_LIVE_END_PATH,
    { onRequest: withContext },
    (request, reply) => {
      const body = parseContract(
        LiveEndSchema,
        request.body ?? {},
        "That is not a reason to end.",
      );
      broker.end({
        actor: getActorContext(request),
        voiceSessionId: params(request).voiceSessionId ?? "",
        reason: body.reason,
      });
      // Ending a line that already ended is not an error.
      return reply.code(204).send();
    },
  );

  // Developer-only: which voice lines this local deployment can compare.
  // Not registered at all outside the gate, so production has no route.
  if (dependencies.preview.enabled) {
    app.get(
      Q_VOICE_LIVE_PREVIEW_PATH,
      { onRequest: withContext },
      (_request, reply) =>
        reply
          .code(200)
          .header("Cache-Control", "no-store")
          .send({ providers: dependencies.preview.providers() }),
    );
  }
}
