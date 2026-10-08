# Q tool execution pipeline

Why included: Schema validation, actor/plan match, authorize step, fail-closed.

## `packages/q-tools/src/executor.ts` lines 25-40

```ts
   25  /**
   26   * The tool execution pipeline (doc 12 §29; doc 15 §50-52):
   27   *
   28   *   model proposes → offered for THIS run? → schema validation of the
   29   *   arguments (exactly like external input) → actor/tenant against the
   30   *   plan → cancellation → the tool's own authorize (capability,
   31   *   disclosure, plan scope) → sensitivity within the plan's ceiling →
   32   *   deterministic execute through the owning domain's port → output
   33   *   validation → bounded, sanitised result → back to the model as data
   34   *
   35   * Nothing skips a step because the model asked nicely; nothing that goes
   36   * wrong reaches the model as anything but a stable code and one safe
   37   * sentence. What is logged: tool, version, status, code, latency, run.
   38   * What is never logged or returned: arguments, results, thrown messages.
   39   */
   40  
```

## `packages/q-tools/src/executor.ts` lines 170-260

```ts
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
```

