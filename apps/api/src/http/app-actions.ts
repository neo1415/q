import type { FastifyInstance } from "fastify";

import {
  APP_ACTIONS,
  AppActionPortMissingError,
  type AnyAppAction,
  type AppActionContext,
  type AppActionPorts,
} from "@capital-q/app-actions";
import {
  CorrelationIdSchema,
  createProblemDetails,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
} from "@capital-q/contracts";
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
  /**
   * A service's own failure as the problem its hand-written route used to
   * answer (the video provider's, for pitch uploads); null: not its kind,
   * and the application's handler answers.
   */
  readonly problemOf?:
    ((error: unknown, requestId: string) => ProblemDetails | null) | undefined;
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

/**
 * A route whose service is not composed on this deployment answers 503
 * with what is unavailable, in the person's words; never a 500.
 */
function unavailableProblem(
  error: unknown,
  requestId: string,
): ProblemDetails | null {
  return error instanceof AppActionPortMissingError
    ? createProblemDetails({
        code: "PROVIDER_UNAVAILABLE",
        requestId,
        detail: error.detail,
      })
    : null;
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
            request.headers,
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
        let out: unknown;
        try {
          out = await action.run(dependencies.ports, context, input);
        } catch (error: unknown) {
          const mapped =
            unavailableProblem(error, request.id) ??
            dependencies.problemOf?.(error, request.id) ??
            null;
          if (mapped === null) throw error;
          request.log.warn(
            { err: error, requestId: request.id },
            "an app action's service failed",
          );
          return reply
            .status(mapped.status)
            .type(PROBLEM_CONTENT_TYPE)
            .send(mapped);
        }
        const problem = http.problem?.(out) ?? null;
        if (problem !== null) {
          const details = createProblemDetails({
            code: problem.code,
            requestId: request.id,
            detail: problem.detail,
          });
          return reply
            .status(details.status)
            .type(PROBLEM_CONTENT_TYPE)
            .header("Cache-Control", "no-store")
            .send(details);
        }
        if (http.notFound?.(out) === true) {
          reply.callNotFound();
          return undefined;
        }
        void reply.header("Cache-Control", "no-store");
        if (http.location !== undefined) {
          void reply.header("Location", http.location(out, input));
        }
        const status =
          typeof http.status === "function"
            ? http.status(out)
            : (http.status ?? 200);
        // 204 answers with no body, whatever `respond` would say.
        if (status === 204) return reply.status(204).send();
        void reply.status(status);
        try {
          return await http.respond(out, input, dependencies.ports);
        } catch (error: unknown) {
          const unavailable = unavailableProblem(error, request.id);
          if (unavailable === null) throw error;
          return reply
            .status(unavailable.status)
            .type(PROBLEM_CONTENT_TYPE)
            .send(unavailable);
        }
      },
    });
  }
}
