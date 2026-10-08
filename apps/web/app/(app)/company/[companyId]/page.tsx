import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  getCompanyAssumptions,
  getCompanyDataRoom,
  getCompanyDeck,
  getCompanyProfile,
  getDiligence,
  getOwnInterest,
  getRelationshipWithCompany,
  listClaimableCompanies,
  listTaxonomyNodes,
} from "@capital-q/api-client";
import {
  isMatchedRelationshipState,
  RelationshipStateV2Schema,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState, Skeleton } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import {
  AssumptionsSection,
  type QuestionsRoute,
} from "@/features/assumptions/assumptions-section";
import {
  CompanyProfileView,
  profileTabOf,
  type ProfileTab,
} from "@/features/company/company-profile-view";
import { apiSession } from "@/features/q/context";
import { Fold } from "@/features/company/overview-sections";
import {
  ProfileTabQSection,
  ProfileTabs,
} from "@/features/company/profile-tabs";
import { QSection } from "@/features/q/q-section";
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

  if (profile === null && session !== null) {
    // F3 (2026-10-08): a founder with no organisation yet opening their own
    // company's page. If it is a company they may see and claim (or join),
    // say so instead of "not available".
    const claimable = await listClaimableCompanies(session, companyId)
      .then((result) => result.companies[0] ?? null)
      .catch(() => null);
    if (claimable !== null && !claimable.yours) {
      const join = claimable.members > 0;
      return (
        <PageContainer>
          <BackToDiscover />
          <EmptyState
            title={
              join
                ? `Do you work at ${claimable.name}?`
                : `Is ${claimable.name} your company?`
            }
            description={
              claimable.requested
                ? "Your request is in. Capital Q checks it and lets you know; the company's page opens to you once you're in."
                : join
                  ? "Its team is already on Capital Q. Ask them to let you in, and the company's page opens to you."
                  : "Nobody has claimed it on Capital Q yet. Claim it with a work email or a registry document, and once it's approved it's yours to run."
            }
          />
          {claimable.requested ? null : (
            <div className="mt-4 flex justify-center">
              <Link
                href={`/gateq?tab=claim&q=${encodeURIComponent(claimable.name)}`}
                className={buttonClassName("primary")}
              >
                {join ? "Ask to join" : "Claim this company"}
              </Link>
            </div>
          )}
        </PageContainer>
      );
    }
  }

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
  // Each tab's read is the API's, for this reader. Every tab arrives with
  // the page so switching tabs happens in place (ProfileTabs): the data
  // room is read now (its size is in the tab bar); the deck (whose team
  // facts the Team tab shows) and the assumptions stream into their own
  // panels and never hold the page.
  const deck =
    profile.overview !== null
      ? getCompanyDeck(session, profile.companyId).catch(() => null)
      : null;
  // Q.07: the investor's assumptions to test, built by the API from what
  // this investor may see (confirmed readings only); never for others.
  const assumptions =
    investor && profile.overview !== null
      ? getCompanyAssumptions(session, profile.companyId).catch(() => null)
      : null;
  const dataRoom =
    profile.overview !== null
      ? await getCompanyDataRoom(session, profile.companyId).catch(() => null)
      : null;
  const questionsRoute: QuestionsRoute =
    relationship === null || !isMatchedRelationshipState(relationship.state)
      ? { kind: "NOT_CONNECTED" }
      : inDiligence
        ? { kind: "DILIGENCE", relationshipId: relationship.relationshipId }
        : { kind: "CHAT", relationshipId: relationship.relationshipId };

  return (
    <PageContainer className="flex flex-col gap-6">
      {/* Q room R1: the profile, its open tab (said by ProfileTabs, as it
          changes) and the data room's size. */}
      <ProfileTabs
        base={`/company/${encodeURIComponent(profile.companyId)}`}
        initial={tab}
        available={
          profile.overview === null
            ? ["elevator"]
            : ["overview", "elevator", "dataroom", "deck", "team"]
        }
        focus={{ kind: "COMPANY", id: profile.companyId }}
      >
        <QPageSubject
          subject={{
            kind: "COMPANY",
            companyId: profile.companyId,
            label: profile.canonicalName,
            scope: "network_visible",
          }}
        />
        <QSection
          id="profile"
          kind="COMPANY_PROFILE"
          refs={[{ kind: "COMPANY", id: profile.companyId }]}
          total={1}
          label={`${profile.canonicalName} profile`}
        />
        {dataRoom === null ? null : (
          <ProfileTabQSection
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
            labelOn="dataroom"
            label={`data room, ${String(dataRoom.documents.length)} files`}
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
          overviewStreamed={
            assumptions === null ? null : (
              <Suspense fallback={<AssumptionsFoldLoading />}>
                <AssumptionsFold
                  assumptions={assumptions}
                  companyName={profile.canonicalName}
                  route={questionsRoute}
                />
              </Suspense>
            )
          }
          relationshipState={
            RelationshipStateV2Schema.safeParse(standing?.relationship?.state)
              .data ?? null
          }
        />
      </ProfileTabs>
    </PageContainer>
  );
}

/** Q.07's fold: the investor's assumptions to test, streamed in. */
async function AssumptionsFold({
  assumptions,
  companyName,
  route,
}: {
  readonly assumptions: Promise<Awaited<
    ReturnType<typeof getCompanyAssumptions>
  > | null>;
  readonly companyName: string;
  readonly route: QuestionsRoute;
}) {
  const board = await assumptions;
  if (board === null) return null;
  return (
    <Fold
      id="company-assumptions"
      title="Assumptions to test"
      summary={[
        `${String(board.assumptions.length)} to test`,
        board.counts.unknown > 0
          ? `${String(board.counts.unknown)} not known yet`
          : null,
      ]
        .filter((part) => part !== null)
        .join(" · ")}
    >
      <AssumptionsSection
        board={board}
        companyName={companyName}
        route={route}
      />
    </Fold>
  );
}

function AssumptionsFoldLoading() {
  return (
    <div className="border-b border-(--cq-border-subtle) py-4" aria-busy="true">
      <Skeleton lines={1} className="w-1/3" />
    </div>
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
