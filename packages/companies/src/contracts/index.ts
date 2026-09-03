import { z } from "zod";

import {
  createUuidIdSchema,
  type CompanyDto,
  type CompanyStatus,
  type MarketplaceVisibility,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { OrganisationId, TenantId } from "@capital-q/security";

/**
 * @capital-q/companies/contracts
 *
 * The safe public surface of the Company bounded context: the canonical
 * identifier, the domain entity and the narrow identity later domains
 * anchor to. No persistence, no use cases. Browser-reachable consumers
 * take the wire DTOs from @capital-q/contracts; server domains take these.
 */

/**
 * The canonical Company identifier. Distinct from OrganisationId and
 * TenantId by construction: a company belongs to an organisation and a
 * tenant; it is neither.
 */
export const CompanyIdSchema = createUuidIdSchema("CompanyId");
export type CompanyId = z.infer<typeof CompanyIdSchema>;

/**
 * The canonical Company as the domain sees it. Profile core only: no
 * founder, capital objective, evidence, score, relationship or Q state.
 */
export type Company = {
  readonly id: CompanyId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly canonicalName: string;
  readonly legalName: string | null;
  readonly slug: string;
  readonly websiteUrl: string | null;
  /** Calendar date, YYYY-MM-DD. */
  readonly foundedDate: string | null;
  readonly headquartersCountry: string | null;
  readonly headquartersCity: string | null;
  readonly currentStageCode: string | null;
  readonly primaryDescription: string | null;
  readonly shortDescription: string | null;
  readonly companyStatus: CompanyStatus;
  readonly marketplaceVisibility: MarketplaceVisibility;
  readonly marketplaceReadinessState: string;
  readonly logoStorageKey: string | null;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
};

/**
 * What a later domain (capital objective, evidence, founder/team) needs to
 * validate a reference to a company. Enough to anchor, not enough to edit.
 */
export type CompanyIdentity = {
  readonly id: CompanyId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly canonicalName: string;
  readonly companyStatus: CompanyStatus;
};

/** Wire shape. Tenant, organisation and logo key stay internal. */
export function toCompanyDto(company: Company): CompanyDto {
  return {
    id: company.id,
    canonicalName: company.canonicalName,
    legalName: company.legalName,
    slug: company.slug,
    websiteUrl: company.websiteUrl,
    foundedDate: company.foundedDate,
    headquartersCountry: company.headquartersCountry,
    headquartersCity: company.headquartersCity,
    currentStageCode: company.currentStageCode,
    primaryDescription: company.primaryDescription,
    shortDescription: company.shortDescription,
    companyStatus: company.companyStatus,
    marketplaceVisibility: company.marketplaceVisibility,
    marketplaceReadinessState: company.marketplaceReadinessState,
    version: company.version,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

export function toCompanyIdentity(company: Company): CompanyIdentity {
  return {
    id: company.id,
    tenantId: company.tenantId,
    organisationId: company.organisationId,
    canonicalName: company.canonicalName,
    companyStatus: company.companyStatus,
  };
}

export * from "./team.js";
