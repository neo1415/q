import type { QTurn, QTurnObjectBlock } from "./conversation";
import { plainFromMarkdown } from "./markdown";

/**
 * The Board as a timeline of what Q showed (C7; mockup board.html).
 *
 * One entry per answer that showed something to keep (cards, a
 * comparison, a file, something waiting for a decision), newest first,
 * grouped by day. Plain prose answers stay in the conversation. Each
 * entry says in plain words what it is and where it came from; sources
 * are folded under one line, never listed as references.
 */

export type BoardMini = {
  readonly name: string;
  readonly hue: number;
  /** The fit, one decimal, when the card had one. */
  readonly score: string | null;
};

export type BoardSource = {
  /** web: a public page; record: something on Capital Q. */
  readonly kind: "web" | "record";
  readonly title: string;
  readonly detail: string;
};

export type BoardFile = {
  readonly artifactId: string;
  readonly title: string;
  readonly detail: string;
};

export type BoardEntry = {
  /** The answer's id: also its key for pinning and dismissing. */
  readonly id: string;
  readonly at: string | undefined;
  readonly title: string;
  readonly kind: string;
  readonly minis: readonly BoardMini[];
  /** Q's words about it, the first sentence or two. */
  readonly said: string | null;
  readonly sources: readonly BoardSource[];
  readonly files: readonly BoardFile[];
  readonly blocks: readonly QTurnObjectBlock[];
};

const KEPT: ReadonlySet<QTurnObjectBlock["kind"]> = new Set([
  "ANSWER_CARDS",
  "COMPARISON",
  "COMPARISON_CARDS",
  "ARTIFACT_REFERENCE",
  "ACTION_PROPOSAL",
]);

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function kindOf(blocks: readonly QTurnObjectBlock[]): string {
  for (const block of blocks) {
    switch (block.kind) {
      case "ANSWER_CARDS": {
        const n = block.cards.length;
        if (block.shape === "RESEARCH")
          return `Research, ${count(n, "part", "parts")}`;
        if (block.shape === "SIDE_BY_SIDE")
          return `Comparison of ${count(n, "thing", "things")}`;
        return `Ranked answer, ${count(n, "result", "results")}`;
      }
      case "COMPARISON_CARDS":
        return `Comparison of ${count(block.items.length, "thing", "things")}`;
      case "COMPARISON":
        return `Comparison of ${count(block.subjects.length, "thing", "things")}`;
      case "ACTION_PROPOSAL":
        return "Waiting for your yes";
      case "ARTIFACT_REFERENCE":
        return "File Q made for you";
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "CLARIFICATION_REQUEST":
      case "UI_INTENT":
        break;
    }
  }
  return "Shown by Q";
}

function titleOf(
  blocks: readonly QTurnObjectBlock[],
  question: string | undefined,
): string {
  for (const block of blocks) {
    if (block.kind === "ANSWER_CARDS") return block.title;
    if (block.kind === "COMPARISON_CARDS" && block.title !== null)
      return block.title;
    if (block.kind === "ARTIFACT_REFERENCE") return block.title;
  }
  return question?.trim().slice(0, 120) || "Shown by Q";
}

function minisOf(blocks: readonly QTurnObjectBlock[]): BoardMini[] {
  for (const block of blocks) {
    if (block.kind === "ANSWER_CARDS") {
      return block.cards.map((card) => ({
        name: card.name,
        hue: card.hue,
        score: card.fit === null ? null : card.fit.score.toFixed(1),
      }));
    }
    if (block.kind === "COMPARISON_CARDS") {
      return block.items.map((item, at) => ({
        name: item.name,
        hue: (at % 7) + 1,
        score: null,
      }));
    }
  }
  return [];
}

/** The first one or two sentences of what Q said, as plain words. */
export function firstWords(text: string, max = 180): string | null {
  const plain = plainFromMarkdown(text).replace(/\s+/gu, " ").trim();
  if (plain.length === 0) return null;
  const sentences = plain.match(/[^.!?]+[.!?]+/gu) ?? [plain];
  let out = "";
  for (const sentence of sentences) {
    if (out.length > 0 && out.length + sentence.length > max) break;
    out += sentence;
    if (out.length >= max) break;
  }
  const trimmed = out.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}…`
    : trimmed;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function sourcesOf(turn: Extract<QTurn, { kind: "Q" }>): BoardSource[] {
  const sources: BoardSource[] = turn.publicSources.map((source) => ({
    kind: "web",
    title: source.title,
    detail: `Public page on ${source.domain}, read ${day(source.retrievedOn)}.`,
  }));
  const onRecord = Math.max(0, turn.sourceCount);
  if (onRecord > 0) {
    sources.push({
      kind: "record",
      title: count(onRecord, "record on Capital Q", "records on Capital Q"),
      detail: "What you and the companies shared, as recorded here.",
    });
  }
  return sources;
}

export function boardTimeline(turns: readonly QTurn[]): BoardEntry[] {
  const entries: BoardEntry[] = [];
  let question: string | undefined;
  for (const turn of turns) {
    if (turn.kind === "PERSON") {
      question = turn.text;
      continue;
    }
    if (turn.streaming) continue;
    const blocks = turn.blocks.filter((block) => KEPT.has(block.kind));
    if (blocks.length === 0) continue;
    entries.push({
      id: turn.id,
      at: turn.at,
      title: titleOf(blocks, question),
      kind: kindOf(blocks),
      minis: minisOf(blocks),
      said: firstWords(turn.text),
      sources: sourcesOf(turn),
      files: blocks.flatMap((block) =>
        block.kind === "ARTIFACT_REFERENCE"
          ? [
              {
                artifactId: block.artifactId,
                title: block.title,
                detail: "Made by Q because you asked",
              },
            ]
          : [],
      ),
      blocks,
    });
  }
  return entries.reverse();
}

/** "Today", "Yesterday" or the date, for grouping the timeline. */
export function dayLabel(
  iso: string | undefined,
  now: Date = new Date(),
): string {
  if (iso === undefined) return "Today";
  const at = new Date(iso);
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function timeLabel(iso: string | undefined): string {
  if (iso === undefined) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function groupByDay(
  entries: readonly BoardEntry[],
  now: Date = new Date(),
): readonly {
  readonly day: string;
  readonly entries: readonly BoardEntry[];
}[] {
  const groups: { day: string; entries: BoardEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at, now);
    const last = groups.at(-1);
    if (last !== undefined && last.day === label) last.entries.push(entry);
    else groups.push({ day: label, entries: [entry] });
  }
  return groups;
}
