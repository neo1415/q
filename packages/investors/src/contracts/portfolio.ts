import { z } from "zod";

import {
  createUuidIdSchema,
  type InvestorPortfolioReferenceDto,
  type InvestorPortfolioSource,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { TenantId, UserId } from "@capital-q/security";

import type { InvestorOrganisationId } from "./index.js";

/**
 * A representative portfolio company named by the investor (ADR 0007).
 * Investor-owned reference data: a name and optional website, provenance,
 * who added it and when it was removed. It is not a Capital Q Company, it
 * links to none, and it carries no ownership, amount, valuation, board or
 * performance fields. Removal keeps history through `removedAt`.
 */
export const InvestorPortfolioReferenceIdSchema = createUuidIdSchema(
  "InvestorPortfolioReferenceId",
);
export type InvestorPortfolioReferenceId = z.infer<
  typeof InvestorPortfolioReferenceIdSchema
>;

export type InvestorPortfolioReference = {
  readonly id: InvestorPortfolioReferenceId;
  readonly tenantId: TenantId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly source: InvestorPortfolioSource;
  readonly createdByUserId: UserId;
  readonly createdAt: UtcTimestamp;
  readonly removedAt: UtcTimestamp | null;
};

export function toInvestorPortfolioReferenceDto(
  reference: InvestorPortfolioReference,
): InvestorPortfolioReferenceDto {
  return {
    id: reference.id,
    investorOrganisationId: reference.investorOrganisationId,
    companyName: reference.companyName,
    websiteUrl: reference.websiteUrl,
    source: reference.source,
    createdAt: reference.createdAt,
  };
}
