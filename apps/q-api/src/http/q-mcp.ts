import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { CorrelationIdSchema, QRunIdSchema } from "@capital-q/contracts";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import { handleQMcpRequest } from "@capital-q/q-connectors";
import type {
  ContextFirewallPort,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";
import type { QToolRegistry } from "@capital-q/q-tools";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Q as an MCP server (doc 12 §34.2), mounted at one path.
 *
 * A compatible host authenticates as a person exactly as the web app
 * does (a Supabase session bearer) and names the organisation it acts for
 * the same way. Every request is then planned by the Context Firewall for
 * a GENERAL purpose with no subject, and the person is offered the tools
 * that plan admits, executed through the Tool Registry's pipeline. There
 * is no MCP session: each request is authenticated and planned afresh,
 * and nothing about a person is remembered between two of them.
 *
 * Off by default (Q_MCP_SERVER=enabled mounts it). REST and SSE remain
 * Q's primary application boundary.
 */

export const Q_MCP_PATH = "/v1/mcp";

export type QMcpRouteDependencies = ActorContextDependencies & {
  readonly firewall: ContextFirewallPort;
  readonly registry: QToolRegistry;
  readonly tools: QToolPort;
  readonly logger: Logger;
};

export function registerQMcpRoute(
  app: FastifyInstance,
  dependencies: QMcpRouteDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { firewall, registry, tools, logger } = dependencies;

  app.post(Q_MCP_PATH, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    const correlationId = CorrelationIdSchema.parse(createCorrelationId());
    // A synthetic run identity: the firewall stamps its plan with one and
    // logs by it, and an MCP call is not a Q run. Nothing is persisted
    // under it.
    const runId = QRunIdSchema.parse(randomUUID());
    const decision = await firewall.plan({
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      subjects: [],
    });
    if (decision.outcome === "DENIED") {
      return reply.code(403).send({
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "Not available in this context.",
      });
    }
    const context: QToolExecutionContext = {
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      plan: decision.plan,
    };
    reply.hijack();
    await handleQMcpRequest({
      registry,
      tools,
      context,
      logger,
      request: request.raw,
      response: reply.raw,
      body: request.body,
    });
    return reply;
  });

  // Stateful MCP uses GET for a server-initiated stream and DELETE to end
  // a session. This façade has neither, on purpose.
  for (const method of ["GET", "DELETE"] as const) {
    app.route({
      method,
      url: Q_MCP_PATH,
      onRequest: withContext,
      handler: (_request, reply) =>
        reply.code(405).send({
          type: "about:blank",
          title: "Method Not Allowed",
          status: 405,
          detail: "The Q MCP endpoint is stateless: POST each request.",
        }),
    });
  }
}
