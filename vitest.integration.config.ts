import { defineConfig } from "vitest/config";

/**
 * Integration tests that need real infrastructure -- today, the local
 * Supabase PostgreSQL from `pnpm db:start`.
 *
 * Kept out of the default `pnpm test` so the fast deterministic suite and the
 * CI quality gate stay database-free; run with `pnpm test:integration`. A test
 * here that cannot reach its dependency fails loudly rather than silently
 * passing on a mock -- an integration test that does not integrate is worse
 * than none.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/**/*.integration.test.ts",
      "packages/**/*.integration.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    // Real network round-trips; still bounded.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    retry: 0,
    // Integration tests may share a database; run files serially so temporary
    // objects and timing assertions cannot interleave.
    fileParallelism: false,
    reporters: ["default"],
  },
});
