import {
  DOCUMENT_ACCESS_LEVEL_WORDS,
  DOCUMENT_SCOPE_CHOICES,
  inboxItemOpen,
  type DataRoomOwnerView,
  type DocumentAccessDto,
  type RequestInboxDto,
} from "@capital-q/contracts";

import type { RoomCardView } from "./room-card-view";

/**
 * The Q room cards for founder documents (2026-10-08), built from the
 * Documents page's own reads as the founder (never model text). Pure, so
 * the words are tested.
 */

const ITEMS_MAX = 8;
export const ACCESS_CARD_DOCUMENTS = 12;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** "What have investors asked me for?": open first, each with its state. */
export function requestsCard(
  inbox: RequestInboxDto,
  href: string,
): RoomCardView {
  const lines = inbox.items.flatMap((item) =>
    item.kind === "DOCUMENT_REQUEST"
      ? [
          {
            id: item.itemId,
            open: inboxItemOpen(item),
            title: `${item.investorOrganisationName ?? "An investor"}: ${item.title}`,
            meta: [
              item.status === "OPEN"
                ? `asked ${day(item.requestedAt)}, waiting for you`
                : item.status === "SHARED"
                  ? "shared"
                  : "declined",
              item.dataRoom === null ? null : "in your data room",
            ]
              .filter((part): part is string => part !== null)
              .join(" · "),
          },
        ]
      : item.questions.map((question) => ({
          id: question.questionId,
          open: question.answer === null,
          title: `${item.investorOrganisationName ?? "An investor"} asked: ${question.question}`,
          meta:
            question.answer === null
              ? `asked ${day(question.askedAt)}, not answered yet`
              : "answered",
        })),
  );
  const ordered = [
    ...lines.filter((line) => line.open),
    ...lines.filter((line) => !line.open),
  ];
  return {
    heading: "What investors asked you for",
    lead:
      inbox.counts.open === 0
        ? "Nothing is waiting for you."
        : `${String(inbox.counts.open)} waiting for you. Answer each on the Requested tab, or tell me what to send.`,
    facts: [
      { label: "Open", value: String(inbox.counts.open) },
      { label: "Answered", value: String(inbox.counts.answered) },
      { label: "Declined", value: String(inbox.counts.declined) },
    ],
    items: ordered.slice(0, ITEMS_MAX).map((line) => ({
      id: line.id,
      title: line.title.slice(0, 200),
      meta: line.meta,
    })),
    more: Math.max(0, ordered.length - ITEMS_MAX),
    href,
    open: "Open Requested",
  };
}

/** "Who can see my financials?": each document, its level and who has it. */
export function accessCard(
  room: DataRoomOwnerView,
  access: readonly DocumentAccessDto[],
  href: string,
): RoomCardView {
  const folders = new Map(room.folders.map((f) => [f.code, f.label]));
  const byId = new Map(access.map((entry) => [entry.documentId, entry]));
  const levelWords = new Map<string, string>(
    DOCUMENT_SCOPE_CHOICES.map((choice) => [choice.level, choice.words]),
  );
  const items = room.documents.map((document) => {
    const grants = byId.get(document.documentId)?.grants ?? [];
    const who =
      grants.length === 0
        ? null
        : grants
            .map(
              (grant) =>
                `${grant.investorOrganisationName ?? "an investor"} (${DOCUMENT_ACCESS_LEVEL_WORDS[grant.accessLevel].toLowerCase()}${grant.expiresAt === null ? "" : `, until ${day(grant.expiresAt)}`})`,
            )
            .join(", ");
    return {
      id: document.documentId,
      title: document.title,
      meta: [
        folders.get(document.folderCode) ?? null,
        levelWords.get(document.level) ?? "Only my team",
        who === null ? null : `shared with ${who}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
    };
  });
  const shared = items.filter((item) => item.meta.includes("shared with"));
  return {
    heading: "Who can see your documents",
    lead:
      shared.length === 0
        ? "No investor has a document shared with them right now."
        : `${String(shared.length)} ${shared.length === 1 ? "document is" : "documents are"} shared with investors now. You can change any of them on the Data room tab.`,
    facts: [],
    items: items.slice(0, ITEMS_MAX),
    more: Math.max(0, items.length - ITEMS_MAX),
    href,
    open: "Open the data room",
  };
}
