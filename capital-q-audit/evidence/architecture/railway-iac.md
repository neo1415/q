# Excerpt: .railway/railway.ts lines 1-330

- Original path: `.railway/railway.ts`
- Line range: 1-330
- Why included: Infrastructure-as-code for the Railway deployment: services, start commands, private networking and the env var NAMES each service receives (values are preserve()). Shows OPENAI_API_KEY and CQ_VOICE_REALTIME are not declared for q-api although production uses them.

```
    1  /**
    2   * Capital Q on Railway — the three Node service deployables (ADR 0014).
    3   *
    4   * `apps/web` is hosted on Vercel and is not configured here. The
    5   * `@capital-q/web` service below exists only because Railway's GitHub import
    6   * created it; it is left exactly as imported, pinned to `main`, so that
    7   * applying this file neither redeploys it nor deletes it. It is removed once
    8   * Vercel is serving staging.
    9   *
   10   * Two rules govern this file.
   11   *
   12   * Secret values are never in it. Every secret is `preserve()`: the name is
   13   * version-controlled, the value is set once with
   14   * `railway variable set <NAME> --stdin` and lives only in Railway.
   15   *
   16   * Each service receives only the variables it actually reads. A variable this
   17   * file does not list for a service is one that service's configuration schema
   18   * does not consume. Notably `DATABASE_PRIVILEGED_URL` appears nowhere:
   19   * `createPrivilegedDatabaseClient` has no caller outside tests, so no
   20   * deployed service needs that credential.
   21   */
   22  
   23  import { defineRailway, github, preserve, project, service } from "railway/iac";
   24  
   25  /**
   26   * The integration branch carrying the accepted product state. Railway's
   27   * default branch for this repo is `main`, which is behind; deployment
   28   * convenience is not a reason to move product history (ADR 0014), so the
   29   * source branch is configuration instead.
   30   */
   31  const INTEGRATION_BRANCH = "recovery/2026-09-12";
   32  
   33  /** EU West, Netherlands — the Amsterdam location doc 21 selected. EU data
   34   * residency is a requirement, not a preference (ADR 0001, carried by 0014). */
   35  const EU_REGION = "europe-west4";
   36  
   37  /**
   38   * A leaf deployable cannot be built alone: every workspace package resolves
   39   * through `dist`, and `turbo.json` declares `build` with
   40   * `dependsOn: ["^build"]`. Turborepo is therefore the authority on build
   41   * order. A bare `pnpm --filter <pkg> build` builds no dependencies and fails
   42   * with hundreds of cascading TS2307 errors that are not source defects.
   43   *
   44   * The command itself lives in the root `package.json` as
   45   * `deploy:build:<service>`, so there is one definition of how a deployable is
   46   * built and it can be run from a clean clone without Railway.
   47   */
   48  const buildFor = (pkg: string) => ({
   49    buildCommand: `pnpm deploy:build:${pkg.replace("@capital-q/", "")}`,
   50    buildEnvironment: "V3" as const,
   51    builder: "RAILPACK" as const,
   52    /**
   53     * A service changes when its own app changes, when any workspace package
   54     * changes, or when the build/runtime contract changes. Watching only
   55     * `apps/<svc>/**` would miss every package this service compiles in.
   56     */
   57    watchPatterns: [
   58      "/apps/" + pkg.replace("@capital-q/", "") + "/**",
   59      "/packages/**",
   60      "/package.json",
   61      "/pnpm-lock.yaml",
   62      "/pnpm-workspace.yaml",
   63      "/turbo.json",
   64      "/tsconfig.base.json",
   65      "/.nvmrc",
   66    ],
   67  });
   68  
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
  107  
  108  export default defineRailway(() => {
  109    const repo = github("neo1415/q", {
  110      branch: INTEGRATION_BRANCH,
  111      checkSuites: false,
  112    });
  113  
  114    /**
  115     * The application API. `PORT` is set explicitly rather than left to
  116     * Railway's injected value so that the private address other services use
  117     * is deterministic; `HOST` already defaults to 0.0.0.0 in
  118     * packages/config/src/common.ts, so nothing in the application changes.
  119     */
  120    const api = service("@capital-q/api", {
  121      source: repo,
  122      build: buildFor("@capital-q/api"),
  123      // node directly, not `pnpm run`: the process that receives SIGTERM should
  124      // be the Node process, not a package-manager wrapper.
  125      start: "node apps/api/dist/main.js",
  126      healthcheckPath: "/health/ready",
  127      replicas: { [EU_REGION]: 1 },
  128      networking: { privateNetworkEndpoint: "capital-qapi" },
  129      variables: {
  130        ...runtimeEnv,
  131        ...databaseEnv,
  132        ...modelProviderEnv,
  133        PORT: "3001",
  134        /**
  135         * The one Q interviewer (QX-004 core gate). The conversational
  136         * onboarding turn is delegated to q-api rather than answered by a
  137         * second implementation here, and without this the route closes:
  138         * every typed turn comes back PROVIDER_UNAVAILABLE and nothing is
  139         * recorded. Reached privately; it never leaves Railway's network.
  140         */
  141        CQ_Q_API_URL: "http://capital-qq-api.railway.internal:3002",
  142        SUPABASE_URL: preserve(),
  143        SUPABASE_PUBLISHABLE_KEY: preserve(),
  144        // Privileged storage credential: without it the document upload
  145        // boundary refuses to open rather than half-working, and the rest of
  146        // the API still serves. It never leaves this process.
  147        SUPABASE_SECRET_KEY: preserve(),
  148      },
  149    });
  150  
  151    /**
  152     * The Q runtime. Its public origin is what the speech provider calls back
  153     * to, which is the ngrok dependency this deployment removes:
  154     * `Q_API_PUBLIC_URL` resolves to this service's own Railway domain at
  155     * deploy time instead of a tunnel that rotates.
  156     *
  157     * The application API is reached privately, never over the public internet.
  158     */
  159    const qApi = service("@capital-q/q-api", {
  160      source: repo,
  161      build: buildFor("@capital-q/q-api"),
  162      start: "node apps/q-api/dist/main.js",
  163      healthcheckPath: "/health/ready",
  164      replicas: { [EU_REGION]: 1 },
  165      networking: { privateNetworkEndpoint: "capital-qq-api" },
  166      variables: {
  167        ...runtimeEnv,
  168        ...databaseEnv,
  169        ...modelProviderEnv,
  170        PORT: "3002",
  171        SUPABASE_URL: preserve(),
  172        SUPABASE_PUBLISHABLE_KEY: preserve(),
  173        CQ_API_URL: "http://capital-qapi.railway.internal:3001",
  174        Q_API_PUBLIC_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
  175        // Controlled public-web research (ADR 0009). Server-side only.
  176        TAVILY_API_KEY: preserve(),
  177        BRIGHT_DATA_API_KEY: preserve(),
  178        SERP_API_KEY: preserve(),
  179        // Voice (ADR 0010). Never exposed to a browser.
  180        DEEPGRAM_API_KEY: preserve(),
  181        ELEVENLABS_API_KEY: preserve(),
  182        ELEVENLABS_SPEECH_ENGINE_ID: preserve(),
  183        ELEVENLABS_SPEECH_ENGINE_ID_MALE: preserve(),
  184        Q_VOICE_EXPRESSIVE: "false",
  185      },
  186    });
  187  
  188    /**
  189     * Background workers: outbox publishing and document processing. No public
  190     * domain (doc 21, IDA-033) — nothing about this service is browser-facing.
  191     *
  192     * `CQ_MALWARE_POLICY` is REQUIRE_CLEAN, the only value permitted outside
  193     * development. Document processing therefore waits on a scanner being
  194     * composed; until then uploads are accepted and held, not parsed.
  195     */
  196    const workers = service("@capital-q/workers", {
  197      source: repo,
  198      build: buildFor("@capital-q/workers"),
  199      start: "node apps/workers/dist/main.js",
  200      replicas: { [EU_REGION]: 1 },
  201      networking: { privateNetworkEndpoint: "capital-qworkers" },
  202      variables: {
  203        ...runtimeEnv,
  204        ...databaseEnv,
  205        ...modelProviderEnv,
  206        SUPABASE_URL: preserve(),
  207        SUPABASE_SECRET_KEY: preserve(),
  208        CQ_MALWARE_POLICY: "REQUIRE_CLEAN",
  209        // Public research now runs here (QX-004 C): a committed company or
  210        // organisation name starts a presence build off the commit event,
  211        // and its findings become onboarding suggestions. Same keys q-api
  212        // holds; server-side only.
  213        TAVILY_API_KEY: preserve(),
  214        BRIGHT_DATA_API_KEY: preserve(),
  215        SERP_API_KEY: preserve(),
  216      },
  217    });
  218  
  219    /**
  220     * The web app. Vercel is still the intended host (ADR 0001, unchanged by
  221     * 0014); this serves staging until Vercel is authenticated.
  222     *
  223     * It was created by Railway's GitHub import and left as imported, which
  224     * meant three things that each made it unservable: it built with a bare
  225     * `pnpm --filter`, which builds no workspace dependency and fails on the
  226     * first `@capital-q/api-client` import; it was pinned to `main` rather
  227     * than the integration branch the other three services deploy; and it
  228     * carried no application variables at all. All three are fixed here.
  229     *
  230     * The voice transport is the reason this matters beyond convenience. The
  231     * speech provider calls back into q-api for every spoken turn, so a
  232     * browser served from a laptop needs a public tunnel for q-api, and a
  233     * tunnel that rotates takes voice down with it. Served from here, the
  234     * callback origin is q-api's own permanent domain and there is no tunnel
  235     * in the picture at all.
  236     */
  237    const web = service("@capital-q/web", {
  238      source: repo,
  239      build: buildFor("@capital-q/web"),
  240      start: "pnpm --filter @capital-q/web start",
  241      replicas: { [EU_REGION]: 1 },
  242      networking: { privateNetworkEndpoint: "capital-qweb" },
  243      variables: {
  244        ...runtimeEnv,
  245        PORT: "3000",
  246        /**
  247         * The browser reaches both services over their public domains: these
  248         * are fetched from the person's own browser, not from this server, so
  249         * a private address would not resolve.
  250         */
  251        CQ_API_URL: "https://${{@capital-q/api.RAILWAY_PUBLIC_DOMAIN}}",
  252        CQ_Q_API_URL: "https://${{@capital-q/q-api.RAILWAY_PUBLIC_DOMAIN}}",
  253        CQ_WEB_ORIGIN: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
  254        /**
  255         * Statically replaced into the bundle at build time, which is why
  256         * they are public by name: an anon Supabase URL and its publishable
  257         * key are safe in a browser and are useless without RLS passing.
  258         */
  259        NEXT_PUBLIC_SUPABASE_URL: preserve(),
  260        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: preserve(),
  261      },
  262    });
  263  
  264    return project("Q", { resources: [api, qApi, workers, web] });
  265  });
```

