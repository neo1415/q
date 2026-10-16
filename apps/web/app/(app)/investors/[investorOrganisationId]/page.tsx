import type { Metadata } from "next";
import type { ReactNode } from "react";
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
import { LooksForSection } from "@/features/investors/looks-for-section";
import { ProfileSectionShell } from "@/features/profile/editable-section";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { ConnectionRequest } from "@/features/network/connection-request";
import { connectCta, REQUEST_WORDS } from "@/features/network/connect-cta";
import { STATE_WORDS } from "@/features/relationships/relationship-words";
import { ProfileHero } from "@/features/profile/profile-header";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QControl } from "@/features/q/control/q-control";
import { QSection } from "@/features/q/q-section";

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
        <QSection
          id="investor"
          kind="INVESTOR_PROFILE"
          refs={[{ kind: "INVESTOR_ORGANISATION", id: investorOrganisationId }]}
          total={1}
          label="an investor profile"
        >
          <EmptyState
            title="This page is for founders."
            description="Founders see investors who chose to be discoverable, and can ask to connect."
            action={
              <Link href="/home" className={buttonClassName("secondary")}>
                Go to Q
              </Link>
            }
          />
        </QSection>
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
        <QSection
          id="investor"
          kind="INVESTOR_PROFILE"
          refs={[{ kind: "INVESTOR_ORGANISATION", id: investorOrganisationId }]}
          total={1}
          label="an investor profile"
        >
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
        </QSection>
      </PageContainer>
    );
  }
  // The reach state and whether the founder's company already has a CRM
  // record with them are read side by side.
  const [status, relationships] = await Promise.all([
    getConnectionStatus(session, investor.investorOrganisationId).catch(
      () => null,
    ),
    ownRelationships(context),
  ]);
  const record = (relationships ?? []).find(
    (item) =>
      item.counterpart.kind === "INVESTOR_ORGANISATION" &&
      item.counterpart.id === investor.investorOrganisationId,
  );
  // One way forward, from the canonical relationship's state: the hero and
  // the Connect panel both read it.
  const cta = connectCta(record);
  const recordHref = `/relationships/investor/${encodeURIComponent(investor.investorOrganisationId)}`;
  const where = countryLabel(investor.hqCountry);
  const deployment = deploymentLabel(investor.deploymentState);
  const inbound = inboundLabel(investor.inboundPreference);
  const id = investor.investorOrganisationId;
  const facts: readonly {
    readonly label: string;
    readonly value: ReactNode;
  }[] = [
    { label: "Type", value: investorTypeLabel(investor.investorType) },
    ...(where === null ? [] : [{ label: "Based in", value: where }]),
    ...(deployment === null ? [] : [{ label: "Deploying", value: deployment }]),
    ...(inbound === null ? [] : [{ label: "Requests", value: inbound }]),
    ...(investor.websiteUrl === null
      ? []
      : [
          {
            label: "Website",
            value: (
              <a
                href={investor.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 break-all underline underline-offset-4"
              >
                <Globe size={ICON_SIZE.compact} aria-hidden="true" />
                {investor.websiteUrl.replace(/^https?:\/\//i, "")}
              </a>
            ),
          },
        ]),
  ];
  return (
    <PageContainer>
      <QSection
        id="investor"
        kind="INVESTOR_PROFILE"
        refs={[{ kind: "INVESTOR_ORGANISATION", id: investorOrganisationId }]}
        total={1}
        label="an investor profile"
      >
        {/*
          The investor as their own profile shows them (owner 2026-10-16:
          the founder's view was "so bad"): the same hero and section
          frames, read-only, with the founder's own actions in the hero.
          Only what the investor chose to show; never their private
          mandate (ADR 0023).
        */}
        <div className="flex flex-col gap-4 sm:gap-6">
          <Link
            href="/discover"
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
            facts={deployment === null ? [] : [deployment]}
            images={{
              subjectType: "INVESTOR_ORGANISATION",
              subjectId: id,
              avatarUrl: investor.photoUrl ?? null,
              coverUrl: investor.coverUrl ?? null,
              editable: false,
              avatarLabel: "logo",
            }}
            actions={
              <QControl id="section.investor-actions" kind="SECTION">
                <div
                  className="flex flex-wrap items-center gap-2"
                  data-investor-actions
                >
                  {/* In touch already: the record leads; else the application. */}
                  {cta.kind === "OPEN" || cta.kind === "ANSWER" ? (
                    <Link
                      href={recordHref}
                      className={buttonClassName("primary")}
                    >
                      {cta.kind === "ANSWER"
                        ? "Answer their interest"
                        : "Open in CRM"}
                    </Link>
                  ) : null}
                  <a
                    href="#apply"
                    className={buttonClassName(
                      cta.kind === "OPEN" || cta.kind === "ANSWER"
                        ? "secondary"
                        : "primary",
                    )}
                  >
                    Apply via GateQ
                  </a>
                  {cta.kind === "REQUEST" ? (
                    <a href="#connect" className={buttonClassName("secondary")}>
                      {REQUEST_WORDS}
                    </a>
                  ) : null}
                  <Link
                    href={`/rehearsals/investor/${encodeURIComponent(id)}`}
                    className={buttonClassName("secondary")}
                  >
                    Rehearse
                  </Link>
                  {cta.kind === "ENDED" ? (
                    <Link
                      href={recordHref}
                      className={buttonClassName("quiet")}
                    >
                      Open in CRM
                    </Link>
                  ) : null}
                </div>
              </QControl>
            }
          />
          <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
              {investor.publicDescription === null ? null : (
                <QControl id="section.about" kind="SECTION">
                  <ProfileSectionShell id="investor-about" title="About">
                    <p className="cq-body whitespace-pre-line text-(--cq-text-secondary)">
                      {investor.publicDescription}
                    </p>
                  </ProfileSectionShell>
                </QControl>
              )}
              {/* Q.05 / RECOVERY-2026-10 (C1): what they publish (public
                  profile + gate criteria only) and the founder's own fit,
                  then the GateQ draft. */}
              <QControl id="section.mandate" kind="SECTION">
                <LooksForSection
                  session={session}
                  investorOrganisationId={id}
                  investorName={investor.displayName}
                />
              </QControl>
            </div>
            <aside className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:sticky lg:top-4">
              <QControl id="section.connect" kind="SECTION">
                <ProfileSectionShell
                  id="connect"
                  title="Connect"
                  description={
                    cta.kind !== "REQUEST"
                      ? undefined
                      : inbound === null
                        ? "A Connection Request shows them your company; they accept or decline."
                        : `${inbound}. A Connection Request shows them your company; they accept or decline.`
                  }
                >
                  {cta.kind === "OPEN" || cta.kind === "ENDED" ? (
                    <p className="cq-status-line" data-connection={cta.state}>
                      {cta.kind === "OPEN"
                        ? `${STATE_WORDS[cta.state]}. You are already in touch; everything with ${investor.displayName} is in your CRM.`
                        : `${STATE_WORDS[cta.state]}. The record stays in your CRM.`}
                    </p>
                  ) : cta.kind === "ANSWER" ? (
                    <p className="cq-status-line" data-connection="ANSWER">
                      {investor.displayName} expressed interest in your company.
                      Answer it from the record.
                    </p>
                  ) : status === null ? (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      Whether you can send a request couldn&apos;t be checked
                      just now. Reload to try again.
                    </p>
                  ) : (
                    <ConnectionRequest
                      investorOrganisationId={id}
                      investorName={investor.displayName}
                      status={status}
                    />
                  )}
                </ProfileSectionShell>
              </QControl>
              <ProfileSectionShell id="investor-facts" title="At a glance">
                <dl className="cq-body-sm flex flex-col divide-y divide-(--cq-border-subtle)">
                  {facts.map((fact) => (
                    <div
                      key={fact.label}
                      className="flex min-h-10 items-baseline justify-between gap-3 py-2"
                    >
                      <dt className="text-(--cq-text-tertiary)">
                        {fact.label}
                      </dt>
                      <dd className="min-w-0 text-right text-(--cq-text-primary)">
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </ProfileSectionShell>
            </aside>
          </div>
        </div>
      </QSection>
    </PageContainer>
  );
}
