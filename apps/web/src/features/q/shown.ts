import type { QTurn, QTurnObjectBlock } from "./conversation";
import { roomShowOf } from "./room/room-stage";

/**
 * What the Q page shows over Q's presence (founder request 2026-10-03).
 *
 * The Q page is Q's presence, not a transcript: the words live in Chat.
 * The page shows something only when Q has something to show -- a
 * document, a comparison, cards, a table, a map, a chart, a timeline, a
 * question back. Everything shown in this session stays one tap away
 * under "Shown recently", and Q can show it again when asked.
 *
 * Lane A (2026-10-15, owner: artifacts "appear and disappear willy-nilly"
 * and "don't appear when they are being talked about"): what is on the
 * stage is decided by the conversation's subject, by code, from the
 * turns alone -- so the same conversation shows the same object after a
 * route change or a reload:
 *
 * - an answer that shows an object puts it on the stage, replacing the
 *   one there (explicitly: the stage says what it replaced);
 * - an answer that shows nothing keeps the object while the answer, or
 *   the question it answers, is about it (its names, its records, "them",
 *   "the table", "the second one"); an object comes back when the
 *   conversation comes back to it;
 * - only an answer with no reference to it at all moves it off, and the
 *   stage says so. There is no answer count after which an object
 *   vanishes while it is still being talked about.
 *
 * A change waiting for approval is never one of these: it is decided where
 * it is shown (QNow), and stays there until it is decided.
 */

/** How many recent objects the side list keeps. */
export const SHOWN_RECENTLY_MAX = 8;

const SHOWABLE: ReadonlySet<QTurnObjectBlock["kind"]> = new Set([
  "ARTIFACT_REFERENCE",
  "COMPARISON",
  "COMPARISON_CARDS",
  "ANSWER_CARDS",
  "CLARIFICATION_REQUEST",
  // RECOVERY-2026-10 E4 data. Until lane A these were drawn only in Chat,
  // so on the presence view "here's the table" had nothing behind it.
  "TABLE",
  "CHART",
  "MAP",
  "TIMELINE",
  // Artifacts live (L-14): the summary Q speaks over.
  "SUMMARY",
  // L-13: a picture of what Q is talking about, credited on the stage too.
  "PICTURE",
]);

export type ShownItem = {
  /** The answer that showed it. */
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly QTurnObjectBlock[];
  /** Which of Q's answers (counting from 1) showed it. */
  readonly answer: number;
  /** The run it belongs to (INC-1): one run, one set. */
  readonly run: string;
};

function titleOf(blocks: readonly QTurnObjectBlock[]): string {
  for (const block of blocks) {
    switch (block.kind) {
      case "ARTIFACT_REFERENCE":
      case "ANSWER_CARDS":
      case "TABLE":
      case "CHART":
      case "MAP":
      case "TIMELINE":
      case "SUMMARY":
        return block.title;
      case "COMPARISON_CARDS":
        if (block.title !== null && block.title.length > 0) return block.title;
        return "Comparison";
      case "COMPARISON":
        return "Comparison";
      case "CLARIFICATION_REQUEST":
        return block.question;
      case "PICTURE":
        return block.alt;
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "ACTION_PROPOSAL":
      case "UI_INTENT":
      case "ATTENTION":
        break;
    }
  }
  return "Shown by Q";
}

/**
 * The run an answer belongs to (INC-1, 2026-10-08): one run's result is
 * one set, however many times it reaches the thread (the room feed and the
 * read-back can each bring the same run's message).
 */
export function resultKey(turn: Extract<QTurn, { kind: "Q" }>): string {
  return turn.runId ?? turn.id;
}

/**
 * One answer's showable blocks as one set: a turn that carries more than
 * one card block (a late duplicate) shows its first, never two merged.
 */
function oneSet(
  blocks: readonly QTurnObjectBlock[],
): readonly QTurnObjectBlock[] {
  let cards = false;
  return blocks.filter((block) => {
    if (!SHOWABLE.has(block.kind)) return false;
    if (block.kind !== "ANSWER_CARDS") return true;
    if (cards) return false;
    cards = true;
    return true;
  });
}

/** Every object Q's settled answers showed, oldest first, one per run. */
export function shownItems(turns: readonly QTurn[]): readonly ShownItem[] {
  const items: ShownItem[] = [];
  const answered = new Set<string>();
  const shownRuns = new Set<string>();
  for (const turn of turns) {
    if (turn.kind !== "Q") continue;
    // The same run again is the same answer, not a newer one.
    const key = resultKey(turn);
    answered.add(key);
    if (turn.streaming) continue;
    const blocks = oneSet(turn.blocks);
    if (blocks.length === 0) continue;
    // Already shown as its own set: never a second, never merged.
    if (shownRuns.has(key)) continue;
    shownRuns.add(key);
    items.push({
      id: turn.id,
      title: titleOf(blocks),
      blocks,
      answer: answered.size,
      run: key,
    });
  }
  return items;
}

/** How many answers Q has given in these turns. */
export function answersIn(turns: readonly QTurn[]): number {
  const runs = new Set<string>();
  for (const turn of turns) if (turn.kind === "Q") runs.add(resultKey(turn));
  return runs.size;
}

// ------------------------------------------------------------- subject --

function folded(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** What an object is about: its records, its names, how it is called. */
export type ItemSubject = {
  /** Company / investor ids, lower case. */
  readonly ids: ReadonlySet<string>;
  /** Whole names (folded): "medtrail", "silo credit". */
  readonly names: readonly string[];
  /** How a person calls this kind of object: "table", "map", "cards". */
  readonly kindWords: readonly string[];
  /** A question back is answered, not talked about: it never stays. */
  readonly answeredOnce: boolean;
};

const KIND_WORDS: Readonly<
  Partial<Record<QTurnObjectBlock["kind"], readonly string[]>>
> = {
  ANSWER_CARDS: ["cards", "card", "list", "shortlist", "these companies"],
  COMPARISON: ["comparison", "side by side", "compare"],
  COMPARISON_CARDS: ["comparison", "side by side", "compare"],
  TABLE: ["table", "grid", "side by side", "columns", "rows"],
  CHART: ["chart", "graph", "bars"],
  MAP: ["map", "where they are", "where they re", "based"],
  TIMELINE: ["timeline", "history", "dates"],
  SUMMARY: ["summary", "recap", "key points", "main points"],
  ARTIFACT_REFERENCE: [
    "brief",
    "document",
    "memo",
    "report",
    "file",
    "pdf",
    "draft",
  ],
};

/** Ordinary words that are not anybody's name, so not a reference. */
const NOT_A_NAME = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "their",
  "side by side",
  "companies",
  "company",
  "investors",
  "investor",
]);

type SubjectLike =
  | {
      readonly kind: string;
      readonly companyId?: string | undefined;
      readonly investorOrganisationId?: string | undefined;
    }
  | null
  | undefined;

function subjectId(subject: SubjectLike): string | null {
  if (subject === null || subject === undefined) return null;
  if (subject.kind === "COMPANY" && typeof subject.companyId === "string") {
    return subject.companyId.toLowerCase();
  }
  if (
    subject.kind === "INVESTOR_ORGANISATION" &&
    typeof subject.investorOrganisationId === "string"
  ) {
    return subject.investorOrganisationId.toLowerCase();
  }
  return null;
}

/** An object's subject, from its own blocks (the server's words). */
export function subjectOf(item: Pick<ShownItem, "blocks">): ItemSubject {
  const ids = new Set<string>();
  const names: string[] = [];
  const kindWords: string[] = [];
  let onlyQuestions = true;
  const name = (value: string | null | undefined) => {
    if (value === null || value === undefined) return;
    const key = folded(value);
    if (key.length >= 3 && !NOT_A_NAME.has(key) && !names.includes(key)) {
      names.push(key);
    }
  };
  const id = (value: SubjectLike) => {
    const one = subjectId(value);
    if (one !== null) ids.add(one);
  };
  for (const block of item.blocks) {
    if (block.kind !== "CLARIFICATION_REQUEST") onlyQuestions = false;
    for (const word of KIND_WORDS[block.kind] ?? []) {
      if (!kindWords.includes(word)) kindWords.push(word);
    }
    switch (block.kind) {
      case "ANSWER_CARDS":
        for (const card of block.cards) {
          name(card.name);
          id(card.subject);
        }
        break;
      case "COMPARISON":
        for (const subject of block.subjects) id(subject);
        break;
      case "COMPARISON_CARDS":
        for (const one of block.items) name(one.name);
        break;
      case "TABLE":
        for (const column of block.columns) {
          name(column.label);
          id(column.subject);
        }
        break;
      case "MAP":
        for (const place of block.places) {
          name(place.label);
          id(place.subject);
        }
        break;
      case "TIMELINE":
        for (const event of block.events) id(event.subject);
        break;
      case "CHART":
        for (const series of block.series) name(series.label);
        break;
      case "ARTIFACT_REFERENCE":
        name(block.title);
        break;
      case "CLARIFICATION_REQUEST":
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "ACTION_PROPOSAL":
      case "UI_INTENT":
      case "ATTENTION":
      case "PICTURE": // names no subject to point back at
        break;
      case "SUMMARY":
        // Its points are the answer's words: it is talked about as "the
        // summary", not by a name.
        break;
    }
  }
  return { ids, names, kindWords, answeredOnce: onlyQuestions };
}

/**
 * Words in a person's question that point back at what is on screen:
 * "them", "their", "those", "it", "the second one", "all three". Only
 * the person's words are read this way -- Q's own prose uses pronouns
 * about anything -- and only to keep an object, never to show one.
 */
const POINTS_BACK =
  /\b(?:them|they|their|theirs|those|these|it|its|this one|that one|both|each of|all (?:three|four|five)|the (?:two|three|four|five)|the (?:first|second|third|fourth|fifth|last)|number (?:one|two|three|four|five|\d))\b/u;

/** True when this answer (or the question it answers) is about the object. */
export function refersTo(
  subject: ItemSubject,
  answer: Extract<QTurn, { kind: "Q" }>,
  question: string | undefined,
): boolean {
  if (subject.answeredOnce) return false;
  // Structured first: the run's own authorised subject references.
  for (const block of answer.blocks) {
    const one =
      block.kind === "COMPANY_REFERENCE"
        ? block.companyId.toLowerCase()
        : block.kind === "INVESTOR_REFERENCE"
          ? block.investorOrganisationId.toLowerCase()
          : null;
    if (one !== null && subject.ids.has(one)) return true;
  }
  const said = ` ${folded(answer.text)} `;
  const asked = question === undefined ? " " : ` ${folded(question)} `;
  for (const name of subject.names) {
    if (said.includes(` ${name} `) || asked.includes(` ${name} `)) return true;
  }
  if (question === undefined) return false;
  for (const word of subject.kindWords) {
    if (asked.includes(` ${word} `)) return true;
  }
  return POINTS_BACK.test(asked);
}

// --------------------------------------------------------------- stage --

/** A settled answer, with the person's words it answered. */
type SettledAnswer = {
  readonly run: string;
  readonly turn: Extract<QTurn, { kind: "Q" }>;
  readonly question: string | undefined;
};

function settledAnswers(turns: readonly QTurn[]): readonly SettledAnswer[] {
  const out: SettledAnswer[] = [];
  let question: string | undefined;
  let asked = false;
  for (const turn of turns) {
    if (turn.kind === "PERSON") {
      question = turn.text;
      asked = true;
      continue;
    }
    // An answer still arriving decides nothing: the stage holds still.
    if (turn.streaming) continue;
    const run = resultKey(turn);
    // The same run again (room feed, read-back) is the same answer.
    if (out.some((one) => one.run === run)) continue;
    out.push({ run, turn, question: asked ? question : undefined });
    asked = false;
  }
  return out;
}

type CardsBlock = Extract<QTurnObjectBlock, { kind: "ANSWER_CARDS" }>;

/** An object that is cards only (no table, map, or document beside them). */
function onlyCardsOf(item: ShownItem): CardsBlock | null {
  const [block, ...rest] = item.blocks;
  return block?.kind === "ANSWER_CARDS" && rest.length === 0 ? block : null;
}

/**
 * Fewer cards, every one already in the set on screen (by key, record or
 * name): a follow-up about part of what is shown, not a new display.
 */
function isPartOf(cards: CardsBlock, shown: ShownItem): boolean {
  const there = shown.blocks.find(
    (block): block is CardsBlock => block.kind === "ANSWER_CARDS",
  );
  if (there === undefined || cards.cards.length === 0) return false;
  if (cards.cards.length >= there.cards.length) return false;
  const sameCard = (
    a: CardsBlock["cards"][number],
    b: CardsBlock["cards"][number],
  ) => {
    if (a.key === b.key) return true;
    const ida = subjectId(a.subject);
    if (ida !== null && ida === subjectId(b.subject)) return true;
    return folded(a.name) === folded(b.name);
  };
  return cards.cards.every((card) =>
    there.cards.some((other) => sameCard(card, other)),
  );
}

/** "Shown recently" brought `run` back after the answer `after` (null: before any). */
export type StageReopened = {
  readonly run: string;
  readonly after: string | null;
};

export type StagePick = {
  /** The object on the stage, or none. */
  readonly item: ShownItem | null;
  /**
   * SHOWN: the latest answer showed it. KEPT: the conversation is still
   * on it. REOPENED: the person brought it back. CARRIED: nothing has
   * been answered here yet, so the last set shown stays (INC-1). NONE:
   * nothing to show, or the conversation moved on.
   */
  readonly why: "SHOWN" | "KEPT" | "REOPENED" | "CARRIED" | "NONE";
};

/** The run of the latest settled answer, for a reopening's place in time. */
export function latestAnswerRun(turns: readonly QTurn[]): string | null {
  return settledAnswers(turns).at(-1)?.run ?? null;
}

/**
 * What is over the presence now, from the turns and the person's own
 * "show again" (the presentation controller keeps that, not the page).
 * Pure and deterministic: the same turns pick the same object.
 */
export function stageOf(
  items: readonly ShownItem[],
  turns: readonly QTurn[],
  reopened: StageReopened | null = null,
): StagePick {
  const answers = settledAnswers(turns);
  // Where the reopening sits: after its answer, in this conversation only.
  const reopenedAt =
    reopened === null
      ? -1
      : reopened.after === null
        ? 0
        : answers.findIndex((one) => one.run === reopened.after) + 1;
  const reopenedItem =
    reopened === null || (reopened.after !== null && reopenedAt === 0)
      ? undefined
      : items.find((item) => item.run === reopened.run);
  // From the latest answer back. An answer nobody asked for (a greeting,
  // an arrival replayed after a voice reconnect) moves nothing on by
  // itself (INC-1); an answer to a question that is about none of these
  // objects does.
  for (let at = answers.length - 1; at >= 0; at -= 1) {
    if (reopenedItem !== undefined && reopenedAt === at + 1) {
      return { item: reopenedItem, why: "REOPENED" };
    }
    const one = answers[at];
    if (one === undefined) break;
    const own = items.find((item) => item.run === one.run);
    if (own !== undefined) {
      // Owner 2026-10-17: "what was the second one?" answered with that
      // one card keeps the set on screen (its card is spotlit by what was
      // said), rather than replacing three cards with one.
      const ownCards = onlyCardsOf(own);
      if (ownCards !== null) {
        const earlier = stageOf(
          items.filter((item) => item.run !== own.run),
          turns.slice(0, turns.indexOf(one.turn)),
          reopened,
        );
        if (earlier.item !== null && isPartOf(ownCards, earlier.item)) {
          return { item: earlier.item, why: "KEPT" };
        }
      }
      return { item: own, why: "SHOWN" };
    }
    // Owner 2026-10-17: an answer that opens a room card is the most
    // recent display; older cards leave the stage rather than sit over it.
    if (roomShowOf(one.turn, one.question ?? null) !== undefined) {
      return { item: null, why: "NONE" };
    }
    // The one the person reopened first, then newest first: the most
    // recent object the conversation is on.
    const ordered = [...items].reverse();
    if (reopenedItem !== undefined) ordered.unshift(reopenedItem);
    for (const item of ordered) {
      if (refersTo(subjectOf(item), one.turn, one.question)) {
        return { item, why: "KEPT" };
      }
    }
    if (one.question !== undefined) return { item: null, why: "NONE" };
  }
  if (reopenedItem !== undefined && reopenedAt === 0) {
    return { item: reopenedItem, why: "REOPENED" };
  }
  const carried = items.at(-1);
  return carried === undefined
    ? { item: null, why: "NONE" }
    : { item: carried, why: "CARRIED" };
}

export type StageNote = {
  /** The latest answer's id: the note belongs to that moment. */
  readonly id: string;
  readonly text: string;
  /** The object that left, for "Show again". */
  readonly item: ShownItem;
};

/**
 * What changed on the stage with the latest answer, said in words: an
 * object never leaves silently. Null when nothing left, when the person
 * brought something back themselves, or when the one that left was put
 * away by the person (they know).
 */
export function stageNoteOf(
  items: readonly ShownItem[],
  turns: readonly QTurn[],
  now: StagePick,
  isHidden: (item: ShownItem) => boolean,
): StageNote | null {
  if (now.why === "REOPENED" || now.why === "CARRIED") return null;
  const latest = settledAnswers(turns).at(-1);
  if (latest === undefined) return null;
  // The stage as it was just before the latest answer, by the same rule.
  const before = turns.slice(0, turns.indexOf(latest.turn));
  const earlier = items.filter((item) => item.run !== latest.run);
  const then = stageOf(earlier, before);
  if (then.item === null || then.item.run === now.item?.run) return null;
  // Owner 2026-10-17: cards replacing cards (a table a table, ...) is the
  // person seeing the new answer, not news: no banner over it. The old one
  // stays in "Shown recently".
  if (
    now.item !== null &&
    now.item.blocks[0]?.kind === then.item.blocks[0]?.kind
  ) {
    return null;
  }
  if (isHidden(then.item)) return null;
  // A question back that was answered goes without a note.
  if (subjectOf(then.item).answeredOnce) return null;
  const title = then.item.title;
  return {
    id: latest.turn.id,
    text:
      now.item === null
        ? `Put “${title}” away as we moved on.`
        : `Replaced “${title}” with “${now.item.title}”.`,
    item: then.item,
  };
}

/** The side list: the latest objects, newest first. */
export function shownRecently(
  items: readonly ShownItem[],
): readonly ShownItem[] {
  return items.slice(-SHOWN_RECENTLY_MAX).reverse();
}

// ------------------------------------------------------------ live --

type LivePreviewOf = NonNullable<Extract<QTurn, { kind: "Q" }>["preview"]>;

/**
 * Artifacts live (owner 2026-10-20): what is put up while Q is still
 * talking. The answer still arriving names subjects (the stream's
 * preview); their cards go up as they are named, over whatever was there,
 * unless every one of them is already on the stage (Q talking about the
 * second card of the set on screen keeps the set, and its card is
 * spotlit as before).
 *
 * Only the latest turn, only while it streams: a settled answer's blocks
 * decide, through `stageOf`, and the preview is gone.
 */
export function livePreviewOf(
  turns: readonly QTurn[],
  shown: Pick<ShownItem, "blocks"> | null,
  /**
   * L-16: on a voice line the answer does not stream into the thread; its
   * preview comes through the room feed instead, while Q says it.
   */
  spoken?: LivePreviewOf | null,
): LivePreviewOf | null {
  const latest = turns.at(-1);
  const latestQ = latest?.kind === "Q" ? latest : undefined;
  const preview =
    latestQ?.streaming === true
      ? latestQ.preview
      : spoken !== null &&
          spoken !== undefined &&
          !turns.some((turn) => turn.id === spoken.messageId)
        ? // Still being said: the room's preview is what is up.
          spoken
        : latestQ !== undefined && latestQ.blocks.length === 0
          ? // Owner 2026-10-23: the answer landed with no cards of its
            // own, so the cards put up while Q talked stay; they no
            // longer clear as it lands. An answer with cards of its own
            // decides by its blocks, as before.
            (latestQ.preview ??
            (spoken?.messageId === latestQ.id ? spoken : undefined))
          : undefined;
  if (preview === undefined) return null;
  // A summary the person asked for is its own object: its frame goes up
  // even before it names anyone, and over whatever was there.
  if (preview.layout === "SUMMARY") return preview;
  if (preview.subjects.length === 0) return null;
  if (shown !== null) {
    const there = subjectOf(shown);
    const covered = preview.subjects.every((one) => {
      const id = subjectId(one.subject);
      return (
        (id !== null && there.ids.has(id)) ||
        there.names.includes(folded(one.name))
      );
    });
    if (covered) return null;
  }
  return preview;
}
