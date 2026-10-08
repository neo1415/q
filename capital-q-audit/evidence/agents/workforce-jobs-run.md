# Evidence: apps/q-api/src/composition/workforce/jobs.ts lines 360-642

- Original path: `apps/q-api/src/composition/workforce/jobs.ts`
- Line range: 360-642 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: EXECUTABLE_JOB_TOOLS, plan/gate/run; workforceTracker sets RUNNING and nothing sets INSTRUCTION/DELEGATED_WORK jobs back.

```ts
  360      };
  361  
  362  /** What the lead Q may plan with: the tools its specialists can carry out. */
  363  export const EXECUTABLE_JOB_TOOLS: readonly string[] = [
  364    "search_companies",
  365    "list_my_relationships",
  366    "relationship.interest.express",
  367    "list_messages",
  368    "chat.message.send",
  369    "find_meeting_times",
  370    "list_schedule",
  371    "schedule.meeting.book",
  372  ];
  373  
  374  /** The default budget of one job the lead Q proposes, USD. */
  375  export const DEFAULT_JOB_BUDGET_USD = 0.5;
  376  
  377  export type PlannedJob = {
  378    readonly summary: string;
  379    readonly steps: readonly BoundStep[];
  380    readonly refused: readonly {
  381      readonly key: string;
  382      readonly reason: string;
  383    }[];
  384    readonly cannot: readonly string[];
  385  };
  386  
  387  export function createWorkforceJobs(dependencies: {
  388    readonly store: WorkforceStore;
  389    readonly models: Pick<WorkforceModels, "plan" | "readReply">;
  390    readonly review: OutwardReview;
  391    readonly ports: WorkforcePorts;
  392    /** J6: one unit of `q.agent_jobs` per job; false is the plan's limit. */
  393    readonly meter?:
  394      ((owner: Owner, idempotencyKey: string) => Promise<boolean>) | undefined;
  395    /** J6: whether this month's spend leaves room for a new job. */
  396    readonly withinLimit?: ((owner: Owner) => Promise<boolean>) | undefined;
  397    readonly logger?: Logger | undefined;
  398  }) {
  399    const { store } = dependencies;
  400  
  401    /** The lead Q's plan, bounded by what is permitted and the budget. */
  402    async function plan(
  403      owner: Owner,
  404      input: {
  405        readonly goal: string;
  406        readonly permitted: readonly string[];
  407        readonly budgetUsd: number;
  408      },
  409      trace: { readonly jobId: string; readonly runId: string } | null,
  410    ): Promise<PlannedJob | null> {
  411      const permitted = new Set(input.permitted);
  412      const planned = await dependencies.models.plan(owner, trace, {
  413        goal: input.goal.slice(0, 2_000),
  414        roster: rosterText(permitted),
  415        allowed: `Tools and actions: ${[...permitted].join(", ") || "none"}. Budget for the whole job: $${input.budgetUsd.toFixed(2)}.`,
  416      });
  417      if (planned === null) return null;
  418      const bound = boundPlan(planned.steps, {
  419        permitted,
  420        // The lead's own planning comes out of the same budget.
  421        budgetUsd: Math.max(0, input.budgetUsd - AGENT_REGISTRY.LEAD.budgetUsd),
  422      });
  423      return {
  424        summary: planned.summary,
  425        steps: bound.steps,
  426        refused: bound.refused,
  427        cannot: planned.cannot,
  428      };
  429    }
  430  
  431    /** Files the job for its source (one per source), with its lead run. */
  432    async function file(
  433      owner: Owner,
  434      input: {
  435        readonly goal: string;
  436        readonly budgetUsd: number;
  437        readonly source: {
  438          readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
  439          readonly id: string;
  440        };
  441      },
  442    ): Promise<{ readonly jobId: string; readonly leadRunId: string }> {
  443      const one = await store.ensureJob(owner, {
  444        source: input.source,
  445        goal: input.goal,
  446        budgetUsd: input.budgetUsd,
  447        threshold: 75,
  448        maxRedrafts: 2,
  449        rubricVersion: RUBRIC_VERSION,
  450      });
  451      return { jobId: one.job.id, leadRunId: one.leadRunId };
  452    }
  453  
  454    /**
  455     * The month's limit and the plan's agent-job allowance, checked before
  456     * anything is planned or run; false holds the job with the reason.
  457     */
  458    async function gate(
  459      owner: Owner,
  460      filed: { readonly jobId: string; readonly leadRunId: string },
  461    ): Promise<boolean> {
  462      const hold = async (summary: string) => {
  463        await store.endRun(owner, filed.leadRunId, "HELD", summary);
  464        await store.setJobStatus(owner, filed.jobId, "HELD");
  465      };
  466      if (dependencies.withinLimit !== undefined) {
  467        const room = await dependencies.withinLimit(owner).catch(() => true);
  468        if (!room) {
  469          await hold(
  470            "This month's limit for Q's work is reached; raise it to go on.",
  471          );
  472          return false;
  473        }
  474      }
  475      if (dependencies.meter !== undefined) {
  476        const allowed = await dependencies
  477          .meter(owner, `wf:${filed.jobId}`)
  478          .catch(() => false);
  479        if (!allowed) {
  480          await hold("Your plan's agent jobs for this month are used up.");
  481          return false;
  482        }
  483      }
  484      return true;
  485    }
  486  
  487    /**
  488     * Carries out a plan already bound (and, for a proposed job, approved):
  489     * never re-planned here. Files the job for its source, checks the plan's
  490     * agent-job allowance and the month's limit, then runs agent by agent.
  491     */
  492    async function run(
  493      owner: Owner,
  494      input: {
  495        readonly goal: string;
  496        readonly budgetUsd: number;
  497        readonly source: {
  498          readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
  499          readonly id: string;
  500        };
  501        readonly planned: PlannedJob;
  502      },
  503      filedAlready?: { readonly jobId: string; readonly leadRunId: string },
  504      options: { readonly gated?: boolean | undefined } = {},
  505    ): Promise<StartJobResult> {
  506      const filed = filedAlready ?? (await file(owner, input));
  507      if (options.gated !== true && !(await gate(owner, filed))) {
  508        return { outcome: "PLAN_LIMIT", jobId: filed.jobId };
  509      }
  510      const { jobId, leadRunId } = filed;
  511      const { planned } = input;
  512      const result = await runJob({
  513        jobId,
  514        goal: planned.summary,
  515        steps: planned.steps,
  516        executors: createWorkforceExecutors({
  517          owner,
  518          ports: dependencies.ports,
  519          models: dependencies.models,
  520          review: dependencies.review,
  521          scheduling: planned.steps.some((step) =>
  522            step.tools.includes("schedule.meeting.book"),
  523          ),
  524        }),
  525        recorder: {
  526          ...recorderFor(store, owner),
  527          // The lead is the job's lead run, not a second one.
  528          startRun: (one) =>
  529            one.role === "LEAD"
  530              ? Promise.resolve(leadRunId)
  531              : recorderFor(store, owner).startRun(one),
  532        },
  533      });
  534      const done = result.steps.filter((step) => step.status === "DONE").length;
  535      await store.setJobStatus(
  536        owner,
  537        jobId,
  538        result.steps.length > 0 && done === result.steps.length ? "DONE" : "HELD",
  539      );
  540      return {
  541        outcome: "STARTED",
  542        jobId,
  543        summary: planned.summary,
  544        steps: result.steps.map((step) => ({
  545          key: step.key,
  546          status: step.status,
  547          summary: step.summary,
  548        })),
  549        refused: planned.refused,
  550        cannot: planned.cannot,
  551      };
  552    }
  553  
  554    return {
  555      plan: (
  556        owner: Owner,
  557        input: {
  558          readonly goal: string;
  559          readonly permitted: readonly string[];
  560          readonly budgetUsd: number;
  561        },
  562      ) => plan(owner, input, null),
  563  
  564      file,
  565      run,
  566  
  567      /**
  568       * Plan and carry out one job the person approved. `permitted` is the
  569       * job's grant (tool and action names); `source` ties it to what it was
  570       * approved under, so a replay is the same job.
  571       */
  572      start: async (
  573        owner: Owner,
  574        input: {
  575          readonly goal: string;
  576          readonly permitted: readonly string[];
  577          readonly budgetUsd: number;
  578          readonly source: {
  579            readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
  580            readonly id: string;
  581          };
  582        },
  583      ): Promise<StartJobResult> => {
  584        const filed = await store.ensureJob(owner, {
  585          source: input.source,
  586          goal: input.goal,
  587          budgetUsd: input.budgetUsd,
  588          threshold: 75,
  589          maxRedrafts: 2,
  590          rubricVersion: RUBRIC_VERSION,
  591        });
  592        const jobId = filed.job.id;
  593        const lead = { jobId, leadRunId: filed.leadRunId };
  594        if (!(await gate(owner, lead))) {
  595          return { outcome: "PLAN_LIMIT", jobId };
  596        }
  597        const planned = await plan(owner, input, {
  598          jobId,
  599          runId: filed.leadRunId,
  600        });
  601        if (planned === null) {
  602          await store.endRun(
  603            owner,
  604            filed.leadRunId,
  605            "HELD",
  606            "Couldn't plan this job just now.",
  607          );
  608          await store.setJobStatus(owner, jobId, "HELD");
  609          return { outcome: "NOT_PLANNED", jobId };
  610        }
  611        return run(owner, { ...input, planned }, lead, { gated: true });
  612      },
  613    };
  614  }
  615  
  616  export type WorkforceJobs = ReturnType<typeof createWorkforceJobs>;
  617  
  618  /**
  619   * Founder brief J5: standing instructions and delegated work are Q's jobs
  620   * too -- the same job record, one per source, shown on the workforce page
  621   * as it runs. Best effort: a record that cannot be written never stops the
  622   * work it describes.
  623   */
  624  export function workforceTracker(
  625    store: WorkforceStore,
  626    kind: "INSTRUCTION" | "DELEGATED_WORK",
  627  ) {
  628    return async (
  629      owner: Owner,
  630      source: { readonly id: string; readonly goal: string },
  631    ): Promise<void> => {
  632      const filed = await store.ensureJob(owner, {
  633        source: { kind, id: source.id },
  634        goal: source.goal,
  635        budgetUsd: DEFAULT_JOB_BUDGET_USD,
  636        threshold: 75,
  637        maxRedrafts: 2,
  638        rubricVersion: RUBRIC_VERSION,
  639      });
  640      await store.setJobStatus(owner, filed.job.id, "RUNNING");
  641    };
  642  }
```
