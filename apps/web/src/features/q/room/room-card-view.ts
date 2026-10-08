import type { QShowInQRoomIntent } from "@capital-q/contracts";

import { recordPagePath } from "../client-actions";

/**
 * What a card in the Q room shows (R4): one shape for every kind, filled
 * on the server from the page's own reads as the person. Never model text:
 * the model chose only the kind and the record.
 */
export type RoomCardView = {
  readonly heading: string;
  readonly lead: string | null;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly meta: string | null;
  }[];
  /** Items beyond those listed. */
  readonly more: number;
  /** The record's own page, from the fixed route map. */
  readonly href: string;
  readonly open: string;
};

/** The deep link behind a card: the page the card summarises. */
export function roomCardHref(intent: QShowInQRoomIntent): string {
  const id = intent.id;
  if (id === undefined) return "/home";
  switch (intent.object) {
    case "COMPANY_PROFILE":
      return recordPagePath("COMPANY", id);
    case "DATA_ROOM":
      return recordPagePath("COMPANY_DATA_ROOM", id);
    case "PITCH_DECK":
      return recordPagePath("COMPANY_DECK", id);
    case "CHAT_WITH_COMPANY":
      return recordPagePath("RELATIONSHIP_COMPANY_MESSAGES", id);
    case "CHAT_WITH_INVESTOR":
      return recordPagePath("RELATIONSHIP_INVESTOR_MESSAGES", id);
    case "WORK_PLAN":
      return recordPagePath("WORK_ITEM", id);
    case "CAPITAL_ROUND":
      return recordPagePath("CAPITAL_ROUND", id);
    case "GATEQ_APPLICATION":
      return recordPagePath("GATEQ_APPLICATION", id);
    case "SOURCES":
      return "/home";
    case "Q_DOCUMENT":
      return "/documents";
    // Q.03/Q.04/Q.01: the founder's own sections on Capital and Home.
    case "READINESS":
      return "/capital#readiness";
    case "ACTION_PLAN":
      return "/capital#action-plan";
    case "FOLLOW_UPS":
      return "/home#follow-ups";
    // Investor promises (2026-10-07).
    case "ASSUMPTIONS":
    case "EVIDENCE_BOARD":
      return `${recordPagePath("COMPANY", id)}#assumptions`;
    case "THESIS":
      return "/profile#thesis";
    case "SAVED_COMPARISON":
      return "/discover/saved";
    case "INVESTOR_FIT":
      return "/discover";
    // Overdeliver: the founder's plan on Capital; one investor's page.
    case "READINESS_BLUEPRINT":
      return "/capital#readiness-blueprint";
    case "INVESTOR_LOOKS_FOR":
      return `/investors/${encodeURIComponent(id)}#looks-for`;
    // Founder documents (2026-10-08): their own Documents tabs.
    case "INVESTOR_REQUESTS":
      return "/documents?tab=requested";
    case "DOCUMENT_ACCESS":
      return "/documents?tab=data-room";
  }
}

/** What the card is, in a word, for "Q can see" and the closing note. */
export const ROOM_OBJECT_WORDS: Readonly<
  Record<QShowInQRoomIntent["object"], string>
> = {
  COMPANY_PROFILE: "profile",
  DATA_ROOM: "data room",
  PITCH_DECK: "pitch deck",
  CHAT_WITH_COMPANY: "chat",
  CHAT_WITH_INVESTOR: "chat",
  WORK_PLAN: "work plan",
  CAPITAL_ROUND: "round",
  GATEQ_APPLICATION: "application",
  SOURCES: "sources",
  Q_DOCUMENT: "document",
  READINESS: "readiness",
  ACTION_PLAN: "action plan",
  FOLLOW_UPS: "questions",
  ASSUMPTIONS: "assumptions",
  EVIDENCE_BOARD: "evidence board",
  THESIS: "thesis",
  SAVED_COMPARISON: "comparison",
  INVESTOR_FIT: "investors",
  READINESS_BLUEPRINT: "plan",
  INVESTOR_REQUESTS: "requests",
  DOCUMENT_ACCESS: "access",
  INVESTOR_LOOKS_FOR: "investor",
};
