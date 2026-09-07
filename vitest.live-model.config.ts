import { defineConfig } from "vitest/config";

/**
 * Live model smoke tests (doc 23 §185; CQ-Q-005 §52-53).
 *
 * These make REAL provider calls with SYNTHETIC, non-confidential input
 * and may cost money. They are excluded from `pnpm test` and
 * `pnpm test:integration` and run only through `pnpm test:live-model`,
 * which reads the two provider key names from `.env.local` into the test
 * process without echoing them. A suite whose key is absent skips itself.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.live.test.ts", "apps/**/*.live.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 0,
    fileParallelism: false,
    reporters: ["default"],
  },
});
