import "server-only";

import {
  type ApiSession,
  getCompanyNetworkPreview,
  getDiscoveredInvestor,
  listCompanyRelationships,
  listInvestorRelationships,
  listRelationshipBriefs,
  listReminders,
} from "@capital-q/api-client";
import type {
  RelationshipBrief,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { investorTypeLabel } from "@/features/investors/investor-labels";

import { apiSession, type OwnContext } from "@/features/q/context";

/**
 * The side's own relationships (CQ-WEB-030), or undefined when they
 * couldn't be read. A person with neither a company nor an investor
 * organisation has none. Each row is the API's answer from the per-party
 * projection over relationship events: state and "since" are read, never
 * recomputed here, and the API decides which relationships this person
 * may see.
 */
export async function ownRelationships(
  context: OwnContext,
): Promise<readonly RelationshipSummaryDto[] | undefined> {
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR") return [];
  const session = await apiSession();
  if (session === null) return undefined;
  try {
    const list =
      context.kind === "FOUNDER"
        ? await listCompanyRelationships(session, context.companyId)
        : await listInvestorRelationships(session);
    return list.items;
  } catch {
    return undefined;
  }
}

/**
 * What a relationship card shows beside the state (founder design
 * 2026-09-28, Relationships list): who the counterpart is, the last
 * message, the next call, the next reminder. Every part is read as the
 * person through the same endpoints the relationship page uses; a part
 * that can't be read is null and its tile falls back to the action that
 * would create it, never to a made-up value.
 */
export type RelationshipDigest = {
  /** A short-lived signed photo URL, when the counterpart has one. */
  readonly photoUrl: string | null;
  readonly about: string | null;
  readonly chips: readonly string[];
  readonly websiteUrl: string | null;
  /** Null: the chat could not be read (unknown, never "no messages"). */
  readonly messages: {
    readonly count: number;
    /** The thread holds more than the one page read. */
    readonly more: boolean;
    readonly last: {
      readonly text: string;
      readonly mine: boolean;
      readonly senderName: string;
      readonly sentAt: string;
    } | null;
  } | null;
  readonly nextCall: { readonly startsAt: string } | null;
  /**
   * Whether the calls were read. False: nextCall is unknown, so the card
   * must not offer "Book a call" as if none were booked.
   */
  readonly callsRead?: boolean | undefined;
  readonly nextReminder: {
    readonly title: string;
    readonly dueAt: string;
  } | null;
  /** A reminder on it has come due and not been dismissed. */
  readonly followUpDue: boolean;
  /**
   * In diligence (2026-10-04): what waits on this side. The founder's open
   * requests; the investor's shares nobody on their side has opened yet.
   */
  readonly diligence?: {
    readonly openRequests: number;
    readonly firstOpenTitle: string | null;
    readonly unopenedShares: number;
  } | null;
};

/** Cards read in full; beyond this the list still shows state and dates. */
const DIGEST_LIMIT = 20;

/**
 * A card's facts from its Relationship Brief (R1): the same read Q answers
 * from. An UNAVAILABLE source is null here (unknown), never an empty one.
 */
export function digestFacts(
  brief: RelationshipBrief | undefined,
  inDiligence: boolean,
): Pick<
  RelationshipDigest,
  "messages" | "nextCall" | "callsRead" | "diligence"
> {
  if (brief === undefined) {
    return {
      messages: null,
      nextCall: null,
      callsRead: false,
      diligence: null,
    };
  }
  const latest = brief.messages.latest;
  const last = latest.status === "OK" ? latest.message : null;
  const meetings = brief.meetings;
  const obligations = brief.obligations;
  const documents = brief.documents;
  return {
    messages:
      latest.status !== "OK"
        ? null
        : {
            count: brief.messages.count,
            more: false,
            last:
              last === null
                ? null
                : {
                    text: last.preview ?? "",
                    mine: last.from === "YOU",
                    senderName: last.senderName,
                    sentAt: last.sentAt,
                  },
          },
    nextCall:
      meetings.status === "OK" && meetings.nextScheduled !== null
        ? { startsAt: meetings.nextScheduled.startsAt }
        : null,
    callsRead: meetings.status === "OK",
    diligence:
      !inDiligence || obligations.status !== "OK" || documents.status !== "OK"
        ? null
        : {
            openRequests: obligations.openRequests.length,
            firstOpenTitle: obligations.openRequests[0]?.title ?? null,
            unopenedShares: documents.items.filter(
              (d) => d.openedByYourSide === false,
            ).length,
          },
  };
}

/**
 * The cards' facts for one page: the briefs in ONE call (R1 batching; it
 * was a thread, a schedule and a diligence call per relationship), the
 * reminders in one, and each counterpart's network profile.
 */
export async function relationshipDigests(
  context: OwnContext,
  items: readonly RelationshipSummaryDto[],
): Promise<Readonly<Record<string, RelationshipDigest>>> {
  const session = await apiSession();
  if (session === null || items.length === 0) return {};
  const now = Date.now();
  const page = items.slice(0, DIGEST_LIMIT);
  const [briefs, reminders, profiles] = await Promise.all([
    listRelationshipBriefs(session, {
      companyId: context.kind === "FOUNDER" ? context.companyId : undefined,
      relationshipIds: page.map((item) => item.relationshipId),
    })
      .then(
        (list) =>
          new Map(list.items.map((brief) => [brief.relationshipId, brief])),
      )
      .catch(() => new Map<string, RelationshipBrief>()),
    listReminders(session)
      .then((list) => list.items)
      .catch(() => [] as const),
    Promise.all(
      page.map((item) =>
        counterpartProfile(session, context, item).catch(() => null),
      ),
    ),
  ]);

  const entries = page.map((item, at) => {
    const profile = profiles[at] ?? null;
    const own = reminders.filter(
      (reminder) => reminder.relationshipId === item.relationshipId,
    );
    const pending = own
      .filter((reminder) => reminder.status === "PENDING")
      .toSorted((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    const digest: RelationshipDigest = {
      photoUrl: profile?.photoUrl ?? null,
      about: profile?.about ?? null,
      chips: profile?.chips ?? [],
      websiteUrl: profile?.websiteUrl ?? null,
      ...digestFacts(
        briefs.get(item.relationshipId),
        item.state === "IN_DILIGENCE",
      ),
      nextReminder:
        pending[0] === undefined
          ? null
          : { title: pending[0].title, dueAt: pending[0].dueAt },
      followUpDue: own.some(
        (reminder) =>
          reminder.status === "DELIVERED" ||
          (reminder.status === "PENDING" && Date.parse(reminder.dueAt) <= now),
      ),
    };
    return [item.relationshipId, digest] as const;
  });
  return Object.fromEntries(entries);
}

/** The counterpart as the network shows it to this side; nothing private. */
async function counterpartProfile(
  session: ApiSession,
  context: OwnContext,
  item: RelationshipSummaryDto,
): Promise<{
  readonly photoUrl: string | null;
  readonly about: string | null;
  readonly chips: readonly string[];
  readonly websiteUrl: string | null;
}> {
  if (item.counterpart.kind === "COMPANY") {
    const company = await getCompanyNetworkPreview(
      session,
      item.counterpart.id,
    );
    return {
      photoUrl: null,
      about: company.shortDescription,
      chips: [
        stageLabel(company.currentStageCode),
        countryLabel(company.headquartersCountry),
      ].filter((chip): chip is string => chip !== null),
      websiteUrl: company.websiteUrl,
    };
  }
  if (context.kind !== "FOUNDER") {
    return { photoUrl: null, about: null, chips: [], websiteUrl: null };
  }
  // Read through Discover, so a founder sees exactly what Discover would
  // show them of this investor, and nothing when it would show nothing.
  const investor = await getDiscoveredInvestor(session, item.counterpart.id);
  return {
    photoUrl: investor.photoUrl ?? null,
    about: investor.publicDescription,
    chips: [
      investorTypeLabel(investor.investorType),
      countryLabel(investor.hqCountry),
    ].filter((chip): chip is string => chip !== null),
    websiteUrl: investor.websiteUrl,
  };
}
