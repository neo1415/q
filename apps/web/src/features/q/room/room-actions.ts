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
  getReadiness,
  getCompanyAssumptions,
  getFitCompare,
  getDiscoveredInvestor,
  getInvestorGates,
  getThesisReading,
  discoverInvestors,
  listSavedCompanies,
  getRelationshipWithInvestor,
  listGateways,
  type ApiSession,
} from "@capital-q/api-client";
import {
  FIT_COMPARE_MAX,
  QShowInQRoomIntentSchema,
  type QShowInQRoomIntent,
} from "@capital-q/contracts";

import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";

import {
  assumptionsCard,
  comparisonCard,
  investorFitCard,
  thesisCard,
} from "./promise-cards";
import { loadBlueprint } from "@/features/capital/readiness-blueprint";

import {
  blueprintCard,
  blueprintNotOnPlanCard,
  looksForCard,
} from "./plan-investor-cards";
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
    // Q.03/Q.04/Q.01: the founder's own readiness, plan and questions,
    // read through the same route as Capital and Home (founder-private).
    case "READINESS":
    case "ACTION_PLAN":
    case "FOLLOW_UPS": {
      const readiness = await getReadiness(session);
      if (readiness.companyId.toLowerCase() !== id.toLowerCase()) return null;
      if (intent.object === "READINESS") {
        const words = {
          STRONG: "Strong",
          DEVELOPING: "Developing",
          GAP: "Gap",
          UNKNOWN: "Not shared yet",
        } as const;
        return {
          heading: "What could stop your raise",
          lead:
            readiness.blockers.length === 0
              ? "Nothing investors at your stage usually ask for first is missing."
              : null,
          facts: readiness.pillars.map((pillar) => ({
            label: pillar.label,
            value: words[pillar.status],
          })),
          items: readiness.blockers.map((blocker) => ({
            id: blocker.id,
            title: blocker.title,
            meta: blocker.why,
          })),
          more: 0,
          href,
          open: "Open readiness",
        };
      }
      if (intent.object === "ACTION_PLAN") {
        const open = readiness.actions.filter(
          (action) => action.state === "OPEN",
        );
        return {
          heading: "Your action plan",
          lead: null,
          facts: [
            { label: "To do", value: String(open.length) },
            {
              label: "Done",
              value: String(readiness.actions.length - open.length),
            },
          ],
          items: open.slice(0, ITEMS_MAX).map((action) => ({
            id: action.key,
            title: action.title,
            meta: `${action.ownerLabel} · ${action.why}`,
          })),
          more: Math.max(0, open.length - ITEMS_MAX),
          href,
          open: "Open the plan",
        };
      }
      const waiting = readiness.followUps.filter((item) => item.answerable);
      return {
        heading: "Q still wants to know",
        lead:
          waiting.length === 0 ? "Q has nothing left to ask right now." : null,
        facts: [],
        items: waiting.slice(0, ITEMS_MAX).map((item) => ({
          id: item.questionId,
          title: item.question,
          meta:
            item.quickAnswers.length === 0
              ? null
              : item.quickAnswers.join(" · "),
        })),
        more: Math.max(0, waiting.length - ITEMS_MAX),
        href,
        open: "Answer on Home",
      };
    }
    // Investor promises (2026-10-07): each read is the page's own route
    // under the person's session; the API decides what they may see.
    case "ASSUMPTIONS":
    case "EVIDENCE_BOARD":
      return assumptionsCard(
        await getCompanyAssumptions(session, id),
        intent.object,
        href,
      );
    case "THESIS": {
      const q = await qApiSession();
      return q === null ? null : thesisCard(await getThesisReading(q), href);
    }
    case "SAVED_COMPARISON": {
      const q = await qApiSession();
      if (q === null) return null;
      const saved = await listSavedCompanies(session);
      const ids = saved.companyIds.slice(0, FIT_COMPARE_MAX);
      if (ids.length < 2) {
        return {
          heading: "Your saved companies, side by side",
          lead: "Save at least two companies to compare them.",
          facts: [],
          items: [],
          more: 0,
          href,
          open: "Open Saved",
        };
      }
      return comparisonCard(await getFitCompare(q, ids), href);
    }
    // Q.04: the founder's own plan; the id must be their own company.
    case "READINESS_BLUEPRINT": {
      const own = await resolveOwnContext();
      if (
        own.kind !== "FOUNDER" ||
        own.companyId.toLowerCase() !== id.toLowerCase()
      ) {
        return null;
      }
      const load = await loadBlueprint(own.companyId, 6);
      if (load.kind === "NOT_ON_PLAN") return blueprintNotOnPlanCard(href);
      return load.kind === "READY" ? blueprintCard(load.blueprint, href) : null;
    }
    // Q.05: one investor as a founder may see them (the page's own 404
    // decides), with their published gate; founders only.
    case "INVESTOR_LOOKS_FOR": {
      const own = await resolveOwnContext();
      if (own.kind !== "FOUNDER") return null;
      const investor = await getDiscoveredInvestor(session, id);
      const gates = await getInvestorGates(session, [id]).catch(() => ({
        items: [],
      }));
      const gate =
        gates.items.find(
          (item) =>
            item.investorOrganisationId.toLowerCase() === id.toLowerCase(),
        ) ?? null;
      return looksForCard(investor, gate, href);
    }
    case "INVESTOR_FIT": {
      const slate = await discoverInvestors(session);
      const top = slate.items.slice(0, ITEMS_MAX);
      const gates =
        top.length === 0
          ? []
          : (
              await getInvestorGates(
                session,
                top.map((item) => item.investorOrganisationId),
              ).catch(() => ({ items: [] }))
            ).items;
      return investorFitCard(top, gates, href);
    }
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
