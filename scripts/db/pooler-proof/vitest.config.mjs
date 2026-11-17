import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The transaction-pooler proof (run.sh). Two projects:
 *
 *   proof   the harness's own *.pooler-proof.test.ts files: 200 concurrent
 *           queries on a saturated pool, statement limits inside
 *           transactions, a slow statement cancelled at its deadline,
 *           NOTIFY through the pooler reaching a session LISTEN, and
 *           concurrent runs through the engine with a checkpoint store
 *           on the pooler.
 *   suites  existing integration suites for runs, checkpoints,
 *           conversation state, memory, the model ledger and LISTEN wake,
 *           with every app client moved onto the pooler by the config shim,
 *           files in parallel so they contend for the small pool.
 *
 * Never part of `pnpm test` or `pnpm test:integration`: both exclude
 * *.pooler-proof.test.ts, and the suites here need run.sh's stack.
 */
const shim = fileURLToPath(
  new URL("./config-database-shim.mjs", import.meta.url),
);
const root = fileURLToPath(new URL("../../..", import.meta.url));

const SUITES = [
  "packages/database/test/database.integration.test.ts",
  "packages/database/test/round-trips.integration.test.ts",
  "packages/q-runtime/test/q-runtime.integration.test.ts",
  "packages/q-runtime/test/conversation-states.integration.test.ts",
  "packages/q-runtime/test/orphan-sweep.integration.test.ts",
  "packages/q-orchestrator/test/q-orchestrator.integration.test.ts",
  "packages/q-orchestrator/test/answer-seam.integration.test.ts",
  "packages/q-orchestrator/test/approval-flow.integration.test.ts",
  "packages/q-orchestrator/test/firewall-resume.integration.test.ts",
  "packages/q-knowledge/test/memory.integration.test.ts",
  "packages/model-gateway/test/gateway-postgres.integration.test.ts",
  "packages/model-gateway/test/usage-reader.integration.test.ts",
  "packages/eventing/test/outbox.integration.test.ts",
  "apps/q-api/test/q-runs.integration.test.ts",
  "apps/q-api/test/q-events.integration.test.ts",
  "apps/q-api/test/work.integration.test.ts",
  "apps/q-api/test/working-snapshot.integration.test.ts",
  "apps/q-api/test/arrival-snapshot.integration.test.ts",
];

export default defineConfig({
  root,
  resolve: {
    alias: [{ find: /^@capital-q\/config\/database$/u, replacement: shim }],
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 0,
    reporters: ["default"],
    projects: [
      {
        extends: true,
        test: {
          name: "proof",
          include: ["packages/**/*.pooler-proof.test.ts"],
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "suites",
          include: SUITES,
          // Two assertions that hold only on a direct connection, by
          // design: the startup statement_timeout (Supavisor drops startup
          // parameters; behind it the limit is the per-transaction
          // set_config plus the client deadline, both proven in `proof`)
          // and the exact round-trip count of a transaction (the
          // set_config is one more statement there).
          testNamePattern:
            /^(?!.*(applies the configured statement timeout on every connection|counts each query sent once, fragments never, and BEGIN\/COMMIT))/u,
          fileParallelism: true,
          maxWorkers: 3,
        },
      },
    ],
  },
});
