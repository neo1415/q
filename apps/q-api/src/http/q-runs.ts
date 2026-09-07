import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AppendQRunMessageRequestSchema,
  AppendQRunMessageResponseSchema,
  CorrelationIdSchema,
  CreateQRunRequestSchema,
  CreateQRunResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  parseContract,
  Q_RUN_CANCEL_SUFFIX,
  Q_RUN_MESSAGES_SUFFIX,
  Q_RUNS_PATH,
  QRunIdSchema,
  QRunSummarySchema,
  type CorrelationId,
  type QRunId,
} from "@capital-q/contracts";
import {
  createCorrelationId,
  withObservabilityContext,
} from "@capital-q/observability";
import {
  toQMessage,
  toQRunHandle,
  type QOrchestrator,
  type QRuntimeService,
} from "@capital-q/q-runtime";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/q/runs` — the Q run lifecycle at the HTTP boundary (doc 22 §66-68,
 * §77-78).
 *
 * Handlers parse the public contract, hand the server-resolved actor to
 * the runtime service, and serialise the result through the public schema.
 * No runtime rule lives here, no SQL lives here, and nothing a client sends
 * chooses tenancy, ownership, status or consequence: the body is the
 * strict Q request, the path names a run, and the actor comes from the
 * verified session.
 *
 * What these routes do NOT do, and say so: analyse anything, stream
 * anything, or approve anything. A created run is RECEIVED and the
 * response says RECEIVED. There is no events route until CQ-Q-009.
 */

export type QRunRoutesDependencies = ActorContextDependencies & {
  readonly qRuntime: QRuntimeService;
  /**
   * Orchestration behind a composition boundary. When present and
   * `autostart` is on, a newly created run is handed to the orchestrator
   * detached from the request: the response is still 202 RECEIVED, and
   * whatever the engine concludes is read back through GET. Off means runs
   * stay RECEIVED until something else picks them up.
   */
  readonly orchestration?:
    | { readonly orchestrator: QOrchestrator; readonly autostart: boolean }
    | undefined;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function runIdParam(request: FastifyRequest): QRunId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    QRunIdSchema,
    params["runId"],
    "The Q request identifier is not valid.",
  );
}

function idempotencyKey(request: FastifyRequest, purpose: string): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof raw === "string" ? raw : undefined,
    `An Idempotency-Key header is required to ${purpose}.`,
  );
}

export function registerQRunRoutes(
  app: FastifyInstance,
  dependencies: QRunRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.qRuntime;
  const runPath = `${Q_RUNS_PATH}/:runId`;

  app.post(Q_RUNS_PATH, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    const key = idempotencyKey(request, "start a Q request");
    const input = parseContract(
      CreateQRunRequestSchema,
      request.body,
      "The Q request is not valid.",
    );

    const correlationId = correlation();
    const result = await service.createRun({
      actor,
      input,
      idempotencyKey: key,
      correlationId,
    });

    // Orchestration begins detached from the request, once per created run
    // (a replayed retry never starts it twice). Its outcome is the run's
    // canonical lifecycle, read back through GET; an engine failure is
    // logged with identifiers only and ends the run through the runtime's
    // own failure path, never through this response.
    const orchestration = dependencies.orchestration;
    if (result.created && orchestration?.autostart === true) {
      void orchestration.orchestrator
        .start({ actor, runId: result.run.id, correlationId })
        .catch((error: unknown) => {
          request.log.error(
            { err: error, qRunId: result.run.id, correlationId },
            "q orchestration ended with an error",
          );
        });
    }

    // 202: durably accepted, not analysed. A replayed retry gets the same
    // handle and the same status, because it is the same logical run.
    return withObservabilityContext({ qRunId: result.run.id }, () =>
      reply
        .code(202)
        .header("Cache-Control", "no-store")
        .header("Location", `${Q_RUNS_PATH}/${result.run.id}`)
        .send(CreateQRunResponseSchema.parse(toQRunHandle(result.run))),
    );
  });

  app.get(runPath, { onRequest: withContext }, async (request, reply) => {
    const result = await service.getRun({
      actor: getActorContext(request),
      runId: runIdParam(request),
    });
    return reply
      .header("Cache-Control", "no-store")
      .send(QRunSummarySchema.parse(result.summary));
  });

  app.post(
    `${runPath}${Q_RUN_MESSAGES_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const key = idempotencyKey(request, "send a message");
      const input = parseContract(
        AppendQRunMessageRequestSchema,
        request.body,
        "The message is not valid.",
      );

      const result = await service.appendMessage({
        actor,
        runId: runIdParam(request),
        input,
        idempotencyKey: key,
        correlationId: correlation(),
      });

      // Stored, not answered. Nothing replies until an orchestrator exists.
      return reply
        .code(result.created ? 201 : 200)
        .header("Cache-Control", "no-store")
        .send(
          AppendQRunMessageResponseSchema.parse({
            message: toQMessage(result.message),
          }),
        );
    },
  );

  app.post(
    `${runPath}${Q_RUN_CANCEL_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const result = await service.cancelRun({
        actor: getActorContext(request),
        runId: runIdParam(request),
        correlationId: correlation(),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(QRunSummarySchema.parse(result.summary));
    },
  );
}
