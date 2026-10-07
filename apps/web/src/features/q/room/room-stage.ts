import type { QShowInQRoomIntent } from "@capital-q/contracts";

import type { QTurn, QTurnPublicSource } from "../conversation";
import { wireNow } from "../wire";

/**
 * Q room R4: which card is open in the room, decided by code from the
 * conversation itself (founder clarification, 6 October): a card stays
 * only while the conversation is on its subject. A new subject closes it
 * straight away, with a quiet "Closed … as we moved on"; the subject
 * coming back reopens it; "close it" closes it. Derived from the turns, so
 * the same conversation always shows the same room, after a reload too.
 *
 * The reading is words and structure, never a model: a card's subject is
 * its record's own name (the server's, never the model's) and its kind.
 */

export type RoomCard = {
  /** One card per kind and record. */
  readonly key: string;
  readonly intent: QShowInQRoomIntent;
  /** For SOURCES: the public sources of the answer that showed it. */
  readonly sources: readonly QTurnPublicSource[];
  /** The index of the turn that opened (or reopened) it. */
  readonly openedAt: number;
};

export type RoomNote = { readonly id: string; readonly text: string };

export type RoomStage = {
  readonly open: RoomCard | null;
  /** Cards shown in this conversation and not open now, newest first. */
  readonly closed: readonly RoomCard[];
  /** The latest "Closed … as we moved on", keyed by the turn that moved on. */
  readonly note: RoomNote | null;
};

const keyOf = (intent: QShowInQRoomIntent) =>
  `${intent.object}:${intent.id ?? "-"}`;

function folded(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const GENERIC = new Set([
  "the",
  "and",
  "with",
  "round",
  "chat",
  "capital",
  "fund",
  "partners",
  "ventures",
  "limited",
  "ltd",
  "inc",
  "fictional",
  "sources",
  "plan",
]);

/** The words that name a card's subject: its record's name, then its kind. */
function subjectWords(intent: QShowInQRoomIntent): {
  readonly names: readonly string[];
  readonly kinds: readonly string[];
} {
  const names = folded(intent.title)
    .split(" ")
    .filter((word) => word.length >= 4 && !GENERIC.has(word));
  const kinds: Record<QShowInQRoomIntent["object"], readonly string[]> = {
    COMPANY_PROFILE: ["profile"],
    DATA_ROOM: ["data room", "dataroom"],
    PITCH_DECK: ["deck", "pitch deck", "slides"],
    CHAT_WITH_COMPANY: ["chat", "messages", "conversation with"],
    CHAT_WITH_INVESTOR: ["chat", "messages", "conversation with"],
    WORK_PLAN: ["plan", "work"],
    CAPITAL_ROUND: ["round", "raise"],
    GATEQ_APPLICATION: ["application", "applicant"],
    SOURCES: ["sources", "news", "articles", "links"],
    // The deck stays while they work on it: slides, pictures, edits.
    Q_DOCUMENT: [
      "deck",
      "slide",
      "slides",
      "document",
      "picture",
      "photo",
      "image",
      "upload",
      "title",
      "one pager",
      "memo",
    ],
  };
  return { names, kinds: kinds[intent.object] };
}

function has(text: string, phrase: string): boolean {
  return ` ${folded(text)} `.includes(` ${phrase} `);
}

/** Whether these words are about the card: its name, or its kind by name. */
export function mentions(text: string, intent: QShowInQRoomIntent): boolean {
  const { names, kinds } = subjectWords(intent);
  return (
    names.some((name) => has(text, name)) ||
    kinds.some((kind) => has(text, kind))
  );
}

/** "Close it", "close that card", "hide it", "dismiss": the person's word. */
export function asksToClose(text: string): boolean {
  return /^\s*(please\s+)?(close|hide|dismiss|put away)\b(\s+(it|that|this|the card|that card|this card|them|the window))?\s*(please)?[.!]?\s*$/i.test(
    text,
  );
}

const POINTING = [
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "them",
  "their",
  "they",
  "here",
  "there",
  "next",
  "previous",
  "page",
  "more",
  "else",
];

/** A follow-up that points back at what is open rather than naming anew. */
function pointsBack(text: string): boolean {
  return POINTING.some((word) => has(text, word));
}

/** Q room W5: the documents Q makes that open in the room as a deck surface. */
const ROOM_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "PITCH_DECK",
  "ONE_PAGER",
  "MEMO",
]);

function showsOf(turn: Extract<QTurn, { kind: "Q" }>): QShowInQRoomIntent[] {
  const out: QShowInQRoomIntent[] = [];
  // W7: checked against the wire's contracts; none until they are in.
  const QShowInQRoomIntentSchema = wireNow()?.QShowInQRoomIntentSchema;
  if (QShowInQRoomIntentSchema === undefined) return out;
  for (const block of turn.blocks) {
    // Q room W5: a deck, one-pager or memo Q made or changed in this
    // answer opens in the room (its card on the answer is the record).
    if (
      block.kind === "ARTIFACT_REFERENCE" &&
      ROOM_DOCUMENT_TYPES.has(block.type)
    ) {
      const parsed = QShowInQRoomIntentSchema.safeParse({
        kind: "SHOW_IN_Q_ROOM",
        object: "Q_DOCUMENT",
        id: block.artifactId,
        title: block.title.slice(0, 120),
      });
      if (parsed.success) out.push(parsed.data);
      continue;
    }
    if (block.kind !== "UI_INTENT") continue;
    const parsed = QShowInQRoomIntentSchema.safeParse(block.intent);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** What a closing note calls the card. */
export function describeCard(intent: QShowInQRoomIntent): string {
  switch (intent.object) {
    case "COMPANY_PROFILE":
      return `${intent.title}'s profile`;
    case "DATA_ROOM":
      return `${intent.title}'s data room`;
    case "PITCH_DECK":
      return `${intent.title}'s pitch deck`;
    case "CHAT_WITH_COMPANY":
    case "CHAT_WITH_INVESTOR":
      return `the chat with ${intent.title}`;
    case "WORK_PLAN":
      return `the plan for ${intent.title}`;
    case "CAPITAL_ROUND":
      return intent.title;
    case "GATEQ_APPLICATION":
      return `${intent.title}'s application`;
    case "SOURCES":
      return "the sources";
    case "Q_DOCUMENT":
      return intent.title;
  }
}

export function roomStage(turns: readonly QTurn[]): RoomStage {
  const known = new Map<string, RoomCard>();
  let open: RoomCard | null = null;
  let note: RoomNote | null = null;
  let asked: string | null = null;
  const movedOn = (card: RoomCard, at: string): RoomNote => ({
    id: at,
    text: `Closed ${describeCard(card.intent)} as we moved on`,
  });

  for (const [index, turn] of turns.entries()) {
    if (turn.kind === "PERSON") {
      asked = turn.text;
      if (asksToClose(turn.text)) {
        open = null;
        asked = null;
        continue;
      }
      // The subject comes back: the card reopens at once, before Q answers.
      const back = [...known.values()]
        .reverse()
        .find(
          (card) => card.key !== open?.key && mentions(turn.text, card.intent),
        );
      if (
        back !== undefined &&
        (open === null || !mentions(turn.text, open.intent))
      ) {
        if (open !== null) note = movedOn(open, turn.id);
        open = { ...back, openedAt: index };
        known.set(back.key, open);
        asked = null;
      }
      continue;
    }
    if (turn.streaming) continue;
    const shows = showsOf(turn);
    const shown = shows.at(-1);
    if (shown !== undefined) {
      // The same document again (a new version of the deck on screen):
      // it stays where it is, on its slide.
      if (open !== null && open.key === keyOf(shown)) {
        asked = null;
        continue;
      }
      const card: RoomCard = {
        key: keyOf(shown),
        intent: shown,
        sources: shown.object === "SOURCES" ? turn.publicSources : [],
        openedAt: index,
      };
      if (open !== null && open.key !== card.key) note = movedOn(open, turn.id);
      open = card;
      known.set(card.key, card);
      asked = null;
      continue;
    }
    if (open !== null && asked !== null) {
      const stays =
        mentions(asked, open.intent) ||
        mentions(turn.text, open.intent) ||
        pointsBack(asked);
      if (!stays) {
        note = movedOn(open, turn.id);
        open = null;
      }
    }
    asked = null;
  }

  const current: RoomCard | null = open;
  return {
    open: current,
    closed: [...known.values()]
      .filter((card) => card.key !== current?.key)
      .reverse(),
    note,
  };
}
