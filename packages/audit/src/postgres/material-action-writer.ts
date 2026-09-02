import { z } from "zod";

import { MaterialActionAuditInputSchema } from "../contracts/material-action.js";
import { toPersistedActorType } from "../contracts/vocabulary.js";
import { AuditEventConflictError, AuditInputError } from "../errors.js";
import type { MaterialActionAuditWriter } from "../writers.js";
import { correlationUuid } from "./correlation.js";

const InsertedSchema = z.object({ id: z.coerce.number() });
const SameSchema = z.object({ same: z.boolean() });

/**
 * PostgreSQL material-action writer. One parameterised INSERT on the
 * caller's transaction; on an event_id collision the stored row is compared
 * column by column (IS NOT DISTINCT FROM; jsonb equality for metadata) to
 * decide between idempotent success and a conflict.
 */
export function createPostgresMaterialActionAuditWriter(): MaterialActionAuditWriter {
  return {
    record: async (tx, input) => {
      const parsed = MaterialActionAuditInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new AuditInputError("material_action", parsed.error);
      }
      const record = parsed.data;
      const actorType = toPersistedActorType(record.actorType);
      const metadata = JSON.stringify(record.metadata);
      const correlation = correlationUuid(record.correlationId);

      const inserted = await tx.sql`
        insert into audit.material_actions
          (event_id, tenant_id, actor_type, actor_id, authority_user_id, organisation_id,
           action_type, resource_type, resource_id, relationship_id, occurred_at, outcome,
           metadata, correlation_id)
        values
          (${record.auditEventId}, ${record.tenantId}, ${actorType}, ${record.actorId ?? null},
           ${record.authorityUserId ?? null}, ${record.organisationId ?? null},
           ${record.actionType}, ${record.resourceType}, ${record.resourceId},
           ${record.relationshipId ?? null}, ${record.occurredAt}::timestamptz, ${record.outcome},
           ${metadata}::text::jsonb, ${correlation}::uuid)
        on conflict (event_id) do nothing
        returning id`;

      if (
        inserted.length > 0 &&
        InsertedSchema.safeParse(inserted[0]).success
      ) {
        return record.auditEventId;
      }

      const existing = await tx.sql`
        select (
              a.tenant_id = ${record.tenantId}::uuid
          and a.actor_type = ${actorType}
          and a.actor_id is not distinct from ${record.actorId ?? null}::uuid
          and a.authority_user_id is not distinct from ${record.authorityUserId ?? null}::uuid
          and a.organisation_id is not distinct from ${record.organisationId ?? null}::uuid
          and a.action_type = ${record.actionType}
          and a.resource_type = ${record.resourceType}
          and a.resource_id = ${record.resourceId}
          and a.relationship_id is not distinct from ${record.relationshipId ?? null}::uuid
          and a.occurred_at = ${record.occurredAt}::timestamptz
          and a.outcome = ${record.outcome}
          and a.metadata = ${metadata}::text::jsonb
          and a.correlation_id is not distinct from ${correlation}::uuid
        ) as same
        from audit.material_actions a
        where a.event_id = ${record.auditEventId}`;
      const same = SameSchema.safeParse(existing[0]);
      if (same.success && same.data.same) {
        return record.auditEventId;
      }
      throw new AuditEventConflictError(record.auditEventId);
    },
  };
}
