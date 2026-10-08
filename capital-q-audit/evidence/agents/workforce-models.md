# Evidence: apps/q-api/src/composition/workforce/models.ts lines 56-232

- Original path: `apps/q-api/src/composition/workforce/models.ts`
- Line range: 56-232 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Workforce model calls: task classes, budgets, timeouts, attempts.

```ts
   56  export type PlanVariables = Omit<JobPlanVariables, Frame>;
   57
   58  const SMALL = {
   59    maxAttempts: 2,
   60    maxEstimatedCostUsd: 0.03,
   61    maxOutputTokens: 900,
   62    attemptTimeoutMs: 30_000,
   63  } as const;
   64  const CLASSIFY = {
   65    maxAttempts: 2,
   66    maxEstimatedCostUsd: 0.005,
   67    maxOutputTokens: 300,
   68    attemptTimeoutMs: 10_000,
   69  } as const;
   70  const PLAN = {
   71    maxAttempts: 1,
   72    maxEstimatedCostUsd: 0.08,
   73    maxOutputTokens: 2_000,
   74    attemptTimeoutMs: 60_000,
   75  } as const;
   76
   77  export type WorkforceModels = {
   78    readonly review: (
   79      who: Who,
   80      trace: Trace,
   81      variables: ReviewVariables,
   82    ) => Promise<DraftReviewResultV2 | null>;
   83    readonly redraft: (
   84      who: Who,
   85      trace: Trace,
   86      variables: RedraftVariables,
   87    ) => Promise<string | null>;
   88    readonly readReply: (
   89      who: Who,
   90      trace: Trace,
   91      variables: ReplyVariables,
   92    ) => Promise<ReplyReaderResult | null>;
   93    readonly plan: (
   94      who: Who,
   95      trace: Trace,
   96      variables: PlanVariables,
   97    ) => Promise<JobPlanResult | null>;
   98  };
   99
  100  export function createWorkforceModels(dependencies: {
  101    readonly gateway: ModelGateway;
  102    readonly dataPosture?: ModelDataPosture | undefined;
  103    readonly logger?: Logger | undefined;
  104    /** ADR 0050: the principal's guides, which the reviewer grades against. */
  105    readonly etiquette?: EtiquetteSource | undefined;
  106    readonly purpose?: ModelUsagePurpose | undefined;
  107  }): WorkforceModels {
  108    const registry = createDefaultPromptRegistry();
  109
  110    async function call<V, O>(input: {
  111      readonly task:
  112        "DRAFT_REVIEW" | "DRAFT_REDRAFT" | "REPLY_READER" | "JOB_PLAN";
  113      readonly taskClass: ModelTextTaskClass;
  114      readonly who: Who;
  115      readonly trace: Trace;
  116      readonly variables: V;
  117      readonly schema: z.ZodType<O>;
  118      readonly budget: typeof SMALL | typeof CLASSIFY | typeof PLAN;
  119      readonly environmentNotes: string;
  120      readonly etiquette: EtiquettePurpose | null;
  121    }): Promise<O | null> {
  122      try {
  123        const etiquette =
  124          input.etiquette === null
  125            ? undefined
  126            : await etiquetteFor(
  127                dependencies.etiquette,
  128                input.who,
  129                input.etiquette,
  130              );
  131        const rendered = renderPrompt<V>(registry, {
  132          task: input.task,
  133          ...(etiquette === undefined ? {} : { etiquette }),
  134          operatingMode: "CONTINUOUS_INTELLIGENCE",
  135          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
  136          environmentNotes: input.environmentNotes,
  137          variables: input.variables,
  138        });
  139        const response = await dependencies.gateway.execute<O>(
  140          {
  141            taskClass: input.taskClass,
  142            sensitivity: "CONFIDENTIAL",
  143            ...(dependencies.dataPosture === undefined
  144              ? {}
  145              : { dataPosture: dependencies.dataPosture }),
  146            budget: input.budget,
  147            messages: [...rendered.messages],
  148            output: rendered.output,
  149            attribution: {
  150              purpose: dependencies.purpose ?? "DELEGATED_WORK",
  151              tenantId: input.who.tenantId,
  152              userId: input.who.userId,
  153              correlationId:
  154                input.trace === null
  155                  ? `cor_${randomUUID()}`
  156                  : workforceCorrelationId(input.trace.jobId, input.trace.runId),
  157            },
  158          },
  159          { schema: input.schema },
  160        );
  161        if (response.output.kind !== "STRUCTURED") return null;
  162        const parsed = input.schema.safeParse(
  163          (response.output as { readonly value: unknown }).value,
  164        );
  165        return parsed.success ? parsed.data : null;
  166      } catch (error: unknown) {
  167        dependencies.logger?.warn(
  168          { err: error, task: input.task },
  169          "workforce model call not made",
  170        );
  171        return null;
  172      }
  173    }
  174
  175    return {
  176      review: (who, trace, variables) =>
  177        call<ReviewVariables, DraftReviewResultV2>({
  178          task: "DRAFT_REVIEW",
  179          taskClass: "STRUCTURED_EXTRACTION",
  180          who,
  181          trace,
  182          variables,
  183          schema: DraftReviewResultV2Schema,
  184          budget: SMALL,
  185          environmentNotes:
  186            "You are grading, not writing to anyone. Code decides from your grades whether anything is sent.",
  187          // The reviewer reads the guides as the writer does: the same frame.
  188          etiquette: "SPEAK_FOR",
  189        }),
  190      redraft: async (who, trace, variables) => {
  191        const result = await call<RedraftVariables, DraftRedraftResult>({
  192          task: "DRAFT_REDRAFT",
  193          taskClass: "STRUCTURED_EXTRACTION",
  194          who,
  195          trace,
  196          variables,
  197          schema: DraftRedraftResultSchema,
  198          budget: SMALL,
  199          environmentNotes:
  200            "Your redraft is graded again before anything is sent.",
  201          etiquette: "SPEAK_FOR",
  202        });
  203        return result?.body ?? null;
  204      },
  205      readReply: (who, trace, variables) =>
  206        call<ReplyVariables, ReplyReaderResult>({
  207          task: "REPLY_READER",
  208          taskClass: "FAST_CLASSIFICATION",
  209          who,
  210          trace,
  211          variables,
  212          schema: ReplyReaderResultSchema,
  213          budget: CLASSIFY,
  214          environmentNotes:
  215            "You are reading a message, not replying. Code acts only on what you report.",
  216          etiquette: null,
  217        }),
  218      plan: (who, trace, variables) =>
  219        call<PlanVariables, JobPlanResult>({
  220          task: "JOB_PLAN",
  221          taskClass: "STRUCTURED_EXTRACTION",
  222          who,
  223          trace,
  224          variables,
  225          schema: JobPlanResultSchema,
  226          budget: PLAN,
  227          environmentNotes:
  228            "You are planning, not acting. Code checks every step against what they allowed before anything happens.",
  229          etiquette: null,
  230        }),
  231    };
  232  }
```
