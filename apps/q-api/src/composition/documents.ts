import type { QMessage } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createBrandKitService,
  type BrandKitService,
} from "@capital-q/q-artifacts";
import type { ActorContext } from "@capital-q/security";

import type { QDocumentRoutesDependencies } from "../http/q-documents.js";
import { suggestBrandFromWebsite } from "./brand-from-website.js";

/**
 * The document studio's server side (DOCS): the brand kit service and what
 * the routes and Q tools need around it.
 */

export type OwnCompany = {
  readonly companyId: string;
  readonly websiteUrl: string | null;
  readonly sectorCodes: readonly string[];
};

/**
 * The actor's own company: the one their active organisation owns, in
 * their tenant. Never a company named in a request.
 */
export async function ownCompanyOf(
  sql: DatabaseExecutor,
  actor: ActorContext,
): Promise<OwnCompany | null> {
  if (actor.organisationId === undefined) return null;
  const rows = await sql<
    { id: string; website_url: string | null; sectors: string[] | null }[]
  >`
    select c.id, c.website_url,
           array(
             select n.canonical_code
               from taxonomy.entity_assignments a
               join taxonomy.nodes n on n.id = a.node_id
              where a.entity_type = 'COMPANY'
                and a.entity_id = c.id
                and a.tenant_id = c.tenant_id
                and a.status = 'ACTIVE'
              limit 12) as sectors
      from core.companies c
     where c.tenant_id = ${actor.tenantId}
       and c.organisation_id = ${actor.organisationId}
     order by c.created_at
     limit 1`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    companyId: row.id,
    websiteUrl: row.website_url,
    sectorCodes: row.sectors ?? [],
  };
}

export type DocumentsModule = Omit<
  QDocumentRoutesDependencies,
  "authenticator" | "resolver" | "identity" | "artifacts"
> & {
  readonly brandKit: BrandKitService;
};

export function createDocumentsModule(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly runMessages: (
    actor: ActorContext,
    runId: string,
  ) => Promise<readonly QMessage[]>;
  readonly fetchImpl?: typeof fetch | undefined;
}): DocumentsModule {
  const brandKit = createBrandKitService({
    sql: dependencies.sql,
    transactions: dependencies.transactions,
  });
  return {
    brandKit,
    runMessages: dependencies.runMessages,
    suggestFromWebsite: async (actor) => {
      const company = await ownCompanyOf(dependencies.sql, actor);
      if (company === null || company.websiteUrl === null) {
        return { status: "NO_WEBSITE" };
      }
      const suggestion = await suggestBrandFromWebsite({
        websiteUrl: company.websiteUrl,
        sectorCodes: company.sectorCodes,
        fetchImpl: dependencies.fetchImpl,
      });
      return suggestion === null
        ? { status: "UNREADABLE" }
        : { status: "FOUND", companyId: company.companyId, suggestion };
    },
  };
}
