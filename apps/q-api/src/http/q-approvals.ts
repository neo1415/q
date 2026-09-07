import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ApproveQApprovalRequestSchema,
  CorrelationIdSchema,
  parseContract,
  Q_APPROVAL_APPROVE_SUFFIX,
  Q_APPROVAL_REJECT_SUFFIX,
  Q_APPROVALS_PATH,
  QApprovalIdSchema,
  QApprovalViewSchema,
  RejectQApprovalRequestSchema,
  type CorrelationId,
  type QApprovalId,
} from "@capital-q/contracts";
import {
  createCorrelationId,
  withObservabilityContext,
} from "@capital-q/observability";
import type { QActionService } from "@capital-q/q-actions";
import type { QOrchestrator } from "@capital-q/q-runtime";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/q/approvals` — a person's decision about an action Q prepared
 * (doc 12 §31; doc 22 §80-§82; CQ-Q-008 §39-§42, §84-§86).
 *
 * The client identifies an existing server-side proposal and states a
 * decision. That is the whole of what it may say: the approve body is an
 * empty object, the reject body carries at most a bounded reason. There is
 * no field for a payload, a hash, a tenant, an approver, a role or a flag
 * that skips a check, and the strict contracts refuse any that is sent.
 * The actor comes from the verified session; the Approval Engine resolves
 * whether that person may decide this approval and whether the persisted
 * proposal still hashes to what was proposed.
 *
 * Approval records first, executes second: only after the decision has
 * committed is the suspended run resumed, detached from this request, and
 * the execution gate re-verifies everything before any side effect. The
 * response is the approval as it stands the moment the decision was
 * recorded — approved, not "done".
 */

export type QApprovalRoutesDependencies = ActorContextDependencies & {
  readonly qActions: QActionService;
  /** Resumes the run after an approval; absent means an approved action waits for a worker. */
  readonly orchestrator?: QOrchestrator | undefined;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function approvalIdParam(request: FastifyRequest): QApprovalId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    QApprovalIdSchema,
    params["approvalId"],
    "The approval identifier is not valid.",
  );
}

export function registerQApprovalRoutes(
  app: FastifyInstance,
  dependencies: QApprovalRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.qActions;
  const approvalPath = `${Q_APPROVALS_PATH}/:approvalId`;

  app.get(approvalPath, { onRequest: withContext }, async (request, reply) => {
    const view = await service.getApproval({
      actor: getActorContext(request),
      approvalId: approvalIdParam(request),
      correlationId: correlation(),
    });
    return reply
      .header("Cache-Control", "no-store")
      .send(QApprovalViewSchema.parse(view));
  });

  app.post(
    `${approvalPath}${Q_APPROVAL_APPROVE_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      parseContract(
        ApproveQApprovalRequestSchema,
        request.body ?? {},
        "An approval decision carries no other input.",
      );
      const correlationId = correlation();
      const result = await service.approve({
        actor,
        approvalId: approvalIdParam(request),
        correlationId,
      });

      // The decision is durable; execution is the run's continuation,
      // re-verified by the gate. A retried approve does not resume twice.
      if (result.decided && dependencies.orchestrator !== undefined) {
        const orchestrator = dependencies.orchestrator;
        void orchestrator
          .resume({ actor, runId: result.action.runId, correlationId })
          .catch((error: unknown) => {
            request.log.error(
              { err: error, qRunId: result.action.runId, correlationId },
              "q run did not resume after approval",
            );
          });
      }

      return withObservabilityContext({ qRunId: result.action.runId }, () =>
        reply
          .header("Cache-Control", "no-store")
          .send(QApprovalViewSchema.parse(result.view)),
      );
    },
  );

  app.post(
    `${approvalPath}${Q_APPROVAL_REJECT_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        RejectQApprovalRequestSchema,
        request.body ?? {},
        "The rejection is not valid.",
      );
      const result = await service.reject({
        actor: getActorContext(request),
        approvalId: approvalIdParam(request),
        correlationId: correlation(),
        reason: input.reason,
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(QApprovalViewSchema.parse(result.view));
    },
  );
}
