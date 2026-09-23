import type { Metadata } from "next";
import Link from "next/link";

import { getCompanyNetworkPreview } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ArrowLeft, Globe, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { apiSession } from "@/features/q/context";
import { QPageSubject } from "@/features/q/q-subject";

export const metadata: Metadata = { title: "Company" };
export const dynamic = "force-dynamic";

/**
 * One company, as the network may see it (CQ-WEB-022; doc 17 §126).
 *
 * The read is `network-preview`, which is the company's own declared
 * projection for investors — not the founder's record. That choice is the
 * authorisation: this page cannot show a private field because the
 * projection does not contain one, and the server decides what is in it
 * under the reader's own session. A company that is not network-visible
 * answers not-found, and this page says so plainly rather than hinting
 * that something exists behind a door.
 *
 * Back returns to Discover, where the feed controller restores the same
 * card from the position it persisted (doc 20 §146).
 */
export default async function CompanyPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await apiSession();

  const company =
    session === null
      ? null
      : await getCompanyNetworkPreview(session, companyId).catch(() => null);

  if (company === null) {
    return (
      <PageContainer>
        <BackToDiscover />
        <EmptyState
          title="This company isn't available to you."
          description="It may not be discoverable, or it may no longer exist. Nothing is wrong with your account."
        />
      </PageContainer>
    );
  }

  const place = [company.headquartersCity, company.headquartersCountry]
    .filter((part): part is string => part !== null)
    .join(", ");

  const rows: readonly (readonly [string, string])[] = [
    ["Stage", company.currentStageCode ?? "Not declared"],
    ["Where", place === "" ? "Not declared" : place],
    ["Founded", company.foundedDate ?? "Not declared"],
    ["Legal name", company.legalName ?? "Not declared"],
  ];

  return (
    <PageContainer>
      <QPageSubject
        subject={{
          kind: "COMPANY",
          companyId: company.companyId,
          label: company.canonicalName,
          scope: "network_visible",
        }}
      />
      <BackToDiscover />
      <PageHeader
        title={company.canonicalName}
        {...(company.shortDescription === null
          ? {}
          : { description: company.shortDescription })}
      />

      <section className="cq-panel">
        <div className="cq-panel-body cq-panel-rows">
          {rows.map(([term, value]) => (
            <div key={term} className="flex justify-between gap-4 py-3">
              <dt className="cq-label text-(--cq-text-secondary)">{term}</dt>
              {/* "Not declared" is an honest answer; it is never a zero. */}
              <dd className="cq-body text-(--cq-text-primary)">{value}</dd>
            </div>
          ))}
        </div>
      </section>

      {company.primaryDescription === null ? null : (
        <p className="cq-prose text-(--cq-text-secondary)">
          {company.primaryDescription}
        </p>
      )}

      {company.websiteUrl === null ? null : (
        <p className="flex items-center gap-1.5">
          <Globe size={ICON_SIZE.compact} aria-hidden="true" />
          <span className="cq-caption break-all text-(--cq-text-tertiary)">
            {company.websiteUrl}
          </span>
        </p>
      )}
    </PageContainer>
  );
}

function BackToDiscover() {
  return (
    <Link href="/discover" className={buttonClassName("quiet", "compact")}>
      <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
      Back to Discover
    </Link>
  );
}
