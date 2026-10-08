# Evidence: apps/q-api/src/http/q-runs.ts (lines 99-221)

- Original path: `apps/q-api/src/http/q-runs.ts`
- Line range: 99-221 (HEAD 520bd123)
- Why included: HTTP entry: POST /v1/q/runs autostarts orchestration detached; appendMessage is stored-not-answered.

```ts
   99  export function registerQRunRoutes(
  100    app: FastifyInstance,
  101    dependencies: QRunRoutesDependencies,
  102  ): void {
  103    const identity = dependencies.identity;
  104    const withContext =
  105      identity === undefined
  106        ? requireActorContextHook(dependencies)
  107        : requireActorContextOrPersonalHook({ ...dependencies, identity });
  108    const service = dependencies.qRuntime;
  109    const runPath = `${Q_RUNS_PATH}/:runId`;
  110  
  111    app.post(Q_RUNS_PATH, { onRequest: withContext }, async (request, reply) => {
  112      const actor = getActorContext(request);
  113      const key = idempotencyKey(request, "start a Q request");
  114      const input = parseContract(
  115        CreateQRunRequestSchema,
  116        request.body,
  117        "The Q request is not valid.",
  118      );
  119  
  120      const correlationId = correlation();
  121      const result = await service.createRun({
  122        actor,
  123        input,
  124        idempotencyKey: key,
  125        correlationId,
  126      });
  127  
  128      // Orchestration begins detached from the request, once per created run
  129      // (a replayed retry never starts it twice). Its outcome is the run's
  130      // canonical lifecycle, read back through GET; an engine failure is
  131      // logged with identifiers only and ends the run through the runtime's
  132      // own failure path, never through this response.
  133      const orchestration = dependencies.orchestration;
  134      if (result.created && orchestration?.autostart === true) {
  135        void orchestration.orchestrator
  136          .start({ actor, runId: result.run.id, correlationId })
  137          .catch((error: unknown) => {
  138            request.log.error(
  139              { err: error, qRunId: result.run.id, correlationId },
  140              "q orchestration ended with an error",
  141            );
  142          });
  143      }
  144  
  145      if (result.created) {
  146        dependencies.room?.watchRun({
  147          actor,
  148          runId: result.run.id,
  149          conversationId: result.run.conversationId,
  150          correlationId,
  151        });
  152      }
  153  
  154      // 202: durably accepted, not analysed. A replayed retry gets the same
  155      // handle and the same status, because it is the same logical run.
  156      return withObservabilityContext({ qRunId: result.run.id }, () =>
  157        reply
  158          .code(202)
  159          .header("Cache-Control", "no-store")
  160          .header("Location", `${Q_RUNS_PATH}/${result.run.id}`)
  161          .send(CreateQRunResponseSchema.parse(toQRunHandle(result.run))),
  162      );
  163    });
  164  
  165    app.get(runPath, { onRequest: withContext }, async (request, reply) => {
  166      const result = await service.getRun({
  167        actor: getActorContext(request),
  168        runId: runIdParam(request),
  169      });
  170      return reply
  171        .header("Cache-Control", "no-store")
  172        .send(QRunSummarySchema.parse(result.summary));
  173    });
  174  
  175    app.post(
  176      `${runPath}${Q_RUN_MESSAGES_SUFFIX}`,
  177      { onRequest: withContext },
  178      async (request, reply) => {
  179        const actor = getActorContext(request);
  180        const key = idempotencyKey(request, "send a message");
  181        const input = parseContract(
  182          AppendQRunMessageRequestSchema,
  183          request.body,
  184          "The message is not valid.",
  185        );
  186  
  187        const result = await service.appendMessage({
  188          actor,
  189          runId: runIdParam(request),
  190          input,
  191          idempotencyKey: key,
  192          correlationId: correlation(),
  193        });
  194  
  195        // Stored, not answered. Nothing replies until an orchestrator exists.
  196        return reply
  197          .code(result.created ? 201 : 200)
  198          .header("Cache-Control", "no-store")
  199          .send(
  200            AppendQRunMessageResponseSchema.parse({
  201              message: toQMessage(result.message),
  202            }),
  203          );
  204      },
  205    );
  206  
  207    app.post(
  208      `${runPath}${Q_RUN_CANCEL_SUFFIX}`,
  209      { onRequest: withContext },
  210      async (request, reply) => {
  211        const result = await service.cancelRun({
  212          actor: getActorContext(request),
  213          runId: runIdParam(request),
  214          correlationId: correlation(),
  215        });
  216        return reply
  217          .header("Cache-Control", "no-store")
  218          .send(QRunSummarySchema.parse(result.summary));
  219      },
  220    );
  221  }
```
