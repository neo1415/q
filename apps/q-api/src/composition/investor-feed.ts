import type {
  CompanyCardPort,
  EligibilityPorts,
  InvestorCompanyDecision,
  SlateReadService,
} from "@capital-q/discovery";
import type { Logger } from "@capital-q/observability";
import type { InvestorFeedPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * The investor's own feed, for Q (CQ-QACT-001, ACC round 1b).
 *
 * Live, an investor asked Home Q "which company should I look at first and
 * why? and skip the one I passed on". Q recommended a company that is
 * visible on the network but not marketplace-ready — so not in their feed
 * at all — and said they had passed on "Synthetic demo" when two companies
 * carry that name and they had saved one and passed the other. The listing
 * Q read bypassed the feed's eligibility, and a decision was named rather
 * than identified.
 *
 * Both answers now come from the feed's own machinery: the page is the
 * same `pageCompanies` the Discover surface calls (declared eligibility,
 * readiness, visibility, ranking and pass suppression), and a decision is
 * the investor organisation's own interaction state, by company id,
 * filtered through the same disclosure check the feed uses so a company
 * that has since gone private is not named.
 */
export function createInvestorFeedPort(dependencies: {
  readonly reader: SlateReadService;
  readonly ports: Pick<EligibilityPorts, "investorSubject" | "discoverability">;
  readonly cards: CompanyCardPort;
  readonly decisions: {
    readonly decided: (query: {
      readonly tenantId: string;
      readonly investorOrganisationId: string;
      readonly limit: number;
    }) => Promise<readonly InvestorCompanyDecision[]>;
  };
  readonly logger?: Logger | undefined;
}): InvestorFeedPort {
  const { reader, ports, cards, decisions } = dependencies;
  return {
    page: async (actor: ActorContext, limit: number) => {
      const subject =
        await ports.investorSubject.investorOrganisationFor(actor);
      if (subject === null) return null;
      const page = await reader.pageCompanies({ actor, limit });
      return {
        items: page.items.map((item) => ({
          companyId: item.companyId,
          name: item.canonicalName,
          stageCode: item.currentStageCode,
          headquartersCountry: item.headquartersCountry,
          shortDescription: item.shortDescription,
          websiteUrl: item.websiteUrl,
          reasonCodes: [...item.reasonCodes],
        })),
        notes: [...page.notes],
      };
    },
    decisions: async (actor: ActorContext, limit: number) => {
      const subject =
        await ports.investorSubject.investorOrganisationFor(actor);
      if (subject === null) return [];
      const decided = await decisions.decided({
        tenantId: actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        limit,
      });
      if (decided.length === 0) return [];
      const ids = decided.map((entry) => entry.companyId);
      const [permitted, named] = await Promise.all([
        ports.discoverability.permittedToView({ kind: "ACTOR", actor }, ids),
        cards.cardsByIds(ids),
      ]);
      return decided.flatMap((entry) => {
        const card = named.get(entry.companyId);
        if (card === undefined || permitted.get(entry.companyId) !== true) {
          return [];
        }
        return [
          {
            companyId: entry.companyId,
            name: card.canonicalName,
            stageCode: card.currentStageCode,
            headquartersCountry: card.headquartersCountry,
            decision: entry.decision,
          },
        ];
      });
    },
  };
}
