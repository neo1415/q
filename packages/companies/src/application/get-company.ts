import { capability, type ActorContext } from "@capital-q/security";

import type { Company, CompanyId } from "../contracts/index.js";
import { CompanyNotFoundError } from "../domain/errors.js";
import type { CompanyServiceDependencies } from "./dependencies.js";

export const COMPANY_VIEW = capability("company.view");

export type GetCompanyQuery = {
  readonly actor: ActorContext;
  /** Untrusted: the path parameter. */
  readonly companyId: CompanyId;
};

/**
 * Organisation-internal canonical read.
 *
 * The row is looked up under the caller's tenant *and* active organisation
 * first: a company that exists elsewhere is "not found", identically to one
 * that does not exist, before any authorization detail could differ. Then
 * `company.view` is required on the exact company resource scope.
 */
export function createGetCompany(dependencies: CompanyServiceDependencies) {
  const { sql, authorization, repositories } = dependencies;

  return async (query: GetCompanyQuery): Promise<Company> => {
    const { actor } = query;
    if (actor.organisationId === undefined) {
      throw new CompanyNotFoundError();
    }

    const company = await repositories.companies.findById(
      sql,
      actor.tenantId,
      actor.organisationId,
      query.companyId,
    );
    if (company === null) {
      throw new CompanyNotFoundError();
    }

    await authorization.requireCapability({
      actor,
      capability: COMPANY_VIEW,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        resourceType: "company",
        resourceId: company.id,
      },
    });

    return company;
  };
}
