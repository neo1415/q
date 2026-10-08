# Evidence: packages/q-orchestrator/src/graph.ts (lines 1-512)

- Original path: `packages/q-orchestrator/src/graph.ts`
- Line range: 1-512 (HEAD 520bd123)
- Why included: Complete LangGraph investigation graph: preflight, firewall, pause, retrieval, answer, action prepare, approval gate.

```ts
    1  import {
    2    END,
    3    START,
    4    StateGraph,
    5    interrupt,
    6    type BaseCheckpointSaver,
    7  } from "@langchain/langgraph";
    8  import type { RunnableConfig } from "@langchain/core/runnables";
    9  
   10  import type {
   11    PermittedContextPlan,
   12    QActionProposalId,
   13    QRunStatus,
   14    QVisibleStage,
   15  } from "@capital-q/contracts";
   16  
   17  type QActionExecuteId = QActionProposalId;
   18  import type { Logger } from "@capital-q/observability";
   19  import {
   20    QRunNotFoundError,
   21    type ContextFirewallPort,
   22    type QActionPort,
   23    type QAnswerPort,
   24    type QLifecycleOutcome,
   25    type QOrchestrationRuntime,
   26    type QOrchestrationSubjectContext,
   27    type QPausePolicy,
   28    type QRetrievalPort,
   29    type QRunRecord,
   30    type QRunRef,
   31  } from "@capital-q/q-runtime";
   32  import { ActorContextSchema, type ActorContext } from "@capital-q/security";
   33  
   34  import {
   35    QGraphAnnotation,
   36    type QContextPlanDescriptor,
   37    type QGraphState,
   38  } from "./state.js";
   39  import { assertResumableOrchestrationVersion } from "./version.js";
   40  
   41  /**
   42   * The investigation graph (packet §63; CQ-Q-008 §46-§49):
   43   *
   44   *   START → preflight → context firewall → pause → retrieve → answer
   45   *                            ↓ denied                  ↓ denied      ↓
   46   *                           END                       END     action prepare
   47   *                                                                    ↓ proposed
   48   *                                                            approval gate (interrupt)
   49   *                                                                    ↓ resumed
   50   *                                                            execute via gate → END
   51   *
   52   * The approval gate interrupts AFTER the Approval Engine has persisted the
   53   * action, the approval request and the run's AWAITING_APPROVAL status in
   54   * one transaction. The interrupt is a suspension point, never authority:
   55   * on resume the same node asks the engine's execution gate, which
   56   * re-verifies the approval record, the payload hash, the actor's current
   57   * permission and the idempotent claim. A replayed node cannot execute
   58   * twice because the action row, not the checkpoint, says what happened.
   59   *
   60   * These nodes are orchestration seams, not intelligence. Each begins at a
   61   * boundary check against the canonical run — the run, not the engine,
   62   * decides whether work may continue — and each advances the canonical
   63   * lifecycle through the runtime's replay-idempotent moves.
   64   *
   65   * The Context Firewall (CQ-Q-004) owns POLICY_CHECK. It runs before any
   66   * retrieval, and retrieval runs it AGAIN: a plan is a decision at an
   67   * instant, so a resumed or long-lived run re-plans against live policy and
   68   * a checkpoint can never carry permission forward. Nothing here calls a
   69   * model, retrieves content, or asks a model what may be seen.
   70   *
   71   * Node names never leave this file. The person sees `QVisibleStage`
   72   * values chosen here; nothing carries a node name.
   73   */
   74  
   75  export type QGraphDependencies = {
   76    readonly runtime: QOrchestrationRuntime;
   77    readonly firewall: ContextFirewallPort;
   78    readonly retrieval: QRetrievalPort;
   79    readonly answer: QAnswerPort;
   80    /** The Approval Engine seam (CQ-Q-008). */
   81    readonly actions: QActionPort;
   82    readonly pausePolicy: QPausePolicy;
   83    readonly logger?: Logger | undefined;
   84  };
   85  
   86  /** The engine is told to stop: the canonical run asked for cancellation. */
   87  export class QCancellationSignal extends Error {
   88    constructor() {
   89      super("cancellation requested");
   90      this.name = "QCancellationSignal";
   91    }
   92  }
   93  
   94  /** The run ended (by someone else) while the engine was between nodes. */
   95  export class QTerminalSignal extends Error {
   96    readonly status: QRunStatus;
   97  
   98    constructor(status: QRunStatus) {
   99      super("run already terminal");
  100      this.name = "QTerminalSignal";
  101      this.status = status;
  102    }
  103  }
  104  
  105  /** The value the pause node interrupts with. Internal; never a client contract. */
  106  export const Q_INTERNAL_PAUSE = { kind: "Q_ORCHESTRATION_PAUSE" } as const;
  107  /** The value the approval gate interrupts with. Internal; never authority. */
  108  export const Q_APPROVAL_PAUSE = { kind: "Q_APPROVAL_PAUSE" } as const;
  109  
  110  function ref(state: QGraphState): QRunRef {
  111    return {
  112      runId: state.runId,
  113      tenantId: state.tenantId,
  114      actorUserId: state.actorUserId,
  115    };
  116  }
  117  
  118  function subjectContext(state: QGraphState): QOrchestrationSubjectContext {
  119    return {
  120      runId: state.runId,
  121      tenantId: state.tenantId,
  122      actorUserId: state.actorUserId,
  123      capability: state.capability,
  124      subjects: state.subjects,
  125    };
  126  }
  127  
  128  /**
  129   * The actor the firewall is asked on behalf of: the person who owns the
  130   * run, in the organisation context that was authorised when the engine
  131   * was (re)started. Re-validated as an ActorContext; a malformed checkpoint
  132   * cannot become an actor.
  133   */
  134  function actorFor(state: QGraphState): ActorContext {
  135    return ActorContextSchema.parse({
  136      userId: state.actorUserId,
  137      tenantId: state.tenantId,
  138      ...(state.actorOrganisationId === null
  139        ? {}
  140        : { organisationId: state.actorOrganisationId }),
  141      ...(state.actorMembershipId === null
  142        ? {}
  143        : { membershipId: state.actorMembershipId }),
  144      actorType: "HUMAN",
  145    });
  146  }
  147  
  148  function describe(plan: PermittedContextPlan): QContextPlanDescriptor {
  149    return {
  150      planId: plan.planId,
  151      fingerprint: plan.fingerprint,
  152      policyVersion: plan.policyVersion,
  153      taskClass: plan.purpose.taskClass,
  154      scopeKinds: plan.scopes.map((scope) => scope.kind),
  155      maxSensitivity: plan.maxSensitivity,
  156      evaluatedAt: plan.evaluatedAt,
  157      revalidateAfter: plan.revalidateAfter,
  158    };
  159  }
  160  
  161  function honour(outcome: QLifecycleOutcome): QRunRecord {
  162    switch (outcome.kind) {
  163      case "ADVANCED":
  164      case "UNCHANGED":
  165        return outcome.run;
  166      case "CANCEL_REQUESTED":
  167        throw new QCancellationSignal();
  168      case "TERMINAL":
  169        throw new QTerminalSignal(outcome.run.status);
  170    }
  171  }
  172  
  173  export function buildQGraph(
  174    dependencies: QGraphDependencies,
  175    saver: BaseCheckpointSaver,
  176  ) {
  177    const { runtime, firewall, retrieval, answer, actions, pausePolicy, logger } =
  178      dependencies;
  179  
  180    /**
  181     * The current plan per run, in process memory only. Never checkpointed:
  182     * a pause or a restart empties it, and the next node re-plans against
  183     * live policy. It exists so a straight run asks the firewall twice
  184     * (decision, then pre-retrieval revalidation) rather than three times.
  185     */
  186    const livePlans = new Map<string, PermittedContextPlan>();
  187    /**
  188     * Runs whose plan the firewall node made in this same invocation, with
  189     * no pause since. Retrieval reuses that plan inside its own
  190     * revalidateAfter instead of evaluating policy again milliseconds later
  191     * (live 2026-10-01: three evaluations per Home Q turn, ~135 ms each). A
  192     * pause, a resume or an expired plan still revalidates.
  193     */
  194    const plannedThisInvocation = new Set<string>();
  195  
  196    async function boundary(state: QGraphState): Promise<QRunRecord> {
  197      const run = await runtime.readRun(ref(state));
  198      if (run === null) {
  199        throw new QRunNotFoundError();
  200      }
  201      if (run.status === "CANCEL_REQUESTED") {
  202        throw new QCancellationSignal();
  203      }
  204      if (
  205        run.status === "COMPLETED" ||
  206        run.status === "FAILED" ||
  207        run.status === "CANCELLED" ||
  208        run.status === "EXPIRED"
  209      ) {
  210        throw new QTerminalSignal(run.status);
  211      }
  212      return run;
  213    }
  214  
  215    async function advance(
  216      state: QGraphState,
  217      to: QRunStatus,
  218      stage?: QVisibleStage,
  219    ): Promise<QRunRecord> {
  220      return honour(await runtime.advance(ref(state), to, stage));
  221    }
  222  
  223    /** Ask the firewall for this run, now. */
  224    async function plan(state: QGraphState) {
  225      return firewall.plan({
  226        actor: actorFor(state),
  227        runId: state.runId,
  228        correlationId: state.correlationId,
  229        capability: state.capability,
  230        subjects: state.subjects,
  231        viewing: state.viewing,
  232        screen: state.screen,
  233      });
  234    }
  235  
  236    // Deterministic checks only: the run exists, is executable, carries a
  237    // conversation, and was stamped with a version this build understands.
  238    const preflight = async (
  239      state: QGraphState,
  240      config: RunnableConfig,
  241    ): Promise<Partial<QGraphState>> => {
  242      const run = await boundary(state);
  243      if (run.conversationId === null) {
  244        throw new Error("q run has no conversation");
  245      }
  246      assertResumableOrchestrationVersion(run.orchestrationVersion);
  247      // CONTEXT_RESOLUTION and POLICY_CHECK in one transaction, each status
  248      // still taken in order (speed sweep 2026-10-01).
  249      honour(
  250        await runtime.advanceThrough(ref(state), [
  251          "CONTEXT_RESOLUTION",
  252          "POLICY_CHECK",
  253        ]),
  254      );
  255      // Preflight has passed: the person's own latest turn may be read now,
  256      // beside the firewall (ADR 0035). Own words and own turns only; the
  257      // reading is dropped unused if any later stage refuses the run.
  258      answer.preread?.({
  259        runId: state.runId,
  260        tenantId: state.tenantId,
  261        actor: actorFor(state),
  262        correlationId: state.correlationId,
  263        signal: config.signal,
  264      });
  265      return { preflight: "PASSED" };
  266    };
  267  
  268    // The Context Firewall: POLICY_CHECK. Deterministic policy over the
  269    // authorization and disclosure layers decides what Q may reason over;
  270    // a denial ends the run through the orchestrator's POLICY_DENIED path
  271    // and nothing further is retrieved or asked.
  272    const contextFirewall = async (
  273      state: QGraphState,
  274    ): Promise<Partial<QGraphState>> => {
  275      // POLICY_CHECK was taken with CONTEXT_RESOLUTION; this still stops a
  276      // run cancelled or ended since. The run's read and the firewall's
  277      // evaluation are independent, so they run side by side (latency2): a
  278      // run that turns out cancelled throws here and its plan is never used.
  279      const [, decision] = await Promise.all([boundary(state), plan(state)]);
  280      if (decision.outcome === "DENIED") {
  281        livePlans.delete(state.runId);
  282        answer.discard?.(state.runId);
  283        return { context: "DENIED", contextPlan: null };
  284      }
  285      livePlans.set(state.runId, decision.plan);
  286      plannedThisInvocation.add(state.runId);
  287      await advance(state, "PLANNING");
  288      return { context: "AUTHORISED", contextPlan: describe(decision.plan) };
  289    };
  290  
  291    // The only node that may interrupt, and it does nothing else.
  292    const pause = async (state: QGraphState): Promise<Partial<QGraphState>> => {
  293      if (!(await pausePolicy.shouldPause(subjectContext(state)))) {
  294        return {};
  295      }
  296      // A resumed run is planned again, whatever this process remembers.
  297      plannedThisInvocation.delete(state.runId);
  298      interrupt(Q_INTERNAL_PAUSE);
  299      return {};
  300    };
  301  
  302    // Retrieval, behind a fresh plan. Whatever the checkpoint remembers, the
  303    // allowlist handed to retrieval is what policy says NOW: a revoked share,
  304    // a removed membership or a switched organisation since the last
  305    // checkpoint means less context or none.
  306    const retrieve = async (
  307      state: QGraphState,
  308    ): Promise<Partial<QGraphState>> => {
  309      // The move itself refuses a cancelled or ended run (honour), so no
  310      // separate read of the run first. It is awaited before anything is
  311      // retrieved: retrieval never runs for a run that has ended.
  312      await advance(state, "RETRIEVAL");
  313      const held = livePlans.get(state.runId);
  314      const reusable =
  315        plannedThisInvocation.has(state.runId) &&
  316        held !== undefined &&
  317        Date.now() < Date.parse(held.revalidateAfter);
  318      plannedThisInvocation.delete(state.runId);
  319      const decision = reusable
  320        ? { outcome: "AUTHORISED" as const, plan: held }
  321        : await plan(state);
  322      if (decision.outcome === "DENIED") {
  323        livePlans.delete(state.runId);
  324        answer.discard?.(state.runId);
  325        return { context: "DENIED", contextPlan: null, retrieval: null };
  326      }
  327      if (
  328        state.contextPlan !== null &&
  329        state.contextPlan.fingerprint !== decision.plan.fingerprint
  330      ) {
  331        logger?.info(
  332          {
  333            qRunId: state.runId,
  334            previousPlanId: state.contextPlan.planId,
  335            planId: decision.plan.planId,
  336          },
  337          "context plan changed on revalidation",
  338        );
  339      }
  340      livePlans.set(state.runId, decision.plan);
  341      const outcome = await retrieval.retrieve(
  342        subjectContext(state),
  343        decision.plan,
  344      );
  345      return {
  346        context: "AUTHORISED",
  347        contextPlan: describe(decision.plan),
  348        retrieval: outcome.kind,
  349      };
  350    };
  351  
  352    // The answer seam. The plan it hands the (future) model gateway is the
  353    // one retrieval just used, or a fresh one if the process no longer holds
  354    // it. No model is chosen or called here.
  355    const answerNode = async (
  356      state: QGraphState,
  357      config: RunnableConfig,
  358    ): Promise<Partial<QGraphState>> => {
  359      await advance(state, "SYNTHESIS", "PREPARING_ANALYSIS");
  360      let current = livePlans.get(state.runId);
  361      if (current === undefined) {
  362        const decision = await plan(state);
  363        if (decision.outcome === "DENIED") {
  364          answer.discard?.(state.runId);
  365          return { context: "DENIED", contextPlan: null, answer: null };
  366        }
  367        current = decision.plan;
  368      }
  369      livePlans.delete(state.runId);
  370      // The engine's signal reaches the model call: a cancelled invocation
  371      // stops waiting on the provider instead of finishing an answer nobody
  372      // asked for.
  373      const outcome = await answer.answer({
  374        ...subjectContext(state),
  375        actor: actorFor(state),
  376        correlationId: state.correlationId,
  377        retrieval:
  378          state.retrieval === "AUTHORISED_REFERENCES"
  379            ? { kind: "AUTHORISED_REFERENCES", referenceCount: 0 }
  380            : { kind: "NOT_CONFIGURED" },
  381        plan: current,
  382        signal: config.signal,
  383      });
  384      switch (outcome.kind) {
  385        case "ANSWERED":
  386          return {
  387            answer: "ANSWERED",
  388            answerFailure: null,
  389            modelPolicyVersion: outcome.modelPolicyVersion,
  390            promptBundleVersion: outcome.promptBundleVersion,
  391          };
  392        case "FAILED":
  393          return { answer: "FAILED", answerFailure: outcome.diagnosticCode };
  394        case "NOT_CONFIGURED":
  395          return { answer: "NOT_CONFIGURED", answerFailure: null };
  396      }
  397    };
  398  
  399    // The action seam, first half: does this run have something consequential
  400    // to prepare? The engine proposes nothing itself; the port's proposer
  401    // does, and the Approval Engine decides whether it may be proposed. A
  402    // proposal is persisted together with its approval request and the
  403    // run's AWAITING_APPROVAL status before this node returns.
  404    const actionPrepare = async (
  405      state: QGraphState,
  406    ): Promise<Partial<QGraphState>> => {
  407      await boundary(state);
  408      if (state.answer !== "ANSWERED") {
  409        return { action: "NONE" };
  410      }
  411      let current = livePlans.get(state.runId);
  412      if (current === undefined) {
  413        const decision = await plan(state);
  414        if (decision.outcome === "DENIED") {
  415          return { action: "NONE" };
  416        }
  417        current = decision.plan;
  418      }
  419      const outcome = await actions.prepare({
  420        ...subjectContext(state),
  421        actor: actorFor(state),
  422        correlationId: state.correlationId,
  423        plan: current,
  424      });
  425      if (outcome.kind === "NONE") {
  426        return { action: "NONE", actionId: null, approvalId: null };
  427      }
  428      return {
  429        action: "AWAITING_APPROVAL",
  430        actionId: outcome.actionId,
  431        approvalId: outcome.approvalId,
  432      };
  433    };
  434  
  435    // Second half: suspend for the person, and on resume execute through
  436    // the gate. LangGraph re-runs this node from its start on resume, which
  437    // is why nothing before `interrupt` has an effect and nothing after it
  438    // is trusted from memory: the gate reads the action row.
  439    const approvalGate = async (
  440      state: QGraphState,
  441      config: RunnableConfig,
  442    ): Promise<Partial<QGraphState>> => {
  443      if (state.actionId === null) {
  444        return {};
  445      }
  446      interrupt(Q_APPROVAL_PAUSE);
  447      await boundary(state);
  448      const outcome = await actions.executeApproved({
  449        actor: actorFor(state),
  450        runId: state.runId,
  451        tenantId: state.tenantId,
  452        correlationId: state.correlationId,
  453        actionId: state.actionId as QActionExecuteId,
  454        signal: config.signal,
  455      });
  456      switch (outcome.kind) {
  457        case "EXECUTED":
  458        case "ALREADY_EXECUTED":
  459        case "IN_PROGRESS":
  460          return { action: outcome.kind, actionFailure: null };
  461        case "FAILED":
  462        case "RECONCILIATION_REQUIRED":
  463          return { action: outcome.kind, actionFailure: outcome.failureCode };
  464        case "NOT_APPROVED":
  465        case "BLOCKED":
  466          return { action: outcome.kind, actionFailure: outcome.reason };
  467      }
  468    };
  469  
  470    const afterContext = (state: QGraphState) =>
  471      state.context === "DENIED" ? END : "pause_seam";
  472    const afterRetrieval = (state: QGraphState) =>
  473      state.context === "DENIED" ? END : "answer_seam";
  474    const afterAnswer = (state: QGraphState) =>
  475      state.answer === "ANSWERED" ? "action_prepare" : END;
  476    const afterPrepare = (state: QGraphState) =>
  477      state.action === "AWAITING_APPROVAL" ? "approval_gate" : END;
  478  
  479    // Node names are internal (never emitted) and must differ from the state
  480    // channel names, which the engine reserves.
  481    return new StateGraph(QGraphAnnotation)
  482      .addNode("preflight_gate", preflight)
  483      .addNode("context_firewall", contextFirewall)
  484      .addNode("pause_seam", pause)
  485      .addNode("retrieval_seam", retrieve)
  486      .addNode("answer_seam", answerNode)
  487      .addNode("action_prepare", actionPrepare)
  488      .addNode("approval_gate", approvalGate)
  489      .addEdge(START, "preflight_gate")
  490      .addEdge("preflight_gate", "context_firewall")
  491      .addConditionalEdges("context_firewall", afterContext, {
  492        pause_seam: "pause_seam",
  493        [END]: END,
  494      })
  495      .addEdge("pause_seam", "retrieval_seam")
  496      .addConditionalEdges("retrieval_seam", afterRetrieval, {
  497        answer_seam: "answer_seam",
  498        [END]: END,
  499      })
  500      .addConditionalEdges("answer_seam", afterAnswer, {
  501        action_prepare: "action_prepare",
  502        [END]: END,
  503      })
  504      .addConditionalEdges("action_prepare", afterPrepare, {
  505        approval_gate: "approval_gate",
  506        [END]: END,
  507      })
  508      .addEdge("approval_gate", END)
  509      .compile({ checkpointer: saver });
  510  }
  511  
  512  export type QCompiledGraph = ReturnType<typeof buildQGraph>;
```
