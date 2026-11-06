"use client";

import { useT } from "@/features/i18n/language";

import type { QTurn } from "./conversation";
import { plainFromMarkdown } from "./markdown";

/**
 * The voice room's words in a conversation (owner 2026-11-06): only the
 * current exchange under Q's pinned presence -- the person's last line and
 * Q's latest reply as a caption, with any cards as one line each. Every
 * line leads to Chat, which holds the whole transcript, cards and lists.
 * One thread: these are the same lines Chat shows, never a copy.
 */

type ExchangeLine = {
  readonly id: string;
  readonly role: "person" | "q";
  readonly text: string;
  readonly turn?: Extract<QTurn, { kind: "Q" }> | undefined;
};

/** At most this many card lines; the rest are one "See all in Chat". */
const CARD_LINES_AT_MOST = 4;

type CardLine = {
  readonly key: string;
  readonly name: string;
  readonly line: string | null;
};

/** The cards an answer laid out, one line each, in the order written. */
export function cardLinesOf(
  turn: Extract<QTurn, { kind: "Q" }> | undefined,
): readonly CardLine[] {
  if (turn === undefined) return [];
  const out: CardLine[] = [];
  for (const block of turn.blocks) {
    if (block.kind === "ANSWER_CARDS") {
      for (const card of block.cards) {
        out.push({
          key: `${turn.id}:${card.key}`,
          name: card.name,
          line: card.line,
        });
      }
    } else if (block.kind === "COMPARISON_CARDS") {
      block.items.forEach((item, index) => {
        out.push({
          key: `${turn.id}:c${String(index)}`,
          name: item.name,
          line: item.subtitle,
        });
      });
    }
  }
  return out;
}

export function QCurrentExchange({
  lines,
  live,
  qSaying,
  captions,
  earlier,
  onOpenChat,
  cardLines = true,
}: {
  /** The person's last line and what Q said after it. */
  readonly lines: readonly ExchangeLine[];
  /** Their words as they are spoken, before the line settles. */
  readonly live: string | null;
  /** On a live line: what Q is saying now, as a caption. */
  readonly qSaying: string | null;
  /** The person's captions setting (always on while a line is open). */
  readonly captions: boolean;
  /** The conversation has more before this exchange. */
  readonly earlier: boolean;
  readonly onOpenChat: () => void;
  /**
   * The answer's cards as one line each. Off where the stage draws them
   * in full under this exchange (owner 2026-11-06: full cards in Q).
   */
  readonly cardLines?: boolean | undefined;
}) {
  const t = useT();
  const person = lines.findLast((line) => line.role === "person");
  const reply = lines.findLast((line) => line.role === "q");
  const said = live ?? person?.text ?? null;
  const caption =
    qSaying !== null && qSaying.length > 0
      ? qSaying
      : reply === undefined
        ? null
        : plainFromMarkdown(reply.text);
  const cards = cardLines ? cardLinesOf(reply?.turn) : [];
  const shown = cards.slice(0, CARD_LINES_AT_MOST);
  const more = cards.length - shown.length;
  return (
    <div
      className="flex w-full max-w-2xl flex-col items-center gap-3 text-center"
      data-q-current-exchange
    >
      {said === null ? null : (
        <p
          className="cq-body m-0 line-clamp-2 text-(--cq-text-secondary)"
          data-q-exchange-person
        >
          <span className="sr-only">{t("You:")} </span>
          {said}
        </p>
      )}
      {captions && caption !== null ? (
        <p
          className="cq-body m-0 line-clamp-3 text-(--cq-text-primary)"
          aria-live="polite"
          data-q-exchange-caption
        >
          <span className="sr-only">Q: </span>
          {caption}
        </p>
      ) : null}
      {shown.length === 0 ? null : (
        <ul
          className="m-0 flex w-full flex-col gap-1 p-0"
          aria-label={t("Cards in this answer")}
          data-q-card-lines
        >
          {shown.map((card) => (
            <li key={card.key} className="list-none">
              <button
                type="button"
                className="cq-stage-quiet w-full min-h-11 justify-center"
                onClick={onOpenChat}
                data-q-card-line
              >
                <span className="truncate">
                  {card.line === null
                    ? card.name
                    : `${card.name} · ${card.line}`}
                </span>
              </button>
            </li>
          ))}
          {more > 0 ? (
            <li className="list-none">
              <button
                type="button"
                className="cq-stage-quiet w-full min-h-11 justify-center"
                onClick={onOpenChat}
              >
                {t("See all in Chat")}
              </button>
            </li>
          ) : null}
        </ul>
      )}
      {earlier ? (
        <button
          type="button"
          className="cq-stage-quiet min-h-11"
          onClick={onOpenChat}
          data-q-earlier
        >
          {t("Earlier in this conversation")}
        </button>
      ) : null}
    </div>
  );
}
