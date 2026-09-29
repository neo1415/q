import "server-only";

import {
  type ApiSession,
  getChatThread,
  getCompanyNetworkPreview,
  getDiscoveredInvestor,
  listCompanyRelationships,
  listInvestorRelationships,
  listRelationshipMeetings,
  listReminders,
} from "@capital-q/api-client";
import {
  CHAT_PAGE_MAX,
  type ChatMessageDto,
  type RelationshipSummaryDto,
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
  readonly nextReminder: {
    readonly title: string;
    readonly dueAt: string;
  } | null;
  /** A reminder on it has come due and not been dismissed. */
  readonly followUpDue: boolean;
};

/** Cards read in full; beyond this the list still shows state and dates. */
const DIGEST_LIMIT = 24;

function messagePreview(message: ChatMessageDto): string {
  if (message.unsent) return "Message unsent";
  if (message.kind === "VOICE_NOTE") return "Voice note";
  if (message.kind === "ATTACHMENT") {
    return message.attachment === null
      ? "Shared a document"
      : `Shared ${message.attachment.title}`;
  }
  return message.body ?? "";
}

export async function relationshipDigests(
  context: OwnContext,
  items: readonly RelationshipSummaryDto[],
): Promise<Readonly<Record<string, RelationshipDigest>>> {
  const session = await apiSession();
  if (session === null || items.length === 0) return {};
  const now = Date.now();
  const reminders = await listReminders(session)
    .then((list) => list.items)
    .catch(() => [] as const);

  const entries = await Promise.all(
    items.slice(0, DIGEST_LIMIT).map(async (item) => {
      const connected = item.state === "CONNECTED";
      const [profile, thread, meetings] = await Promise.all([
        counterpartProfile(session, context, item).catch(() => null),
        connected
          ? getChatThread(session, item.relationshipId).catch(() => null)
          : Promise.resolve(null),
        connected
          ? listRelationshipMeetings(session, item.relationshipId)
              .then((list) => list.items)
              .catch(() => [] as const)
          : Promise.resolve([] as const),
      ]);
      const own = reminders.filter(
        (reminder) => reminder.relationshipId === item.relationshipId,
      );
      const pending = own
        .filter((reminder) => reminder.status === "PENDING")
        .toSorted((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
      const upcomingCall = meetings
        .filter(
          (meeting) =>
            meeting.status !== "CANCELLED" && Date.parse(meeting.endsAt) > now,
        )
        .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .at(0);
      const last = thread?.messages.at(-1);
      const digest: RelationshipDigest = {
        photoUrl: profile?.photoUrl ?? null,
        about: profile?.about ?? null,
        chips: profile?.chips ?? [],
        websiteUrl: profile?.websiteUrl ?? null,
        messages:
          thread === null
            ? null
            : {
                count: thread.messages.length,
                more: thread.messages.length >= CHAT_PAGE_MAX,
                last:
                  last === undefined
                    ? null
                    : {
                        text: messagePreview(last),
                        mine: last.mine,
                        senderName: last.senderName,
                        sentAt: last.sentAt,
                      },
              },
        nextCall:
          upcomingCall === undefined
            ? null
            : { startsAt: upcomingCall.startsAt },
        nextReminder:
          pending[0] === undefined
            ? null
            : { title: pending[0].title, dueAt: pending[0].dueAt },
        followUpDue: own.some(
          (reminder) =>
            reminder.status === "DELIVERED" ||
            (reminder.status === "PENDING" &&
              Date.parse(reminder.dueAt) <= now),
        ),
      };
      return [item.relationshipId, digest] as const;
    }),
  );
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
