import type { QResultBlock } from "@capital-q/contracts";
import type {
  QConversationFetch,
  QConversationMessage,
} from "@capital-q/q-runtime";

/**
 * What Q already said and showed in this conversation, as structured
 * context (owner live 2026-10-17, conversation 971c5a53).
 *
 * Q named three companies with their cards; "show me the cards again" then
 * opened the person's saved companies, and "so what was the second one?"
 * re-ran the ranking and answered with one card. Every earlier turn of
 * Q's is already durable: its words and the blocks the browser received
 * (cards with their ids, order and figures, findings, records opened),
 * stored on the conversation's own messages and parsed through the public
 * contract on the way in and out. This turns them into one record, T1
 * oldest, that the turn reader and the answer read, so a follow-up is
 * answered by meaning from what was shown rather than by a new lookup.
 *
 * Generic by construction: any block kind is rendered the same way (its
 * own fields, nulls and empties dropped, list items numbered), so a new
 * card kind is covered without a case here, and no words are matched.
 *
 * What a turn fetched but did not render (QConversationFetch: a profile
 * read for a spoken answer, a fit profile behind a sentence) is attached
 * to that turn as `fetched`, after what it showed, so the record holds
 * everything Q had in hand, newest turns kept first.
 *
 * Context Firewall: the history is the run's own conversation, read under
 * the run's tenant (`listRecentForConversationOfRun`), and its blocks are
 * what this person was already shown; the fetched results are the owner's
 * own, already filtered to this run's sensitivity ceiling by their store.
 * Nothing here reads another record, and nothing here widens what any
 * tool may read.
 */

/** How many of Q's most recent turns are kept. */
export const CONTEXT_TURNS_MAX = 8;
const SAID_CHARS = 600;
const STRING_CHARS = 240;
const LIST_ITEMS_MAX = 12;
const TURN_CHARS = 3_200;
/** Within the reader's SHOWN bound (TurnReaderV54VariablesSchema). */
export const CONTEXT_CHARS_MAX = 8_000;

export type ShownTurn = {
  /** 1 is the oldest kept turn of Q's. */
  readonly turn: number;
  readonly messageId: string;
  readonly said: string;
  readonly blocks: readonly QResultBlock[];
  /** What this turn's run fetched (tool and result), in call order. */
  readonly fetched: readonly {
    readonly tool: string;
    readonly arguments: unknown;
    readonly result: unknown;
  }[];
};

export type ConversationContext = {
  readonly turns: readonly ShownTurn[];
  /** The rendered record (empty when Q has said nothing yet). */
  readonly text: string;
};

/**
 * How much of a value is kept. OUTLINE keeps every listed item, in its
 * place, with its own short fields, and drops the lists inside it (a
 * card's measures and reasons): the order and names survive a turn too
 * long to keep whole (guard I-top-five, 2026-10-26: five answer cards
 * were cut after the second, mid-card).
 */
type Keep = { readonly stringChars: number; readonly listDepth: number };
const WHOLE: Keep = { stringChars: STRING_CHARS, listDepth: Infinity };
/** The blocks, and the items a block lists (its cards, rows, findings). */
const OUTLINE: Keep = { stringChars: 80, listDepth: 2 };

/** A value with its nulls, empty strings and empty lists dropped; lists numbered. */
function compact(
  value: unknown,
  depth = 0,
  keep: Keep = WHOLE,
  lists = 0,
): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length === 0) return undefined;
    return text.length > keep.stringChars
      ? `${text.slice(0, keep.stringChars - 1)}…`
      : text;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 6) return undefined;
  if (Array.isArray(value)) {
    if (lists >= keep.listDepth) return undefined;
    const items = value
      .slice(0, LIST_ITEMS_MAX)
      .map((item: unknown, index) => {
        const kept = compact(item, depth + 1, keep, lists + 1);
        // Order is part of what was shown ("the second one"): an object
        // in a list carries its place, 1-based, as the person counts.
        return kept !== null && typeof kept === "object" && !Array.isArray(kept)
          ? { "#": index + 1, ...kept }
          : kept;
      })
      .filter((item) => item !== undefined);
    return items.length === 0 ? undefined : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      const kept = compact(field, depth + 1, keep, lists);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return undefined;
}

function renderTurn(turn: ShownTurn): string {
  const said = turn.said.trim().slice(0, SAID_CHARS);
  const render = (keep: Keep): string => {
    const shown = compact(turn.blocks, 0, keep);
    const fetched = compact(turn.fetched, 0, keep);
    return `T${String(turn.turn)}: said ${JSON.stringify(said)}${
      shown === undefined ? "" : ` | showed ${JSON.stringify(shown)}`
    }${fetched === undefined ? "" : ` | fetched ${JSON.stringify(fetched)}`}`;
  };
  const whole = render(WHOLE);
  if (whole.length <= TURN_CHARS) return whole;
  const line = render(OUTLINE);
  return line.length > TURN_CHARS ? `${line.slice(0, TURN_CHARS - 1)}…` : line;
}

/**
 * Q's recent turns in this conversation, before the person's latest words.
 * Newest turns are kept first when the record is over its bound.
 */
export function conversationContextOf(
  history: readonly QConversationMessage[],
  latestId?: string,
  fetchedInConversation: readonly QConversationFetch[] = [],
): ConversationContext {
  const mine = history.filter(
    (message) => message.role === "Q" && message.id !== latestId,
  );
  // A run's results go with its last message; oldest call first.
  const lastOfRun = new Map<string, string>();
  for (const message of mine) lastOfRun.set(message.runId, message.id);
  const fetchedBy = new Map<string, ShownTurn["fetched"][number][]>();
  const inOrder = [...fetchedInConversation].sort((a, b) =>
    a.fetchedAt.localeCompare(b.fetchedAt),
  );
  for (const fetch of inOrder) {
    const messageId = lastOfRun.get(fetch.runId);
    if (messageId === undefined) continue;
    const list = fetchedBy.get(messageId) ?? [];
    list.push({
      tool: fetch.toolName,
      arguments: fetch.arguments,
      result: fetch.result,
    });
    fetchedBy.set(messageId, list);
  }
  const turns = mine
    .slice(-CONTEXT_TURNS_MAX)
    .map((message, index): ShownTurn => ({
      turn: index + 1,
      messageId: message.id,
      said: message.content,
      blocks: message.blocks ?? [],
      fetched: fetchedBy.get(message.id) ?? [],
    }));
  const lines: string[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    const line = renderTurn(turn);
    if (used + line.length + 1 > CONTEXT_CHARS_MAX) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  return { turns, text: lines.join("\n") };
}

/** The turn a reading pointed at, when it is one of the kept turns. */
export function shownTurnOf(
  context: ConversationContext,
  turn: number,
): ShownTurn | null {
  return context.turns.find((kept) => kept.turn === turn) ?? null;
}

/**
 * Screen intents that only display something, so showing them again
 * decides nothing. Navigation, screen acts, settings and the like are left
 * out: repeating them is a new request, answered the normal way.
 */
const DISPLAY_INTENTS: ReadonlySet<string> = new Set([
  "SHOW_IN_Q_ROOM",
  "SHOW_COMPARISON",
  "SHOW_EVIDENCE",
]);

/**
 * What that turn put on screen, to show again exactly as it was (the same
 * records, in the same order, with the same figures). Empty when it showed
 * nothing that can simply be shown again.
 */
export function reshownBlocks(turn: ShownTurn): readonly QResultBlock[] {
  return turn.blocks.filter(
    (block) =>
      block.kind !== "UI_INTENT" || DISPLAY_INTENTS.has(block.intent.kind),
  );
}
