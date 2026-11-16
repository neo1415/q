/**
 * The workers' statement budget when DATABASE_STATEMENT_TIMEOUT_MS is unset.
 *
 * Until 16 Nov 2026 no statement limit was in force on hosted at all: the
 * limit went as a connection startup parameter and Supavisor drops those.
 * It is now enforced on every connection mode (packages/database), so the
 * 10 s request budget would newly cut short batch work that has been
 * running longer: production pg_stat_statements showed app statements of
 * 84-112 s. Workers get two minutes, which still ends a statement that
 * never returns; request services (api, q-api) keep the 10 s default.
 */
export const WORKER_STATEMENT_TIMEOUT_MS = 120_000;

export const WORKER_DATABASE_DEFAULTS = {
  statementTimeoutMs: WORKER_STATEMENT_TIMEOUT_MS,
} as const;
