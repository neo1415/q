import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";

/**
 * Capital Q root ESLint configuration (ESLint 10 flat config, ERA-055).
 *
 * One lint architecture for the whole repository: workspaces do not define
 * their own configs. Layer order is deliberate —
 *
 *   1. global ignores
 *   2. base JavaScript correctness
 *   3. TypeScript + type-aware safety
 *   4. Capital Q architecture / import boundaries
 *   5. Next.js + React, scoped to apps/web only
 *   6. environment-scoped overrides
 *   7. eslint-config-prettier last, so formatting stays Prettier's job (25)
 *
 * Formatting rules do not belong here. ESLint owns correctness; Prettier owns
 * layout.
 */

/** Workspace package names that are deployable applications, never dependencies. */
const APP_PACKAGES = [
  "@capital-q/web",
  "@capital-q/api",
  "@capital-q/q-api",
  "@capital-q/workers",
];

/** Importing an app, or any subpath of one. */
const APP_IMPORT_PATTERNS = APP_PACKAGES.flatMap((name) => [name, `${name}/*`]);

/** Reaching into another workspace package's implementation. */
const DEEP_INTERNAL_PATTERN = "@capital-q/*/src/*";

/** Browser-reachable source: the web app and the shared component package. */
const WEB_SOURCE = ["apps/web/**/*.{ts,tsx}"];

const boundaryMessage = {
  appFromPackage:
    "Reusable packages must not import deployable apps. The direction is apps -> packages, never the reverse (ERA-002, doc 23 s22).",
  deepInternal:
    "Import a package through its public entrypoint (@capital-q/<name>), not its internals. Deep imports defeat the package boundary (ERA-008, doc 23 s25).",
  privilegedDatabase:
    "Browser-reachable code must not import database infrastructure. Service-role access bypasses RLS and must never reach a client bundle (SEC-006, TM-TEN-03). Consume @capital-q/api-client or @capital-q/contracts instead.",
  apiImplementation:
    "The API client consumes public contracts, not server implementation (doc 23 s32, AEC-057).",
  serverOnlyDatabase:
    "@capital-q/database is server-only infrastructure holding connection strings. It must not reach a browser bundle or the API client (SEC-006, TM-TEN-03).",
  migrationEntrypoint:
    "@capital-q/database/migration is schema-administration tooling. Runtime deployables use the request client; workers that genuinely need elevation use @capital-q/database/privileged.",
  unsafeSql:
    "sql.unsafe() bypasses parameterisation and is forbidden in application code. Interpolate values in the sql`` tagged template so they are bound as parameters (doc 23, 96).",
  serverOnlySecurityAdapters:
    "@capital-q/security/postgres and @capital-q/security/supabase are server-side security adapters (database driver, Auth server client). Browser-reachable code and the API client use the pure primitives from @capital-q/security only.",
  serverOnlyEventing:
    "@capital-q/eventing is server-side event infrastructure over the database. Browser-reachable code and the API client never import it.",
  publisherOnlyInWorkers:
    "@capital-q/eventing/publisher (OutboxPublisher, PgmqEventDispatcher) is worker infrastructure. Domain and application code emit events through OutboxWriter inside their own transaction and never publish to the queue directly (ERA-041, AEC-036).",
  serverOnlyAudit:
    "@capital-q/audit writes accountability records through the database. Browser-reachable code and the API client never import it.",
  serverOnlyObservability:
    "@capital-q/observability is server-only: it depends on Pino and Node built-ins and must not reach a browser bundle. Browser telemetry arrives as its own surface.",
  relativeEscape:
    "Cross-package imports use the @capital-q/* workspace name, not a relative path out of the package.",
};

/** Import restrictions as reusable pattern entries. */
const deepInternal = {
  group: [DEEP_INTERNAL_PATTERN],
  message: boundaryMessage.deepInternal,
};
const relativeEscape = {
  group: ["**/apps/*/src/*", "**/packages/*/src/*"],
  message: boundaryMessage.relativeEscape,
};
const noApps = {
  group: APP_IMPORT_PATTERNS,
  message: boundaryMessage.appFromPackage,
};
const noAppPaths = {
  group: ["**/apps/**"],
  message: boundaryMessage.appFromPackage,
};
const noDatabase = {
  group: ["@capital-q/database", "@capital-q/database/*"],
  message: boundaryMessage.privilegedDatabase,
};
const noSecurityAdapters = {
  group: ["@capital-q/security/postgres", "@capital-q/security/supabase"],
  message: boundaryMessage.serverOnlySecurityAdapters,
};
const noEventing = {
  group: ["@capital-q/eventing", "@capital-q/eventing/*"],
  message: boundaryMessage.serverOnlyEventing,
};
const noAudit = {
  group: ["@capital-q/audit", "@capital-q/audit/*"],
  message: boundaryMessage.serverOnlyAudit,
};
const noObservability = {
  group: ["@capital-q/observability", "@capital-q/observability/*"],
  message: boundaryMessage.serverOnlyObservability,
};
const noMigration = {
  group: ["@capital-q/database/migration"],
  message: boundaryMessage.migrationEntrypoint,
};
const noPublisher = {
  group: ["@capital-q/eventing/publisher"],
  message: boundaryMessage.publisherOnlyInWorkers,
};

/** One complete, non-merging import-boundary scope. */
function restrictImports(files, ignores, patterns) {
  return {
    files,
    ignores,
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns }],
    },
  };
}

export default tseslint.config(
  // 1. Global ignores. Build output and generated files only -- never real source.
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
      // Generated by `pnpm db:types` from the database; not authored source.
      "packages/database/src/generated/**",
    ],
  },

  // 2. Base JavaScript correctness.
  js.configs.recommended,

  // 3. TypeScript, with type-aware rules for all TS source.
  //
  // recommendedTypeChecked is chosen over strictTypeChecked deliberately: the
  // compiler is already strict, and strictTypeChecked is a semver-unstable
  // opinion set that can shift under us on a minor bump (15).
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        // projectService resolves each file to its owning workspace tsconfig,
        // so type-aware linting works across the monorepo without listing
        // every project by hand.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Escape hatches are exceptional, not routine style (ERA-017, ERA-018).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          // The ts-ignore directive silences an error forever; the
          // ts-expect-error directive fails once the underlying problem is
          // fixed, so it is the only allowed form and must carry a reason (23).
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],

      // Unhandled async work is a correctness and security concern: a dropped
      // promise silently discards failures.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // Exhaustive handling of discriminated unions (ERA-019).
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // Unused code is removed, not accumulated. Leading-underscore names are
      // the documented opt-out for genuinely required-but-unused bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Code execution from strings (doc 15, 99; CSP has no unsafe-eval).
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },

  // 4. Capital Q architecture boundaries.
  //
  // Enforced with no-restricted-imports rather than a dependency-graph
  // framework (36). One rule of flat config shapes everything below: when two
  // config objects match the same file, the later one REPLACES the rule's
  // options -- patterns are never merged. So each scope here is complete on
  // its own, scopes are disjoint, and a probe file in each scope is part of
  // every packet's verification.

  // Rule A -- no reusable package may import a deployable app.
  restrictImports(
    ["packages/**/*.{ts,tsx}"],
    ["packages/ui/**", "packages/api-client/**", "packages/eventing/**"],
    [
      noApps,
      noAppPaths,
      noPublisher,
      noMigration,
      deepInternal,
      relativeEscape,
    ],
  ),
  restrictImports(
    ["packages/eventing/**/*.{ts,tsx}"],
    [],
    [noApps, noAppPaths, noMigration, deepInternal, relativeEscape],
  ),

  // Rule C -- browser-reachable code must not reach server infrastructure
  // (doc 15, 113/116; TM-TEN-03, TM-SEC-02). Lint is one of the two controls
  // those threats name; the other is production build scanning in CI.
  restrictImports(
    ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    [],
    [
      noDatabase,
      noSecurityAdapters,
      noEventing,
      noAudit,
      noObservability,
      {
        group: APP_IMPORT_PATTERNS.filter(
          (pattern) => !pattern.startsWith("@capital-q/web"),
        ),
        message: boundaryMessage.appFromPackage,
      },
      deepInternal,
      relativeEscape,
    ],
  ),

  // Rule D -- the API client consumes contracts, never server implementation.
  restrictImports(
    ["packages/api-client/**/*.ts"],
    [],
    [
      noDatabase,
      noSecurityAdapters,
      noEventing,
      noAudit,
      noApps,
      noAppPaths,
      deepInternal,
      relativeEscape,
    ],
  ),

  // Rule E -- HTTP deployables: no schema administration, no queue
  // publication. Events leave through OutboxWriter in a transaction.
  restrictImports(
    ["apps/api/**/*.{ts,tsx}", "apps/q-api/**/*.{ts,tsx}"],
    [],
    [noMigration, noPublisher, deepInternal, relativeEscape],
  ),

  // Rule F -- the worker may publish; it still never administers schema.
  restrictImports(
    ["apps/workers/**/*.{ts,tsx}"],
    [],
    [noMigration, deepInternal, relativeEscape],
  ),

  // Everything else (root configs, e2e tests): package boundaries only.
  restrictImports(
    ["**/*.{ts,tsx,mts,cts}"],
    ["apps/**", "packages/**"],
    [deepInternal, relativeEscape],
  ),

  // Parameterisation is never bypassed outside the driver adapter itself.
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    ignores: ["packages/database/src/internal/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "unsafe", message: boundaryMessage.unsafeSql },
      ],
    },
  },

  // The service worker is plain browser JavaScript with worker globals, and
  // the icon generator is a Node script. Neither is TypeScript source.
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Promise: "readonly",
      },
    },
  },
  {
    files: ["apps/web/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },

  // Backend runtime logging goes through @capital-q/observability, so records
  // are structured, carry service metadata and pass baseline redaction
  // (ERA-050, ERA-141). Scripts, tooling and tests are unaffected.
  {
    files: [
      "apps/api/src/**/*.ts",
      "apps/q-api/src/**/*.ts",
      "apps/workers/src/**/*.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },

  // 5. Next.js and React -- apps/web only. These rules are meaningless in the
  // Node services and would only produce noise there (20).
  //
  // core-web-vitals already contains the `next/typescript` block, so
  // `eslint-config-next/typescript` is deliberately not also applied: it would
  // register a second typescript-eslint instance on top of the
  // recommendedTypeChecked layer above (21, 22).
  //
  // One entry in the preset is ignore-only. Attaching `files` to it would turn
  // a global ignore into a scoped config, so it is passed through untouched.
  ...nextCoreWebVitals.map((config) =>
    Object.keys(config).length === 1 && config.ignores
      ? config
      : { ...config, files: WEB_SOURCE },
  ),

  // eslint-plugin-react 7.37.5 (transitive, via eslint-config-next) declares
  // peer support only up to ESLint 9.7. Its React auto-detection path calls
  // context.getFilename(), removed in ESLint 10, and throws. Declaring the
  // React version explicitly skips detection entirely, which is the correct
  // configuration for a pinned monorepo dependency regardless. Revisit when
  // the plugin ships ESLint 10 support.
  {
    files: WEB_SOURCE,
    settings: {
      react: { version: "19.2" },
    },
    rules: {
      // Pages Router rule. Capital Q is App Router only, so this rule has
      // nothing to check and otherwise probes for a pages/ directory that will
      // never exist. Not a relaxation -- the routing model it guards is not in
      // use.
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  // The Next preset supplies its own languageOptions for apps/web, which drops
  // the type-aware parser settings established above. Re-assert them after it
  // so type-aware rules keep working in the web app rather than silently
  // degrading to syntax-only linting.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // 6. Environment-scoped overrides.
  //
  // Config files live outside the TypeScript projects, so type-aware linting
  // cannot apply to them. Scoped off here rather than disabled repo-wide (38).
  {
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // 7. Prettier last: turns off every rule that would fight the formatter.
  prettier,
);
