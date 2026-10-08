# Excerpt: apps/api/src/http/app-actions.ts lines 120-245

- Original path: `apps/api/src/http/app-actions.ts`
- Line range: 120-245
- Why included: Registry-generated mutation routes (ADR 0040): 131 HTTP actions from packages/app-actions are mounted here with authorize() before run().

```
  120      const details = createProblemDetails({
  121        code: problem.code,
  122        requestId: request.id,
  123        detail: problem.detail,
  124      });
  125      return reply
  126        .status(details.status)
  127        .type(PROBLEM_CONTENT_TYPE)
  128        .header("Cache-Control", "no-store")
  129        .send(details);
  130    }
  131    if (http.notFound?.(out) === true) {
  132      reply.callNotFound();
  133      return undefined;
  134    }
  135    void reply.header("Cache-Control", "no-store");
  136    if (http.location !== undefined) {
  137      void reply.header("Location", http.location(out, input));
  138    }
  139    const status =
  140      typeof http.status === "function" ? http.status(out) : (http.status ?? 200);
  141    // 204 answers with no body, whatever `respond` would say.
  142    if (status === 204) return reply.status(204).send();
  143    void reply.status(status);
  144    try {
  145      return await http.respond(out, input, dependencies.ports);
  146    } catch (error: unknown) {
  147      const unavailable = unavailableProblem(error, request.id);
  148      if (unavailable === null) throw error;
  149      return reply
  150        .status(unavailable.status)
  151        .type(PROBLEM_CONTENT_TYPE)
  152        .send(unavailable);
  153    }
  154  }
  155
  156  export function registerAppActionRoutes(
  157    app: FastifyInstance,
  158    dependencies: AppActionRoutesDependencies,
  159  ): void {
  160    const withContext = requireActorContextHook(dependencies);
  161    for (const action of dependencies.actions ?? APP_ACTIONS) {
  162      const http = action.http;
  163      if (http === undefined) continue;
  164      app.route({
  165        method: http.method,
  166        url: http.path,
  167        onRequest: withContext,
  168        handler: async (request, reply) => {
  169          const input = parseContract(
  170            action.input,
  171            http.fromRequest(
  172              request.params as Record<string, string>,
  173              request.body ?? {},
  174              request.headers,
  175            ),
  176            "The request is not valid.",
  177          );
  178          const context: AppActionContext = {
  179            actor: getActorContext(request),
  180            idempotencyKey: http.idempotencyKeyOf?.(input) ?? request.id,
  181            correlationId: CorrelationIdSchema.parse(createCorrelationId()),
  182            surface: "SCREEN",
  183          };
  184          const verdict = await action.authorize(
  185            dependencies.ports,
  186            context,
  187            input,
  188          );
  189          if (!verdict.ok) {
  190            reply.callNotFound();
  191            return undefined;
  192          }
  193          return answer(request, reply, dependencies, http, input, () =>
  194            action.run(dependencies.ports, context, input),
  195          );
  196        },
  197      });
  198    }
  199  }
  200
  201  export type PersonActionRoutesDependencies = OnboardingActorDependencies & {
  202    readonly ports: AppActionPorts;
  203    readonly actions?: readonly AnyPersonAction[] | undefined;
  204  };
  205
  206  /**
  207   * Person-scoped routes (ADR 0040): the same generated answer, under the
  208   * onboarding actor, for a person who may have no organisation yet. The
  209   * owning service authorises the person; nothing here widens that.
  210   */
  211  export function registerPersonActionRoutes(
  212    app: FastifyInstance,
  213    dependencies: PersonActionRoutesDependencies,
  214  ): void {
  215    const withPerson = requireOnboardingActorHook(dependencies);
  216    for (const action of dependencies.actions ?? PERSON_ACTIONS) {
  217      const http = action.http;
  218      app.route({
  219        method: http.method,
  220        url: http.path,
  221        onRequest: withPerson,
  222        handler: async (request, reply) => {
  223          const input = parseContract(
  224            action.input,
  225            http.fromRequest(
  226              request.params as Record<string, string>,
  227              request.body ?? {},
  228              request.headers,
  229            ),
  230            "The request is not valid.",
  231          );
  232          const context: PersonActionContext = {
  233            person: getOnboardingActor(request),
  234            correlationId: CorrelationIdSchema.parse(createCorrelationId()),
  235          };
  236          return answer(request, reply, dependencies, http, input, () =>
  237            action.run(dependencies.ports, context, input),
  238          );
  239        },
  240      });
  241    }
  242  }
```
