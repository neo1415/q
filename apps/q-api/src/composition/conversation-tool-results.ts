import {
  Q_SENSITIVITY_RANK,
  type QSensitivityClass,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { QConversationFetch, QToolPort } from "@capital-q/q-runtime";

/**
 * What Q fetched in a conversation, kept for its follow-ups (owner live
 * 2026-10-17; q_runtime.conversation_tool_results, 20261228190000).
 *
 * Written: each successful READ_ONLY tool result a run received, after the
 * tool's own authorize step and output validation under that run's plan,
 * at most CONFIDENTIAL. Nothing is fetched to fill it. One short statement
 * per result, off the turn's path (never awaited by the answer, never in a
 * transaction, never across a model call); a failure is logged once and
 * the turn goes on. The run's owner and conversation are taken from
 * q_runtime.runs in the same statement, never from the caller, and the
 * table's owner trigger checks them again.
 *
 * Read: the owner's own rows for the run's conversation, unexpired, newest
 * first and bounded; the answer seam then keeps only those within the
 * current run's sensitivity ceiling.
 */

/** Rows read back per turn, newest first. */
export const FETCHED_READ_MAX = 40;
/** Pre-cut on the JSON text; the table bounds the stored size itself. */
const RESULT_CHARS_MAX = 60_000;
const ARGUMENTS_CHARS_MAX = 6_000;
/** Calls numbered per run; beyond this a run's results are not kept. */
const CALLS_PER_RUN_MAX = 999;
const RUNS_TRACKED_MAX = 512;

const KEPT_UP_TO: QSensitivityClass = "CONFIDENTIAL";

export type ConversationToolResultsStore = {
  readonly record: (entry: {
    readonly tenantId: string;
    readonly userId: string;
    readonly runId: string;
    readonly callIndex: number;
    readonly toolName: string;
    readonly arguments: unknown;
    readonly result: unknown;
    readonly sensitivity: QSensitivityClass;
  }) => Promise<void>;
  readonly recent: (scope: {
    readonly tenantId: string;
    readonly userId: string;
    readonly runId: string;
  }) => Promise<readonly QConversationFetch[]>;
};

const SENSITIVITIES = new Set<string>(Object.keys(Q_SENSITIVITY_RANK));

function isSensitivity(value: unknown): value is QSensitivityClass {
  return typeof value === "string" && SENSITIVITIES.has(value);
}

export function createPostgresConversationToolResults(dependencies: {
  readonly sql: DatabaseExecutor;
}): ConversationToolResultsStore {
  const { sql } = dependencies;
  return {
    record: async (entry) => {
      const result = JSON.stringify(entry.result);
      const args = JSON.stringify(entry.arguments ?? {});
      if (result.length > RESULT_CHARS_MAX) return;
      await sql`
        insert into q_runtime.conversation_tool_results
          (tenant_id, conversation_id, user_id, run_id, call_index,
           tool_name, arguments, result, sensitivity)
        select r.tenant_id, r.conversation_id, r.actor_user_id, r.id,
               ${entry.callIndex}, ${entry.toolName.slice(0, 120)},
               ${args.length > ARGUMENTS_CHARS_MAX ? "{}" : args}::jsonb,
               ${result}::jsonb, ${entry.sensitivity}
          from q_runtime.runs r
         where r.id = ${entry.runId}
           and r.tenant_id = ${entry.tenantId}
           and r.actor_user_id = ${entry.userId}
        on conflict (run_id, call_index) do nothing`;
    },
    recent: async (scope) => {
      const rows = await sql<
        {
          run_id: string;
          tool_name: string;
          arguments: unknown;
          result: unknown;
          sensitivity: string;
          created_at: Date | string;
        }[]
      >`
        select t.run_id, t.tool_name, t.arguments, t.result, t.sensitivity,
               t.created_at
          from q_runtime.conversation_tool_results t
         where t.tenant_id = ${scope.tenantId}
           and t.user_id = ${scope.userId}
           and t.conversation_id = (
             select r.conversation_id
               from q_runtime.runs r
              where r.id = ${scope.runId}
                and r.tenant_id = ${scope.tenantId}
                and r.actor_user_id = ${scope.userId})
           and t.run_id <> ${scope.runId}
           and t.expires_at > now()
         order by t.created_at desc
         limit ${FETCHED_READ_MAX}`;
      return rows.flatMap((row): QConversationFetch[] =>
        isSensitivity(row.sensitivity)
          ? [
              {
                runId: row.run_id,
                toolName: row.tool_name,
                arguments: row.arguments,
                result: row.result,
                sensitivity: row.sensitivity,
                fetchedAt:
                  row.created_at instanceof Date
                    ? row.created_at.toISOString()
                    : String(row.created_at),
              },
            ]
          : [],
      );
    },
  };
}

/**
 * The same tool port, with each successful read-only result it returned
 * kept for the conversation's follow-ups. The outcome is returned exactly
 * as the tool gave it, at once; keeping it never delays, changes or fails
 * a call.
 */
export function withKeptToolResults(
  tools: QToolPort,
  store: ConversationToolResultsStore,
  logger?: Logger  ,
): QToolPort {
  const calls = new Map<string, number>();
  let warned = false;
  return {
    ...tools,
    execute: async (proposal, context) => {
      const outcome = await tools.execute(proposal, context);
      if (
        outcome.status !== "SUCCEEDED" ||
        outcome.classification !== "READ_ONLY" ||
        outcome.toolName === null ||
        outcome.sensitivity === null ||
        !outcome.result.ok ||
        Q_SENSITIVITY_RANK[outcome.sensitivity] > Q_SENSITIVITY_RANK[KEPT_UP_TO]
      ) {
        return outcome;
      }
      const runId = context.runId;
      const callIndex = calls.get(runId) ?? 0;
      if (callIndex > CALLS_PER_RUN_MAX) return outcome;
      calls.delete(runId);
      calls.set(runId, callIndex + 1);
      while (calls.size > RUNS_TRACKED_MAX) {
        const oldest = calls.keys().next().value;
        if (oldest === undefined) break;
        calls.delete(oldest);
      }
      void store
        .record({
          tenantId: context.actor.tenantId,
          userId: context.actor.userId,
          runId,
          callIndex,
          toolName: outcome.toolName,
          arguments: proposal.arguments,
          result: outcome.result.data,
          sensitivity: outcome.sensitivity,
        })
        .catch((error: unknown) => {
          // Until 20261228190000 is applied every write fails: said once.
          if (warned) return;
          warned = true;
          logger?.warn(
            { err: error, qRunId: runId },
            "a fetched result was not kept for follow-ups",
          );
        });
      return outcome;
    },
  };
}
