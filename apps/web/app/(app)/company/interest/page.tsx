import type { Metadata } from "next";
import Link from "next/link";

import {
  discoverInvestors,
  listIncomingInterest,
  type ApiSession,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { deploymentLabel } from "@/features/investors/investor-labels";
import {
  gateFor,
  investorCards,
  investorGates,
  investorProfiles,
} from "@/features/investors/investor-reads";
import {
  dimensionMatches,
  looksForSentence,
  publishedMandate,
} from "@/features/investors/published-focus";
import {
  InterestCards,
  type InterestFacts,
} from "@/features/network/interest-cards";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Investor interest" };
export const dynamic = "force-dynamic";

/**
 * Investor interest in the founder's company (CQ-NET-011).
 *
 * The company is the person's own, resolved on the server; the list is
 * read through the API under their session, which answers only for the
 * company's members holding `company.interest.view`. An investor, or a
 * person with no company, has no inbox here.
 */
export default async function InvestorInterestPage() {
  const t = await serverT();
  const context = await resolveOwnContext();
  const session = await apiSession();

  const header = (
    <PageHeader
      title={t("Investor interest")}
      description={t("Accepting connects you. It isn’t an investment.")}
    />
  );

  if (context.kind === "INVESTOR") {
    // The investor's own side of interest is their relationships (R30 #16).
    return (
      <PageContainer>
        <QSection
          id="interest"
          kind="INTEREST_LIST"
          total={0}
          label={t("investor interest")}
        >
          {header}
          <EmptyState
            title={t("This is a founder's page.")}
            description={t(
              "Interest you have expressed, and each company's answer, is under Relationships.",
            )}
            action={
              <Link
                href="/relationships"
                className={buttonClassName("secondary")}
              >
                {t("Go to Relationships")}
              </Link>
            }
          />
        </QSection>
      </PageContainer>
    );
  }

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        <QSection
          id="interest"
          kind="INTEREST_LIST"
          total={0}
          label={t("investor interest")}
        >
          {header}
          <EmptyState
            title={t("Nothing to answer here.")}
            description={t(
              "Investor interest is addressed to a company. It appears here for the company's own team.",
            )}
            action={
              <Link href="/home" className={buttonClassName("secondary")}>
                {t("Back to Home")}
              </Link>
            }
          />
        </QSection>
      </PageContainer>
    );
  }

  const incoming = await listIncomingInterest(session, context.companyId).catch(
    () => null,
  );
  const facts = await interestFacts(
    session,
    (incoming?.items ?? []).map((item) => item.investorOrganisationId),
  );
  return (
    <PageContainer>
      <div className="max-w-[820px]">
        <QSection
          id="interest"
          kind="INTEREST_LIST"
          refs={(incoming?.items ?? []).slice(0, 12).map((item) => ({
            kind: "INVESTOR_ORGANISATION" as const,
            id: item.investorOrganisationId,
          }))}
          total={incoming?.items.length ?? 0}
          label={t("investor interest")}
        >
          {/* The chosen design (interest, option 1): the title, then its
            two tabs, then the cards; no line under the title. */}
          <h1 className="cq-title-xl mb-2.5 text-(--cq-text-primary)">
            {t("Investor interest")}
          </h1>
          {incoming === null ? (
            <EmptyState
              title={t("Investor interest couldn't load.")}
              description={t(
                "Nothing is wrong with your company. Capital Q didn't answer just now; try again in a moment.",
              )}
              action={
                <Link
                  href="/company/interest"
                  className={buttonClassName("secondary")}
                >
                  {t("Try again")}
                </Link>
              }
            />
          ) : (
            <InterestCards items={incoming.items} facts={facts} />
          )}
        </QSection>
      </div>
    </PageContainer>
  );
}

/**
 * What each interested investor publishes, read as this founder may see
 * it: their declared deployment, what their Q Card says they look for, and
 * stage, sector and geography against their published gate and Discover's
 * public-profile reasons. An investor the founder may not see in Discover
 * answers nothing here: the card then says "not known yet".
 */
async function interestFacts(
  session: ApiSession,
  ids: readonly string[],
): Promise<ReadonlyMap<string, InterestFacts>> {
  if (ids.length === 0) return new Map();
  const [profiles, cards, gates, slate] = await Promise.all([
    investorProfiles(session, ids),
    investorCards(session, ids),
    investorGates(session, ids),
    discoverInvestors(session).catch(() => null),
  ]);
  const listed = new Map(
    (slate?.items ?? []).map((item) => [
      item.investorOrganisationId.toLowerCase(),
      item,
    ]),
  );
  return new Map(
    ids.map((id) => {
      const profile = profiles.get(id) ?? null;
      return [
        id,
        {
          deployment:
            profile === null ? null : deploymentLabel(profile.deploymentState),
          looksFor: looksForSentence(publishedMandate(cards.get(id) ?? null)),
          matches: dimensionMatches(
            gateFor(gates, id),
            listed.get(id.toLowerCase())?.reasons ?? [],
            listed.get(id.toLowerCase())?.publishedFit,
          ),
        },
      ];
    }),
  );
}
