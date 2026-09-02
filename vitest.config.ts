import { defineConfig } from "vitest/config";

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
  test: {
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
    ],

    // Deterministic tests fail fast. Long-running integration and browser
    // suites get their own explicit configuration rather than inflating this
    // default (doc 24, 240).
    testTimeout: 10_000,
    hookTimeout: 10_000,

    // A flaky deterministic test is a defect, not something to retry until it
    // passes (TEO-062; doc 24, 237).
    retry: 0,

    reporters: ["default"],
  },
});
