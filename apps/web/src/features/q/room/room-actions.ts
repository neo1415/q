"use server";

import {
  getCapitalLedger,
  getChatThread,
  getCompanyDataRoom,
  getCompanyDeck,
  getCompanyProfile,
  getGateqInbox,
  getGateqInboxItem,
  getQWork,
  getRelationshipWithCompany,
  getRelationshipWithInvestor,
  listGateways,
  type ApiSession,
} from "@capital-q/api-client";
import {
  QShowInQRoomIntentSchema,
  type QShowInQRoomIntent,
} from "@capital-q/contracts";

import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";

import { roomCardHref, type RoomCardView } from "./room-card-view";

/**
 * Q room R4: a card's content, read as the person (server side, so the
 * session never reaches the browser). The model chose only the kind and
 * the record id; every read here is the page's own API call under the
 * person's session, so a card shows exactly what that page would, and
 * nothing for a record the person may not open.
 */

export type RoomCardResult =
  | { readonly ok: true; readonly view: RoomCardView }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE: RoomCardResult = {
  ok: false,
  message: "This isn't available to you here.",
};
const ITEMS_MAX = 8;

const money = (value: { amount: string; currency: string } | null) =>
  value === null ? null : `${value.currency} ${value.amount}`;

export async function loadRoomCardAction(
  raw: unknown,
): Promise<RoomCardResult> {
  const parsed = QShowInQRoomIntentSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id === undefined) return UNAVAILABLE;
  const intent = parsed.data;
  const id = parsed.data.id;
  const session =
    intent.object === "WORK_PLAN" ? await qApiSession() : await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to see this." };
  }
  try {
    const view = await read(session, intent, id);
    return view === null ? UNAVAILABLE : { ok: true, view };
  } catch {
    return UNAVAILABLE;
  }
}

async function read(
  session: ApiSession,
  intent: QShowInQRoomIntent,
  id: string,
): Promise<RoomCardView | null> {
  const href = roomCardHref(intent);
  switch (intent.object) {
    // Q room W5: the deck surface reads its own document (deck-actions).
    case "Q_DOCUMENT":
      return null;
    case "COMPANY_PROFILE": {
      const profile = await getCompanyProfile(session, id);
      const overview = profile.overview;
      return {
        heading: profile.canonicalName,
        lead:
          profile.shortDescription ??
          overview?.primaryDescription?.slice(0, 280) ??
          null,
        facts: [
          ...(profile.currentStageCode === null
            ? []
            : [
                {
                  label: "Stage",
                  value: profile.currentStageCode.replace(/_/g, " "),
                },
              ]),
          ...(profile.headquartersCountry === null
            ? []
            : [
                {
                  label: "Based in",
                  value: [profile.headquartersCity, profile.headquartersCountry]
                    .filter((part) => part !== null)
                    .join(", "),
                },
              ]),
          ...(overview?.raise == null
            ? []
            : [{ label: "Raising", value: money(overview.raise) ?? "" }]),
          ...(overview === null
            ? []
            : [
                {
                  label: "Verified",
                  value: overview.organisationVerified ? "Yes" : "Not yet",
                },
              ]),
        ],
        items: [],
        more: 0,
        href,
        open: "Open the profile",
      };
    }
    case "DATA_ROOM": {
      const room = await getCompanyDataRoom(session, id);
      const documents = room.documents.map((document) => ({
        id: document.documentId,
        title: document.title,
        meta:
          room.viewer === "INVESTOR" && "access" in document
            ? document.access === "OPEN"
              ? "Open to you"
              : document.access === "REQUESTED"
                ? "Requested"
                : "On request"
            : null,
      }));
      return {
        heading: `${intent.title} · Data room`,
        lead:
          documents.length === 0
            ? "No documents are shared here yet."
            : `${String(documents.length)} document${documents.length === 1 ? "" : "s"}${room.viewer === "INVESTOR" ? " you can see" : ""}.`,
        facts: [],
        items: documents.slice(0, ITEMS_MAX),
        more: Math.max(0, documents.length - ITEMS_MAX),
        href,
        open: "Open the data room",
      };
    }
    case "PITCH_DECK": {
      const deck = await getCompanyDeck(session, id);
      if (deck.deck === null) {
        return {
          heading: `${intent.title} · Pitch deck`,
          lead: "No pitch deck is shared here yet.",
          facts: [],
          items: [],
          more: 0,
          href,
          open: "Open the pitch deck",
        };
      }
      const sections = (deck.extraction?.sections ?? []).filter(
        (section) => section.status === "PRESENT" && section.summary !== null,
      );
      return {
        heading: `${intent.title} · ${deck.deck.title}`,
        lead:
          deck.deck.pageCount === null
            ? null
            : `${String(deck.deck.pageCount)} pages, version ${String(deck.deck.versionNumber)}.`,
        facts: [],
        items: sections.slice(0, ITEMS_MAX).map((section) => ({
          id: section.section,
          title: section.section.toLowerCase().replace(/_/g, " "),
          meta: section.summary?.slice(0, 140) ?? null,
        })),
        more: Math.max(0, sections.length - ITEMS_MAX),
        href,
        open: "Open the pitch deck",
      };
    }
    case "CHAT_WITH_COMPANY":
    case "CHAT_WITH_INVESTOR": {
      const standing =
        intent.object === "CHAT_WITH_COMPANY"
          ? await getRelationshipWithCompany(session, id)
          : await getRelationshipWithInvestor(session, id);
      const relationshipId = standing.relationship?.relationshipId;
      if (relationshipId === undefined) return null;
      const thread = await getChatThread(session, relationshipId);
      const messages = thread.messages.filter((message) => !message.unsent);
      return {
        heading: `Chat with ${intent.title}`,
        lead:
          messages.length === 0
            ? "No messages yet."
            : thread.unread > 0
              ? `${String(thread.unread)} unread.`
              : null,
        facts: [],
        items: messages.slice(-ITEMS_MAX).map((message) => ({
          id: message.messageId,
          title: `${message.mine ? "You" : message.senderName}: ${
            message.kind === "TEXT"
              ? (message.body ?? "").slice(0, 200)
              : message.kind === "ATTACHMENT"
                ? "sent a file"
                : "sent a voice note"
          }`,
          meta: null,
        })),
        more: 0,
        href,
        open: "Open the chat",
      };
    }
    case "WORK_PLAN": {
      const detail = await getQWork(session, id);
      const lanes = detail.work.lanes;
      return {
        heading: detail.work.goal ?? intent.title,
        lead: detail.work.summary,
        facts: [
          {
            label: "Status",
            value: detail.work.status.toLowerCase().replace(/_/g, " "),
          },
        ],
        items: lanes.slice(0, ITEMS_MAX).map((lane) => ({
          id: lane.id,
          title: lane.counterpartName,
          meta: [lane.stage.toLowerCase().replace(/_/g, " "), lane.lastStep]
            .filter((part) => part !== null && part.length > 0)
            .join(" · "),
        })),
        more: Math.max(0, lanes.length - ITEMS_MAX),
        href,
        open: "Open the work",
      };
    }
    case "CAPITAL_ROUND": {
      const context = await resolveOwnContext();
      if (context.kind !== "FOUNDER") return null;
      const ledger = await getCapitalLedger(session, context.companyId);
      const round = ledger.rounds.find((one) => one.id === id);
      if (round === undefined) return null;
      return {
        heading: `${round.name} round`,
        lead: round.isCurrent ? "Your current round." : null,
        facts: [
          { label: "Target", value: money(round.target) ?? "" },
          {
            label: "Raised",
            value: `${round.target.currency} ${round.sums.raised}`,
          },
          {
            label: "Confirmed",
            value: `${round.target.currency} ${round.sums.confirmed}`,
          },
          {
            label: "Pledged",
            value: `${round.target.currency} ${round.sums.pledged}`,
          },
          {
            label: "Status",
            value: round.status.toLowerCase().replace(/_/g, " "),
          },
        ],
        items: [],
        more: 0,
        href,
        open: "Open Capital",
      };
    }
    case "GATEQ_APPLICATION": {
      const context = await resolveOwnContext();
      if (context.kind !== "INVESTOR") return null;
      const gateways = await listGateways(
        session,
        context.investorOrganisationId,
      );
      const gateway = gateways.gateways.find(
        (item) => item.status === "ACTIVE",
      );
      if (gateway === undefined) return null;
      // The inbox lists it for this person first; its detail is then read.
      const inbox = await getGateqInbox(session, gateway.id, "INBOX");
      if (!inbox.items.some((item) => item.applicationId === id)) {
        const archived = await getGateqInbox(session, gateway.id, "ARCHIVED");
        if (!archived.items.some((item) => item.applicationId === id)) {
          return null;
        }
      }
      const detail = await getGateqInboxItem(session, gateway.id, id);
      const item = detail.item;
      return {
        heading: item.companyName,
        lead: item.oneLiner,
        facts: [
          ...(item.stage === null
            ? []
            : [{ label: "Stage", value: item.stage }]),
          ...(item.sector === null
            ? []
            : [{ label: "Sector", value: item.sector }]),
          ...(item.country === null
            ? []
            : [{ label: "Country", value: item.country }]),
          { label: "Fit", value: item.fit.toLowerCase() },
          {
            label: "Rules met",
            value: `${String(item.rules.met)} of ${String(item.rules.total)}`,
          },
          ...(item.daysLeft === null
            ? []
            : [
                {
                  label: "Reply",
                  value:
                    item.daysLeft < 0
                      ? `${String(-item.daysLeft)} days overdue`
                      : `due in ${String(item.daysLeft)} days`,
                },
              ]),
        ],
        items: [],
        more: 0,
        href,
        open: "Open the application",
      };
    }
    case "SOURCES":
      return null;
  }
}
