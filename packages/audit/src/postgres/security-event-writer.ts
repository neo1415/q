import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import { SecurityEventInputSchema } from "../contracts/security-event.js";
import { AuditEventConflictError, AuditInputError } from "../errors.js";
import type { SecurityEventWriter } from "../writers.js";
import { correlationUuid } from "./correlation.js";

const InsertedSchema = z.object({ id: z.coerce.number() });
const SameSchema = z.object({ same: z.boolean() });

/**
 * PostgreSQL security-event writer. Uses the executor it is given (a pooled
 * client at the composition root) for one short statement per event; it
 * never opens a pool and never joins a business transaction.
 */
export function createPostgresSecurityEventWriter(options: {
  readonly sql: DatabaseExecutor;
}): SecurityEventWriter {
  const { sql } = options;
  return {
    record: async (input) => {
      const parsed = SecurityEventInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new AuditInputError("security_event", parsed.error);
      }
      const record = parsed.data;
      const metadata = JSON.stringify(record.metadata);
      const correlation = correlationUuid(record.correlationId);

      const inserted = await sql`
        insert into audit.security_events
          (event_id, tenant_id, user_id, event_type, severity, resource_type, resource_id,
           occurred_at, ip_hash, user_agent_hash, metadata, correlation_id)
        values
          (${record.auditEventId}, ${record.tenantId ?? null}, ${record.userId ?? null},
           ${record.eventType}, ${record.severity}, ${record.resourceType ?? null},
           ${record.resourceId ?? null}, ${record.occurredAt}::timestamptz,
           ${record.ipHash ?? null}, ${record.userAgentHash ?? null},
           ${metadata}::text::jsonb, ${correlation}::uuid)
        on conflict (event_id) do nothing
        returning id`;

      if (
        inserted.length > 0 &&
        InsertedSchema.safeParse(inserted[0]).success
      ) {
        return record.auditEventId;
      }

      const existing = await sql`
        select (
              s.tenant_id is not distinct from ${record.tenantId ?? null}::uuid
          and s.user_id is not distinct from ${record.userId ?? null}::uuid
          and s.event_type = ${record.eventType}
          and s.severity = ${record.severity}
          and s.resource_type is not distinct from ${record.resourceType ?? null}
          and s.resource_id is not distinct from ${record.resourceId ?? null}
          and s.occurred_at = ${record.occurredAt}::timestamptz
          and s.ip_hash is not distinct from ${record.ipHash ?? null}
          and s.user_agent_hash is not distinct from ${record.userAgentHash ?? null}
          and s.metadata = ${metadata}::text::jsonb
          and s.correlation_id is not distinct from ${correlation}::uuid
        ) as same
        from audit.security_events s
        where s.event_id = ${record.auditEventId}`;
      const same = SameSchema.safeParse(existing[0]);
      if (same.success && same.data.same) {
        return record.auditEventId;
      }
      throw new AuditEventConflictError(record.auditEventId);
    },
  };
}
