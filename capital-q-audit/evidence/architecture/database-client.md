# Excerpt: packages/database/src/client.ts lines 1-41

- Original path: `packages/database/src/client.ts`
- Line range: 1-41
- Why included: REQUEST database client: one pool per process, no role switching, no tenant GUC.

```
    1  import {
    2    resolveDatabaseUrl,
    3    type DatabaseConfig,
    4  } from "@capital-q/config/database";
    5  
    6  import { createPostgresClient } from "./internal/postgres.js";
    7  import { createTransactionManager } from "./transaction.js";
    8  import type { RequestDatabase } from "./types.js";
    9  
   10  /**
   11   * Normal server application database access.
   12   *
   13   * Create once per process and share it: a persistent service reuses its pool
   14   * for every request. Constructing a client per request would open a fresh pool
   15   * each time and exhaust the database's connection budget.
   16   *
   17   * Holding this client is not authority. The request path remains
   18   *
   19   *   request → ActorContext → AuthorizationService → use case → repository → DB
   20   *
   21   * and a row coming back from the database does not mean the caller was allowed
   22   * to see it.
   23   */
   24  export function createRequestDatabaseClient(
   25    config: DatabaseConfig,
   26  ): RequestDatabase {
   27    const sql = createPostgresClient(
   28      resolveDatabaseUrl(config, "REQUEST"),
   29      config,
   30      "REQUEST",
   31    );
   32  
   33    return {
   34      accessClass: "REQUEST",
   35      sql,
   36      transactions: createTransactionManager(sql),
   37      listen: (channel, onNotify, onListen) =>
   38        sql.listen(channel, onNotify, onListen),
   39      close: () => sql.end(),
   40    };
   41  }
```

# Excerpt: packages/database/src/transaction.ts lines 43-77

- Original path: `packages/database/src/transaction.ts`
- Line range: 43-77
- Why included: Transaction boundary (sql.begin).

```
   43  /**
   44   * Wrap a client in the transaction boundary.
   45   *
   46   * `sql.begin` reserves one connection from the pool for the callback's
   47   * lifetime and issues BEGIN; a normal return issues COMMIT; a throw issues
   48   * ROLLBACK and the error propagates. Nothing here catches, logs and commits
   49   * anyway -- a failure inside the boundary is a failure of the whole unit.
   50   *
   51   * There is no automatic retry. A serialization failure is retryable in
   52   * principle, but re-running a callback re-runs its business logic, and only
   53   * the use case knows whether that is safe. Bounded retry belongs at the
   54   * application boundary, applied to work proven idempotent.
   55   */
   56  export function createTransactionManager(sql: Sql): TransactionManager {
   57    return {
   58      run: async (work) => {
   59        try {
   60          // The driver unwraps an array-of-promises result; boxing the value
   61          // keeps `run` honest about returning exactly what `work` returned.
   62          const { value } = await sql.begin(async (transactionSql) => {
   63            const context: TransactionContext = { sql: transactionSql };
   64            return { value: await work(context) };
   65          });
   66          return value;
   67        } catch (error) {
   68          // Only driver failures are translated. An application error thrown
   69          // inside the boundary -- a validation failure, a business rule, a
   70          // deliberate abort -- is the caller's own: the rollback has already
   71          // happened and the error propagates unchanged, so callers can match
   72          // on their own types instead of unwrapping `cause`.
   73          throw isDriverFailure(error) ? toDatabaseError(error) : error;
   74        }
   75      },
   76    };
   77  }
```

# Excerpt: supabase/migrations/20260902144826_identity_permissions_rls.sql lines 130-200

- Original path: `supabase/migrations/20260902144826_identity_permissions_rls.sql`
- Line range: 130-200
- Why included: RLS helper functions and policies written for the 'authenticated' role (PostgREST), which the application does not use.

```
  130  create index grants_capability_idx
  131    on permissions.grants (capability_id);
  132  create index grants_resource_idx
  133    on permissions.grants (resource_type, resource_id)
  134    where resource_id is not null;
  135  
  136  -- ---------------------------------------------------------------------------
  137  -- private RLS helpers
  138  --
  139  -- SECURITY DEFINER so a policy on memberships can consult memberships without
  140  -- recursing through its own policy. Each one: private schema, empty
  141  -- search_path, fully qualified names, EXECUTE only for the policy role. The
  142  -- caller is always derived from auth.uid(); no function takes a user id.
  143  -- ---------------------------------------------------------------------------
  144  
  145  create function private.current_app_user_id()
  146  returns uuid
  147  language sql
  148  stable
  149  security definer
  150  set search_path = ''
  151  as $$
  152    select p.id
  153    from identity.user_profiles p
  154    where p.auth_user_id = (select auth.uid())
  155      and p.status = 'active'
  156  $$;
  157  
  158  create function private.is_tenant_member(target_tenant_id uuid)
  159  returns boolean
  160  language sql
  161  stable
  162  security definer
  163  set search_path = ''
  164  as $$
  165    select exists (
  166      select 1
  167      from identity.organisation_memberships m
  168      where m.tenant_id = target_tenant_id
  169        and m.membership_status = 'active'
  170        and m.user_id = (select private.current_app_user_id())
  171    )
  172  $$;
  173  
  174  create function private.is_organisation_member(target_organisation_id uuid)
  175  returns boolean
  176  language sql
  177  stable
  178  security definer
  179  set search_path = ''
  180  as $$
  181    select exists (
  182      select 1
  183      from identity.organisation_memberships m
  184      where m.organisation_id = target_organisation_id
  185        and m.membership_status = 'active'
  186        and m.user_id = (select private.current_app_user_id())
  187    )
  188  $$;
  189  
  190  revoke all on function private.current_app_user_id() from public;
  191  revoke all on function private.is_tenant_member(uuid) from public;
  192  revoke all on function private.is_organisation_member(uuid) from public;
  193  grant execute on function private.current_app_user_id() to authenticated;
  194  grant execute on function private.is_tenant_member(uuid) to authenticated;
  195  grant execute on function private.is_organisation_member(uuid) to authenticated;
  196  
  197  -- ---------------------------------------------------------------------------
  198  -- Privileges
  199  --
  200  -- anon: nothing. authenticated: SELECT only, on the tables whose policies
```

# Excerpt: supabase/migrations/20260902144826_identity_permissions_rls.sql lines 236-290

- Original path: `supabase/migrations/20260902144826_identity_permissions_rls.sql`
- Line range: 236-290
- Why included: The RLS policies themselves; every one is `to authenticated`, i.e. PostgREST callers, not the application's postgres connection.

```
  236  
  237  -- A person reads their own profile only. Raw profiles are not a directory;
  238  -- network-visible professional profiles arrive as their own projection.
  239  create policy user_profiles_select_own
  240    on identity.user_profiles for select to authenticated
  241    using (auth_user_id = (select auth.uid()));
  242  
  243  -- Tenant and organisation rows are visible only through an active membership.
  244  create policy tenants_select_member
  245    on identity.tenants for select to authenticated
  246    using (private.is_tenant_member(id));
  247  
  248  create policy organisations_select_member
  249    on identity.organisations for select to authenticated
  250    using (private.is_organisation_member(id));
  251  
  252  -- Own memberships, including historical ones (attribution, not access).
  253  -- Organisation rosters are served by the server under application authorization.
  254  create policy organisation_memberships_select_own
  255    on identity.organisation_memberships for select to authenticated
  256    using (user_id = (select private.current_app_user_id()));
  257  
  258  create policy membership_roles_select_own
  259    on identity.membership_roles for select to authenticated
  260    using (exists (
  261      select 1 from identity.organisation_memberships m
  262      where m.id = membership_id
  263        and m.user_id = (select private.current_app_user_id())
  264    ));
  265  
  266  create policy user_active_contexts_select_own
  267    on identity.user_active_contexts for select to authenticated
  268    using (user_id = (select private.current_app_user_id()));
  269  
  270  -- Reference data. Reading a capability's name grants nothing.
  271  create policy capabilities_select_reference
  272    on permissions.capabilities for select to authenticated using (true);
  273  create policy roles_select_reference
  274    on permissions.roles for select to authenticated using (true);
  275  create policy role_capabilities_select_reference
  276    on permissions.role_capabilities for select to authenticated using (true);
  277  
  278  -- permissions.grants and identity.tenant_organisations: RLS enabled, no
  279  -- policies. Even a future accidental GRANT yields zero rows.
```
