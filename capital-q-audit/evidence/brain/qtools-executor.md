# Evidence: packages/q-tools/src/executor.ts (lines 140-410)

- Original path: `packages/q-tools/src/executor.ts`
- Line range: 140-410 (HEAD 9177629d)
- Why included: Tool execution pipeline: offered check, Zod input, actor/plan match, authorize, sensitivity ceiling, execute, output validation.

```ts
  140    };
  141
  142    async function execute(
  143      proposal: QToolProposal,
  144      context: QToolExecutionContext,
  145    ): Promise<QToolCallOutcome> {
  146      const started = now();
  147      const elapsed = () => Math.max(0, now() - started);
  148      const record = registry.offeredByProviderName(context, proposal.name);
  149      if (record === undefined) {
  150        return finish(
  151          context,
  152          failed(
  153            proposal,
  154            undefined,
  155            "DENIED",
  156            "TOOL_NOT_ELIGIBLE",
  157            "That tool is not available in this conversation.",
  158            elapsed(),
  159          ),
  160        );
  161      }
  162      const { definition } = record;
  163      return tracer.startActiveSpan(
  164        "q.tool.execute",
  165        {
  166          attributes: {
  167            "q.tool.id": definition.id,
  168            "q.tool.version": definition.version,
  169            "q.run_id": context.runId,
  170          },
  171        },
  172        async (span) => {
  173          try {
  174            const parsed = definition.input.safeParse(proposal.arguments);
  175            if (!parsed.success) {
  176              return finish(
  177                context,
  178                failed(
  179                  proposal,
  180                  record,
  181                  "FAILED",
  182                  "INVALID_ARGUMENTS",
  183                  argumentIssues(parsed.error.issues),
  184                  elapsed(),
  185                ),
  186              );
  187            }
  188            // The actor the run was authorised for is the only actor a tool
  189            // serves; a context that disagrees with its plan is refused.
  190            if (
  191              context.actor.actorType !== "HUMAN" ||
  192              context.actor.tenantId !== context.plan.tenantId ||
  193              context.actor.userId !== context.plan.actor.userId ||
  194              (context.actor.organisationId ?? null) !==
  195                (context.plan.actor.organisationId ?? null)
  196            ) {
  197              return finish(
  198                context,
  199                failed(
  200                  proposal,
  201                  record,
  202                  "DENIED",
  203                  "ACTOR_MISMATCH",
  204                  NOT_AVAILABLE_MESSAGE,
  205                  elapsed(),
  206                ),
  207              );
  208            }
  209            if (isAborted(context.signal)) {
  210              return finish(
  211                context,
  212                failed(
  213                  proposal,
  214                  record,
  215                  "FAILED",
  216                  "CANCELLED",
  217                  "The request was cancelled.",
  218                  elapsed(),
  219                ),
  220              );
  221            }
  222            // An authorize step that throws (its port down, a timeout) is
  223            // closed, as a typed failure for this one call: it used to
  224            // escape the executor and end the whole turn (harden harness,
  225            // 2026-10-01: get_company, get_capital_objective,
  226            // propose_handle_claim). Nothing is granted on a failure.
  227            let authorization: Awaited<ReturnType<typeof definition.authorize>>;
  228            try {
  229              authorization = await definition.authorize(parsed.data, context);
  230            } catch (error: unknown) {
  231              logger?.error(
  232                { err: error, qRunId: context.runId, tool: definition.id },
  233                "q tool authorization threw",
  234              );
  235              return finish(
  236                context,
  237                failed(
  238                  proposal,
  239                  record,
  240                  "FAILED",
  241                  isAborted(context.signal) ? "CANCELLED" : "TOOL_INTERNAL_ERROR",
  242                  isAborted(context.signal)
  243                    ? "The request was cancelled."
  244                    : "The tool could not complete.",
  245                  elapsed(),
  246                ),
  247              );
  248            }
  249            if (authorization.outcome === "DENY") {
  250              return finish(
  251                context,
  252                failed(
  253                  proposal,
  254                  record,
  255                  "DENIED",
  256                  authorization.code,
  257                  authorization.safeMessage,
  258                  elapsed(),
  259                ),
  260              );
  261            }
  262            if (
  263              !sensitivityWithin(
  264                authorization.sensitivity,
  265                context.plan.maxSensitivity,
  266              )
  267            ) {
  268              return finish(
  269                context,
  270                failed(
  271                  proposal,
  272                  record,
  273                  "DENIED",
  274                  "SENSITIVITY_NOT_PERMITTED",
  275                  NOT_AVAILABLE_MESSAGE,
  276                  elapsed(),
  277                ),
  278              );
  279            }
  280            let produced: unknown;
  281            try {
  282              produced = await definition.execute(
  283                parsed.data,
  284                context,
  285                authorization.grant,
  286              );
  287            } catch (error: unknown) {
  288              if (error instanceof QToolArgumentError) {
  289                return finish(
  290                  context,
  291                  failed(
  292                    proposal,
  293                    record,
  294                    "FAILED",
  295                    "INVALID_ARGUMENTS",
  296                    error.safeMessage,
  297                    elapsed(),
  298                  ),
  299                );
  300              }
  301              if (isAborted(context.signal)) {
  302                return finish(
  303                  context,
  304                  failed(
  305                    proposal,
  306                    record,
  307                    "FAILED",
  308                    "CANCELLED",
  309                    "The request was cancelled.",
  310                    elapsed(),
  311                  ),
  312                );
  313              }
  314              // Server-side diagnostics only; the model learns a code.
  315              logger?.error(
  316                { err: error, qRunId: context.runId, tool: definition.id },
  317                "q tool execution threw",
  318              );
  319              return finish(
  320                context,
  321                failed(
  322                  proposal,
  323                  record,
  324                  "FAILED",
  325                  "TOOL_INTERNAL_ERROR",
  326                  "The tool could not complete.",
  327                  elapsed(),
  328                ),
  329              );
  330            }
  331            const output = definition.output.safeParse(produced);
  332            if (!output.success) {
  333              logger?.error(
  334                { qRunId: context.runId, tool: definition.id },
  335                "q tool produced output its schema refuses",
  336              );
  337              return finish(
  338                context,
  339                failed(
  340                  proposal,
  341                  record,
  342                  "FAILED",
  343                  "INVALID_TOOL_OUTPUT",
  344                  "The tool could not complete.",
  345                  elapsed(),
  346                ),
  347              );
  348            }
  349            if (
  350              JSON.stringify(output.data).length > MODEL_TOOL_RESULT_MAX_CHARS
  351            ) {
  352              return finish(
  353                context,
  354                failed(
  355                  proposal,
  356                  record,
  357                  "FAILED",
  358                  "RESULT_TOO_LARGE",
  359                  "The result is too large to return; narrow the request.",
  360                  elapsed(),
  361                ),
  362              );
  363            }
  364            return finish(context, {
  365              callId: proposal.callId,
  366              toolName: definition.id,
  367              toolVersion: definition.version,
  368              classification: definition.classification,
  369              status: "SUCCEEDED",
  370              failureCode: null,
  371              sensitivity: authorization.sensitivity,
  372              result: { ok: true, data: output.data },
  373              latencyMs: elapsed(),
  374            });
  375          } finally {
  376            span.end();
  377          }
  378        },
  379      );
  380    }
  381
  382    return {
  383      offer: (context) => {
  384        const ranked = registry.ranked(context);
  385        // The bound is applied by the registry (core first, then priority);
  386        // what it cut is logged so a crowded purpose is seen, not silent.
  387        if (ranked.length > Q_TURN_TOOLS_MAX) {
  388          logger?.warn(
  389            {
  390              qRunId: context.runId,
  391              purpose: context.plan.purpose.taskClass,
  392              eligible: ranked.length,
  393              dropped: ranked
  394                .slice(Q_TURN_TOOLS_MAX)
  395                .map((record) => record.definition.providerName),
  396            },
  397            "more tools relevant than one model request carries",
  398          );
  399        }
  400        return Promise.resolve(registry.eligible(context).map(toOfferedTool));
  401      },
  402      // The reader's list: every tool this purpose and plan allow, unfocused,
  403      // up to what one request can carry, exactly as the offer was before.
  404      // Declared app actions follow on any purpose: the reader may name one,
  405      // and a named one executes (lead 2026-10-03).
  406      available: (context) =>
  407        Promise.resolve(registry.available(context).map(toOfferedTool)),
  408      execute,
  409    };
  410  }
```
