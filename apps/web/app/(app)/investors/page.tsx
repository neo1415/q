import type { Metadata } from "next";
import Link from "next/link";
import { GoToDiscover } from "./go-to-discover";

import {
  getFitProfiles,
  listConnectionRequests,
  listInvestorRelationships,
} from "@capital-q/api-client";
import {
  FIT_IDS_MAX,
  isMatchedRelationshipState,
  type FitCompanyDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { QViewMark } from "@/features/fit/q-view-note";
import { ConnectionRequestsInbox } from "@/features/network/connection-requests-inbox";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";

export const metadata: Metadata = { title: "Investors" };
export const dynamic = "force-dynamic";

/**
 * Investors (ADR 0023). A founder sees the investors who chose to be
 * discoverable, as cards that open each investor's page, where a
 * Connection Request is the one way to reach them. An investor sees the
 * requests founders sent their organisation. The person's own side decides
 * which; every list is the API's, read under their own session.
 */
export default async function InvestorsPage() {
  const context = await resolveOwnContext();
  const session = await apiSession();

  if (context.kind === "INVESTOR" && session !== null) {
    const [inbox, relationships] = await Promise.all([
      listConnectionRequests(session).catch(() => null),
      // Only used to tell a request already overtaken by a match; when it
      // can't load, every pending request stays answerable, as before.
      listInvestorRelationships(session).catch(() => null),
    ]);
    const matchedCompanyIds = new Set(
      (relationships?.items ?? [])
        .filter(
          (item) =>
            item.counterpart.kind === "COMPANY" &&
            isMatchedRelationshipState(item.state),
        )
        .map((item) => item.counterpart.id),
    );
    // Fit with their own mandate (ADR 0052), read beside the inbox: a
    // request without a fit is still a request, so a failed read is none.
    const fits = await requestFits(
      (inbox?.items ?? []).map((item) => item.companyId),
    );
    return (
      <PageContainer>
        <PageHeader
          title="Company requests"
          description={`Companies that asked to connect with ${context.label ?? "you"}. Accepting connects you; it isn’t an investment.`}
        >
          {inbox === null || inbox.items.length === 0 ? null : (
            <Link
              href="/investors/top"
              className={buttonClassName("secondary")}
              data-top-three
            >
              <QViewMark />
              Q, give me the top three
            </Link>
          )}
        </PageHeader>
        {inbox === null ? (
          <EmptyState
            title="Requests couldn't load."
            description="Nothing is wrong with your setup. Try again in a moment."
            action={
              <Link href="/investors" className={buttonClassName("secondary")}>
                Try again
              </Link>
            }
          />
        ) : (
          <ConnectionRequestsInbox
            items={inbox.items}
            matchedCompanyIds={matchedCompanyIds}
            fits={fits}
          />
        )}
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Who can send you a request follows the choice you set in{" "}
          <Link
            href="/company/visibility"
            className="text-(--cq-text-primary) underline underline-offset-4"
          >
            Visibility
          </Link>
          .
        </p>
      </PageContainer>
    );
  }

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        <PageHeader title="Investors" />
        <EmptyState
          title={
            context.kind === "NONE" && context.unavailable === true
              ? "Investors couldn't load."
              : "Tell Q what you're here to do first."
          }
          description={
            context.kind === "NONE" && context.unavailable === true
              ? "Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment."
              : "Investors show here for founders once your company is set up."
          }
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Go to Q
            </Link>
          }
        />
      </PageContainer>
    );
  }

  // A founder's investor list is Discover's Investors tab (demo audit
  // 2026-10-03: the same list lived at two addresses). Old links land there,
  // through the client router: a server redirect after the shell streamed
  // becomes a meta refresh (axe, critical).
  return (
    <PageContainer>
      <GoToDiscover />
      <EmptyState
        title="Investors are on Discover."
        description="Your investor list lives on Discover's Investors tab."
        action={
          <Link href="/discover" className={buttonClassName("secondary")}>
            Open Discover
          </Link>
        }
      />
    </PageContainer>
  );
}

async function requestFits(
  companyIds: readonly string[],
): Promise<ReadonlyMap<string, FitCompanyDto>> {
  const session = await qApiSession();
  const ids = [...new Set(companyIds)].slice(0, FIT_IDS_MAX);
  if (session === null || ids.length === 0) return new Map();
  try {
    const { items } = await getFitProfiles(session, ids);
    return new Map(items.map((item) => [item.companyId, item]));
  } catch {
    return new Map();
  }
}
