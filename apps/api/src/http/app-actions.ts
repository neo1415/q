import type { FastifyInstance } from "fastify";

import {
  APP_ACTIONS,
  type AnyAppAction,
  type AppActionContext,
  type AppActionPorts,
} from "@capital-q/app-actions";
import { CorrelationIdSchema, parseContract } from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Routes generated from the app's action registry (ADR 0040, Proposed).
 *
 * Each declared action with an HTTP shape gets exactly its own route --
 * its own method and path, never a catch-all -- that parses the declared
 * input, runs the declared authorize step and the one service call, and
 * answers in the route's existing response contract. The same declaration
 * is Q's tool (q-tools) and its approved action (q-api), so the screen and
 * Q cannot drift. A refusal is the one 404, whatever the reason.
 */

export type AppActionRoutesDependencies = ActorContextDependencies & {
  readonly ports: AppActionPorts;
  readonly actions?: readonly AnyAppAction[] | undefined;
};

/** The routes this registry declares, as `<METHOD> <path>` (the parity guard reads it). */
export function appActionRouteKeys(
  actions: readonly AnyAppAction[] = APP_ACTIONS,
): readonly string[] {
  return actions.flatMap((action) =>
    action.http === undefined
      ? []
      : [`${action.http.method} ${action.http.path}`],
  );
}

export function registerAppActionRoutes(
  app: FastifyInstance,
  dependencies: AppActionRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  for (const action of dependencies.actions ?? APP_ACTIONS) {
    const http = action.http;
    if (http === undefined) continue;
    app.route({
      method: http.method,
      url: http.path,
      onRequest: withContext,
      handler: async (request, reply) => {
        const input = parseContract(
          action.input,
          http.fromRequest(
            request.params as Record<string, string>,
            request.body ?? {},
          ),
          "The request is not valid.",
        );
        const context: AppActionContext = {
          actor: getActorContext(request),
          idempotencyKey: http.idempotencyKeyOf?.(input) ?? request.id,
          correlationId: CorrelationIdSchema.parse(createCorrelationId()),
          surface: "SCREEN",
        };
        const verdict = await action.authorize(
          dependencies.ports,
          context,
          input,
        );
        if (!verdict.ok) {
          reply.callNotFound();
          return undefined;
        }
        const out = await action.run(dependencies.ports, context, input);
        if (http.notFound?.(out) === true) {
          reply.callNotFound();
          return undefined;
        }
        void reply.header("Cache-Control", "no-store");
        return await http.respond(out, input, dependencies.ports);
      },
    });
  }
}
