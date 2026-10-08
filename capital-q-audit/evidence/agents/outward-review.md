# Evidence: apps/q-api/src/composition/workforce/review.ts lines 88-426

- Original path: `apps/q-api/src/composition/workforce/review.ts`
- Line range: 88-426 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: OutwardReview: NEAR_MISS_POINTS=10, HELD outcome recorded inside review(), settle() returns early for anything not PASSED (near-miss cards never recorded as OFFERED).

```ts
   88  /**
   89   * Tensorgate, 8 Oct: a code-clean draft this many points under the bar
   90   * (out of 100; the bar is 75) is offered to the person rather than lost.
   91   */
   92  export const NEAR_MISS_POINTS = 10;
   93  
   94  /**
   95   * A message's job, writer and reviewer runs, filed before its first draft
   96   * is written so the writer's own call is priced under the job (J6).
   97   */
   98  export type PreparedDraft = {
   99    readonly jobId: string;
  100    readonly writer: string;
  101    readonly reviewer: string;
  102    readonly policy: { readonly threshold: number; readonly maxRedrafts: number };
  103    /** The correlation id the first draft's model call carries. */
  104    readonly correlationId: string;
  105  };
  106  
  107  export type OutwardReview = {
  108    /** Files the job and runs before the first draft; null without a store. */
  109    readonly prepare: (
  110      who: Owner,
  111      source: OutwardSource,
  112      draft: Pick<OutwardDraft, "channel" | "counterpartName">,
  113    ) => Promise<PreparedDraft | null>;
  114    readonly review: (
  115      who: Owner,
  116      source: OutwardSource,
  117      draft: OutwardDraft,
  118      options?: {
  119        /** Code's own checks, re-run on a redraft. A string is the problem. */
  120        readonly recheck?: ((body: string) => string | null) | undefined;
  121        /** A job planned by the lead Q files the draft under its own run. */
  122        readonly job?:
  123          { readonly jobId: string; readonly parentRunId: string } | undefined;
  124        /** Filed already, before the first draft was written. */
  125        readonly prepared?: PreparedDraft | null | undefined;
  126        /** Hand back a near miss (HELD, `nearMiss`) for the person's card. */
  127        readonly nearMiss?: boolean | undefined;
  128      },
  129    ) => Promise<OutwardVerdict>;
  130    /** A prepared message the writer had nothing honest for: its runs end. */
  131    readonly abandon: (who: Owner, prepared: PreparedDraft) => Promise<void>;
  132    /** What happened to a passed draft: sent by Q, or offered for approval. */
  133    readonly settle: (
  134      who: Owner,
  135      verdict: OutwardVerdict,
  136      outcome: "SENT" | "OFFERED",
  137      qActionId?: string | null,
  138    ) => Promise<void>;
  139  };
  140  
  141  /** The words a held draft carries back to the person. */
  142  export function heldLine(verdict: OutwardVerdict, counterpart: string): string {
  143    if (verdict.verdict === "PASSED") return "";
  144    const why: Record<HoldReason, string> = {
  145      BELOW_BAR: `didn't reach your bar${verdict.score === null ? "" : ` (scored ${String(verdict.score)})`}`,
  146      INTEGRITY: "would have said something Capital Q can't stand behind",
  147      REVIEW_UNAVAILABLE: "couldn't be checked just now",
  148      THREAD_MISMATCH: "still didn't answer what they last asked or offered",
  149      WRITER_GAVE_UP: "couldn't be written honestly from what you approved",
  150      CODE_CHECK: "broke one of the rules for this conversation when redrafted",
  151    };
  152    return `Q held a message to ${counterpart.slice(0, 80)}: it ${why[verdict.reason]}. You can read it on your workforce page and send your own.`.slice(
  153      0,
  154      300,
  155    );
  156  }
  157  
  158  export function createOutwardReview(dependencies: {
  159    readonly models: Pick<WorkforceModels, "review" | "redraft">;
  160    readonly store?: WorkforceStore | undefined;
  161    readonly policy?: ReviewPolicy | undefined;
  162    readonly logger?: Logger | undefined;
  163  }): OutwardReview {
  164    const { store, logger } = dependencies;
  165    const basePolicy = dependencies.policy ?? DEFAULT_REVIEW_POLICY;
  166  
  167    async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  168      try {
  169        return await work();
  170      } catch (error: unknown) {
  171        logger?.warn({ err: error }, "workforce record not written");
  172        return fallback;
  173      }
  174    }
  175  
  176    async function file(
  177      who: Owner,
  178      source: OutwardSource,
  179      draft: Pick<OutwardDraft, "channel" | "counterpartName">,
  180      job: { readonly jobId: string; readonly parentRunId: string } | undefined,
  181    ): Promise<PreparedDraft | null> {
  182      if (store === undefined) return null;
  183      return quietly(async () => {
  184        const filedJob =
  185          job === undefined
  186            ? await store.ensureJob(who, {
  187                source: { kind: source.kind, id: source.id },
  188                goal: source.goal,
  189                budgetUsd: 0.5,
  190                threshold: basePolicy.threshold,
  191                maxRedrafts: basePolicy.maxRedrafts,
  192                rubricVersion: RUBRIC_VERSION,
  193              })
  194            : null;
  195        const jobId = job?.jobId ?? filedJob?.job.id ?? null;
  196        const parent = job?.parentRunId ?? filedJob?.leadRunId ?? null;
  197        if (jobId === null || parent === null) return null;
  198        const goal = `${draft.channel === "EMAIL" ? "Email" : "Message"} to ${draft.counterpartName}`;
  199        const writer = await store.startRun(who, {
  200          jobId,
  201          role: "WRITER",
  202          agentName: "Writer",
  203          goal,
  204          tools: [],
  205          budgetUsd: 0.1,
  206          stepKey: null,
  207          spawnedByRunId: parent,
  208        });
  209        const reviewer = await store.startRun(who, {
  210          jobId,
  211          role: "REVIEWER",
  212          agentName: "Reviewer",
  213          goal: `Grade: ${goal}`,
  214          tools: [],
  215          budgetUsd: 0.1,
  216          stepKey: null,
  217          spawnedByRunId: parent,
  218        });
  219        return {
  220          jobId,
  221          writer,
  222          reviewer,
  223          policy: {
  224            threshold: filedJob?.job.review_threshold ?? basePolicy.threshold,
  225            maxRedrafts: filedJob?.job.max_redrafts ?? basePolicy.maxRedrafts,
  226          },
  227          correlationId: workforceCorrelationId(jobId, writer),
  228        };
  229      }, null);
  230    }
  231  
  232    return {
  233      prepare: (who, source, draft) => file(who, source, draft, undefined),
  234  
  235      abandon: async (who, prepared) => {
  236        if (store === undefined) return;
  237        await quietly(async () => {
  238          await store.endRun(who, prepared.writer, "DONE", "Nothing to say yet.");
  239          await store.endRun(
  240            who,
  241            prepared.reviewer,
  242            "SKIPPED",
  243            "Nothing to grade.",
  244          );
  245        }, undefined);
  246      },
  247  
  248      review: async (who, source, draft, options) => {
  249        // The job, its lead, and this message's writer and reviewer runs.
  250        const filed =
  251          options?.prepared ?? (await file(who, source, draft, options?.job));
  252        const policy = filed?.policy ?? basePolicy;
  253        const frame = {
  254          principalName: draft.principalName.slice(0, 120),
  255          counterpartName: draft.counterpartName.slice(0, 200),
  256          channel: draft.channel,
  257          stage: draft.stage,
  258          purpose: draft.purpose.slice(0, 600),
  259          material: draft.material.slice(0, 6_000),
  260          thread: draft.thread.slice(-8_000),
  261        };
  262        const reviewTrace =
  263          filed === null ? null : { jobId: filed.jobId, runId: filed.reviewer };
  264        const writerTrace =
  265          filed === null ? null : { jobId: filed.jobId, runId: filed.writer };
  266        // Thread consistency: what their latest message left open, by code.
  267        const asks =
  268          draft.stage === "REPLY" ? pendingAsks(draft.theirLatest) : [];
  269        const outcome = await writeWithReview(
  270          draft.body,
  271          {
  272            review: (body) =>
  273              dependencies.models.review(who, reviewTrace, {
  274                ...frame,
  275                pendingAsks: asksLine(asks),
  276                draft: body.slice(0, 4_000),
  277              }),
  278            consistency: (body) => threadProblems(body, asks),
  279            threadRule: asks.length > 0,
  280            // The writer is told what their latest message left open, in
  281            // code's fixed words, beside the fixes (Tensorgate: a redraft
  282            // asked Zino the very question Zino had asked).
  283            redraft: (body, feedback) =>
  284              dependencies.models.redraft(who, writerTrace, {
  285                ...frame,
  286                draft: body.slice(0, 4_000),
  287                feedback: (asks.length === 0
  288                  ? feedback
  289                  : `${feedback}\nWhat their latest message left open (code): ${asksLine(asks)} Respond to it; never ask them what they already asked or offered.`
  290                ).slice(0, 2_000),
  291              }),
  292            recheck: options?.recheck,
  293            ...(options?.nearMiss === true
  294              ? { nearMissPoints: NEAR_MISS_POINTS }
  295              : {}),
  296            ...(filed === null || store === undefined
  297              ? {}
  298              : {
  299                  onDraft: (one) =>
  300                    store.addDraft(who, {
  301                      jobId: filed.jobId,
  302                      writerRunId: filed.writer,
  303                      attempt: one.attempt,
  304                      parentDraftId: one.parentDraftId,
  305                      channel: draft.channel,
  306                      counterpartName: draft.counterpartName,
  307                      body: one.body,
  308                    }),
  309                  onGrade: async (draftId, grade) => {
  310                    logger?.info(
  311                      {
  312                        jobId: filed.jobId,
  313                        draftId,
  314                        score: grade.score,
  315                        threshold: policy.threshold,
  316                        passed: grade.passed,
  317                        failedIntegrity: grade.failedIntegrity,
  318                        criteria: grade.criteria.map(
  319                          (one) => `${one.criterion}:${String(one.score)}`,
  320                        ),
  321                        threadProblems: grade.threadProblems?.length ?? 0,
  322                      },
  323                      "workforce draft graded",
  324                    );
  325                    if (draftId === null) return;
  326                    await store.addGrade(who, {
  327                      jobId: filed.jobId,
  328                      draftId,
  329                      reviewerRunId: filed.reviewer,
  330                      grade,
  331                      threshold: policy.threshold,
  332                      maxRedrafts: policy.maxRedrafts,
  333                      rubricVersion: RUBRIC_VERSION,
  334                      promptVersion: DRAFT_REVIEW_PROMPT_VERSION,
  335                    });
  336                  },
  337                  onHandoff: (handoff) =>
  338                    store.handoff(who, {
  339                      jobId: filed.jobId,
  340                      fromRunId:
  341                        handoff.from === "WRITER" ? filed.writer : filed.reviewer,
  342                      toRunId:
  343                        handoff.to === "WRITER" ? filed.writer : filed.reviewer,
  344                      draftId: handoff.draftId,
  345                      note: handoff.note,
  346                    }),
  347                }),
  348          },
  349          policy,
  350        );
  351        if (filed !== null && store !== undefined) {
  352          await quietly(async () => {
  353            const passed = outcome.verdict === "PASSED";
  354            await store.endRun(
  355              who,
  356              filed.writer,
  357              passed ? "DONE" : "HELD",
  358              passed
  359                ? `Wrote it in ${String(outcome.attempts)} ${outcome.attempts === 1 ? "draft" : "drafts"}.`
  360                : "Its draft was held.",
  361            );
  362            await store.endRun(
  363              who,
  364              filed.reviewer,
  365              passed ? "DONE" : "HELD",
  366              outcome.grade === null
  367                ? "Couldn't grade it."
  368                : `Scored ${String(outcome.grade.score)} against a bar of ${String(policy.threshold)}.`,
  369            );
  370            if (outcome.verdict === "HELD" && outcome.draftId !== null) {
  371              await store.addOutcome(who, {
  372                jobId: filed.jobId,
  373                draftId: outcome.draftId,
  374                outcome: "HELD",
  375                reason: outcome.reason,
  376                qActionId: null,
  377              });
  378            }
  379          }, undefined);
  380        }
  381        const jobId = filed?.jobId ?? null;
  382        return outcome.verdict === "PASSED"
  383          ? {
  384              verdict: "PASSED",
  385              body: outcome.body,
  386              score: outcome.grade.score,
  387              attempts: outcome.attempts,
  388              jobId,
  389              draftId: outcome.draftId,
  390            }
  391          : {
  392              verdict: "HELD",
  393              reason: outcome.reason,
  394              body: outcome.body,
  395              score: outcome.grade?.score ?? null,
  396              feedback: outcome.grade?.feedback ?? "",
  397              jobId,
  398              draftId: outcome.draftId,
  399              ...(outcome.nearMiss === true ? { nearMiss: true as const } : {}),
  400            };
  401      },
  402  
  403      settle: async (who, verdict, outcome, qActionId = null) => {
  404        if (
  405          store === undefined ||
  406          verdict.verdict !== "PASSED" ||
  407          verdict.jobId === null ||
  408          verdict.draftId === null
  409        ) {
  410          return;
  411        }
  412        const { jobId, draftId } = verdict;
  413        await quietly(
  414          () =>
  415            store.addOutcome(who, {
  416              jobId,
  417              draftId,
  418              outcome,
  419              reason: null,
  420              qActionId,
  421            }),
  422          undefined,
  423        );
  424      },
  425    };
  426  }
```
