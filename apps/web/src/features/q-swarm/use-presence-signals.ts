"use client";

import { useEffect, useRef, useState } from "react";

import { presence } from "./presence-cue";
import {
  EVERYDAY_HOLD_MS,
  figureForSignals,
  type PresenceSignalBlock,
  type PresenceSignals,
} from "./presence-signals";

/**
 * Everyday Q (Q Story S4): when the run's own signals name a figure
 * (presence-signals.ts), the presence forms it for a moment. Each figure
 * forms once per thing that asked for it -- a stage, an answer -- never
 * again on a re-render, and never for the answer already on screen when
 * the page opened: a reload is not Q talking.
 */
export function usePresenceSignals(input: {
  readonly stage: string | null;
  readonly task: string | null;
  readonly answer: {
    readonly id: string;
    readonly blocks: readonly PresenceSignalBlock[];
    readonly preview: PresenceSignals["preview"];
  } | null;
}): void {
  const [opened] = useState(() => input.answer?.id ?? null);
  const formed = useRef<string | null>(null);
  const answer =
    input.answer !== null && input.answer.id !== opened ? input.answer : null;
  const fromAnswer =
    answer === null
      ? null
      : figureForSignals({ blocks: answer.blocks, preview: answer.preview });
  const figure =
    fromAnswer ?? figureForSignals({ stage: input.stage, task: input.task });
  // What asked: the answer when it carries the figure, else the stage; a
  // stage moving on under the same answer forms nothing new.
  const key =
    figure === null
      ? null
      : fromAnswer !== null && answer !== null
        ? `answer|${answer.id}|${figure}`
        : `stage|${input.stage ?? ""}|${input.task ?? ""}|${figure}`;
  useEffect(() => {
    if (figure === null || key === null || key === formed.current) return;
    formed.current = key;
    presence.form(figure, { holdMs: EVERYDAY_HOLD_MS });
  }, [figure, key]);
}
