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
 *
 * Live 2026-11-16 (scenario D, run d58a4564): the founder fulfilled a
 * diligence request (a disclosure policy, a fulfilment and a
 * `document_shared` event on the relationship), and the investor's
 * follow-up seconds later reused the earlier reads and said the request was
 * "still outstanding". Two misses:
 * - an investor's relationships were matched on `investor_organisation_id
 *   = actor.organisationId`, but the actor carries the core organisation,
 *   not the investor organisation's id, so no investor ever matched;
 * - what changes what an investor may read lives in the company's tenant
 *   (disclosure policies, diligence requests and their fulfilments or
 *   declines, data-room decisions and entries), so tenant-scoped checks
 *   never saw it.
 * Both sides of each company-investor relationship of theirs are now
 * resolved first, and every disclosure-state change on those pairs counts.
 */
export function createEvidenceWatermark(
  sql: DatabaseExecutor,
): EvidenceWatermark {
  return async (actor, since) => {
    const at = since.toISOString();
    const rows = await sql<{ readonly changed: boolean }[]>`
      with mine as (
        select r.id, r.company_id
          from network.relationships r
          left join core.companies c on c.id = r.company_id
         where r.investor_organisation_id in (
                 select io.id from core.investor_organisations io
                  where io.organisation_id = ${actor.organisationId}::uuid
               )
            or c.organisation_id = ${actor.organisationId}::uuid
      )
      select (
        exists (
          select 1 from network.relationship_events e
           where e.relationship_id in (select id from mine)
             and e.created_at > ${at}::timestamptz
        )
        or exists (
          select 1 from permissions.disclosure_policies p
           where p.recipient_type = 'RELATIONSHIP'
             and p.recipient_id in (select id from mine)
             and (p.created_at > ${at}::timestamptz
                  or p.revoked_at > ${at}::timestamptz
                  or p.expires_at between ${at}::timestamptz and now())
        )
        or exists (
          select 1 from network.diligence_requests dr
           where dr.relationship_id in (select id from mine)
             and (
               dr.created_at > ${at}::timestamptz
               or exists (
                 select 1 from network.diligence_fulfilments f
                  where f.request_id = dr.id
                    and f.created_at > ${at}::timestamptz
               )
               or exists (
                 select 1 from network.diligence_request_declines d
                  where d.request_id = dr.id
                    and d.created_at > ${at}::timestamptz
               )
             )
        )
        or exists (
          select 1 from network.diligence_question_answers qa
            join network.diligence_questions q on q.id = qa.question_id
           where q.relationship_id in (select id from mine)
             and qa.created_at > ${at}::timestamptz
        )
        or exists (
          select 1 from evidence.data_room_access_requests ar
           where ar.relationship_id in (select id from mine)
             and (
               ar.created_at > ${at}::timestamptz
               or exists (
                 select 1 from evidence.data_room_request_decisions dd
                  where dd.request_id = ar.id
                    and dd.created_at > ${at}::timestamptz
               )
             )
        )
        or exists (
          select 1 from evidence.data_room_entries de
           where de.company_id in (select company_id from mine)
             and de.updated_at > ${at}::timestamptz
        )
        or exists (
          select 1 from permissions.grants g
           where g.principal_id in (
                   ${actor.userId}::uuid, ${actor.organisationId}::uuid
                 )
             and (g.created_at > ${at}::timestamptz
                  or g.revoked_at > ${at}::timestamptz)
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
