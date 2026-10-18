/**
 * Capital Q on Railway — the three Node service deployables (ADR 0014).
 *
 * `apps/web` is hosted on Vercel and is not configured here. The
 * `@capital-q/web` service below exists only because Railway's GitHub import
 * created it; it is left exactly as imported, pinned to `main`, so that
 * applying this file neither redeploys it nor deletes it. It is removed once
 * Vercel is serving staging.
 *
 * Two rules govern this file.
 *
 * Secret values are never in it. Every secret is `preserve()`: the name is
 * version-controlled, the value is set once with
 * `railway variable set <NAME> --stdin` and lives only in Railway.
 *
 * Each service receives only the variables it actually reads. A variable this
 * file does not list for a service is one that service's configuration schema
 * does not consume. Notably `DATABASE_PRIVILEGED_URL` appears nowhere:
 * `createPrivilegedDatabaseClient` has no caller outside tests, so no
 * deployed service needs that credential.
 */

import { defineRailway, github, preserve, project, service } from "railway/iac";

/**
 * The integration branch carrying the accepted product state. Railway's
 * default branch for this repo is `main`, which is behind; deployment
 * convenience is not a reason to move product history (ADR 0014), so the
 * source branch is configuration instead.
 */
const INTEGRATION_BRANCH = "recovery/2026-09-12";

/** EU West, Netherlands — the Amsterdam location doc 21 selected. EU data
 * residency is a requirement, not a preference (ADR 0001, carried by 0014). */
const EU_REGION = "europe-west4";

/**
 * A leaf deployable cannot be built alone: every workspace package resolves
 * through `dist`, and `turbo.json` declares `build` with
 * `dependsOn: ["^build"]`. Turborepo is therefore the authority on build
 * order. A bare `pnpm --filter <pkg> build` builds no dependencies and fails
 * with hundreds of cascading TS2307 errors that are not source defects.
 *
 * The command itself lives in the root `package.json` as
 * `deploy:build:<service>`, so there is one definition of how a deployable is
 * built and it can be run from a clean clone without Railway.
 */
const buildFor = (pkg: string) => ({
  buildCommand: `pnpm deploy:build:${pkg.replace("@capital-q/", "")}`,
  buildEnvironment: "V3" as const,
  builder: "RAILPACK" as const,
  /**
   * A service changes when its own app changes, when any workspace package
   * changes, or when the build/runtime contract changes. Watching only
   * `apps/<svc>/**` would miss every package this service compiles in.
   */
  watchPatterns: [
    "/apps/" + pkg.replace("@capital-q/", "") + "/**",
    "/packages/**",
    "/package.json",
    "/pnpm-lock.yaml",
    "/pnpm-workspace.yaml",
    "/turbo.json",
    "/tsconfig.base.json",
    "/.nvmrc",
  ],
});

/**
 * Shared runtime posture.
 *
 * `CAPITAL_Q_ENV` is `staging`, not `production`: Railway's environment is
 * called `production` only because that is Railway's default name, and a
 * platform label is not a product claim.
 *
 * `CQ_SYNTHETIC_DEMO_ROUTING` is deliberately absent. The attestation in
 * `packages/model-gateway/src/policy/synthetic-demo.ts` admits only
 * `local`/`test` with a loopback database and throws at startup otherwise, so
 * setting it here would both crash the service and assert something untrue: a
 * deployment that can reach hosted data does not get to call itself a demo.
 */
const runtimeEnv = {
  NODE_ENV: "production",
  CAPITAL_Q_ENV: "staging",
  REGION: "eu-west",
  LOG_LEVEL: "info",
} as const;

/** Hosted Supabase is reached through its session pooler. */
const databaseEnv = {
  DATABASE_URL: preserve(),
  DATABASE_CONNECTION_MODE: "session_pooler",
} as const;

/**
 * Model providers. Each is optional and the gateway routes around an
 * unconfigured one. `api` needs one because the GateQ applicant interview is
 * only registered when a provider exists; `workers` needs one for governed
 * document extraction.
 */
const modelProviderEnv = {
  GEMINI_API_KEY: preserve(),
  GEMINI_API_KEY2: preserve(),
  GROQ_API_KEY: preserve(),
  GROQ_API_KEY_2: preserve(),
} as const;

export default defineRailway(() => {
  const repo = github("neo1415/q", {
    branch: INTEGRATION_BRANCH,
    /**
     * RECOVERY F2 (audit F-D6): wait for CI. A push to the branch deploys
     * only after the commit's GitHub check suites pass (.github/workflows/
     * ci.yml now runs on `recovery/**`). Takes effect only when the founder
     * applies this file, or sets each service's Settings → Source → "Wait
     * for CI" in the dashboard. While CI is red on the branch, deploys hold.
     */
    checkSuites: true,
  });

  /**
   * The application API. `PORT` is set explicitly rather than left to
   * Railway's injected value so that the private address other services use
   * is deterministic; `HOST` already defaults to 0.0.0.0 in
   * packages/config/src/common.ts, so nothing in the application changes.
   */
  const api = service("@capital-q/api", {
    source: repo,
    build: buildFor("@capital-q/api"),
    // node directly, not `pnpm run`: the process that receives SIGTERM should
    // be the Node process, not a package-manager wrapper.
    start: "node apps/api/dist/main.js",
    healthcheckPath: "/health/ready",
    replicas: { [EU_REGION]: 1 },
    networking: { privateNetworkEndpoint: "capital-qapi" },
    variables: {
      ...runtimeEnv,
      ...databaseEnv,
      ...modelProviderEnv,
      PORT: "3001",
      /**
       * The one Q interviewer (QX-004 core gate). The conversational
       * onboarding turn is delegated to q-api rather than answered by a
       * second implementation here, and without this the route closes:
       * every typed turn comes back PROVIDER_UNAVAILABLE and nothing is
       * recorded. Reached privately; it never leaves Railway's network.
       */
      CQ_Q_API_URL: "http://capital-qq-api.railway.internal:3002",
      SUPABASE_URL: preserve(),
      SUPABASE_PUBLISHABLE_KEY: preserve(),
      // Privileged storage credential: without it the document upload
      // boundary refuses to open rather than half-working, and the rest of
      // the API still serves. It never leaves this process.
      SUPABASE_SECRET_KEY: preserve(),
    },
  });

  /**
   * The Q runtime. Its public origin is what the speech provider calls back
   * to, which is the ngrok dependency this deployment removes:
   * `Q_API_PUBLIC_URL` resolves to this service's own Railway domain at
   * deploy time instead of a tunnel that rotates.
   *
   * The application API is reached privately, never over the public internet.
   */
  const qApi = service("@capital-q/q-api", {
    source: repo,
    build: buildFor("@capital-q/q-api"),
    start: "node apps/q-api/dist/main.js",
    healthcheckPath: "/health/ready",
    replicas: { [EU_REGION]: 1 },
    networking: { privateNetworkEndpoint: "capital-qq-api" },
    variables: {
      ...runtimeEnv,
      ...databaseEnv,
      ...modelProviderEnv,
      PORT: "3002",
      SUPABASE_URL: preserve(),
      SUPABASE_PUBLISHABLE_KEY: preserve(),
      CQ_API_URL: "http://capital-qapi.railway.internal:3001",
      Q_API_PUBLIC_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      // Controlled public-web research (ADR 0009). Server-side only.
      TAVILY_API_KEY: preserve(),
      BRIGHT_DATA_API_KEY: preserve(),
      SERP_API_KEY: preserve(),
      // Voice (ADR 0010). Never exposed to a browser.
      DEEPGRAM_API_KEY: preserve(),
      ELEVENLABS_API_KEY: preserve(),
      ELEVENLABS_SPEECH_ENGINE_ID: preserve(),
      ELEVENLABS_SPEECH_ENGINE_ID_MALE: preserve(),
      Q_VOICE_EXPRESSIVE: "false",
    },
  });

  /**
   * Background workers: outbox publishing and document processing. No public
   * domain (doc 21, IDA-033) — nothing about this service is browser-facing.
   *
   * `CQ_MALWARE_POLICY` is REQUIRE_CLEAN, the only value permitted outside
   * development. Document processing therefore waits on a scanner being
   * composed; until then uploads are accepted and held, not parsed.
   */
  const workers = service("@capital-q/workers", {
    source: repo,
    build: buildFor("@capital-q/workers"),
    start: "node apps/workers/dist/main.js",
    replicas: { [EU_REGION]: 1 },
    networking: { privateNetworkEndpoint: "capital-qworkers" },
    variables: {
      ...runtimeEnv,
      ...databaseEnv,
      ...modelProviderEnv,
      SUPABASE_URL: preserve(),
      SUPABASE_SECRET_KEY: preserve(),
      CQ_MALWARE_POLICY: "REQUIRE_CLEAN",
      // Public research now runs here (QX-004 C): a committed company or
      // organisation name starts a presence build off the commit event,
      // and its findings become onboarding suggestions. Same keys q-api
      // holds; server-side only.
      TAVILY_API_KEY: preserve(),
      BRIGHT_DATA_API_KEY: preserve(),
      SERP_API_KEY: preserve(),
    },
  });

  /**
   * The web app. Vercel is still the intended host (ADR 0001, unchanged by
   * 0014); this serves staging until Vercel is authenticated.
   *
   * It was created by Railway's GitHub import and left as imported, which
   * meant three things that each made it unservable: it built with a bare
   * `pnpm --filter`, which builds no workspace dependency and fails on the
   * first `@capital-q/api-client` import; it was pinned to `main` rather
   * than the integration branch the other three services deploy; and it
   * carried no application variables at all. All three are fixed here.
   *
   * The voice transport is the reason this matters beyond convenience. The
   * speech provider calls back into q-api for every spoken turn, so a
   * browser served from a laptop needs a public tunnel for q-api, and a
   * tunnel that rotates takes voice down with it. Served from here, the
   * callback origin is q-api's own permanent domain and there is no tunnel
   * in the picture at all.
   */
  const web = service("@capital-q/web", {
    source: repo,
    build: buildFor("@capital-q/web"),
    start: "pnpm --filter @capital-q/web start",
    replicas: { [EU_REGION]: 1 },
    networking: { privateNetworkEndpoint: "capital-qweb" },
    variables: {
      ...runtimeEnv,
      PORT: "3000",
      /**
       * The browser reaches both services over their public domains: these
       * are fetched from the person's own browser, not from this server, so
       * a private address would not resolve.
       */
      CQ_API_URL: "https://${{@capital-q/api.RAILWAY_PUBLIC_DOMAIN}}",
      CQ_Q_API_URL: "https://${{@capital-q/q-api.RAILWAY_PUBLIC_DOMAIN}}",
      CQ_WEB_ORIGIN: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      /**
       * Statically replaced into the bundle at build time, which is why
       * they are public by name: an anon Supabase URL and its publishable
       * key are safe in a browser and are useless without RLS passing.
       */
      NEXT_PUBLIC_SUPABASE_URL: preserve(),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: preserve(),
    },
  });

  return project("Q", { resources: [api, qApi, workers, web] });
});
