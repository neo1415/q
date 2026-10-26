"use client";

import { useEffect, useRef, useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { Q_SAID_EVENT, saidText } from "@/features/q-swarm/q-said";

import { focusForSaid, shortLine, spokenLine } from "./answer-canvas-logic";

export type AnswerPlayback = {
  /** The card Q is talking about; -1 for the overview. */
  readonly focus: number;
  /** The line under the presence: what Q is saying now. */
  readonly said: string;
  /** The person chose a card: Q's walk-through stops there. */
  readonly choose: (index: number) => void;
  /**
   * A live line is still walking through the cards: what comes after the
   * walk (the follow-ups) waits for the overview. False in a text turn.
   */
  readonly walking: boolean;
};

/**
 * Which card is open, kept in step with what Q says (C2).
 *
 * With a live voice line, Q's own lines drive it: each one arrives as a
 * `cq:q-said` event and the card it names comes into focus. A tap on a
 * card stops that there.
 *
 * In a text turn nothing is said, so nothing is paced (live 2026-10-26,
 * run 8965cbe4: the answer was done at 6 s, and the second card's detail
 * and the follow-ups arrived about 16 s later, at speaking pace with no
 * voice). The answer opens whole: the first card open, every other card's
 * line, the follow-ups at once (`walking` is false); the line is the
 * answer's own short close.
 *
 * F-11 (QA 2026-10-23): the line belongs to the current exchange. When a
 * later exchange is held over the same cards (`exchangeId` changes), the
 * line is that exchange's own closing, never the earlier walk-through's
 * card line, and the cards are not walked through again.
 */
export function useAnswerPlayback(
  block: QAnswerCardsBlock,
  answerId: string,
  closing: string,
  live: boolean,
  exchangeId: string = answerId,
): AnswerPlayback {
  const [state, setState] = useState<{
    readonly answerId: string;
    readonly exchangeId: string;
    readonly focus: number;
    readonly said: string;
    readonly chosen: boolean;
  }>(() => ({
    answerId,
    exchangeId,
    focus: live ? -1 : 0,
    said: "",
    chosen: false,
  }));

  // A new answer starts its own walk-through.
  if (state.answerId !== answerId) {
    setState({
      answerId,
      exchangeId,
      focus: live ? -1 : 0,
      said: "",
      chosen: false,
    });
  } else if (state.exchangeId !== exchangeId) {
    // A new exchange over the same cards: its own line, the overview. The
    // timed walk-through is not replayed; on a live line, Q's own lines
    // still move the focus.
    setState({
      ...state,
      exchangeId,
      focus: -1,
      said: "",
      chosen: live ? state.chosen : true,
    });
  }

  // The block is rebuilt with each conversation update; a live line is
  // matched against the latest cards without re-subscribing.
  const latest = useRef({ cards: block.cards });
  useEffect(() => {
    latest.current = { cards: block.cards };
  });

  useEffect(() => {
    if (!live) return;
    const onSaid = (event: Event) => {
      const text = saidText(event);
      if (text === null) return;
      const at = focusForSaid(latest.current.cards, text);
      setState((current) =>
        current.chosen
          ? { ...current, said: text }
          : { ...current, said: text, focus: at ?? current.focus },
      );
    };
    window.addEventListener(Q_SAID_EVENT, onSaid);
    return () => window.removeEventListener(Q_SAID_EVENT, onSaid);
  }, [live]);

  return {
    focus: state.focus,
    walking: live && state.focus >= 0,
    // F-11 (QA 2026-10-23, phone): in a text turn the line is at most one
    // short human line, the answer's own close; a card's stored line is
    // never the caption (the card shows its own words). Only a live voice
    // line puts Q's spoken words here.
    said: live
      ? state.said.length > 0
        ? state.said
        : closing
      : shortLine(closing),
    choose: (index) =>
      setState((current) => ({
        ...current,
        chosen: true,
        focus: current.focus === index ? -1 : index,
        said: (() => {
          const card = block.cards[index];
          if (card === undefined || current.focus === index) {
            return current.focus === index ? closing : current.said;
          }
          return spokenLine(card);
        })(),
      })),
  };
}
