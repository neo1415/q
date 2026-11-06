import { z } from "zod";

import { createConversationStateCache } from "../application/conversation-state-cache.js";
import type { QConversationStateRepository } from "../application/ports.js";
import {
  EMPTY_CONVERSATION_LEDGER,
  QConversationLedgerSchema,
  QOpenThreadsSchema,
  type QConversationState,
} from "../contracts/conversation-state.js";

/**
 * PostgreSQL for q_runtime.conversation_states and
 * conversation_summary_revisions (20261231250000).
 *
 * Every read carries tenant AND owner. The ledger is parsed on the way out:
 * a ledger this package cannot read is no ledger (null), and the caller
 * rebuilds from the stored turns rather than trusting a malformed record.
 * Writes carry the expected version, so a stale writer writes nothing.
 */

const isoOf = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : typeof value === "string" || typeof value === "number"
        ? new Date(value).toISOString()
        : null;

const StateRow = z.object({
  conversation_id: z.string(),
  tenant_id: z.string(),
  user_id: z.string(),
  ledger: z.unknown(),
  open_threads: z.unknown(),
  through_message_at: z.unknown(),
  through_message_id: z.string().nullable(),
  messages_folded: z.number().int(),
  builder_version: z.string(),
  version: z.number().int(),
});

const SummaryRow = z.object({
  revision: z.number().int(),
  summary: z.string(),
  covers_through_at: z.unknown(),
  covered_messages: z.number().int(),
});

function toState(row: unknown): QConversationState | null {
  const r = StateRow.safeParse(row);
  if (!r.success) return null;
  const ledger = QConversationLedgerSchema.safeParse(r.data.ledger);
  const threads = QOpenThreadsSchema.safeParse(r.data.open_threads);
  return {
    conversationId: r.data.conversation_id,
    tenantId: r.data.tenant_id,
    userId: r.data.user_id,
    // A malformed ledger is rebuilt from the turns, never half-trusted.
    ledger: ledger.success ? ledger.data : EMPTY_CONVERSATION_LEDGER,
    openThreads: threads.success ? threads.data : [],
    throughMessageAt: ledger.success ? isoOf(r.data.through_message_at) : null,
    throughMessageId: ledger.success ? r.data.through_message_id : null,
    messagesFolded: ledger.success ? r.data.messages_folded : 0,
    builderVersion: r.data.builder_version,
    version: r.data.version,
  };
}

export function createPostgresConversationStates(): QConversationStateRepository {
  return {
    // One per repository set, so one per process in q-api: the answer path
    // and the memory learner share it (step 11).
    cache: createConversationStateCache(),
    find: async (executor, tenantId, userId, conversationId) => {
      const rows = await executor`
        select conversation_id::text, tenant_id::text, user_id::text, ledger,
               open_threads, through_message_at, through_message_id::text,
               messages_folded, builder_version, version
          from q_runtime.conversation_states
         where conversation_id = ${conversationId}
           and tenant_id = ${tenantId}
           and user_id = ${userId}`;
      return rows.length === 0 ? null : toState(rows[0]);
    },
    save: async (tx, state) => {
      const ledger = JSON.stringify(
        QConversationLedgerSchema.parse(state.ledger),
      );
      const threads = JSON.stringify(
        QOpenThreadsSchema.parse(state.openThreads),
      );
      if (state.version === 0) {
        const rows = await tx.sql`
          insert into q_runtime.conversation_states
            (conversation_id, tenant_id, user_id, ledger, open_threads,
             through_message_at, through_message_id, messages_folded,
             builder_version, version)
          values (${state.conversationId}, ${state.tenantId}, ${state.userId},
                  ${ledger}::text::jsonb, ${threads}::text::jsonb,
                  ${state.throughMessageAt}, ${state.throughMessageId},
                  ${state.messagesFolded}, ${state.builderVersion}, 1)
          on conflict (conversation_id) do nothing
          returning version`;
        return rows.length === 1;
      }
      const rows = await tx.sql`
        update q_runtime.conversation_states
           set ledger = ${ledger}::text::jsonb,
               open_threads = ${threads}::text::jsonb,
               through_message_at = ${state.throughMessageAt},
               through_message_id = ${state.throughMessageId},
               messages_folded = ${state.messagesFolded},
               builder_version = ${state.builderVersion},
               version = version + 1
         where conversation_id = ${state.conversationId}
           and tenant_id = ${state.tenantId}
           and user_id = ${state.userId}
           and version = ${state.version}
        returning version`;
      return rows.length === 1;
    },
    latestSummary: async (executor, tenantId, userId, conversationId) => {
      const rows = await executor`
        select revision, summary, covers_through_at, covered_messages
          from q_runtime.conversation_summary_revisions
         where conversation_id = ${conversationId}
           and tenant_id = ${tenantId}
           and user_id = ${userId}
         order by revision desc
         limit 1`;
      if (rows.length === 0) return null;
      const r = SummaryRow.parse(rows[0]);
      return {
        revision: r.revision,
        summary: r.summary,
        coversThroughAt: isoOf(r.covers_through_at) ?? "",
        coveredMessages: r.covered_messages,
      };
    },
    appendSummary: async (tx, input) => {
      // The next number is taken in the statement; the table's guard
      // serialises writers on the conversation row and refuses a gap.
      const rows = await tx.sql`
        insert into q_runtime.conversation_summary_revisions
          (conversation_id, tenant_id, user_id, revision, summary,
           covers_through_at, covered_messages, gate_version, prompt_version,
           q_run_id)
        select ${input.conversationId}, ${input.tenantId}, ${input.userId},
               coalesce(max(r.revision), 0) + 1, ${input.summary},
               ${input.coversThroughAt}, ${input.coveredMessages},
               ${input.gateVersion}, ${input.promptVersion ?? null},
               ${input.runId ?? null}
          from q_runtime.conversation_summary_revisions r
         where r.conversation_id = ${input.conversationId}
        returning revision`;
      return z.object({ revision: z.number().int() }).parse(rows[0]).revision;
    },
  };
}
