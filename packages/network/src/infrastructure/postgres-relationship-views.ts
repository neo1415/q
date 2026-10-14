import { z } from "zod";
import {
  SavedRelationshipViewSchema,
  SaveRelationshipViewRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";
import {
  InterestNotFoundError,
  InterestNotPermittedError,
} from "../domain/errors.js";

const Row = z.object({
  id: UuidSchema,
  name: z.string(),
  scope: z.enum(["PERSONAL", "ORGANISATION"]),
  definition: z.unknown(),
  version: z.number(),
  updated_at: z.union([z.date(), z.string()]),
  owner_user_id: UuidSchema,
});
/** Actor-scoped preferences; no canonical relationship access or mutations. */
export function createRelationshipViewStore(
  sql: DatabaseExecutor,
  authorization: AuthorizationService,
) {
  async function member(actor: ActorContext) {
    if (actor.organisationId === undefined || actor.membershipId === undefined)
      throw new ActorContextRequiredError();
    const rows =
      await sql`select id from identity.organisation_memberships where id=${actor.membershipId} and user_id=${actor.userId} and organisation_id=${actor.organisationId} and tenant_id=${actor.tenantId} and membership_status='active'`;
    if (rows.length !== 1) throw new InterestNotPermittedError();
  }
  async function admin(actor: ActorContext) {
    if (actor.organisationId === undefined) return false;
    return (
      (
        await authorization.authorize({
          actor,
          capability: capability("organisation.admin"),
          resource: {
            kind: "RESOURCE",
            tenantId: actor.tenantId,
            organisationId: actor.organisationId,
            resourceType: "organisation",
            resourceId: actor.organisationId,
          },
        })
      ).outcome === "ALLOW"
    );
  }
  function dto(raw: unknown, actor: ActorContext, teamEditable: boolean) {
    const row = Row.parse(raw);
    return SavedRelationshipViewSchema.parse({
      id: row.id,
      name: row.name,
      scope: row.scope,
      definition: row.definition,
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
      editable:
        row.scope === "PERSONAL"
          ? row.owner_user_id === actor.userId
          : teamEditable,
    });
  }
  return {
    async list(actor: ActorContext) {
      await member(actor);
      const teamEditable = await admin(actor);
      const rows =
        await sql`select * from network.relationship_views where tenant_id=${actor.tenantId} and organisation_id=${actor.organisationId ?? null} and (scope='ORGANISATION' or owner_user_id=${actor.userId}) order by name,id limit 100`;
      return rows.map((row) => dto(row, actor, teamEditable));
    },
    async save(actor: ActorContext, id: string, input: unknown) {
      await member(actor);
      const data = SaveRelationshipViewRequestSchema.parse(input);
      const viewId = UuidSchema.parse(id);
      const teamEditable = await admin(actor);
      if (data.scope === "ORGANISATION" && !teamEditable)
        throw new InterestNotPermittedError();
      // Scope immutable: a private view cannot be turned into shared content by a rename.
      const rows =
        data.expectedVersion === 0
          ? await sql`insert into network.relationship_views (id,tenant_id,organisation_id,owner_user_id,name,scope,definition) values (${viewId},${actor.tenantId},${actor.organisationId ?? null},${actor.userId},${data.name},${data.scope},${sql.json(data.definition)}) on conflict (id) do nothing returning *`
          : await sql`update network.relationship_views set name=${data.name},definition=${sql.json(data.definition)},version=version+1,updated_at=now() where id=${viewId} and tenant_id=${actor.tenantId} and organisation_id=${actor.organisationId ?? null} and scope=${data.scope} and version=${data.expectedVersion} and ((scope='PERSONAL' and owner_user_id=${actor.userId}) or (scope='ORGANISATION' and ${teamEditable})) returning *`;
      const row = rows[0];
      if (row === undefined) throw new InterestNotFoundError();
      return dto(row, actor, teamEditable);
    },
    async remove(actor: ActorContext, id: string, version: number) {
      await member(actor);
      const teamEditable = await admin(actor);
      const rows =
        await sql`delete from network.relationship_views where id=${UuidSchema.parse(id)} and tenant_id=${actor.tenantId} and organisation_id=${actor.organisationId ?? null} and version=${z.number().int().positive().parse(version)} and ((scope='PERSONAL' and owner_user_id=${actor.userId}) or (scope='ORGANISATION' and ${teamEditable})) returning id`;
      if (rows.length !== 1) throw new InterestNotFoundError();
    },
  };
}
