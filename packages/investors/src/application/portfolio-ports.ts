import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import type { InvestorOrganisationId } from "../contracts/index.js";
import type {
  InvestorPortfolioReference,
  InvestorPortfolioReferenceId,
} from "../contracts/portfolio.js";

export type NewInvestorPortfolioReference = {
  readonly tenantId: TenantId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly createdByUserId: UserId;
};

/** Investor-owned portfolio references; every call carries the tenant. */
export type InvestorPortfolioReferenceRepository = {
  /** Current (not removed) references, oldest first. */
  readonly listCurrent: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<readonly InvestorPortfolioReference[]>;
  /** Serialises additions for one investor organisation until commit. */
  readonly lockForInvestor: (
    tx: TransactionContext,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<readonly InvestorPortfolioReference[]>;
  readonly insert: (
    tx: TransactionContext,
    input: NewInvestorPortfolioReference,
  ) => Promise<InvestorPortfolioReference>;
  /** Marks the reference removed; returns null when it is absent or already removed. */
  readonly remove: (
    tx: TransactionContext,
    tenantId: TenantId,
    investorOrganisationId: InvestorOrganisationId,
    referenceId: InvestorPortfolioReferenceId,
  ) => Promise<InvestorPortfolioReference | null>;
};
