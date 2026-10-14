import { z } from "zod";
import {
  PipelineSavedViewSchema,
  SavedRelationshipViewSchema,
  SaveRelationshipViewRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";
import {
  InterestNotFoundError,
  InterestNotPermittedError,
  RelationshipViewLimitError,
} from "../domain/errors.js";
import type { ExpressInterestDependencies } from "../application/express-interest.js";
import { requireRelationshipListingScope } from "../application/relationship-status.js";

const Definition = PipelineSavedViewSchema.omit({ id: true, name: true });
const Row = z.object({
  id: UuidSchema,
  name: z.string(),
  scope: z.enum(["PERSONAL", "ORGANISATION"]),
  definition: Definition,
  version: z.number(),
  updated_at: z.union([z.date(), z.string()]),
  owner_user_id: UuidSchema,
});
const VIEW_LIMIT = 20;
type Dependencies = Pick<
  ExpressInterestDependencies,
  "sql" | "transactions" | "authorization" | "companies" | "investorSubject"
>;

/** Narrow preferences; all canonical relationship queries still use their existing service. */
export function createRelationshipViewStore(dependencies: Dependencies) {
  async function member(
    sql: DatabaseExecutor,
    actor: ActorContext,
    lock = false,
  ) {
    if (actor.organisationId === undefined || actor.membershipId === undefined)
      throw new ActorContextRequiredError();
    // The write lock prevents membership revocation between admission and commit.
    const rows = lock
      ? await sql`select m.id from identity.organisation_memberships m join identity.organisations o on o.id=m.organisation_id and o.tenant_id=m.tenant_id join identity.user_profiles p on p.id=m.user_id where m.id=${actor.membershipId} and m.user_id=${actor.userId} and m.organisation_id=${actor.organisationId} and m.tenant_id=${actor.tenantId} and m.membership_status='active' and o.status='active' and p.status='active' for share of m`
      : await sql`select m.id from identity.organisation_memberships m join identity.organisations o on o.id=m.organisation_id and o.tenant_id=m.tenant_id join identity.user_profiles p on p.id=m.user_id where m.id=${actor.membershipId} and m.user_id=${actor.userId} and m.organisation_id=${actor.organisationId} and m.tenant_id=${actor.tenantId} and m.membership_status='active' and o.status='active' and p.status='active'`;
    if (rows.length !== 1) throw new InterestNotPermittedError();
  }
  async function scope(actor: ActorContext, companyId?: string) {
    await member(dependencies.sql, actor);
    const party = await requireRelationshipListingScope(
      dependencies,
      actor,
      companyId,
    );
    const organisationId = UuidSchema.parse(actor.organisationId);
    const teamEditable =
      (
        await dependencies.authorization.authorize({
          actor,
          capability: capability("organisation.admin"),
          resource: {
            kind: "RESOURCE",
            tenantId: actor.tenantId,
            organisationId,
            resourceType: "organisation",
            resourceId: organisationId,
          },
        })
      ).outcome === "ALLOW";
    return {
      organisationId,
      companyId:
        party.party === "COMPANY" ? UuidSchema.parse(party.partyId) : null,
      investorId:
        party.party === "INVESTOR" ? UuidSchema.parse(party.partyId) : null,
      teamEditable,
      lock: `network.relationship-views:${actor.tenantId}:${organisationId}:${party.party}:${party.partyId}`,
    };
  }
  function dto(raw: unknown, actor: ActorContext, teamEditable: boolean) {
    const row = Row.parse(raw);
    return SavedRelationshipViewSchema.parse({
      id: row.id,
      name: row.name,
      ...row.definition,
      scope: row.scope,
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
      editable:
        row.scope === "PERSONAL"
          ? row.owner_user_id === actor.userId
          : teamEditable,
    });
  }
  return {
    async list(actor: ActorContext, companyId?: string) {
      const view = await scope(actor, companyId);
      const rows =
        await dependencies.sql`select * from network.relationship_views where tenant_id=${actor.tenantId} and organisation_id=${view.organisationId} and company_id is not distinct from ${view.companyId} and investor_organisation_id is not distinct from ${view.investorId} and (scope='ORGANISATION' or (scope='PERSONAL' and owner_user_id=${actor.userId})) order by name,id limit 41`;
      if (rows.length > VIEW_LIMIT * 2) throw new RelationshipViewLimitError();
      return {
        items: rows.map((row) => dto(row, actor, view.teamEditable)),
        teamEditable: view.teamEditable,
      };
    },
    async save(
      actor: ActorContext,
      id: string,
      input: unknown,
      companyId?: string,
    ) {
      const data = SaveRelationshipViewRequestSchema.parse(input);
      const viewId = UuidSchema.parse(id);
      const view = await scope(actor, companyId);
      if (data.scope === "ORGANISATION" && !view.teamEditable)
        throw new InterestNotPermittedError();
      const definition = Definition.parse({
        query: data.query,
        layout: data.layout,
        columns: data.columns,
      });
      return dependencies.transactions.run(async ({ sql }) => {
        await member(sql, actor, true);
        await sql`select pg_advisory_xact_lock(hashtextextended(${view.lock},0))`;
        if (data.expectedVersion === 0) {
          const counts =
            await sql`select count(*)::int as count from network.relationship_views where tenant_id=${actor.tenantId} and organisation_id=${view.organisationId} and company_id is not distinct from ${view.companyId} and investor_organisation_id is not distinct from ${view.investorId} and scope=${data.scope} and (${data.scope === "ORGANISATION"} or owner_user_id=${actor.userId})`;
          if (
            z.object({ count: z.number().int() }).parse(counts[0]).count >=
            VIEW_LIMIT
          )
            throw new RelationshipViewLimitError();
        }
        // Scope/owner are immutable; compare-and-swap never overwrites another editor.
        const rows =
          data.expectedVersion === 0
            ? await sql`insert into network.relationship_views (id,tenant_id,organisation_id,company_id,investor_organisation_id,owner_user_id,owner_membership_id,name,scope,definition) values (${viewId},${actor.tenantId},${view.organisationId},${view.companyId},${view.investorId},${actor.userId},${actor.membershipId},${data.name},${data.scope},${sql.json(definition)}) on conflict (id) do nothing returning *`
            : await sql`update network.relationship_views set name=${data.name},definition=${sql.json(definition)},version=version+1,updated_at=now() where id=${viewId} and tenant_id=${actor.tenantId} and organisation_id=${view.organisationId} and company_id is not distinct from ${view.companyId} and investor_organisation_id is not distinct from ${view.investorId} and scope=${data.scope} and version=${data.expectedVersion} and ((scope='PERSONAL' and owner_user_id=${actor.userId}) or (scope='ORGANISATION' and ${view.teamEditable})) returning *`;
        if (rows[0] === undefined) throw new InterestNotFoundError();
        return dto(rows[0], actor, view.teamEditable);
      });
    },
    async remove(
      actor: ActorContext,
      id: string,
      version: number,
      companyId?: string,
    ) {
      const viewId = UuidSchema.parse(id);
      const expectedVersion = z.number().int().positive().parse(version);
      const view = await scope(actor, companyId);
      await dependencies.transactions.run(async ({ sql }) => {
        await member(sql, actor, true);
        await sql`select pg_advisory_xact_lock(hashtextextended(${view.lock},0))`;
        const rows =
          await sql`delete from network.relationship_views where id=${viewId} and tenant_id=${actor.tenantId} and organisation_id=${view.organisationId} and company_id is not distinct from ${view.companyId} and investor_organisation_id is not distinct from ${view.investorId} and version=${expectedVersion} and ((scope='PERSONAL' and owner_user_id=${actor.userId}) or (scope='ORGANISATION' and ${view.teamEditable})) returning id`;
        if (rows.length !== 1) throw new InterestNotFoundError();
      });
    },
  };
}
