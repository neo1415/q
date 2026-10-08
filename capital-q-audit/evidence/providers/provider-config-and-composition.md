# Provider keys and q-api gateway composition

Why included: Which keys exist, stale 'diagnostic only' comments, registration, posture logging.

## `packages/config/src/model-providers.ts` lines 18-135

```ts
   18  export const MODEL_PROVIDER_ENV_NAMES = [
   19    "GEMINI_API_KEY",
   20    "GEMINI_API_KEY_2",
   21    "GEMINI_API_KEY2",
   22    "GROQ_API_KEY",
   23  ] as const;
   24  
   25  const REDACTED = "[redacted]";
   26  
   27  export class ProviderCredential {
   28    readonly #value: string;
   29  
   30    constructor(value: string) {
   31      this.#value = value;
   32    }
   33  
   34    /** The only way to the value. Call at composition, never in a log path. */
   35    reveal(): string {
   36      return this.#value;
   37    }
   38  
   39    toJSON(): string {
   40      return REDACTED;
   41    }
   42  
   43    toString(): string {
   44      return REDACTED;
   45    }
   46  
   47    [Symbol.for("nodejs.util.inspect.custom")](): string {
   48      return REDACTED;
   49    }
   50  }
   51  
   52  /**
   53   * Keys are opaque strings of a vendor's choosing; the only validation that
   54   * does not embed a vendor's format is "present and not obviously blank".
   55   */
   56  // An empty variable means "not configured" (e.g. OPENAI_API_KEY= in a local
   57  // launch env to keep a paid provider out of development traffic), so the
   58  // gateway routes around it instead of the service refusing to start.
   59  const apiKey = z.preprocess(
   60    (value) =>
   61      typeof value === "string" && value.trim() === "" ? undefined : value,
   62    z
   63      .string()
   64      .trim()
   65      .min(16, "expected a provider API key")
   66      .max(512, "expected a provider API key")
   67      .optional(),
   68  );
   69  
   70  /**
   71   * The operator's opt-in for synthetic-demo model routing (doc 15 §62,
   72   * CQ-REC-007). Off unless set to `true`. Setting it is a claim about the
   73   * DATA this deployment holds — that every founder, investor and company in
   74   * it was invented for a demonstration — and the claim is checked again,
   75   * against the environment and the database, by
   76   * `createSyntheticDemoRoutingAllowance`, which refuses to build an
   77   * allowance anywhere it cannot hold. Parsing it here grants nothing.
   78   */
   79  const syntheticDemoRouting = z
   80    .preprocess(
   81      (value) => (value === undefined || value === "" ? "false" : value),
   82      z.enum(["true", "false"]),
   83    )
   84    .transform((value) => value === "true");
   85  
   86  export const modelProviderEnvShape = {
   87    CQ_SYNTHETIC_DEMO_ROUTING: syntheticDemoRouting,
   88    /**
   89     * The deployment's own statement that everything it holds was invented
   90     * (QX-004 §0.3). Server-only: no HTTP contract carries it and no browser
   91     * can set it. Meaningless without the routing opt-in beside it, refused
   92     * outright in preview and production, and in staging it must name the
   93     * synthetic Supabase project below.
   94     */
   95    CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED: syntheticDemoRouting,
   96    /** The Supabase project that attestation is about; must be the one in use. */
   97    CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF: z
   98      .string()
   99      .trim()
  100      .min(16)
  101      .max(64)
  102      .optional(),
  103    GEMINI_API_KEY: apiKey.optional(),
  104    // Further Gemini keys. The adapter rotates to the next one when a key
  105    // is rate-limited, so one exhausted free tier does not stop Q. Both
  106    // spellings are accepted because the second key was already in use
  107    // without the underscore before this was configurable.
  108    GEMINI_API_KEY_2: apiKey.optional(),
  109    GEMINI_API_KEY2: apiKey.optional(),
  110    GROQ_API_KEY: apiKey.optional(),
  111    // Further GroqCloud keys. The adapter rotates to the next one when a key
  112    // is rate-limited, so one exhausted free tier does not stop Q.
  113    GROQ_API_KEY_2: apiKey.optional(),
  114    GROQ_API_KEY_3: apiKey.optional(),
  115    GROQ_API_KEY_4: apiKey.optional(),
  116    /**
  117     * OpenAI, for diagnosis only (QX-004 core gate).
  118     *
  119     * No routing policy names it. It is reachable only through the
  120     * server-side test route, which refuses to exist outside a local or
  121     * test environment and without the synthetic-demo attestation. The
  122     * account holds a few dollars; the adapter runs one model and refuses
  123     * every other.
  124     */
  125    OPENAI_API_KEY: apiKey.optional(),
  126    // Both spellings, as the Gemini keys already are: the key was in use
  127    // under this name before it was configurable.
  128    OPEN_AI_API_KEY: apiKey.optional(),
  129    /**
  130     * Put one provider's models first, for a deployment that is diagnosing
  131     * rather than serving. Named by code (`openai`). Absent is the ordinary
  132     * case and the production one.
  133     */
  134    CQ_TEST_MODEL_PROVIDER: z.string().trim().max(32).optional(),
  135  };
```

## `apps/q-api/src/main.ts` lines 900-1030

```ts
  900  // The Model Gateway (CQ-Q-005): the one inference boundary. Providers are
  901  // registered only when their key is configured; routing, eligibility and
  902  // the kill switches come from ai_ops, and a service with no provider at
  903  // all still starts — model-capable tasks then fail safely as unavailable.
  904  // The keys are revealed here, once, and handed to the adapters.
  905  const providerSecrets = config.secrets.modelProviders;
  906  const providers: ModelProvider[] = [];
  907  if (providerSecrets.google !== undefined) {
  908    providers.push(
  909      createGoogleModelProvider({
  910        apiKey: providerSecrets.google.reveal(),
  911        additionalApiKeys: providerSecrets.googleKeys
  912          .slice(1)
  913          .map((key) => key.reveal()),
  914      }),
  915    );
  916  }
  917  if (providerSecrets.groq !== undefined) {
  918    providers.push(
  919      createGroqModelProvider({
  920        apiKey: providerSecrets.groq.reveal(),
  921        additionalApiKeys: providerSecrets.groqKeys
  922          .slice(1)
  923          .map((key) => key.reveal()),
  924      }),
  925    );
  926  }
  927  // The routing policies name gpt-5.6-luna first for every task class
  928  // (20261008130000); a provider routed to but never registered is
  929  // PROVIDER_UNCONFIGURED on every call, and every turn fell through to
  930  // the free tiers it was meant to replace.
  931  if (providerSecrets.openai !== undefined) {
  932    providers.push(
  933      createOpenAIModelProvider({ apiKey: providerSecrets.openai.reveal() }),
  934    );
  935  }
  936  /**
  937   * Doc 15 §62: free/shared inference may be used aggressively for synthetic
  938   * data and development, while confidential customer information still
  939   * requires an approved provider. This is the attestation that this
  940   * deployment holds the former — an operator opt-in, checked again against
  941   * the environment and the database before it counts for anything. Null
  942   * everywhere a real customer is served, which is what makes a
  943   * SYNTHETIC_DEMO posture inert there.
  944   */
  945  const syntheticDemo = createSyntheticDemoRoutingAllowance({
  946    operatorEnabled: providerSecrets.syntheticDemoRouting,
  947    environment: config.runtime.deploymentEnvironment,
  948    databaseUrl: loadDatabaseConfig().secrets.url,
  949    hostedAttested: providerSecrets.syntheticDemoAttested,
  950    ...(providerSecrets.syntheticDemoProjectRef === undefined
  951      ? {}
  952      : { syntheticProjectRef: providerSecrets.syntheticDemoProjectRef }),
  953    supabaseUrl: config.public.supabaseUrl,
  954  });
  955  
  956  /**
  957   * What kind of material this service handles (doc 15 section 62).
  958   *
  959   * Named once rather than spelled out at each call site: it is the same
  960   * question every time, and four copies of a ternary is four chances to get
  961   * one of them backwards. Null attestation means REAL_CUSTOMER, which is
  962   * what every deployment serving a real person gets.
  963   */
  964  const demoDataPosture: ModelDataPosture =
  965    syntheticDemo === null ? "REAL_CUSTOMER" : "SYNTHETIC_DEMO";
  966  
  967  /**
  968   * The diagnostic route, when a local or test deployment names one
  969   * (QX-004 core gate).
  970   *
  971   * `withTestRouting` puts one provider's models first in every routing
  972   * policy and refuses loudly anywhere it could touch a real person. It had
  973   * only ever been applied by the interview smoke harness: this server read
  974   * CQ_TEST_MODEL_PROVIDER into its config, logged it as composed, and never
  975   * routed a single call through it -- so every local acceptance run was
  976   * still at the mercy of two free tiers. Absent, the catalogue is returned
  977   * unchanged, which is the ordinary case and the production one.
  978   */
  979  const modelCatalog = withTestRouting(
  980    createPostgresModelCatalog({ sql: database.sql }),
  981    {
  982      providerCode: providerSecrets.testProviderCode,
  983      environment: config.runtime.deploymentEnvironment,
  984      syntheticDemoPermitted: syntheticDemo !== null,
  985    },
  986  );
  987  
  988  /**
  989   * Where each spoken turn's time goes (CQ-VOICE-010): one line per voice
  990   * turn, "voice turn timed". Created before the gateway so that every model
  991   * call made inside a voice turn is listed on it, whichever part of Q made
  992   * it. Outside a voice turn the wrapper adds nothing.
  993   */
  994  const voiceTimings = createVoiceTurnTimings({ logger });
  995  const modelGateway = timedModelGateway(
  996    createModelGateway({
  997      catalog: modelCatalog,
  998      registry: createModelProviderRegistry(providers),
  999      usage: createPostgresModelUsageRepository({ sql: database.sql }),
 1000      health: createProcessLocalProviderHealth(),
 1001      syntheticDemo,
 1002      logger,
 1003    }),
 1004    voiceTimings,
 1005  );
 1006  logger.info(
 1007    { modelProviders: modelProviderConfigStatus(providerSecrets) },
 1008    "model gateway composed",
 1009  );
 1010  /**
 1011   * Whether this deployment attested its material is invented, and on what
 1012   * grounds (ADR 0014).
 1013   *
 1014   * The allowance has carried these conditions for the startup log since it
 1015   * was written and nothing logged them, so the one security-relevant fact
 1016   * about a deployment's routing was invisible until a request failed. The
 1017   * conditions are names, never values: which environment, which project,
 1018   * never a key.
 1019   */
 1020  logger.info(
 1021    {
 1022      dataPosture: demoDataPosture,
 1023      attestation: syntheticDemo?.attestation ?? null,
 1024    },
 1025    syntheticDemo === null
 1026      ? "no synthetic-demo attestation: every request is a customer's"
 1027      : "synthetic-demo attestation accepted",
 1028  );
 1029  
 1030  // Controlled public-web research (CQ-Q-RESEARCH-001): the provider exists
```

## `.railway/railway.ts` lines 69-106

```ts
   69  /**
   70   * Shared runtime posture.
   71   *
   72   * `CAPITAL_Q_ENV` is `staging`, not `production`: Railway's environment is
   73   * called `production` only because that is Railway's default name, and a
   74   * platform label is not a product claim.
   75   *
   76   * `CQ_SYNTHETIC_DEMO_ROUTING` is deliberately absent. The attestation in
   77   * `packages/model-gateway/src/policy/synthetic-demo.ts` admits only
   78   * `local`/`test` with a loopback database and throws at startup otherwise, so
   79   * setting it here would both crash the service and assert something untrue: a
   80   * deployment that can reach hosted data does not get to call itself a demo.
   81   */
   82  const runtimeEnv = {
   83    NODE_ENV: "production",
   84    CAPITAL_Q_ENV: "staging",
   85    REGION: "eu-west",
   86    LOG_LEVEL: "info",
   87  } as const;
   88  
   89  /** Hosted Supabase is reached through its session pooler. */
   90  const databaseEnv = {
   91    DATABASE_URL: preserve(),
   92    DATABASE_CONNECTION_MODE: "session_pooler",
   93  } as const;
   94  
   95  /**
   96   * Model providers. Each is optional and the gateway routes around an
   97   * unconfigured one. `api` needs one because the GateQ applicant interview is
   98   * only registered when a provider exists; `workers` needs one for governed
   99   * document extraction.
  100   */
  101  const modelProviderEnv = {
  102    GEMINI_API_KEY: preserve(),
  103    GEMINI_API_KEY2: preserve(),
  104    GROQ_API_KEY: preserve(),
  105    GROQ_API_KEY_2: preserve(),
  106  } as const;
```

