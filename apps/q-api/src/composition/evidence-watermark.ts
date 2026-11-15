import type { DatabaseExecutor } from "@capital-q/database";
import type { EvidenceWatermark } from "@capital-q/model-gateway/q";

/**
 * RC3 (Q voice audit, 15 Nov 2026): whether anything the asking person's
 * account evidence is built from changed since a conversation's evidence
 * was read -- their relationships' events (either side), actions and
 * approvals of theirs, documents, statements and meetings in their tenant.
 * One bounded EXISTS read, run only before evidence is reused; it returns a
 * yes or no and never any row's content.
 *
 * Deliberately wide: a change anywhere in their tenant, or on any of their
 * relationships, counts. A reuse missed costs one turn of reads; a stale
 * answer costs the person's trust (no stale data).
 */
export function createEvidenceWatermark(
  sql: DatabaseExecutor,
): EvidenceWatermark {
  return async (actor, since) => {
    const at = since.toISOString();
    const rows = await sql<{ readonly changed: boolean }[]>`
      select (
        exists (
          select 1
            from network.relationship_events e
            join network.relationships r on r.id = e.relationship_id
            left join core.companies c on c.id = r.company_id
           where e.created_at > ${at}::timestamptz
             and (
               r.investor_organisation_id = ${actor.organisationId}::uuid
               or c.organisation_id = ${actor.organisationId}::uuid
             )
        )
        or exists (
          select 1 from q_runtime.actions a
           where a.tenant_id = ${actor.tenantId}::uuid
             and a.updated_at > ${at}::timestamptz
        )
        or exists (
          select 1 from evidence.documents d
           where d.tenant_id = ${actor.tenantId}::uuid
             and d.updated_at > ${at}::timestamptz
        )
        or exists (
          select 1 from evidence.claims cl
           where cl.tenant_id = ${actor.tenantId}::uuid
             and cl.created_at > ${at}::timestamptz
        )
        or exists (
          select 1 from communication.meetings m
           where m.tenant_id = ${actor.tenantId}::uuid
             and m.updated_at > ${at}::timestamptz
        )
      ) as changed`;
    // No row is a change: never reuse on an answer we could not read.
    return rows[0]?.changed !== false;
  };
}
