import type { QTurn, QTurnObjectBlock } from "./conversation";
import { splitSentences } from "@capital-q/q-core/speech";

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

/**
 * A decision this tab made on a change Q prepared (CQ-Q-008): what the
 * thread acts on the moment it is made, and what the Board reads so its
 * entry says the same (live run 2026-10-28: the thread said "Saved."
 * while the Board still said "Waiting for your yes").
 */
export type BoardDecision = {
  readonly approvalId: string;
  readonly decision: "APPROVED" | "DECLINED";
  readonly at: string;
};

export type BoardOutcome = {
  readonly status: "APPROVED" | "DECLINED" | "EXPIRED" | "WITHDRAWN";
  /** When it was decided, where known. */
  readonly at: string | undefined;
};

export type BoardEntry = {
  /** The answer's id: also its key for pinning and dismissing. */
  readonly id: string;
  readonly at: string | undefined;
  readonly title: string;
  readonly kind: string;
  /** For a change Q prepared: how it was decided, null while it waits. */
  readonly outcome: BoardOutcome | null;
  readonly minis: readonly BoardMini[];
  /** Q's words about it, the first sentence or two. */
  readonly said: string | null;
  readonly sources: readonly BoardSource[];
  /** How many sources in all (a line may stand for several records). */
  readonly sourceTotal: number;
  readonly files: readonly BoardFile[];
  readonly blocks: readonly QTurnObjectBlock[];
};

const KEPT: ReadonlySet<QTurnObjectBlock["kind"]> = new Set([
  "ANSWER_CARDS",
  "COMPARISON",
  "COMPARISON_CARDS",
  "ARTIFACT_REFERENCE",
  "ACTION_PROPOSAL",
  // Live e11: the plan card is on the Board (S5), but it was never kept
  // here, so the header read "Board 0" beside a plan with 19 tasks.
  "PLAN",
]);

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

const OUTCOME_WORDS: Readonly<Record<BoardOutcome["status"], string>> = {
  APPROVED: "Approved",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  WITHDRAWN: "Withdrawn",
};

/**
 * How a prepared change was decided: from the proposal's own approval
 * record where the read-back carries it, else from a decision made in
 * this tab; null while it still waits on the person.
 */
export function proposalOutcome(
  blocks: readonly QTurnObjectBlock[],
  decisions: readonly BoardDecision[],
): BoardOutcome | null {
  for (const block of blocks) {
    if (block.kind !== "ACTION_PROPOSAL") continue;
    const { proposal } = block;
    const approval = proposal.approval.required
      ? proposal.approval.approval
      : undefined;
    if (approval !== undefined) {
      const decided = decisions.find(
        (one) => one.approvalId === approval.approvalId,
      );
      if (decided !== undefined) {
        return { status: decided.decision, at: decided.at };
      }
      if (approval.status === "APPROVED") {
        return { status: "APPROVED", at: undefined };
      }
      if (approval.status === "REJECTED") {
        return { status: "DECLINED", at: undefined };
      }
    }
    if (proposal.status === "EXPIRED")
      return { status: "EXPIRED", at: undefined };
    if (proposal.status === "WITHDRAWN") {
      return { status: "WITHDRAWN", at: undefined };
    }
    return null;
  }
  return null;
}

function kindOf(
  blocks: readonly QTurnObjectBlock[],
  outcome: BoardOutcome | null,
): string {
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
        return outcome === null
          ? "Waiting for your yes"
          : OUTCOME_WORDS[outcome.status];
      case "ARTIFACT_REFERENCE":
        return "File Q made for you";
      case "WORK_IN_PROGRESS":
        return "Work Q is doing for you";
      case "PLAN":
        return "A plan Q wrote for you";
      case "TABLE":
      case "CHART":
      case "MAP":
      case "TIMELINE":
      case "ATTENTION":
      case "SUMMARY":
      case "PICTURE":
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "CLARIFICATION_REQUEST":
      case "UI_INTENT":
        break;
      case "SCHEDULE":
        return "Your schedule";
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
    if (block.kind === "PLAN") return cutAtWord(block.title, 120);
  }
  return cutAtWord(question?.trim() ?? "", 120) || "Shown by Q";
}

/** At most `max` characters, cut at a word, never mid-word (live 2026-10-28). */
export function cutAtWord(text: string, max: number): string {
  const plain = text.replace(/\s+/gu, " ").trim();
  if (plain.length <= max) return plain;
  const head = plain.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
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
  // Real sentence ends only, so "8.8/10" is never cut after "8." (D9).
  const sentences = splitSentences(plain);
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

export function boardTimeline(
  turns: readonly QTurn[],
  decisions: readonly BoardDecision[] = [],
): BoardEntry[] {
  const entries: BoardEntry[] = [];
  // INC-1: one run, one Board entry, as first filed; a later copy of the
  // same run (room feed, read-back) never adds or merges a second.
  const runs = new Set<string>();
  let question: string | undefined;
  for (const turn of turns) {
    if (turn.kind === "PERSON") {
      question = turn.text;
      continue;
    }
    if (turn.streaming) continue;
    let cards = false;
    const blocks = turn.blocks.filter((block) => {
      if (!KEPT.has(block.kind)) return false;
      if (block.kind !== "ANSWER_CARDS") return true;
      if (cards) return false;
      cards = true;
      return true;
    });
    if (blocks.length === 0) continue;
    const run = turn.runId ?? turn.id;
    if (runs.has(run)) continue;
    runs.add(run);
    const outcome = proposalOutcome(blocks, decisions);
    entries.push({
      id: turn.id,
      at: turn.at,
      title: titleOf(blocks, question),
      kind: kindOf(blocks, outcome),
      outcome,
      minis: minisOf(blocks),
      said: firstWords(turn.text),
      sources: sourcesOf(turn),
      sourceTotal: turn.publicSources.length + Math.max(0, turn.sourceCount),
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

/**
 * C4: what the Board holds, less the answer still on the stage; it counts
 * up as an answer flies into it. F-37 (QA 2026-10-23: it stayed 0 after a
 * report was made): only a Board entry that is itself on the stage is held
 * back (a table or a map on the stage is not on the Board at all), and a
 * document Q made is filed at once.
 */
export function boardCountOf(
  entries: readonly Pick<BoardEntry, "id" | "files">[],
  dismissed: readonly string[],
  stageObject: string | null,
): number {
  return entries.filter(
    (entry) =>
      !dismissed.includes(entry.id) &&
      (entry.id !== stageObject || entry.files.length > 0),
  ).length;
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
