"use client";

import { useEffect, useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { Q_SAID_EVENT, saidText } from "@/features/q-swarm/q-said";

import { focusForSaid, playbackSteps } from "./answer-canvas-logic";

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
 * walks through the cards at speaking pace, each card open while its line
 * is shown, and ends on the overview with its closing line. A tap on a
 * card stops the walk-through there.
 */
export function useAnswerPlayback(
  block: QAnswerCardsBlock,
  answerId: string,
  closing: string,
  live: boolean,
): AnswerPlayback {
  const [state, setState] = useState<{
    readonly answerId: string;
    readonly focus: number;
    readonly said: string;
    readonly chosen: boolean;
  }>(() => ({ answerId, focus: live ? -1 : 0, said: "", chosen: false }));

  // A new answer starts its own walk-through.
  if (state.answerId !== answerId) {
    setState({ answerId, focus: live ? -1 : 0, said: "", chosen: false });
  }

  useEffect(() => {
    if (!live) return;
    const onSaid = (event: Event) => {
      const text = saidText(event);
      if (text === null) return;
      const at = focusForSaid(block.cards, text);
      setState((current) =>
        current.chosen
          ? { ...current, said: text }
          : { ...current, said: text, focus: at ?? current.focus },
      );
    };
    window.addEventListener(Q_SAID_EVENT, onSaid);
    return () => window.removeEventListener(Q_SAID_EVENT, onSaid);
  }, [live, block]);

  const chosen = state.chosen;
  useEffect(() => {
    if (live || chosen) return;
    const steps = playbackSteps(block, closing);
    let timer: number | undefined;
    const run = (at: number) => {
      const step = steps[at];
      if (step === undefined) return;
      setState((current) =>
        current.chosen ? current : { ...current, focus: step.focus, said: step.said },
      );
      if (at + 1 < steps.length) {
        timer = window.setTimeout(() => run(at + 1), step.ms);
      }
    };
    run(0);
    return () => window.clearTimeout(timer);
  }, [block, closing, live, chosen, answerId]);

  return {
    focus: state.focus,
    said: state.said.length > 0 ? state.said : closing,
    choose: (index) =>
      setState((current) => ({
        ...current,
        chosen: true,
        focus: current.focus === index ? -1 : index,
        said:
          block.cards[index]?.said ??
          (current.focus === index ? closing : current.said),
      })),
  };
}
