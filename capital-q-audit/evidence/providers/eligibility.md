# Eligibility and provider-justified ceiling

Why included: Decides which models a request may reach; SYNTHETIC_DEMO bypasses both sensitivity checks.

## `packages/model-gateway/src/policy/eligibility.ts` lines 43-131

```ts
   43  /**
   44   * The strongest class a provider's REVIEWED TERMS justify sending it
   45   * (CQ-C5-R2A §20-§25; doc 15 §61-§62).
   46   *
   47   * A model's `sensitivity_ceiling` is a per-model policy record, and until
   48   * now it was the only thing eligibility read. That left one edit — raising a
   49   * single model's ceiling — able to send confidential customer data to a
   50   * vendor whose terms nobody had verified, with no second opinion anywhere in
   51   * the system. This is that second opinion: the effective ceiling is the
   52   * WEAKER of the model's own and the one its provider's class justifies, so
   53   * approving a provider is a deliberate, reviewable act rather than a side
   54   * effect of a number in a different row.
   55   *
   56   * The mapping is the review policy, written once:
   57   *
   58   *   UNREVIEWED                     nothing is known. PUBLIC only.
   59   *   TRAINING_PERMITTED             inputs may train the vendor's models, so
   60   *                                  customer data must never reach it. PUBLIC.
   61   *   NO_TRAINING_DEFAULT_RETENTION  not trained on, but retained under the
   62   *                                  vendor's ordinary policy. INTERNAL.
   63   *   NO_TRAINING_ZERO_RETENTION     not trained on and not retained — the
   64   *                                  first class that may carry a customer's
   65   *                                  confidential material. CONFIDENTIAL, and
   66   *                                  only when zero retention is actually
   67   *                                  asserted for this account, because the
   68   *                                  class describes what the vendor OFFERS
   69   *                                  and the flag records what we ENABLED.
   70   *   ENTERPRISE_CONTRACT            a signed agreement. CONFIDENTIAL.
   71   *
   72   * No class reaches HIGHLY_CONFIDENTIAL or RESTRICTED. That is deliberate and
   73   * is the reason this function exists as a ceiling rather than a lookup: the
   74   * strongest material Capital Q holds does not leave it through a model
   75   * provider under any review short of a decision nobody has made yet.
   76   */
   77  export function providerJustifiedCeiling(
   78    provider: ProviderRecord,
   79  ): ModelSensitivity {
   80    switch (provider.privacyPolicyClass) {
   81      case "UNREVIEWED":
   82      case "TRAINING_PERMITTED":
   83        return "PUBLIC";
   84      case "NO_TRAINING_DEFAULT_RETENTION":
   85        return "INTERNAL";
   86      case "NO_TRAINING_ZERO_RETENTION":
   87        // The class is the vendor's offer; the flag is our configuration of it.
   88        // Without the second, the first is a brochure.
   89        return provider.supportsZeroRetention ? "CONFIDENTIAL" : "INTERNAL";
   90      case "ENTERPRISE_CONTRACT":
   91        return "CONFIDENTIAL";
   92    }
   93  }
   94
   95  export type EligibleCandidate = {
   96    readonly candidateIndex: number;
   97    readonly provider: ProviderRecord;
   98    readonly model: ModelRecord;
   99    readonly price: ModelPriceRecord | null;
  100    readonly estimatedInputTokens: number;
  101    readonly estimatedAttemptCostUsd: number;
  102  };
  103
  104  export type RoutePlan = {
  105    readonly policy: RoutingPolicyRecord;
  106    readonly decisions: readonly ModelCandidateDecision[];
  107    readonly eligible: readonly EligibleCandidate[];
  108  };
  109
  110  /**
  111   * The active policy for a task class whose sensitivity class covers the
  112   * request: the most specific (lowest) covering ceiling, highest version.
  113   */
  114  export function selectRoutingPolicy(
  115    catalog: ModelCatalog,
  116    request: Pick<ModelGatewayRequest, "taskClass" | "sensitivity">,
  117  ): RoutingPolicyRecord | null {
  118    const policies = (catalog.policiesByTaskClass.get(request.taskClass) ?? [])
  119      .filter(
  120        (policy) =>
  121          policy.status === "ACTIVE" &&
  122          sensitivityAtMost(request.sensitivity, policy.sensitivityClass),
  123      )
  124      .sort((a, b) => {
  125        const byCeiling =
  126          rankSensitivity(a.sensitivityClass) -
  127          rankSensitivity(b.sensitivityClass);
  128        return byCeiling !== 0 ? byCeiling : b.version - a.version;
  129      });
  130    return policies[0] ?? null;
  131  }
```

## `packages/model-gateway/src/policy/eligibility.ts` lines 211-382

```ts
  211  /**
  212   * Judge every candidate the policy names, in policy order. Preferred
  213   * models come first, then fallbacks; the order of the eligible list is
  214   * the order the gateway will try them in.
  215   */
  216  export function planRoute(
  217    input: EligibilityInput,
  218    policy: RoutingPolicyRecord,
  219  ): RoutePlan {
  220    const { catalog, request } = input;
  221    // Both halves are required: the request declares, the deployment attests.
  222    // Either alone decides nothing.
  223    const synthetic =
  224      request.dataPosture === "SYNTHETIC_DEMO" &&
  225      input.syntheticDemo?.permitted === true;
  226    const modelIds = [...policy.preferredModels, ...policy.fallbackModels];
  227    const decisions: ModelCandidateDecision[] = [];
  228    const eligible: EligibleCandidate[] = [];
  229
  230    modelIds.forEach((modelId, candidateIndex) => {
  231      const model = catalog.modelById.get(modelId);
  232      if (model === undefined) {
  233        // A policy naming a model that does not exist is a configuration
  234        // fault, recorded as such rather than silently skipped.
  235        decisions.push({
  236          providerCode: "unknown",
  237          modelCode: modelId,
  238          candidateIndex,
  239          reason: "MODEL_DISABLED",
  240        });
  241        return;
  242      }
  243      const provider = catalog.providerById.get(model.providerId);
  244      const providerCode = provider?.code ?? "unknown";
  245      const decide = (reason: ModelEligibilityReason) => {
  246        decisions.push({
  247          providerCode,
  248          modelCode: model.modelCode,
  249          candidateIndex,
  250          reason,
  251        });
  252      };
  253
  254      if (provider === undefined || provider.status !== "ACTIVE") {
  255        decide("PROVIDER_DISABLED");
  256        return;
  257      }
  258      if (input.registry.get(provider.code) === undefined) {
  259        decide("PROVIDER_UNCONFIGURED");
  260        return;
  261      }
  262      if (
  263        input.health.state(provider.code, model.modelCode, input.now) ===
  264        "TEMPORARILY_FAILING"
  265      ) {
  266        decide("PROVIDER_TEMPORARILY_FAILING");
  267        return;
  268      }
  269      if (model.status !== "ACTIVE") {
  270        decide("MODEL_DISABLED");
  271        return;
  272      }
  273      if (!isModelEffective(model, input.now)) {
  274        decide("MODEL_NOT_EFFECTIVE");
  275        return;
  276      }
  277      // Privacy before everything that follows: the ceiling is the reviewed
  278      // policy record, and nothing cheaper or more available can lower it.
  279      //
  280      // Two independent limits, and the request must satisfy both. The model's
  281      // own ceiling is checked first so its refusal is the one recorded when
  282      // both would refuse — "this model is not for this data" is the more
  283      // specific fact.
  284      //
  285      // Both limits exist to protect a customer's material. Where the server
  286      // has attested there is none — invented companies in a demo deployment
  287      // — doc 15 §62 is the governing rule rather than the ceiling: free and
  288      // shared inference may be used aggressively for synthetic data and
  289      // development. The declared sensitivity is untouched and still travels
  290      // with the request; only the question changes, from "may this vendor
  291      // hold this class of customer data" to "is there a customer here at
  292      // all". `synthetic` is false for every request that does not declare
  293      // the posture and for every deployment without an attestation, so this
  294      // is inert in production by construction.
  295      if (!synthetic) {
  296        if (!sensitivityAtMost(request.sensitivity, model.sensitivityCeiling)) {
  297          decide("SENSITIVITY_EXCEEDS_CEILING");
  298          return;
  299        }
  300        if (
  301          !sensitivityAtMost(
  302            request.sensitivity,
  303            providerJustifiedCeiling(provider),
  304          )
  305        ) {
  306          decide("PROVIDER_POLICY_INSUFFICIENT");
  307          return;
  308        }
  309      }
  310      if (!tenantAllows(input.tenantPolicy, provider.code)) {
  311        decide("TENANT_POLICY_DENIES_PROVIDER");
  312        return;
  313      }
  314      const capabilities = modelCapabilities(model);
  315      if (input.requiredCapabilities.some((c) => !capabilities.has(c))) {
  316        decide("CAPABILITY_MISSING");
  317        return;
  318      }
  319      const outputTokens = Math.min(
  320        request.budget.maxOutputTokens,
  321        model.maxOutputTokens,
  322      );
  323      if (request.budget.maxOutputTokens > model.maxOutputTokens) {
  324        decide("OUTPUT_LIMIT_TOO_SMALL");
  325        return;
  326      }
  327      if (input.estimatedInputTokens + outputTokens > model.contextWindow) {
  328        decide("CONTEXT_WINDOW_TOO_SMALL");
  329        return;
  330      }
  331      if (
  332        request.budget.maxInputTokens !== undefined &&
  333        input.estimatedInputTokens > request.budget.maxInputTokens
  334      ) {
  335        decide("CONTEXT_WINDOW_TOO_SMALL");
  336        return;
  337      }
  338      const floor = strongerQuality(policy.qualityFloor, request.qualityFloor);
  339      if (!meetsQuality(model, floor)) {
  340        decide("QUALITY_BELOW_FLOOR");
  341        return;
  342      }
  343      if (
  344        request.latencyTarget !== undefined &&
  345        !meetsLatency(model, request.latencyTarget)
  346      ) {
  347        decide("LATENCY_ABOVE_TARGET");
  348        return;
  349      }
  350      const price = effectivePrice(catalog, model.id, input.now);
  351      const ceiling = Math.min(
  352        request.budget.maxEstimatedCostUsd,
  353        policy.costCeilingUsd ?? Number.POSITIVE_INFINITY,
  354      );
  355      if (price === null) {
  356        // Unknown price is not free: with a ceiling to honour, a route we
  357        // cannot cost is a route we cannot take.
  358        decide("PRICE_UNKNOWN");
  359        return;
  360      }
  361      const estimate = estimateAttemptCost(
  362        input.estimatedInputTokens,
  363        outputTokens,
  364        price,
  365      );
  366      if (estimate.amount > ceiling) {
  367        decide("COST_EXCEEDS_CEILING");
  368        return;
  369      }
  370      decide(synthetic ? "ELIGIBLE_SYNTHETIC_DEMO" : "ELIGIBLE");
  371      eligible.push({
  372        candidateIndex,
  373        provider,
  374        model,
  375        price,
  376        estimatedInputTokens: input.estimatedInputTokens,
  377        estimatedAttemptCostUsd: estimate.amount,
  378      });
  379    });
  380
  381    return { policy, decisions, eligible };
  382  }
```
