# Model Gateway: attempt, route, hedge

Why included: Single inference boundary: per-attempt ledger write, retry/fallback/budget/firstAttemptTimeout/hedge logic.

## `packages/model-gateway/src/gateway.ts` lines 151-155

```ts
  151  /** At most one retry on the same candidate before moving on. */
  152  const ATTEMPTS_PER_CANDIDATE = 2;
  153  const BACKOFF_BASE_MS = 300;
  154  const BACKOFF_CAP_MS = 4_000;
  155  const RETRY_AFTER_CAP_MS = 10_000;
```

## `packages/model-gateway/src/gateway.ts` lines 256-270

```ts
  256    async function recordUsage(
  257      entry: Parameters<ModelUsageRepository["record"]>[0],
  258    ): Promise<void> {
  259      try {
  260        await dependencies.usage.record(entry);
  261      } catch (error: unknown) {
  262        // Accounting must not fail the answer, but it must never be silent.
  263        metrics.usageRecordFailures.add(1);
  264        logger?.error(
  265          { err: error, qRunId: entry.qRunId, taskClass: entry.taskClass },
  266          "model usage ledger write failed",
  267        );
  268      }
  269    }
  270  
```

## `packages/model-gateway/src/gateway.ts` lines 495-520

```ts
  495          // The ledger row: tokens and cost when known, the class otherwise.
  496          const failureClass =
  497            outcome.kind === "SUCCESS" ? undefined : outcome.failureClass;
  498          const success = failureClass === undefined;
  499          await recordUsage({
  500            tenantId: request.attribution.tenantId,
  501            userId: request.attribution.userId,
  502            purpose: usagePurposeOf(request.attribution),
  503            qRunId: request.attribution.qRunId,
  504            taskClass: request.taskClass,
  505            providerId: candidate.provider.id,
  506            modelId: candidate.model.id,
  507            routingPolicyId: policyId,
  508            attempt: attemptNumber,
  509            inputTokens: usage?.inputTokens ?? 0,
  510            cachedInputTokens: usage?.cachedInputTokens ?? 0,
  511            outputTokens: usage?.outputTokens ?? 0,
  512            latencyMs,
  513            costUsd: cost?.amount,
  514            costBasis: cost?.basis ?? "UNPRICED",
  515            success,
  516            errorCode: failureClass,
  517            correlationId: request.attribution.correlationId,
  518          });
  519  
  520          const result = failureClass ?? "success";
```

## `packages/model-gateway/src/gateway.ts` lines 649-760

```ts
  649    async function route<T>(
  650      request: ModelGatewayRequest,
  651      schema: z.ZodType<T> | undefined,
  652      callerSignal: AbortSignal,
  653      span: {
  654        setAttribute: (key: string, value: string | number | boolean) => unknown;
  655      },
  656      onTextDelta: ((text: string) => void) | undefined,
  657      firstAttemptTimeoutMs: number | undefined,
  658      accept: AcceptOptions,
  659    ): Promise<ModelGatewayResult<T>> {
  660      if (callerSignal.aborted) {
  661        throw new ModelGatewayError("model request cancelled before routing", {
  662          failureClass: "CANCELLED",
  663          attempts: 0,
  664          candidates: [],
  665        });
  666      }
  667      const now = clock.now();
  668      const catalog: ModelCatalog = indexCatalog(
  669        await dependencies.catalog.load(),
  670      );
  671      const policy = selectRoutingPolicy(catalog, request);
  672      if (policy === null) {
  673        metrics.policyIneligible.add(1, {
  674          task_class: request.taskClass,
  675          reason: "NO_POLICY",
  676        });
  677        throw new ModelGatewayError("no active routing policy covers this task", {
  678          failureClass: "POLICY_INELIGIBLE",
  679          attempts: 0,
  680          candidates: [],
  681        });
  682      }
  683      span.setAttribute("q.model.routing_policy", policy.code);
  684      const hedgeAfterMs = policy.hedgeAfterMs ?? null;
  685      const tenantPolicy =
  686        request.tenantPolicy ??
  687        (await tenantPolicies.policyFor(request.attribution.tenantId));
  688      const plan = planRoute(
  689        {
  690          catalog,
  691          registry: dependencies.registry,
  692          health,
  693          request,
  694          requiredCapabilities: requiredCapabilitiesFor(
  695            request.output,
  696            messagesCarryImages(request.messages)
  697              ? [...request.requiredCapabilities, "VISION"]
  698              : request.requiredCapabilities,
  699            request.tools,
  700          ),
  701          estimatedInputTokens: estimateInputTokens(
  702            request.messages,
  703            request.tools,
  704          ),
  705          tenantPolicy,
  706          syntheticDemo: dependencies.syntheticDemo,
  707          now,
  708        },
  709        policy,
  710      );
  711  
  712      if (plan.eligible.length === 0) {
  713        const onlyCost = plan.decisions.every(
  714          (d) =>
  715            d.reason === "COST_EXCEEDS_CEILING" || d.reason === "PRICE_UNKNOWN",
  716        );
  717        const failureClass = onlyCost ? "BUDGET_EXCEEDED" : "POLICY_INELIGIBLE";
  718        if (onlyCost) {
  719          metrics.budgetRejected.add(1, { task_class: request.taskClass });
  720        } else {
  721          metrics.policyIneligible.add(1, {
  722            task_class: request.taskClass,
  723            reason: plan.decisions[0]?.reason ?? "NONE",
  724          });
  725        }
  726        logger?.info(
  727          {
  728            taskClass: request.taskClass,
  729            sensitivity: request.sensitivity,
  730            routingPolicy: policy.code,
  731            decisions: plan.decisions.map(
  732              (d) => `${d.providerCode}/${d.modelCode}:${d.reason}`,
  733            ),
  734            qRunId: request.attribution.qRunId,
  735          },
  736          "model request has no eligible route",
  737        );
  738        throw new ModelGatewayError(
  739          "no configured model is eligible for this request",
  740          {
  741            failureClass,
  742            attempts: 0,
  743            candidates: plan.decisions,
  744            routingPolicyCode: policy.code,
  745          },
  746        );
  747      }
  748  
  749      const attempts: ModelAttemptRecord[] = [];
  750      let spentUsd = 0;
  751      let lastFailure: ModelFailureClass | undefined;
  752      let lastCause: unknown;
  753      let attemptNumber = 0;
  754      /**
  755       * An earlier answer hit the ceiling; later attempts ask for more. Held
  756       * on an object rather than in a local so that reading it before an
  757       * attempt does not depend on what that attempt turns out to be.
  758       */
  759      const room: { ranOut: boolean } = { ranOut: false };
  760  
```

## `packages/model-gateway/src/gateway.ts` lines 776-916

```ts
  776        while (attemptsOnCandidate < ATTEMPTS_PER_CANDIDATE) {
  777          if (attemptNumber >= request.budget.maxAttempts) {
  778            break;
  779          }
  780          if (callerSignal.aborted) {
  781            throw new ModelGatewayError("model request cancelled", {
  782              failureClass: "CANCELLED",
  783              attempts: attempts.length,
  784              candidates: plan.decisions,
  785              routingPolicyCode: policy.code,
  786            });
  787          }
  788          // Retries and fallbacks count toward the same money.
  789          if (
  790            spentUsd + candidate.estimatedAttemptCostUsd >
  791            request.budget.maxEstimatedCostUsd
  792          ) {
  793            lastFailure = "BUDGET_EXCEEDED";
  794            metrics.budgetRejected.add(1, { task_class: request.taskClass });
  795            break;
  796          }
  797          // Whether another eligible model could take this request if this
  798          // one does not answer.
  799          const anotherCandidateWaits = plan.eligible.some(
  800            (other) =>
  801              other.candidateIndex > candidate.candidateIndex &&
  802              dependencies.registry.get(other.provider.code) !== undefined,
  803          );
  804          // The first model is held to the caller's shorter patience only
  805          // when there is somewhere else to go. A last resort gets the whole
  806          // attempt budget.
  807          const timeoutMs =
  808            attemptNumber === 0 &&
  809            anotherCandidateWaits &&
  810            firstAttemptTimeoutMs !== undefined
  811              ? Math.min(firstAttemptTimeoutMs, request.budget.attemptTimeoutMs)
  812              : request.budget.attemptTimeoutMs;
  813          attemptNumber += 1;
  814          attemptsOnCandidate += 1;
  815          const spoke = { spoke: false };
  816          const run = (
  817            which: EligibleCandidate,
  818            whichProvider: ModelProvider,
  819            number: number,
  820            signal: AbortSignal,
  821            ms: number,
  822          ) =>
  823            attempt(
  824              request,
  825              which,
  826              whichProvider,
  827              policy.id,
  828              number,
  829              schema,
  830              signal,
  831              room.ranOut,
  832              onTextDelta,
  833              spoke,
  834              ms,
  835              accept,
  836            );
  837          // A hedge (L1): the first attempt of a request nobody is listening
  838          // to word by word, with the policy's hedge configured and a second
  839          // model eligible, asks that model too once hedgeAfterMs has passed.
  840          const hedgeTo =
  841            attemptNumber === 1 &&
  842            onTextDelta === undefined &&
  843            hedgeAfterMs !== null &&
  844            request.budget.maxAttempts >= 2
  845              ? plan.eligible.find(
  846                  (other) =>
  847                    other.candidateIndex > candidate.candidateIndex &&
  848                    dependencies.registry.get(other.provider.code) !==
  849                      undefined &&
  850                    spentUsd +
  851                      candidate.estimatedAttemptCostUsd +
  852                      other.estimatedAttemptCostUsd <=
  853                      request.budget.maxEstimatedCostUsd,
  854                )
  855              : undefined;
  856          const hedgeProvider =
  857            hedgeTo === undefined
  858              ? undefined
  859              : dependencies.registry.get(hedgeTo.provider.code);
  860          const settled =
  861            hedgeTo === undefined ||
  862            hedgeProvider === undefined ||
  863            hedgeAfterMs === null
  864              ? {
  865                  outcome: await run(
  866                    candidate,
  867                    provider,
  868                    attemptNumber,
  869                    callerSignal,
  870                    timeoutMs,
  871                  ),
  872                  served: candidate,
  873                  extra: [] as ModelAttemptRecord[],
  874                }
  875              : await hedged({
  876                  first: (signal) =>
  877                    run(candidate, provider, attemptNumber, signal, timeoutMs),
  878                  second: (signal) =>
  879                    run(
  880                      hedgeTo,
  881                      hedgeProvider,
  882                      attemptNumber + 1,
  883                      signal,
  884                      request.budget.attemptTimeoutMs,
  885                    ),
  886                  firstCandidate: candidate,
  887                  secondCandidate: hedgeTo,
  888                  hedgeAfterMs,
  889                  callerSignal,
  890                  onHedge: () => {
  891                    attemptNumber += 1;
  892                    metrics.hedges.add(1, {
  893                      task_class: request.taskClass,
  894                      provider: hedgeTo.provider.code,
  895                    });
  896                    logger?.info(
  897                      {
  898                        taskClass: request.taskClass,
  899                        routingPolicy: policy.code,
  900                        first: `${candidate.provider.code}/${candidate.model.modelCode}`,
  901                        second: `${hedgeTo.provider.code}/${hedgeTo.model.modelCode}`,
  902                        hedgeAfterMs,
  903                        qRunId: request.attribution.qRunId,
  904                      },
  905                      "model request hedged",
  906                    );
  907                  },
  908                });
  909          const outcome = settled.outcome;
  910          const served = settled.served;
  911          attempts.push(outcome.record, ...settled.extra);
  912          spentUsd +=
  913            outcome.record.cost?.amount ?? served.estimatedAttemptCostUsd;
  914          for (const record of settled.extra) {
  915            spentUsd += record.cost?.amount ?? 0;
  916          }
```

## `packages/model-gateway/src/gateway.ts` lines 1061-1153

```ts
 1061  type Attempted<T> = AttemptOutcome<T> & {
 1062    readonly record: ModelAttemptRecord;
 1063  };
 1064  
 1065  /**
 1066   * A hedged first attempt (L1 latency sweep, 2026-10-06).
 1067   *
 1068   * The first model is asked; if it has not settled after `hedgeAfterMs`,
 1069   * the second is asked too, WITHOUT stopping the first. The first success
 1070   * is the answer and the other attempt is cancelled (its own record lands
 1071   * in the usage ledger as CANCELLED). If both fail, the first's failure is
 1072   * returned for the loop to judge as before, with the second's record kept.
 1073   *
 1074   * Only for requests that stream nothing (the caller checks): two models
 1075   * must never both be heard.
 1076   */
 1077  async function hedged<T>(input: {
 1078    readonly first: (signal: AbortSignal) => Promise<Attempted<T>>;
 1079    readonly second: (signal: AbortSignal) => Promise<Attempted<T>>;
 1080    readonly firstCandidate: EligibleCandidate;
 1081    readonly secondCandidate: EligibleCandidate;
 1082    readonly hedgeAfterMs: number;
 1083    readonly callerSignal: AbortSignal;
 1084    readonly onHedge: () => void;
 1085  }): Promise<{
 1086    readonly outcome: Attempted<T>;
 1087    readonly served: EligibleCandidate;
 1088    readonly extra: ModelAttemptRecord[];
 1089  }> {
 1090    const firstStop = new AbortController();
 1091    const first = input.first(
 1092      AbortSignal.any([input.callerSignal, firstStop.signal]),
 1093    );
 1094    let timer: ReturnType<typeof setTimeout> | undefined;
 1095    const hedgeTime = new Promise<"HEDGE">((resolve) => {
 1096      timer = setTimeout(() => {
 1097        resolve("HEDGE");
 1098      }, input.hedgeAfterMs);
 1099    });
 1100    const early = await Promise.race([first, hedgeTime]);
 1101    clearTimeout(timer);
 1102    if (early !== "HEDGE" || input.callerSignal.aborted) {
 1103      return {
 1104        outcome: early === "HEDGE" ? await first : early,
 1105        served: input.firstCandidate,
 1106        extra: [],
 1107      };
 1108    }
 1109    input.onHedge();
 1110    const secondStop = new AbortController();
 1111    const second = input.second(
 1112      AbortSignal.any([input.callerSignal, secondStop.signal]),
 1113    );
 1114    const winner = await new Promise<"FIRST" | "SECOND" | null>((resolve) => {
 1115      let failed = 0;
 1116      const settle = (which: "FIRST" | "SECOND", success: boolean) => {
 1117        if (success) {
 1118          resolve(which);
 1119          return;
 1120        }
 1121        failed += 1;
 1122        if (failed === 2) resolve(null);
 1123      };
 1124      first.then(
 1125        (outcome) => {
 1126          settle("FIRST", outcome.kind === "SUCCESS");
 1127        },
 1128        () => {
 1129          settle("FIRST", false);
 1130        },
 1131      );
 1132      second.then(
 1133        (outcome) => {
 1134          settle("SECOND", outcome.kind === "SUCCESS");
 1135        },
 1136        () => {
 1137          settle("SECOND", false);
 1138        },
 1139      );
 1140    });
 1141    if (winner === "FIRST") {
 1142      secondStop.abort();
 1143      second.catch(() => undefined);
 1144      return { outcome: await first, served: input.firstCandidate, extra: [] };
 1145    }
 1146    if (winner === "SECOND") {
 1147      firstStop.abort();
 1148      first.catch(() => undefined);
 1149      return { outcome: await second, served: input.secondCandidate, extra: [] };
 1150    }
 1151    const [a, b] = await Promise.all([first, second]);
 1152    return { outcome: a, served: input.firstCandidate, extra: [b.record] };
 1153  }
```

