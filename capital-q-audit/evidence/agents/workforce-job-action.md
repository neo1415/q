# Evidence: apps/q-api/src/composition/workforce/job-actions.ts lines 260-340

- Original path: `apps/q-api/src/composition/workforce/job-actions.ts`
- Line range: 260-340 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Approved job runs fire-and-forget (void jobs.run); no resume after restart.

```ts
  260
  261  export function createWorkforceJobActions(dependencies: {
  262    /** The jobs runner for one approver, over their own ports. */
  263    readonly jobsFor: (actor: ActorContext) => WorkforceJobs;
  264    readonly logger?: Logger | undefined;
  265  }): readonly AnyQActionDefinition[] {
  266    const { logger } = dependencies;
  267    return [
  268      defineQAction<WorkforceJobStartPayload, z.infer<typeof StartedSchema>>({
  269        actionType: WORKFORCE_JOB_START,
  270        version: 1,
  271        riskClass: "CONFIRM_REQUIRED",
  272        owner: "q-api",
  273        description:
  274          "Runs one job the lead Q planned, exactly as approved: each step by its specialist (or a helper with only its step's tools), as the approver, within the plan's tools and budget; every outward message passes the reviewer.",
  275        payload: WorkforceJobStartPayloadSchema,
  276        result: StartedSchema,
  277        targets: (payload): readonly QSubjectRef[] => [
  278          { kind: "USER", userId: payload.ownerUserId },
  279        ],
  280        describe: (payload) => ({
  281          summary: `Q's team: ${payload.summary}`.slice(0, 200),
  282          preview: preview(payload),
  283        }),
  284        confirm: () =>
  285          "On it. You can follow each step under Q's team on your Work page.",
  286        authorize: (payload, actor) =>
  287          Promise.resolve(
  288            actor.actorType !== "HUMAN"
  289              ? { outcome: "DENY" as const, code: "NOT_A_PERSON" }
  290              : payload.ownerUserId !== actor.userId
  291                ? { outcome: "DENY" as const, code: "NOT_YOURS" }
  292                : { outcome: "ALLOW" as const },
  293          ),
  294        executor: {
  295          execute: async (action, context) => {
  296            const owner: Owner = {
  297              tenantId: context.approver.tenantId,
  298              userId: context.approver.userId,
  299            };
  300            const jobs = dependencies.jobsFor(context.approver);
  301            try {
  302              const filed = await jobs.file(owner, {
  303                goal: action.payload.goal,
  304                budgetUsd: Number(action.payload.budgetUsd),
  305                source: { kind: "JOB", id: action.actionId },
  306              });
  307              // The job runs past the approval: never inside it (model calls,
  308              // messages and bookings are slow and each is idempotent by key).
  309              void jobs
  310                .run(
  311                  owner,
  312                  {
  313                    goal: action.payload.goal,
  314                    budgetUsd: Number(action.payload.budgetUsd),
  315                    source: { kind: "JOB", id: action.actionId },
  316                    planned: plannedFrom(action.payload),
  317                  },
  318                  filed,
  319                )
  320                .catch((error: unknown) => {
  321                  logger?.warn(
  322                    { err: error, actionId: action.actionId },
  323                    "workforce job did not finish",
  324                  );
  325                });
  326              return { outcome: "EXECUTED", result: { jobId: filed.jobId } };
  327            } catch (error: unknown) {
  328              logger?.warn(
  329                { err: error, actionId: action.actionId },
  330                "workforce job not started",
  331              );
  332              return {
  333                outcome: "FAILED",
  334                failureCode: "NOT_FILED",
  335                retryable: true,
  336              };
  337            }
  338          },
  339        },
  340      }),
```
