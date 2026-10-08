# Database access classes

Why included: No per-request role or JWT claims; privileged URL unused in staging.

## `packages/database/src/privileged.ts` lines 1-45

```ts
    1  import {
    2    resolveDatabaseUrl,
    3    type DatabaseConfig,
    4  } from "@capital-q/config/database";
    5
    6  import { createPostgresClient } from "./internal/postgres.js";
    7  import { createTransactionManager } from "./transaction.js";
    8  import type { PrivilegedDatabase } from "./types.js";
    9
   10  /**
   11   * Elevated database access for a narrowly scoped server process.
   12   *
   13   * Reached only through `@capital-q/database/privileged`, so every import site
   14   * says what it is asking for. The name is deliberate: this is a
   15   * security-sensitive path, and a reviewer should be able to find every use of
   16   * it by searching for the word.
   17   *
   18   * Elevated at the database is not authorised at the application. Bypassing
   19   * row-level security removes a defence-in-depth layer; it does not remove the
   20   * obligation to run ActorContext, AuthorizationService and tenant-ownership
   21   * checks. There is no `if (privileged) return ALLOW` anywhere, and there must
   22   * never be.
   23   *
   24   * Outside local and test environments this requires DATABASE_PRIVILEGED_URL
   25   * and fails at creation without it. It never falls back to the request
   26   * credential in a deployed environment.
   27   */
   28  export function createPrivilegedDatabaseClient(
   29    config: DatabaseConfig,
   30  ): PrivilegedDatabase {
   31    const sql = createPostgresClient(
   32      resolveDatabaseUrl(config, "PRIVILEGED_SERVICE"),
   33      config,
   34      "PRIVILEGED_SERVICE",
   35    );
   36
   37    return {
   38      accessClass: "PRIVILEGED_SERVICE",
   39      sql,
   40      transactions: createTransactionManager(sql),
   41      listen: (channel, onNotify, onListen) =>
   42        sql.listen(channel, onNotify, onListen),
   43      close: () => sql.end(),
   44    };
   45  }
```

## `packages/config/src/database.ts` lines 120-175

```ts
  120  export function loadDatabaseConfig(): DatabaseConfig {
  121    return parseDatabaseConfig(process.env);
  122  }
  123
  124  /**
  125   * The connection string for a given access class.
  126   *
  127   * The three classes are logically distinct even where they physically share an
  128   * endpoint. Locally and under test they may all resolve to DATABASE_URL, because
  129   * the local stack has no dedicated runtime roles yet. In any deployed
  130   * environment a missing privileged or migration URL is a hard failure: falling
  131   * back to the request credential there would silently change what authority a
  132   * process runs with, which is exactly the substitution this must prevent.
  133   *
  134   * Resolution is lazy -- at client creation, not config load -- so a deployment
  135   * that never creates a privileged client needs only DATABASE_URL.
  136   */
  137  export function resolveDatabaseUrl(
  138    config: DatabaseConfig,
  139    accessClass: DatabaseAccessClass,
  140  ): string {
  141    const { deploymentEnvironment } = config.runtime;
  142    const mayShareLocalCredential =
  143      deploymentEnvironment === "local" || config.runtime.nodeEnv === "test";
  144
  145    const dedicated =
  146      accessClass === "PRIVILEGED_SERVICE"
  147        ? config.secrets.privilegedUrl
  148        : accessClass === "MIGRATION"
  149          ? config.secrets.migrationUrl
  150          : config.secrets.url;
  151
  152    if (dedicated !== undefined) {
  153      return dedicated;
  154    }
  155
  156    if (mayShareLocalCredential) {
  157      return config.secrets.url;
  158    }
  159
  160    const variable =
  161      accessClass === "PRIVILEGED_SERVICE"
  162        ? "DATABASE_PRIVILEGED_URL"
  163        : "DATABASE_MIGRATION_URL";
  164
  165    throw new ConfigurationError("database", [
  166      {
  167        variable,
  168        reason: `required in ${deploymentEnvironment}; ${accessClass} access does not fall back to the request credential`,
  169      },
  170    ]);
  171  }
```

## `docs/deployment/staging.md` lines 98-104

```ts
   98  In `.railway/railway.ts` every secret is declared `preserve()`, which
   99  version-controls the _name_ while leaving the value in Railway.
  100
  101  Each service gets only what its configuration schema reads.
  102  `DATABASE_PRIVILEGED_URL` is deliberately absent everywhere:
  103  `createPrivilegedDatabaseClient` has no caller outside tests.
  104
```

## `docs/deployment/staging.md` lines 128-140

```ts
  128  `PORT` is set explicitly (api 3001, q-api 3002) rather than left to Railway's
  129  injected value, so the private address peers use is deterministic. `HOST`
  130  already defaults to `0.0.0.0` in `packages/config/src/common.ts`; no
  131  application change was needed for the platform's port.
  132
  133  ### Two variables that must not be set
  134
  135  - **`CQ_SYNTHETIC_DEMO_ROUTING`.** `createSyntheticDemoRoutingAllowance`
  136    (`packages/model-gateway/src/policy/synthetic-demo.ts`) admits only
  137    `CAPITAL_Q_ENV` of `local`/`test` **and** a loopback database host, and
  138    **throws at startup** otherwise. Staging is `staging` against hosted
  139    Supabase, so setting this both crashes the service and asserts something
  140    false. Staging Q traffic runs under its ordinary confidentiality ceiling.
```
