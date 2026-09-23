import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * How many worker processes may fork at once (CQ-TEST-FLAKE-001).
 *
 * A non-watch run defaults to `availableParallelism() - 1`, which on an
 * 8-core Windows host means seven processes forking together, each booting
 * the runner and -- for the `.tsx` suites -- jsdom as well. Waiting for a
 * worker to say "started" has a hard-coded 60s budget inside Vitest
 * (`START_TIMEOUT` in `cli-api`; there is no option for it), and on a busy
 * machine with a few GB free that budget was being missed. The run then
 * reports an unhandled error for files that never ran at all, which reads
 * like a test failure and is not one.
 *
 * Halving the fork count is the smallest fix that addresses the cause
 * rather than the symptom: no serial execution, no longer timeouts, no
 * retries, no weakened assertions. It is expressed against the host's own
 * parallelism so a larger machine still gets more workers, and floored at
 * two so the suite never silently becomes serial. Half is not an arbitrary
 * fraction: it is the count Vitest itself picks for watch mode, where it
 * expects to share the machine.
 */
const MAX_WORKERS = Math.max(2, Math.floor(availableParallelism() / 2));

/**
 * Capital Q deterministic test runner (ERA-057, TEO-001).
 *
 * One root configuration for the whole monorepo. Vitest's multi-project
 * configuration is deliberately not used yet: the repository has a single test
 * environment today, and doc 24 (236) warns against building a complex
 * distributed test platform before it is needed. A browser-environment project
 * can be added here when the first real component test arrives.
 *
 * `vitest.workspace.*` is deprecated and is intentionally not created.
 *
 * This runner covers deterministic software tests only. Browser journeys belong
 * to Playwright, database and RLS tests to Supabase CLI + pgTAP, and
 * probabilistic Q behaviour to the eval harness -- all separate systems
 * (TEO-001).
 */
export default defineConfig({
  // Component tests are TSX; opt into the automatic React runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: [
      // See tests/support/server-only.ts. The guard stays in the build; the
      // runner is simply not a browser bundle.
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./tests/support/server-only.ts", import.meta.url),
        ),
      },
      /**
       * `@/` is apps/web's own path alias (its tsconfig `paths`), used by
       * fifteen feature modules. The runner has to resolve it the way the
       * bundler does, or a component test fails on an import rather than on
       * anything it was written to check.
       *
       * Anchored to `@/` with the trailing slash on purpose: a bare `@`
       * alias is a prefix match and would also swallow every
       * `@capital-q/*` workspace import.
       */
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./apps/web/src", import.meta.url))}/`,
      },
    ],
  },
  test: {
    // Testing Library auto-cleans between tests when the globals exist.
    globals: true,
    // Node is the default environment. A fake browser is not imposed on
    // backend and domain tests just because a web app exists in the repo;
    // component tests will opt into a browser environment explicitly.
    environment: "node",

    // Tests live next to the code that owns them. Deterministic suites are
    // discovered anywhere under apps/ and packages/ so a bounded context can
    // keep its tests inside its own boundary.
    include: [
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
    ],

    // Playwright owns tests/e2e. Excluded explicitly so the two runners can
    // never discover the same file, even if the include globs widen later.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "tests/e2e/**",
      // Real-infrastructure tests run separately via `pnpm test:integration`.
      "**/*.integration.test.ts",
      // Real model calls run only via `pnpm test:live-model` (CQ-Q-005).
      "**/*.live.test.ts",
    ],

    // Deterministic tests fail fast. Long-running integration and browser
    // suites get their own explicit configuration rather than inflating this
    // default (doc 24, 240).
    testTimeout: 10_000,
    hookTimeout: 10_000,

    // A flaky deterministic test is a defect, not something to retry until it
    // passes (TEO-062; doc 24, 237).
    retry: 0,

    // See MAX_WORKERS above. Files still run in parallel, in isolated
    // processes; there are simply fewer of them starting at once.
    // `maxWorkers` is the Vitest 4 spelling: `poolOptions.forks.maxForks`
    // is accepted, warned about and then ignored, which looks exactly like
    // a fix that worked.
    maxWorkers: MAX_WORKERS,

    reporters: ["default"],
  },
});
