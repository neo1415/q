// W3-B (audit finding 4): moved unchanged out of answer.ts, which
// re-exports what it exported. Here: the work board: what a turn asks of it and how it is read out.
import { type QResultBlock } from "@capital-q/contracts";
import { createHash } from "node:crypto";

/** A job id the board port returned, checked before it is stored on a block. */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * How each of Q's own board replies opens: a later "break it into tasks"
 * or "work on those" is about the work before it, never about Q's own
 * confirmation (QA 2026-10-24: the breakdown split "Q's answer: Save that
 * plan to my board").
 */
const BOARD_REPLY_OPENERS = [
  "I've filed that",
  "I filed it as a document",
  "I've put “",
  "I've added “",
  "I've started on “",
  "Here's your board.",
  "Your board is ",
  "I couldn't add",
  "I couldn't read your board",
  "That work is still under way",
] as const;

export function isBoardReply(content: string): boolean {
  const said = content.trimStart();
  return BOARD_REPLY_OPENERS.some((opener) => said.startsWith(opener));
}

/**
 * Q's answer that produced nothing to keep: a refusal or failure line
 * ("I couldn't plan this just now… nothing has started"). F-78b (live
 * 18d7884c4): saved anyway, it became a "12-month plan" item from
 * nothing. These are Q's own fixed openings, never the person's words.
 */
export function producedNothing(content: string): boolean {
  const said = content.trimStart();
  // An answer that opens with a caveat and then carries the work (a list,
  // or a long body) is still the work.
  if (said.length > 700 || answerSteps(said).length > 0) return false;
  return (
    /^(?:I couldn't|I can't|I wasn't able|Sorry, I couldn't|Something failed)\b/u.test(
      said,
    ) ||
    /^(?:Work like this|Something like this) is already waiting\b/u.test(
      said,
    ) ||
    /^Taking on work like this isn't available\b/u.test(said) ||
    /^I've reached the limit of work\b/u.test(said) ||
    /\bnothing has started\b/u.test(said.slice(0, 240))
  );
}

/** Q's own line when deep work starts (team-job startedLine). */
export function startsTeamJob(content: string): boolean {
  return /^On it[.,] [Ss]tarting now\b/u.test(content.trimStart());
}

/** Words in "the first open task" that describe nothing. */
const BOARD_FILLER = new Set([
  "open",
  "next",
  "main",
  "board",
  "todo",
  "to-do",
]);

const ORDINALS: Readonly<Record<string, number>> = {
  first: 0,
  "1st": 0,
  second: 1,
  "2nd": 1,
  third: 2,
  "3rd": 2,
  fourth: 3,
  "4th": 3,
  fifth: 4,
  "5th": 4,
};

/**
 * Which of their board's open items "work on …" means, from the board
 * itself: "the first task" by its place in To do, a title they say, or
 * "those" / "them" / "all of them" for the items Q added last. Empty:
 * not read here; the board tool reads it.
 */
export function boardItemsMeant(
  words: string,
  items: readonly {
    readonly id?: string;
    readonly kind?: string;
    readonly title: string;
    readonly status: string;
    readonly createdBy?: string;
    readonly createdAt?: string;
  }[],
): string[] {
  const said = words.toLowerCase();
  // Live 18d7884c4: "the first task" took the first open item, a saved
  // document, which no plan can work on. A task asked for is a task.
  const wantsTasks = /\btasks?\b|\bto-?dos?\b/u.test(said);
  const open = items.filter(
    (item): item is typeof item & { readonly id: string } =>
      item.id !== undefined &&
      item.status === "TODO" &&
      (!wantsTasks || item.kind === undefined || item.kind === "TASK"),
  );
  if (open.length === 0) return [];
  const ordered =
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\b((?:\s+[\p{L}\d-]+){0,4}?)\s+(?:task|to-?do|item|one)s?\b/u.exec(
      said,
    ) ??
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\b/u.exec(
      said,
    );
  const ordinal = ordered?.[1];
  if (ordinal !== undefined) {
    // F-79: "the first logistics task" is the first task about logistics,
    // never simply the first; none about it is not read here.
    const described = (ordered?.[2] ?? "")
      .split(/\s+/u)
      .filter((word) => word.length >= 4 && !BOARD_FILLER.has(word));
    const pool =
      described.length === 0
        ? open
        : open.filter((item) => {
            const title = item.title.toLowerCase();
            return described.every((word) =>
              title.includes(word.slice(0, Math.max(4, word.length - 2))),
            );
          });
    const at = ordinal === "last" ? pool.length - 1 : (ORDINALS[ordinal] ?? -1);
    const item = pool[at];
    return item === undefined ? [] : [item.id];
  }
  const named = open.filter(
    (item) => item.title.length >= 4 && said.includes(item.title.toLowerCase()),
  );
  if (named.length > 0) return named.slice(0, 5).map((item) => item.id);
  if (
    !/\b(those|these|them|all|everything|the tasks|the items)\b/u.test(said)
  ) {
    return [];
  }
  // The batch Q added last: within two minutes of the newest of its items.
  const byQ = open.filter(
    (item) => item.createdBy === "Q" && item.createdAt !== undefined,
  );
  const newest = Math.max(
    ...byQ.map((item) => Date.parse(item.createdAt ?? "")),
  );
  if (!Number.isFinite(newest)) return [];
  return byQ
    .filter((item) => newest - Date.parse(item.createdAt ?? "") <= 120_000)
    .slice(0, 5)
    .map((item) => item.id);
}

/** At most this many tasks from one answer. */
const BOARD_TASKS_MAX = 12;

/**
 * The steps an answer itself lists, in its words: its numbered or bulleted
 * lines, without their markers or emphasis. Nothing is invented: an answer
 * with no list has no steps (owner 2026-10-23, "break it into tasks").
 */
export function answerSteps(answer: string): string[] {
  const steps: string[] = [];
  for (const line of answer.split(/\r?\n/u)) {
    const item = /^\s{0,6}(?:[-*\u2022]|\d{1,2}[.)])\s+(.+)$/u.exec(line);
    const text = (item?.[1] ?? "")
      .replace(/\*\*|__|`/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (text.length < 3) continue;
    steps.push(text.length > 300 ? `${text.slice(0, 297)}...` : text);
    if (steps.length === BOARD_TASKS_MAX) break;
  }
  return steps;
}

/** At most this many items of a column are read out. */
const BOARD_READ_MAX = 8;

const BOARD_COLUMNS = [
  ["TODO", "To do"],
  ["DOING", "Doing"],
  ["DONE", "Done"],
] as const;

/** "What's on my board?", answered from the board itself, by column. */
export function boardReadOut(
  items: readonly { readonly title: string; readonly status: string }[],
): string {
  if (items.length === 0) {
    return "Your board is empty. Ask me to save a plan or an answer to it, or to add a task, and it'll be there.";
  }
  const lines = BOARD_COLUMNS.flatMap(([status, label]) => {
    const column = items.filter((item) => item.status === status);
    if (column.length === 0) return [];
    const shown = column.slice(0, BOARD_READ_MAX).map((item) => item.title);
    const more =
      column.length > shown.length
        ? `; and ${String(column.length - shown.length)} more`
        : "";
    return [
      `**${label}** (${String(column.length)}): ${shown.join("; ")}${more}.`,
    ];
  });
  return `Here's your board.\n\n${lines.join("\n\n")}`;
}

/**
 * A title they dictated ('add "Prep IC memo for Mizan" to my board'): a
 * new item in their words, never Q's last answer.
 */
export function dictatesItem(words: string): boolean {
  return /["“”'‘’«»][^"“”'‘’«»]{3,}["“”'‘’«»]/u.test(words);
}

/**
 * The new item's title in their own words (reader v62 boardAsk ADD,
 * F-72): what they put in quotes, else what sits between "add" and "to my
 * board". Null when neither is there: the board tool reads it then.
 */
export function boardItemFromWords(words: string): string | null {
  const quoted = /["“'‘«]([^"“”'‘’«»]{3,300})["”'’»]/u.exec(words)?.[1];
  const said =
    quoted ??
    /^\s*(?:please\s+)?(?:add|put|pin|stick|create)\s+(?:a\s+(?:task|to-?do|card)\s+(?:to\s+|for\s+)?)?(.{3,300}?)\s+(?:to|on|onto|in)\s+(?:my\s+)?(?:work\s+)?(?:board|to-?dos?|to-?do list)\b/iu.exec(
      words,
    )?.[1];
  const title = said
    ?.replace(/\s+/gu, " ")
    .replace(/[.,;:!?]+$/u, "")
    .trim();
  return title === undefined || title.length < 3 ? null : title;
}

/**
 * The proper name an ask is about, as they wrote it: "a call with Savanna
 * Seed Partners" -> "Savanna Seed Partners". Used only beside the one
 * record Q's answer referenced; null when the ask names none.
 */
export function nameInAsk(question: string): string | null {
  const found =
    /\b(?:with|for|about|meet(?:ing)?|call)\s+((?:\p{Lu}[\p{L}\d&'.-]*)(?:\s+(?:\p{Lu}[\p{L}\d&'.-]*|of|and|&))*)/u.exec(
      question,
    )?.[1];
  const name = found?.replace(/\s+(?:of|and|&)$/u, "").trim();
  return name === undefined || (name.match(/\p{L}/gu)?.length ?? 0) < 3
    ? null
    : name;
}

/**
 * F-95 (live 24 Oct 2026, "Write me an IC memo on Ledgerfold"): who a piece
 * of work is about, named right after the kind of work in the ask ("memo
 * on Ledgerfold", "plan for Maji Loop"). Null when the ask names no one.
 */
export function workSubjectInAsk(question: string): string | null {
  const found =
    /\b(?:memo|plan|analysis|brief|summary|prep|report|questions|deck|one-pager)\s+(?:on|about|for|of)\s+((?:\p{Lu}[\p{L}\d&'.-]*)(?:\s+(?:\p{Lu}[\p{L}\d&'.-]*|of|and|&))*)/u.exec(
      question,
    )?.[1];
  // "…on Ledgerfold I can share": the pronoun is not part of the name.
  const name = found?.replace(/(?:\s+(?:of|and|&|I))+$/u, "").trim();
  return name === undefined || name.length < 2 ? null : name;
}

/**
 * Their ask without its "…and save it to my board" clause: the work alone,
 * for the planner. The board keeps the job itself (F11).
 */
export function withoutBoardSave(words: string): string {
  const work = words
    .replace(
      /[\s,;]*(?:\band\s+|\bthen\s+|\band\s+then\s+)*(?:please\s+)?(?:save|keep|pin|put|add|file|store)\s+(?:it|that|this|them|the\s+\w+(?:\s+\w+)?)?\s*(?:to|on|onto|in|into)\s+(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?|to-?do\s+list)\b[.!?]*/giu,
      "",
    )
    .trim();
  return work.length === 0 ? words : work;
}

/**
 * Their own work board, by its words: "my board", "my work board", "my
 * to-dos", "mon tableau", "mi tablero". Offering and a guard only: it
 * names the board tool for a turn the reader left without a board ask
 * (live 91d6361f9: "add 'Prep data room' to my board" read as no board
 * ask, so my_board was never offered), and it never decides alone.
 */
export function mentionsOwnBoard(words: string): boolean {
  return /\b(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?|to-?do\s+list)\b|\bmon\s+tableau\b|\bmi\s+tablero\b|\bmeu\s+quadro\b/iu.test(
    words,
  );
}

/**
 * Only asking what is on their own board ("what's on my board?", "show me
 * my work board"): read from the board by code when the reader carries no
 * LIST (before v63). Never the readiness checklist.
 */
export function asksWhatIsOnBoard(words: string): boolean {
  return /^\s*(?:(?:so\s+)?what(?:'s|\s+is|\s+are|\s+do\s+i\s+have)?\b.{0,20}\b(?:on|in)\s+(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?|to-?do\s+list)\b|(?:show|open|read)\s+(?:me\s+)?(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?)\b)[^.!]*\??\s*$/iu.test(
    words,
  );
}

/**
 * "the top company" in an item they dictated, as the list Q just showed
 * names it (F-72: "Prep IC memo for the top company" is Anchor's).
 */
export function resolveTopOne(
  title: string,
  shownFirst: string | null,
): string {
  if (shownFirst === null) return title;
  return title.replace(
    /\bthe (?:top|first|1st) (?:company|one|investor|fund|founder)\b/iu,
    shownFirst,
  );
}

/** A UUID (version 5 layout) for one change Q makes, stable on a retry. */
export function boardKeyOf(runId: string, what: string): string {
  const hex = createHash("sha1").update(`${runId}|board|${what}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export type DocumentReply = {
  readonly content: string;
  readonly blocks?: readonly QResultBlock[] | undefined;
};

/** The proposer's side of a visibility reading; nothing here applies it. */
export type QVisibilityNotebook = {
  readonly noteVisibility: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly companyId: string;
    readonly visibility: "network_visible" | "organisation_private";
  }) => void;
};
