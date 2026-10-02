import type { CompanyService } from "@capital-q/companies";
import type { PitchSummaryDto } from "@capital-q/contracts";
import type { InteractionSignalService } from "@capital-q/discovery";
import type { InvestorService } from "@capital-q/investors";
import type { PublicIdentityService } from "@capital-q/public-identity";
import type { MediaService } from "@capital-q/media";
import type { ActorContext } from "@capital-q/security";

/**
 * The services the declared actions call (ADR 0040). Each composition (the
 * API for routes, the Q API for tools and approved actions) passes its own
 * instances; an action whose port is absent is not offered and its route
 * refuses, never half-runs.
 */
export type AppActionPorts = {
  readonly media?:
    Pick<MediaService, "listCompanyMedia" | "setPitchDetails"> | undefined;
  readonly interactions?: Pick<InteractionSignalService, "decide"> | undefined;
  /** Profile and records (ADR 0040 checklist): the owning services. */
  readonly companies?:
    | Pick<
        CompanyService,
        | "updateCompany"
        | "upsertMyCompanyMembership"
        | "updateMyFounderProfile"
        | "updateCompanyTeamFacts"
      >
    | undefined;
  readonly investors?:
    | Pick<
        InvestorService,
        "updateInvestorOrganisation" | "upsertMyInvestorRepresentative"
      >
    | undefined;
  readonly publicIdentity?:
    Pick<PublicIdentityService, "claimHandle" | "updateCard"> | undefined;
  /** A company's publishable pitch, for the company route's answer. */
  readonly companyPitch?:
    ((companyId: string) => Promise<PitchSummaryDto | null>) | undefined;
  /** The actor's own company, from their membership on the server. */
  readonly ownCompanyId?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
};
