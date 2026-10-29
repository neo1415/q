import { defineConfig } from "vitest/config";

/**
 * The research acceptance gate's LIVE driver (owner 2026-10-29): records a
 * golden case against the real search providers and model, or evaluates
 * live models over the recorded web pages. It may cost money, so it is
 * never part of `pnpm test`; it runs only through
 * scripts/research-acceptance/record.mjs and eval.mjs, which supply the
 * keys. The CI gate is the replay test, which `pnpm test` runs.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/q-api/test/research-acceptance/drive.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    retry: 0,
    fileParallelism: false,
    reporters: ["default"],
  },
});
