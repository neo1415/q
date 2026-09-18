import { z } from "zod";

import { UtcTimestampSchema } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import { TenantIdSchema, type TenantId } from "@capital-q/security";

import {
  LIVE_MEMORY_STATUSES,
  MemoryItemSchema,
  MemoryKeySchema,
  MemoryOwnerContextTypeSchema,
  MemoryStatusSchema,
  MemoryTypeSchema,
  MemoryWriteModeSchema,
  type MemoryItem,
  type MemoryOwner,
  type MemoryType,
  type MemoryWriteMode,
} from "./contracts.js";

/**
 * The memory store in Postgres (doc 13 §40).
 *
 * The only file that writes `q_knowledge.memory_items`. Every statement
 * is parameterised and every read takes an explicit tenant and owner:
 * there is no ambient tenant, and nothing above the memory service is
 * handed this module.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );
const NullableTimestamp = z
  .union([z.date(), z.string(), z.null()])
  .transform((value) =>
    value === null
      ? null
      : UtcTimestampSchema.parse(
          value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString(),
        ),
  );

const Row = z.object({
  id: z.string().uuid(),
  tenant_id: TenantIdSchema,
  owner_context_type: MemoryOwnerContextTypeSchema,
  owner_context_id: z.string().uuid(),
  subject_type: z
    .enum(["PERSON", "COMPANY", "INVESTOR_ORGANISATION"])
    .nullable(),
  subject_id: z.string().uuid().nullable(),
  memory_type: MemoryTypeSchema,
  memory_key: MemoryKeySchema,
  content: z.string(),
  structured_value: z.record(z.string(), z.unknown()),
  quote: z.string().nullable(),
  content_sha256: z.string(),
  source_conversation_id: z.string().uuid().nullable(),
  source_run_id: z.string().uuid().nullable(),
  write_mode: MemoryWriteModeSchema,
  status: MemoryStatusSchema,
  superseded_by: z.string().uuid().nullable(),
  valid_from: Timestamp,
  valid_to: NullableTimestamp,
  last_used_at: NullableTimestamp,
  use_count: z.number().int(),
  created_at: Timestamp,
  updated_at: Timestamp,
});

function toItem(row: unknown): MemoryItem {
  const r = Row.parse(row);
  return MemoryItemSchema.parse({
    id: r.id,
    tenantId: r.tenant_id,
    ownerContextType: r.owner_context_type,
    ownerContextId: r.owner_context_id,
    subject:
      r.subject_type === null || r.subject_id === null
        ? null
        : { subjectType: r.subject_type, subjectId: r.subject_id },
    memoryType: r.memory_type,
    memoryKey: r.memory_key,
    content: r.content,
    structuredValue: r.structured_value,
    quote: r.quote,
    contentSha256: r.content_sha256,
    sourceConversationId: r.source_conversation_id,
    sourceRunId: r.source_run_id,
    writeMode: r.write_mode,
    status: r.status,
    supersededBy: r.superseded_by,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

function select(executor: DatabaseExecutor) {
  return executor`
    select m.id, m.tenant_id, m.owner_context_type, m.owner_context_id,
           m.subject_type, m.subject_id, m.memory_type, m.memory_key,
           m.content, m.structured_value, m.quote, m.content_sha256,
           m.source_conversation_id, m.source_run_id, m.write_mode,
           m.status, m.superseded_by, m.valid_from, m.valid_to,
           m.last_used_at, m.use_count, m.created_at, m.updated_at
      from q_knowledge.memory_items m`;
}

export type NewMemoryItem = {
  readonly tenantId: TenantId;
  readonly owner: MemoryOwner;
  readonly subject: {
    readonly subjectType: string;
    readonly subjectId: string;
  } | null;
  readonly memoryType: MemoryType;
  readonly memoryKey: string;
  readonly content: string;
  readonly structuredValue: Record<string, unknown>;
  readonly quote: string | null;
  readonly contentSha256: string;
  readonly sourceConversationId: string | null;
  readonly sourceRunId: string | null;
  readonly writeMode: MemoryWriteMode;
  readonly status: "candidate" | "confirmed" | "active";
};

export type MemoryRepository = {
  /** The owner's live memory, most recently written first, bounded. */
  readonly listLive: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    owner: MemoryOwner,
    limit: number,
  ) => Promise<readonly MemoryItem[]>;
  readonly findLiveByKey: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    owner: MemoryOwner,
    memoryType: MemoryType,
    memoryKey: string,
  ) => Promise<MemoryItem | null>;
  readonly findLiveByHash: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    owner: MemoryOwner,
    contentSha256: string,
  ) => Promise<MemoryItem | null>;
  readonly insert: (
    tx: TransactionContext,
    input: NewMemoryItem,
  ) => Promise<MemoryItem>;
  /** Marks `id` superseded by `by`. Tenant- and owner-scoped. */
  readonly supersede: (
    tx: TransactionContext,
    tenantId: TenantId,
    owner: MemoryOwner,
    id: string,
    by: string,
  ) => Promise<void>;
  /** Marks the owner's item forgotten. Null when it is not theirs or not live. */
  readonly forget: (
    tx: TransactionContext,
    tenantId: TenantId,
    owner: MemoryOwner,
    id: string,
  ) => Promise<MemoryItem | null>;
  /** Bumps use bookkeeping for the items a recall handed out. Best effort. */
  readonly markUsed: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    ids: readonly string[],
  ) => Promise<void>;
};

export function createPostgresMemoryRepository(): MemoryRepository {
  const live = [...LIVE_MEMORY_STATUSES];
  return {
    listLive: async (executor, tenantId, owner, limit) => {
      const rows = await executor`
        ${select(executor)}
         where m.tenant_id = ${tenantId}
           and m.owner_context_type = ${owner.ownerContextType}
           and m.owner_context_id = ${owner.ownerContextId}
           and m.status = any(${live}::text[])
         order by m.updated_at desc, m.id desc
         limit ${limit}`;
      return rows.map(toItem);
    },
    findLiveByKey: async (executor, tenantId, owner, memoryType, memoryKey) => {
      const rows = await executor`
        ${select(executor)}
         where m.tenant_id = ${tenantId}
           and m.owner_context_type = ${owner.ownerContextType}
           and m.owner_context_id = ${owner.ownerContextId}
           and m.memory_type = ${memoryType}
           and m.memory_key = ${memoryKey}
           and m.status in ('candidate', 'confirmed', 'active')
         limit 1`;
      return rows.length === 0 ? null : toItem(rows[0]);
    },
    findLiveByHash: async (executor, tenantId, owner, contentSha256) => {
      const rows = await executor`
        ${select(executor)}
         where m.tenant_id = ${tenantId}
           and m.owner_context_type = ${owner.ownerContextType}
           and m.owner_context_id = ${owner.ownerContextId}
           and m.content_sha256 = ${contentSha256}
           and m.status in ('candidate', 'confirmed', 'active')
         limit 1`;
      return rows.length === 0 ? null : toItem(rows[0]);
    },
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into q_knowledge.memory_items
          (tenant_id, owner_context_type, owner_context_id, subject_type, subject_id,
           memory_type, memory_key, content, structured_value, quote, content_sha256,
           source_conversation_id, source_run_id, write_mode, status)
        values (${input.tenantId}, ${input.owner.ownerContextType}, ${input.owner.ownerContextId},
                ${input.subject?.subjectType ?? null}, ${input.subject?.subjectId ?? null},
                ${input.memoryType}, ${input.memoryKey}, ${input.content},
                ${JSON.stringify(input.structuredValue)}::text::jsonb, ${input.quote},
                ${input.contentSha256}, ${input.sourceConversationId}, ${input.sourceRunId},
                ${input.writeMode}, ${input.status})
        returning id`;
      const { id } = z.object({ id: z.string().uuid() }).parse(rows[0]);
      const created =
        await tx.sql`${select(tx.sql)} where m.id = ${id} and m.tenant_id = ${input.tenantId}`;
      if (created.length === 0) {
        throw new Error("memory insert did not return a row");
      }
      return toItem(created[0]);
    },
    supersede: async (tx, tenantId, owner, id, by) => {
      await tx.sql`
        update q_knowledge.memory_items
           set status = 'superseded', superseded_by = ${by}, valid_to = now(), updated_at = now()
         where id = ${id}
           and tenant_id = ${tenantId}
           and owner_context_type = ${owner.ownerContextType}
           and owner_context_id = ${owner.ownerContextId}`;
    },
    forget: async (tx, tenantId, owner, id) => {
      const rows = await tx.sql`
        update q_knowledge.memory_items
           set status = 'forgotten', valid_to = now(), updated_at = now()
         where id = ${id}
           and tenant_id = ${tenantId}
           and owner_context_type = ${owner.ownerContextType}
           and owner_context_id = ${owner.ownerContextId}
           and status in ('candidate', 'confirmed', 'active')
        returning id`;
      if (rows.length === 0) return null;
      const read =
        await tx.sql`${select(tx.sql)} where m.id = ${id} and m.tenant_id = ${tenantId}`;
      return read.length === 0 ? null : toItem(read[0]);
    },
    markUsed: async (executor, tenantId, ids) => {
      if (ids.length === 0) return;
      await executor`
        update q_knowledge.memory_items
           set last_used_at = now(), use_count = use_count + 1
         where tenant_id = ${tenantId}
           and id = any(${[...ids]}::uuid[])`;
    },
  };
}
