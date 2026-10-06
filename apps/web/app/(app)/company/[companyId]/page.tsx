import type { Metadata } from "next";
import Link from "next/link";

import {
  getCompanyDataRoom,
  getCompanyDeck,
  getCompanyProfile,
  getDiligence,
  getOwnInterest,
  getRelationshipWithCompany,
  listTaxonomyNodes,
} from "@capital-q/api-client";
import {
  isMatchedRelationshipState,
  RelationshipStateV2Schema,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import {
  CompanyProfileView,
  profileTabOf,
  type ProfileTab,
} from "@/features/company/company-profile-view";
import { apiSession } from "@/features/q/context";
import { QPageState, QSection } from "@/features/q/q-section";
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
  readonly searchParams?: Promise<{
    readonly tab?: string | string[];
    readonly as?: string | string[];
  }>;
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

  // In diligence, what the company shared with this relationship, read
  // through the diligence area's own authorisation (never inferred here).
  const relationship = standing?.relationship ?? null;
  const inDiligence =
    relationship !== null &&
    relationship.milestones.some((m) => m.state === "IN_DILIGENCE") &&
    isMatchedRelationshipState(relationship.state);
  const area = inDiligence
    ? await getDiligence(session, relationship.relationshipId).catch(() => null)
    : null;
  const diligence = inDiligence
    ? {
        href: `/relationships/company/${encodeURIComponent(profile.companyId)}#diligence`,
        titles: (area?.shares ?? []).map((share) => share.title),
      }
    : null;

  // A founder viewing another company has only the Elevator; anyone else
  // opens on the overview, or the tab the URL names (A1).
  const query = await searchParams;
  const requested = profileTabOf(
    typeof query?.tab === "string" ? query.tab : undefined,
  );
  const tab: ProfileTab =
    profile.overview === null ? "elevator" : (requested ?? "overview");
  // Each tab's read is the API's, for this reader; only the open tab (and
  // the deck, whose team facts the Team tab shows) is fetched.
  const [dataRoom, deck] = await Promise.all([
    profile.overview !== null
      ? getCompanyDataRoom(session, profile.companyId).catch(() => null)
      : null,
    profile.overview !== null && (tab === "deck" || tab === "team")
      ? getCompanyDeck(session, profile.companyId).catch(() => null)
      : null,
  ]);

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
      {/* Q room R1: the profile, its open tab and the data room's size. */}
      <QPageState
        tab={tab}
        focus={{ kind: "COMPANY", id: profile.companyId }}
      />
      <QSection
        id="profile"
        kind="COMPANY_PROFILE"
        refs={[{ kind: "COMPANY", id: profile.companyId }]}
        total={1}
        label={`${profile.canonicalName} profile`}
      />
      {dataRoom === null ? null : (
        <QSection
          id="data-room"
          kind="DATA_ROOM"
          refs={
            dataRoom.viewer === "OWNER"
              ? dataRoom.documents.slice(0, 12).map((document) => ({
                  kind: "UPLOADED_DOCUMENT" as const,
                  id: document.documentId,
                }))
              : []
          }
          total={dataRoom.documents.length}
          label={
            tab === "dataroom"
              ? `data room, ${String(dataRoom.documents.length)} files`
              : undefined
          }
        />
      )}
      <BackToDiscover />
      <CompanyProfileView
        profile={profile}
        tab={tab}
        interest={interest?.interest ?? null}
        connected={isMatchedRelationshipState(
          standing?.relationship?.state ?? "",
        )}
        sectorLabels={sectorLabels}
        diligence={diligence}
        dataRoom={dataRoom}
        deck={deck}
        previewAsInvestor={query?.as === "investor"}
        relationshipState={
          RelationshipStateV2Schema.safeParse(standing?.relationship?.state)
            .data ?? null
        }
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
