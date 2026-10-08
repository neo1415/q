import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  APP_ACTIONS,
  AppActionPortMissingError,
  PERSON_ACTIONS,
  type AnyPersonAction,
  type PersonActionContext,
  type AnyAppAction,
  type AppActionHttp,
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
  createActionReplayGuard,
  idempotencyKeyOf,
  type ActionReplayGuard,
} from "./app-action-replay.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import {
  getOnboardingActor,
  requireOnboardingActorHook,
  type OnboardingActorDependencies,
} from "../security/onboarding-actor.js";

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
  /** One run per Idempotency-Key (app-action-replay.ts); a fresh guard by default. */
  readonly replay?: ActionReplayGuard | undefined;
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
  people: readonly AnyPersonAction[] = PERSON_ACTIONS,
): readonly string[] {
  return [
    ...actions.flatMap((action) =>
      action.http === undefined
        ? []
        : [`${action.http.method} ${action.http.path}`],
    ),
    ...people.map((action) => `${action.http.method} ${action.http.path}`),
  ];
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

/**
 * The answer every generated route gives once its input is parsed and its
 * actor authorised: the one service call, then the declared problem,
 * status, Location and body. A service missing on this deployment is a
 * 503, a service's own failure the problem `problemOf` maps it to.
 */
async function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: Pick<AppActionRoutesDependencies, "ports" | "problemOf">,
  http: AppActionHttp<unknown, unknown>,
  input: unknown,
  run: () => Promise<unknown>,
): Promise<unknown> {
  let out: unknown;
  try {
    out = await run();
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
    return reply.status(mapped.status).type(PROBLEM_CONTENT_TYPE).send(mapped);
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
    typeof http.status === "function" ? http.status(out) : (http.status ?? 200);
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
}

export function registerAppActionRoutes(
  app: FastifyInstance,
  dependencies: AppActionRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const replay = dependencies.replay ?? createActionReplayGuard();
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
        // RECOVERY-2026-10: the screen's own key for this intent (the same
        // on a retry); a malformed one is refused, never silently replaced.
        const header = idempotencyKeyOf(request.headers);
        if (header.kind === "INVALID") {
          return reply
            .status(422)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              createProblemDetails({
                code: "VALIDATION_FAILED",
                requestId: request.id,
                detail:
                  "The Idempotency-Key must be 8 to 255 printable characters without spaces.",
              }),
            );
        }
        const intentKey =
          http.idempotencyKeyOf?.(input) ??
          (header.kind === "KEY" ? header.key : undefined);
        const actor = getActorContext(request);
        const context: AppActionContext = {
          actor,
          idempotencyKey: intentKey ?? request.id,
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
        const run = () => action.run(dependencies.ports, context, input);
        if (intentKey === undefined) {
          return answer(request, reply, dependencies, http, input, run);
        }
        // One run per person, action and key; a retry replays its outcome.
        const decision = replay.once(
          `${actor.tenantId}:${actor.userId}:${action.name}`,
          intentKey,
          input,
          run,
        );
        if (decision.kind === "CONFLICT") {
          return reply
            .status(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              createProblemDetails({
                code: "IDEMPOTENCY_CONFLICT",
                requestId: request.id,
              }),
            );
        }
        if (decision.kind === "REPLAY") {
          void reply.header("Idempotent-Replayed", "true");
        }
        return answer(
          request,
          reply,
          dependencies,
          http,
          input,
          () => decision.outcome,
        );
      },
    });
  }
}

export type PersonActionRoutesDependencies = OnboardingActorDependencies & {
  readonly ports: AppActionPorts;
  readonly actions?: readonly AnyPersonAction[] | undefined;
};

/**
 * Person-scoped routes (ADR 0040): the same generated answer, under the
 * onboarding actor, for a person who may have no organisation yet. The
 * owning service authorises the person; nothing here widens that.
 */
export function registerPersonActionRoutes(
  app: FastifyInstance,
  dependencies: PersonActionRoutesDependencies,
): void {
  const withPerson = requireOnboardingActorHook(dependencies);
  for (const action of dependencies.actions ?? PERSON_ACTIONS) {
    const http = action.http;
    app.route({
      method: http.method,
      url: http.path,
      onRequest: withPerson,
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
        const context: PersonActionContext = {
          person: getOnboardingActor(request),
          correlationId: CorrelationIdSchema.parse(createCorrelationId()),
        };
        return answer(request, reply, dependencies, http, input, () =>
          action.run(dependencies.ports, context, input),
        );
      },
    });
  }
}
