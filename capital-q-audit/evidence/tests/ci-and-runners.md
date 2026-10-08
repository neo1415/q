# CI workflow and test runner configs

Why included: What CI runs, on which branches; vitest exclusions; deploy branch with checkSuites false.

## `.github/workflows/ci.yml` lines 1-80

```ts
    1  name: CI
    2  
    3  # Baseline quality gate: a clean runner must reproduce the repository's static
    4  # checks, deterministic tests and build from the committed dependency graph.
    5  # Deployment, database, E2E and security scanning are deliberately not here --
    6  # they arrive with the packets that introduce those capabilities.
    7  
    8  on:
    9    pull_request:
   10    push:
   11      branches:
   12        - main
   13    workflow_dispatch:
   14  
   15  # Read-only. This job checks out code and runs local tooling; it never writes to
   16  # the repository, publishes, or deploys. Unspecified permissions default to none.
   17  permissions:
   18    contents: read
   19  
   20  # A newer commit on the same ref supersedes an in-flight run.
   21  concurrency:
   22    group: ci-${{ github.workflow }}-${{ github.ref }}
   23    cancel-in-progress: true
   24  
   25  jobs:
   26    quality:
   27      name: quality
   28      runs-on: ubuntu-latest
   29      timeout-minutes: 15
   30  
   31      steps:
   32        - name: Checkout
   33          uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
   34  
   35        # .nvmrc is the single runtime version source, shared with local dev.
   36        - name: Set up Node
   37          uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
   38          with:
   39            node-version-file: .nvmrc
   40  
   41        # Corepack activates the exact pnpm pinned in package.json#packageManager,
   42        # so CI and local development run the same package manager version.
   43        - name: Activate pinned pnpm
   44          run: |
   45            corepack enable
   46            corepack prepare --activate
   47            node --version
   48            pnpm --version
   49  
   50        - name: Resolve pnpm store path
   51          id: pnpm-store
   52          run: echo "path=$(pnpm store path)" >> "$GITHUB_OUTPUT"
   53  
   54        - name: Restore pnpm store
   55          uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
   56          with:
   57            path: ${{ steps.pnpm-store.outputs.path }}
   58            key: pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
   59            restore-keys: |
   60              pnpm-store-${{ runner.os }}-
   61  
   62        # Fails if package.json and pnpm-lock.yaml have drifted apart.
   63        - name: Install dependencies
   64          run: pnpm install --frozen-lockfile
   65  
   66        # Cheapest gates first so obvious failures do not pay for a build.
   67        - name: Format check
   68          run: pnpm format:check
   69  
   70        - name: Lint
   71          run: pnpm lint
   72  
   73        - name: Typecheck
   74          run: pnpm typecheck
   75  
   76        - name: Test
   77          run: pnpm test
   78  
   79        - name: Build
   80          run: pnpm build
```

## `vitest.config.ts` lines 85-125

```ts
   85        "apps/**/*.{test,spec}.{ts,tsx}",
   86        "packages/**/*.{test,spec}.{ts,tsx}",
   87      ],
   88  
   89      // Playwright owns tests/e2e. Excluded explicitly so the two runners can
   90      // never discover the same file, even if the include globs widen later.
   91      exclude: [
   92        "**/node_modules/**",
   93        "**/dist/**",
   94        "**/.next/**",
   95        "**/.turbo/**",
   96        "tests/e2e/**",
   97        // Real-infrastructure tests run separately via `pnpm test:integration`.
   98        "**/*.integration.test.ts",
   99        // Real model calls run only via `pnpm test:live-model` (CQ-Q-005).
  100        "**/*.live.test.ts",
  101      ],
  102  
  103      // Deterministic tests fail fast. Long-running integration and browser
  104      // suites get their own explicit configuration rather than inflating this
  105      // default (doc 24, 240).
  106      testTimeout: 10_000,
  107      hookTimeout: 10_000,
  108  
  109      // A flaky deterministic test is a defect, not something to retry until it
  110      // passes (TEO-062; doc 24, 237).
  111      retry: 0,
  112  
  113      // See MAX_WORKERS above. Files still run in parallel, in isolated
  114      // processes; there are simply fewer of them starting at once.
  115      // `maxWorkers` is the Vitest 4 spelling: `poolOptions.forks.maxForks`
  116      // is accepted, warned about and then ignored, which looks exactly like
  117      // a fix that worked.
  118      maxWorkers: MAX_WORKERS,
  119  
  120      reporters: ["default"],
  121    },
  122  });
```

## `.railway/railway.ts` lines 28-32

```ts
   28   * convenience is not a reason to move product history (ADR 0014), so the
   29   * source branch is configuration instead.
   30   */
   31  const INTEGRATION_BRANCH = "recovery/2026-09-12";
   32  
```

## `.railway/railway.ts` lines 108-112

```ts
  108  export default defineRailway(() => {
  109    const repo = github("neo1415/q", {
  110      branch: INTEGRATION_BRANCH,
  111      checkSuites: false,
  112    });
```

