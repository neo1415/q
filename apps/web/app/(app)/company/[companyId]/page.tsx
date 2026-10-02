import type { Metadata } from "next";
import Link from "next/link";

import {
  getCompanyProfile,
  getOwnInterest,
  getRelationshipWithCompany,
  listTaxonomyNodes,
} from "@capital-q/api-client";
import { isMatchedRelationshipState } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import {
  CompanyProfileView,
  type ProfileTab,
} from "@/features/company/company-profile-view";
import { apiSession } from "@/features/q/context";
import { QPageSubject } from "@/features/q/q-subject";
import { ArrowLeft, ICON_SIZE } from "@capital-q/ui/icons";

export const metadata: Metadata = { title: "Company" };
export const dynamic = "force-dynamic";

/**
 * One company, as THIS reader may see it (CQ-WEB-022; founder request
 * 2026-10-02: the profile opened from Discover).
 *
 * The read is the API's profile, which decides who is reading and so what
 * the page receives: an investor gets the overview (the network
 * projection, the raise only where it is disclosed to them, the deck only
 * where the company shared it with them) and the decisions; a founder
 * looking at another company gets its identity and the videos opened to
 * the network, and nothing to act on. The page renders what it was given;
 * hiding is never the authorisation. A company the reader may not see is
 * one plain not-found.
 *
 * Back returns to Discover, where the feed controller restores the same
 * card from the position it persisted (doc 20 §146).
 */
export default async function CompanyPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
  readonly searchParams?: Promise<{ readonly tab?: string | string[] }>;
}) {
  const { companyId } = await params;
  const session = await apiSession();

  const profile =
    session === null
      ? null
      : await getCompanyProfile(session, companyId).catch(() => null);

  if (profile === null || session === null) {
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

  const investor = profile.viewer === "INVESTOR";
  const [interest, standing, sectorLabels] = await Promise.all([
    investor
      ? getOwnInterest(session, profile.companyId).catch(() => null)
      : null,
    investor
      ? getRelationshipWithCompany(session, profile.companyId).catch(() => null)
      : null,
    // The industry vocabulary is reference data; the profile carries only
    // node ids. Only the most specific of a lineage is named.
    profile.overview === null || profile.overview.sectorNodeIds.length === 0
      ? []
      : listTaxonomyNodes(session, "industry", { status: "ACTIVE", limit: 100 })
          .then((page) => {
            const wanted = new Set(profile.overview?.sectorNodeIds ?? []);
            const nodes = page.items.filter((node) => wanted.has(node.id));
            const deepest = Math.max(...nodes.map((node) => node.depth));
            return nodes
              .filter((node) => node.depth === deepest)
              .map((node) => node.displayName);
          })
          .catch(() => []),
  ]);

  // A founder has only the videos; anyone else opens on the overview.
  const requested = (await searchParams)?.tab;
  const tab: ProfileTab =
    profile.overview === null || requested === "videos" ? "videos" : "overview";

  return (
    <PageContainer className="flex flex-col gap-6">
      <QPageSubject
        subject={{
          kind: "COMPANY",
          companyId: profile.companyId,
          label: profile.canonicalName,
          scope: "network_visible",
        }}
      />
      <BackToDiscover />
      <CompanyProfileView
        profile={profile}
        tab={tab}
        interest={interest?.interest ?? null}
        connected={isMatchedRelationshipState(
          standing?.relationship?.state ?? "",
        )}
        sectorLabels={sectorLabels}
      />
    </PageContainer>
  );
}

function BackToDiscover() {
  return (
    <Link
      href="/discover"
      className={buttonClassName("quiet", "compact", "self-start")}
    >
      <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
      Back to Discover
    </Link>
  );
}
