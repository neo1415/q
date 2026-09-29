import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ApiProblemError,
  getConnectionStatus,
  getDiscoveredInvestor,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronLeft, Globe, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { countryLabel } from "@/features/company/declared-labels";
import {
  deploymentLabel,
  inboundLabel,
  investorTypeLabel,
} from "@/features/investors/investor-labels";
import { ConnectionRequest } from "@/features/network/connection-request";
import { ProfileHero } from "@/features/profile/profile-header";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Investor" };
export const dynamic = "force-dynamic";

/**
 * One investor, as a founder may see them (ADR 0023): only what the
 * investor chose to show on Capital Q, and the one way to reach them, a
 * Connection Request, when they take requests. An investor the founder may
 * not see and one that does not exist are the same not-found.
 */
export default async function InvestorPage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  const { investorOrganisationId } = await params;
  const context = await resolveOwnContext();
  const session = await apiSession();

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        <EmptyState
          title="This page is for founders."
          description="Founders see investors who chose to be discoverable, and can ask to connect."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Go to Q
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const investor = await getDiscoveredInvestor(
    session,
    investorOrganisationId,
  ).catch((error: unknown) => {
    if (error instanceof ApiProblemError && error.status === 404) notFound();
    return null;
  });
  if (investor === null) {
    return (
      <PageContainer>
        <EmptyState
          title="This investor couldn't load."
          description="Nothing is wrong with your profile. Try again in a moment."
          action={
            <Link
              href={`/investors/${investorOrganisationId}`}
              className={buttonClassName("secondary")}
            >
              Try again
            </Link>
          }
        />
      </PageContainer>
    );
  }
  const status = await getConnectionStatus(
    session,
    investor.investorOrganisationId,
  ).catch(() => null);

  const where = countryLabel(investor.hqCountry);
  const deployment = deploymentLabel(investor.deploymentState);
  return (
    <PageContainer>
      <Link
        href="/investors"
        className="cq-body-sm inline-flex min-h-11 items-center gap-1 self-start text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
      >
        <ChevronLeft size={ICON_SIZE.compact} aria-hidden="true" />
        Investors
      </Link>
      <ProfileHero
        name={investor.displayName}
        headline={investorTypeLabel(investor.investorType)}
        location={where}
        square
        facts={[
          ...(deployment === null ? [] : [deployment]),
          ...(investor.websiteUrl === null
            ? []
            : [
                <a
                  key="web"
                  href={investor.websiteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  <Globe size={ICON_SIZE.compact} aria-hidden="true" />
                  {investor.websiteUrl.replace(/^https?:\/\//, "")}
                </a>,
              ]),
        ]}
        images={{
          subjectType: "INVESTOR_ORGANISATION",
          subjectId: investor.investorOrganisationId,
          avatarUrl: investor.photoUrl ?? null,
          coverUrl: investor.coverUrl ?? null,
          editable: false,
          avatarLabel: "logo",
        }}
      />
      <section
        aria-labelledby="investor-reach"
        className="flex flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-4 sm:p-6"
      >
        <h2
          id="investor-reach"
          className="cq-title-md text-(--cq-text-primary)"
        >
          Connect
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {inboundLabel(investor.inboundPreference)}.
        </p>
        {status === null ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Whether you can send a request couldn&apos;t be checked just now.
            Reload to try again.
          </p>
        ) : (
          <ConnectionRequest
            investorOrganisationId={investor.investorOrganisationId}
            investorName={investor.displayName}
            status={status}
          />
        )}
      </section>
      {investor.publicDescription === null ? null : (
        <section
          aria-labelledby="investor-about"
          className="flex flex-col gap-2 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-4 sm:p-6"
        >
          <h2
            id="investor-about"
            className="cq-title-md text-(--cq-text-primary)"
          >
            About
          </h2>
          <p className="cq-body whitespace-pre-line text-(--cq-text-secondary)">
            {investor.publicDescription}
          </p>
        </section>
      )}
    </PageContainer>
  );
}
