"use client";

import { useEffect, useRef, useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { Q_SAID_EVENT, saidText } from "@/features/q-swarm/q-said";

import {
  focusForSaid,
  playbackSteps,
  shortLine,
  spokenLine,
} from "./answer-canvas-logic";

export type AnswerPlayback = {
  /** The card Q is talking about; -1 for the overview. */
  readonly focus: number;
  /** The line under the presence: what Q is saying now. */
  readonly said: string;
  /** The person chose a card: Q's walk-through stops there. */
  readonly choose: (index: number) => void;
};

/**
 * Which card is open, kept in step with what Q says (C2).
 *
 * With a live voice line, Q's own lines drive it: each one arrives as a
 * `cq:q-said` event and the card it names comes into focus. Otherwise Q
 * walks through the cards at speaking pace, each card open in turn, and
 * ends on the overview; the line is the answer's own short close. A tap
 * on a card stops the walk-through there.
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

  // The block is rebuilt with each conversation update; what Q walks
  // through is keyed by the cards' own lines, so neither a re-render nor
  // the closing line changing (it streams in) restarts it.
  const steps = playbackSteps(block, closing);
  const plan = steps
    .filter((step) => step.focus >= 0)
    .map((step) => `${String(step.focus)}:${step.said}`)
    .join("\n");
  const latest = useRef({ steps, cards: block.cards });
  useEffect(() => {
    latest.current = { steps, cards: block.cards };
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

  const chosen = state.chosen;
  useEffect(() => {
    if (live || chosen) return;
    const all = latest.current.steps;
    let timer: number | undefined;
    const run = (at: number) => {
      const step = all[at];
      if (step === undefined) return;
      setState((current) =>
        current.chosen
          ? current
          : { ...current, focus: step.focus, said: step.said },
      );
      if (at + 1 < all.length) {
        timer = window.setTimeout(() => run(at + 1), step.ms);
      }
    };
    run(0);
    return () => window.clearTimeout(timer);
  }, [plan, live, chosen, answerId]);

  return {
    focus: state.focus,
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
