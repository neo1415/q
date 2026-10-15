import { z } from "zod";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { InboxAuthority } from "./ports.js";

/**
 * The GateQ applications linked to ONE canonical company-investor
 * relationship (P14: `application_founders.relationship_id`), for the CRM
 * record. Linked by the stored relationship id only, never by a company or
 * fund name.
 *
 * The caller must already have proved the actor is a party to the
 * relationship and on which side (Network's `relationshipById`); this read
 * narrows further by side:
 *
 *   INVESTOR  submitted applications only, and only to gateways GateQ's own
 *             authority lets this actor view (the inbox rule). A draft is
 *             the founder's private work and never shown.
 *   COMPANY   submitted applications from the company, plus the actor's
 *             OWN unsubmitted drafts. A colleague's draft stays theirs.
 *
 * It returns identities and lifecycle only: no answers, dossier, documents
 * or qualification detail, which stay behind the inbox/brief reads.
 */
export type RelationshipGateqApplication = {
  readonly applicationId: string;
  readonly reference: string;
  /** The fund's internal gateway name: investor side only (founders see null). */
  readonly gatewayName: string | null;
  readonly status: "IN_PROGRESS" | "READY_TO_SUBMIT" | "SUBMITTED";
  readonly startedAt: string;
  readonly submittedAt: string | null;
};

const Row = z.object({
  application_id: z.string().uuid(),
  public_reference: z.string(),
  gateway_id: z.string().uuid(),
  gateway_name: z.string(),
  status: z.enum(["IN_PROGRESS", "READY_TO_SUBMIT", "SUBMITTED"]),
  founder_user_id: z.string().uuid(),
  created_at: z.coerce.date(),
  submitted_at: z.coerce.date().nullable(),
});

/** Bound on one relationship's list; a relationship has a handful at most. */
const MAX_ITEMS = 50;

export function createRelationshipGateqApplications(deps: {
  readonly sql: DatabaseExecutor;
  readonly authority: InboxAuthority;
}) {
  return async (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly side: "COMPANY" | "INVESTOR";
  }): Promise<readonly RelationshipGateqApplication[]> => {
    const relationshipId = z.string().uuid().safeParse(input.relationshipId);
    if (!relationshipId.success) return [];
    const rows = (
      await deps.sql`
        select a.id as application_id, a.public_reference, a.gateway_id, g.name as gateway_name,
          a.status, f.founder_user_id, a.created_at, a.submitted_at
        from gateq.application_founders f
        join gateq.applications a on a.id=f.application_id and a.tenant_id=f.tenant_id
        join gateq.gateways g on g.id=a.gateway_id
        where f.relationship_id=${relationshipId.data}
          and a.status in ('IN_PROGRESS','READY_TO_SUBMIT','SUBMITTED')
        order by coalesce(a.submitted_at,a.created_at) desc, a.id
        limit ${MAX_ITEMS}`
    ).map((row) => Row.parse(row));

    let visible: typeof rows;
    if (input.side === "INVESTOR") {
      const submitted = rows.filter((row) => row.status === "SUBMITTED");
      // GateQ's own gateway authority, once per gateway: a fund member who
      // may not view a gateway does not learn its applications exist.
      const allowed = new Map<string, boolean>();
      for (const gatewayId of new Set(submitted.map((r) => r.gateway_id))) {
        allowed.set(
          gatewayId,
          (await deps.authority
            .authorise(input.actor, gatewayId)
            .catch(() => null)) !== null,
        );
      }
      visible = submitted.filter((row) => allowed.get(row.gateway_id) === true);
    } else {
      visible = rows.filter(
        (row) =>
          row.status === "SUBMITTED" ||
          row.founder_user_id === input.actor.userId,
      );
    }
    return visible.map((row) => ({
      applicationId: row.application_id,
      reference: row.public_reference,
      gatewayName: input.side === "INVESTOR" ? row.gateway_name : null,
      status: row.status,
      startedAt: row.created_at.toISOString(),
      submittedAt: row.submitted_at?.toISOString() ?? null,
    }));
  };
}
