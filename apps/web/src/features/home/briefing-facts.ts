import "server-only";

import {
  discoverCompanies,
  getMarketplaceReadiness,
  listCompanyRelationships,
  listIncomingInterest,
  listInvestorRelationships,
  listPendingQApprovals,
} from "@capital-q/api-client";
import type {
  DiscoveryCompanySlateDto,
  IncomingInterestListDto,
  MarketplaceReadinessAssessment,
  QPendingApprovalList,
  RelationshipListDto,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { apiSession, type OwnContext } from "@/features/q/context";
import { relationshipHref } from "@/features/relationships/relationship-words";

import {
  composeBriefing,
  type ApprovalFact,
  type Briefing,
  type BriefingFacts,
  type ReadinessGapFact,
  type RelationshipFact,
} from "./briefing";

/**
 * What Q's briefing is built from (R35), read on the server under the
 * person's own session through the ordinary APIs, each of which
 * authorises the read again. Nothing here is authority.
 *
 * The Context Firewall at this layer is which reads run for whom: an
 * investor's briefing is built only from the investor's own reads (their
 * relationships, their slate, their approvals) and never calls a
 * company's inbox, readiness or anything else founder-private -- so no
 * founder-private fact can reach it, whatever a response carried. Each
 * response is then narrowed to the named fields the composer takes.
 *
 * Every read is bounded and optional. A read that fails or is slow is
 * absent, and the composer says nothing about it.
 */

export type BriefingReads = {
  readonly pendingApprovals: () => Promise<QPendingApprovalList>;
  readonly investorRelationships: () => Promise<RelationshipListDto>;
  readonly companyRelationships: (
    companyId: string,
  ) => Promise<RelationshipListDto>;
  readonly incomingInterest: (
    companyId: string,
  ) => Promise<IncomingInterestListDto>;
  readonly readiness: (
    companyId: string,
  ) => Promise<MarketplaceReadinessAssessment>;
  readonly companySlate: () => Promise<DiscoveryCompanySlateDto>;
};

/** Past this, a read is treated as unanswered rather than waited for. */
const READ_BUDGET_MS = 1500;
/** What counts as news: a week, so a weekly visitor misses nothing. */
const NEWS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Enough of the slate to find a few pitches, never the whole feed. */
const SLATE_LOOK = 12;

async function within<T>(read: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READ_BUDGET_MS);
  });
  try {
    return await Promise.race([read(), late]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function approvalFacts(
  list: QPendingApprovalList | undefined,
): readonly ApprovalFact[] | undefined {
  return list?.items.map((item) => ({
    approvalId: item.approvalId,
    summary: item.summary,
    conversationId: item.conversationId,
  }));
}

function relationshipFacts(
  list: RelationshipListDto | undefined,
): readonly RelationshipFact[] | undefined {
  return list?.items.map((item) => ({
    relationshipId: item.relationshipId,
    counterpartName: item.counterpart.name,
    counterpartId: item.counterpart.id,
    href: relationshipHref(item),
    state: item.state,
    stateSince: item.stateSince,
  }));
}

/** Where each readiness step is done. */
function readinessHref(requirement: string, companyId: string): string {
  switch (requirement) {
    case "DISCOVERY_VISIBILITY_CONFIRMED":
      return "/company/visibility";
    case "FOUNDER_IDENTITY_VERIFIED":
    case "ORGANISATION_VERIFIED":
      return "/verification";
    default:
      return `/company/${encodeURIComponent(companyId)}`;
  }
}

function readinessGaps(
  assessment: MarketplaceReadinessAssessment | undefined,
  companyId: string,
): readonly ReadinessGapFact[] | undefined {
  // Not assessed yet says nothing either way.
  if (assessment === undefined || assessment.state === "not_assessed") {
    return undefined;
  }
  return assessment.requirements
    .filter((result) => result.outcome === "OUTSTANDING")
    .map((result) => ({
      requirement: result.requirement,
      description: result.description,
      href: readinessHref(result.requirement, companyId),
    }));
}

export async function readBriefingFacts(
  context: OwnContext,
  reads: BriefingReads,
  now: Date,
): Promise<BriefingFacts | null> {
  const since = new Date(now.getTime() - NEWS_WINDOW_MS).toISOString();
  switch (context.kind) {
    case "FOUNDER": {
      const { companyId } = context;
      const [approvals, relationships, interest, readiness] = await Promise.all(
        [
          within(reads.pendingApprovals),
          within(() => reads.companyRelationships(companyId)),
          within(() => reads.incomingInterest(companyId)),
          within(() => reads.readiness(companyId)),
        ],
      );
      return {
        role: "FOUNDER",
        since,
        approvals: approvalFacts(approvals),
        relationships: relationshipFacts(relationships),
        interest: interest?.items
          .filter((item) => item.response === "PENDING")
          .map((item) => ({
            interestId: item.interestId,
            investorName: item.investorName,
          })),
        readinessGaps: readinessGaps(readiness, companyId),
      };
    }
    case "INVESTOR": {
      const [approvals, relationships, slate] = await Promise.all([
        within(reads.pendingApprovals),
        within(reads.investorRelationships),
        within(reads.companySlate),
      ]);
      return {
        role: "INVESTOR",
        since,
        approvals: approvalFacts(approvals),
        relationships: relationshipFacts(relationships),
        pitches: slate?.items
          .filter((item) => item.pitch !== null)
          .map((item) => ({
            companyId: item.companyId,
            name: item.canonicalName,
          })),
        mandate:
          slate === undefined
            ? undefined
            : slate.notes.includes("NO_ACTIVE_MANDATE")
              ? "NOT_ACTIVE"
              : slate.notes.includes("MANDATE_HAS_NO_PREFERENCES")
                ? "NO_PREFERENCES"
                : "ACTIVE",
      };
    }
    case "NONE":
      return null;
  }
}

/**
 * The briefing for this person, or null. Never rejects: a briefing that
 * cannot be built is simply not given, and Home is unaffected.
 */
export async function resolveBriefing(
  context: OwnContext,
): Promise<Briefing | null> {
  try {
    if (context.kind === "NONE") return null;
    const session = await apiSession();
    if (session === null) return null;
    const { qApiBaseUrl } = loadWebServerConfig();
    const qSession =
      qApiBaseUrl === undefined
        ? null
        : { baseUrl: qApiBaseUrl, accessToken: session.accessToken };
    const facts = await readBriefingFacts(
      context,
      {
        pendingApprovals: () =>
          qSession === null
            ? Promise.reject(new Error("Q API not configured"))
            : listPendingQApprovals(qSession),
        investorRelationships: () => listInvestorRelationships(session),
        companyRelationships: (companyId) =>
          listCompanyRelationships(session, companyId),
        incomingInterest: (companyId) =>
          listIncomingInterest(session, companyId),
        readiness: (companyId) => getMarketplaceReadiness(session, companyId),
        companySlate: () => discoverCompanies(session, { limit: SLATE_LOOK }),
      },
      new Date(),
    );
    return facts === null ? null : composeBriefing(facts);
  } catch {
    return null;
  }
}
