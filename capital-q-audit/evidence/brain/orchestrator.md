# Evidence: packages/q-orchestrator/src/orchestrator.ts (lines 130-472)

- Original path: `packages/q-orchestrator/src/orchestrator.ts`
- Line range: 130-472 (HEAD 520bd123)
- Why included: Orchestrator start/resume/cancel and lifecycle settlement.

```ts
  130  export function createLangGraphQOrchestrator(
  131    options: LangGraphQOrchestratorOptions,
  132  ): QOrchestrator {
  133    const { runtime, cancelRun, logger } = options;
  134    const graph: QCompiledGraph = buildQGraph(
  135      {
  136        runtime,
  137        firewall: options.firewall,
  138        retrieval: options.retrieval,
  139        answer: options.answer,
  140        actions: options.actions ?? createUnconfiguredQActions(),
  141        pausePolicy: options.pausePolicy,
  142        logger,
  143      },
  144      options.checkpoints.saver,
  145    );
  146
  147    function config(ref: QRunRef, signal: AbortSignal | undefined) {
  148      return {
  149        configurable: {
  150          thread_id: threadIdForRun(ref.runId),
  151          checkpoint_ns: Q_CHECKPOINT_NAMESPACE,
  152        },
  153        ...(signal === undefined ? {} : { signal }),
  154      };
  155    }
  156
  157    async function handleOf(ref: QRunRef): Promise<QRunHandle> {
  158      const run = await runtime.readRun(ref);
  159      if (run === null) {
  160        // The run was authorised moments ago; its disappearance is a fault.
  161        throw new Error("q run vanished during orchestration");
  162      }
  163      return toQRunHandle(run);
  164    }
  165
  166    /**
  167     * Drives the engine for one invocation and reconciles the canonical
  168     * lifecycle with what it did. Resolves with the run's handle whatever
  169     * the outcome; only faults that mean the caller's own request was wrong
  170     * are thrown, and those happen before this is reached.
  171     */
  172    async function execute(
  173      ref: QRunRef,
  174      invoke: () => Promise<unknown>,
  175      operation: "start" | "resume",
  176    ): Promise<QRunHandle> {
  177      return tracer.startActiveSpan(
  178        `q.orchestration.${operation}`,
  179        {
  180          attributes: {
  181            "q.run_id": ref.runId,
  182            "q.orchestration_version": Q_ORCHESTRATION_VERSION,
  183          },
  184        },
  185        async (span) => {
  186          const startedAt = Date.now();
  187          let outcome = "unknown";
  188          try {
  189            const result = await invoke();
  190
  191            if (isInterrupted(result)) {
  192              const current = await runtime.readRun(ref);
  193              if (current?.status === "AWAITING_APPROVAL") {
  194                // The approval gate interrupted: the Approval Engine already
  195                // moved the run and recorded the request in one transaction.
  196                outcome = "awaiting_approval";
  197              } else {
  198                // The pause node interrupted with nothing before it; the
  199                // canonical move is made here, outside the engine.
  200                await runtime.pause(ref);
  201                outcome = "paused";
  202              }
  203            } else {
  204              const state = QGraphStateSchema.parse(result);
  205              if (state.context === "DENIED") {
  206                // The Context Firewall left nothing Q may reason over. One
  207                // public code for every reason: the person learns only that
  208                // this is not available in their access context.
  209                await runtime.fail(ref, "POLICY_DENIED");
  210                outcome = "policy_denied";
  211              } else if (
  212                state.action !== null &&
  213                state.action !== "NONE" &&
  214                state.action !== "AWAITING_APPROVAL"
  215              ) {
  216                // The execution gate's durable answer decides the run's end.
  217                // A model never does; nothing here reads what Q said.
  218                outcome = await settleAction(ref, state);
  219              } else if (state.answer === "ANSWERED") {
  220                await runtime.complete(ref, {
  221                  modelPolicyVersion: state.modelPolicyVersion ?? undefined,
  222                  promptBundleVersion: state.promptBundleVersion ?? undefined,
  223                });
  224                outcome = "completed";
  225              } else if (state.answer === "FAILED") {
  226                // The gateway ended without an answer: a coded failure, the
  227                // same public sentence family as any other, never its text.
  228                const code = state.answerFailure ?? "MODEL_PROVIDER_UNAVAILABLE";
  229                const current = await runtime.readRun(ref);
  230                if (
  231                  code === "RUN_CANCELLED" &&
  232                  current?.status === "CANCEL_REQUESTED"
  233                ) {
  234                  await runtime.finishCancellation(ref);
  235                  outcome = "cancelled";
  236                } else {
  237                  await runtime.fail(
  238                    ref,
  239                    code,
  240                    options.answer.failureNotice?.(ref.runId),
  241                  );
  242                  outcome = "answer_failed";
  243                }
  244              } else {
  245                // No model execution is configured (CQ-Q-005). The run ends
  246                // honestly: a retryable public failure, never a fake answer.
  247                await runtime.fail(ref, "MODEL_PROVIDER_UNAVAILABLE");
  248                outcome = "model_not_configured";
  249              }
  250            }
  251          } catch (error: unknown) {
  252            const cause = rootCause(error);
  253            if (cause instanceof QCancellationSignal) {
  254              await runtime.finishCancellation(ref);
  255              outcome = "cancelled";
  256            } else if (cause instanceof QTerminalSignal) {
  257              outcome = "already_terminal";
  258            } else {
  259              // Diagnostics stay here. The run gets a coded failure and the
  260              // person a plain sentence; the engine's error never travels.
  261              logger?.error(
  262                { err: error, qRunId: ref.runId, operation },
  263                "q orchestration failed",
  264              );
  265              await runtime.fail(ref, "INTERNAL_ERROR");
  266              outcome = "failed";
  267            }
  268          } finally {
  269            span.setAttribute("q.outcome", outcome);
  270            span.setAttribute("q.duration_ms", Date.now() - startedAt);
  271            span.end();
  272          }
  273          logger?.info(
  274            {
  275              qRunId: ref.runId,
  276              operation,
  277              outcome,
  278              orchestrationVersion: Q_ORCHESTRATION_VERSION,
  279              durationMs: Date.now() - startedAt,
  280            },
  281            "q orchestration returned",
  282          );
  283          return handleOf(ref);
  284        },
  285      );
  286    }
  287
  288    /** Maps the action gate's outcome onto the canonical lifecycle. */
  289    async function settleAction(
  290      ref: QRunRef,
  291      state: QGraphState,
  292    ): Promise<string> {
  293      switch (state.action) {
  294        case "EXECUTED":
  295        case "ALREADY_EXECUTED":
  296          await runtime.complete(ref, {
  297            modelPolicyVersion: state.modelPolicyVersion ?? undefined,
  298            promptBundleVersion: state.promptBundleVersion ?? undefined,
  299          });
  300          return "action_executed";
  301        case "IN_PROGRESS":
  302          // Another worker holds the claim and will settle the run.
  303          return "action_in_progress";
  304        case "NOT_APPROVED":
  305          // Declined, expired or withdrawn: the run ended without a side
  306          // effect (a rejection already completed it; expiry ends it here).
  307          if (
  308            state.actionFailure === "APPROVAL_EXPIRED" ||
  309            state.actionFailure === "EXPIRED"
  310          ) {
  311            await runtime.fail(ref, "APPROVAL_EXPIRED");
  312            return "action_expired";
  313          }
  314          await runtime.complete(ref, {
  315            modelPolicyVersion: state.modelPolicyVersion ?? undefined,
  316            promptBundleVersion: state.promptBundleVersion ?? undefined,
  317          });
  318          return "action_not_approved";
  319        case "BLOCKED":
  320          await runtime.fail(ref, "POLICY_DENIED");
  321          return "action_blocked";
  322        case "FAILED":
  323        case "RECONCILIATION_REQUIRED":
  324          await runtime.fail(ref, "TOOL_FAILED");
  325          return "action_failed";
  326        case "NONE":
  327        case "AWAITING_APPROVAL":
  328        case null:
  329          return "unknown";
  330      }
  331    }
  332
  333    return {
  334      start: async (input: QOrchestrationInput) => {
  335        const run = await runtime.loadOwnedRun(
  336          input.actor,
  337          input.runId,
  338          input.correlationId,
  339        );
  340        if (isTerminal(run.status)) {
  341          throw new QRunAlreadyTerminalError(run.status);
  342        }
  343        if (run.status !== "RECEIVED" || run.orchestrationVersion !== null) {
  344          throw new QRunAlreadyStartedError();
  345        }
  346        requireSameOrganisationContext(run, input.actor);
  347        const ref = runRef(run);
  348
  349        // RECEIVED → PREFLIGHT, stamping the version and the real start time.
  350        // Anything but ADVANCED means another starter or a cancellation got
  351        // there first; the engine is not touched.
  352        const begun = await runtime.begin(ref, Q_ORCHESTRATION_VERSION);
  353        if (begun.kind === "CANCEL_REQUESTED") {
  354          await runtime.finishCancellation(ref);
  355          return handleOf(ref);
  356        }
  357        if (begun.kind !== "ADVANCED") {
  358          if (isTerminal(begun.run.status)) {
  359            return toQRunHandle(begun.run);
  360          }
  361          throw new QRunAlreadyStartedError();
  362        }
  363
  364        const initial: QGraphState = {
  365          runId: run.id,
  366          tenantId: run.tenantId,
  367          actorUserId: run.actorUserId,
  368          conversationId: run.conversationId,
  369          actorOrganisationId: input.actor.organisationId ?? null,
  370          actorMembershipId: input.actor.membershipId ?? null,
  371          capability: run.capability,
  372          subjects: run.subjects,
  373          viewing: run.viewing ?? null,
  374          screen: run.screen ?? null,
  375          orchestrationVersion: Q_ORCHESTRATION_VERSION,
  376          correlationId: run.correlationId,
  377          preflight: null,
  378          context: null,
  379          contextPlan: null,
  380          retrieval: null,
  381          answer: null,
  382          answerFailure: null,
  383          modelPolicyVersion: null,
  384          promptBundleVersion: null,
  385          action: null,
  386          actionId: null,
  387          approvalId: null,
  388          actionFailure: null,
  389        };
  390        return execute(
  391          ref,
  392          () => detached(() => graph.invoke(initial, config(ref, input.signal))),
  393          "start",
  394        );
  395      },
  396
  397      resume: async (input: QResumeInput) => {
  398        const run = await runtime.loadOwnedRun(
  399          input.actor,
  400          input.runId,
  401          input.correlationId,
  402        );
  403        if (isTerminal(run.status)) {
  404          throw new QRunAlreadyTerminalError(run.status);
  405        }
  406        if (
  407          run.status !== "AWAITING_INPUT" &&
  408          run.status !== "AWAITING_APPROVAL"
  409        ) {
  410          throw new QRunNotResumableError(run.status);
  411        }
  412        // Fail closed on a version this build cannot continue — before the
  413        // canonical lifecycle moves and before the engine reads a checkpoint.
  414        assertResumableOrchestrationVersion(run.orchestrationVersion);
  415        // The organisation context a run was started under does not follow
  416        // the person into another organisation: a run is resumed only in the
  417        // context that owns it.
  418        requireSameOrganisationContext(run, input.actor);
  419        const ref = runRef(run);
  420
  421        // AWAITING_INPUT → PLANNING, or AWAITING_APPROVAL → ACTION_EXECUTION.
  422        // Two concurrent resumes serialise on the row lock; the second finds
  423        // the run already moved and is refused rather than driving the
  424        // engine a second time. Moving to ACTION_EXECUTION is a lifecycle
  425        // fact, not authority: the gate the resumed node calls re-verifies
  426        // the approval before anything executes.
  427        const resumed =
  428          run.status === "AWAITING_APPROVAL"
  429            ? await runtime.resumeFromApproval(ref)
  430            : await runtime.resumeFromPause(ref);
  431        if (resumed.kind !== "ADVANCED") {
  432          if (isTerminal(resumed.run.status)) {
  433            throw new QRunAlreadyTerminalError(resumed.run.status);
  434          }
  435          throw new QRunNotResumableError(resumed.run.status);
  436        }
  437
  438        return execute(
  439          ref,
  440          () =>
  441            detached(() =>
  442              graph.invoke(
  443                // The actor's organisation context is taken from THIS authorised
  444                // request, never from the checkpoint: whatever the engine
  445                // remembers, the firewall re-plans on behalf of who is here now.
  446                new Command({
  447                  resume: { kind: "Q_ORCHESTRATION_RESUME" },
  448                  update: {
  449                    actorOrganisationId: input.actor.organisationId ?? null,
  450                    actorMembershipId: input.actor.membershipId ?? null,
  451                  },
  452                }),
  453                config(ref, input.signal),
  454              ),
  455            ),
  456          "resume",
  457        );
  458      },
  459
  460      cancel: async (input: QCancelInput) => {
  461        // The canonical lifecycle is the authority. A running engine sees the
  462        // result at its next boundary; a suspended one is simply never
  463        // resumed, because resume checks the canonical status first.
  464        const result = await cancelRun({
  465          actor: input.actor,
  466          runId: input.runId,
  467          correlationId: input.correlationId,
  468        });
  469        return toQRunHandle(result.run);
  470      },
  471    };
  472  }
```
