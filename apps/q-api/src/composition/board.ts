import { createBoardService, type BoardService } from "@capital-q/board";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

/**
 * The work board for Q (owner 2026-10-23): the same board service the API
 * composes, as the signed-in person. An item whose Q job is DONE moves to
 * DONE on read, from the person's own job statuses (every predicate is
 * their user and tenant; another person's job id reads as no job). The API
 * composes the same rule for the page.
 */
export function createQApiBoard(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): BoardService {
  return createBoardService({
    sql: dependencies.sql,
    transactions: dependencies.transactions,
    jobStatus: async (actor, jobIds) => {
      if (jobIds.length === 0) return new Map();
      const rows = await dependencies.sql<{ id: string; status: string }[]>`
        select id, status from q_runtime.workforce_jobs
         where id = any(${[...jobIds]}::uuid[]) and user_id = ${actor.userId}
           and tenant_id = ${actor.tenantId}`;
      return new Map(rows.map((row) => [row.id, row.status]));
    },
  });
}
