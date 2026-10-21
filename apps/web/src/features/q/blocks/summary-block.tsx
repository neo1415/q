"use client";

import { useEffect, useRef, useState } from "react";

import type { QSummaryBlock } from "@capital-q/contracts";

import { Q_SAID_EVENT, saidText } from "@/features/q-swarm/q-said";

import { sentenceSaid, sentencesOf, speakingMs } from "../room/document-room";

/**
 * Artifacts live (owner 2026-10-20, L-14): the summary Q speaks over.
 *
 * Each point is one of the answer's own findings. A point that is not a
 * verified fact says what it is ("Their claim", "Q's inference"), so the
 * summary never reads an inference as fact; what is missing is listed as
 * missing. As Q says each line (cq:q-said, from voice or as the answer
 * lands), the point it matches lights, the same way a document page does.
 * Colour is never the only signal: the lit point is also marked current.
 */

const TRUTH_WORDS: Readonly<Partial<Record<string, string>>> = {
  USER_CLAIM: "Their claim",
  ESTIMATE: "Estimate",
  Q_INFERENCE: "Q's inference",
  UNKNOWN: "Not known",
};

/** The point Q is saying now, by the words they share; null when none. */
export function summaryPointSaid(
  points: readonly string[],
  said: string,
  from = 0,
): number | null {
  return sentenceSaid(points, said, from);
}

function useSpokenPoint(points: readonly string[]): number | null {
  const [at, setAt] = useState<number | null>(null);
  const latest = useRef(points);
  useEffect(() => {
    latest.current = points;
  });
  useEffect(() => {
    const timers: number[] = [];
    let from = 0;
    const onSaid = (event: Event) => {
      const text = saidText(event);
      if (text === null) return;
      for (const timer of timers.splice(0)) window.clearTimeout(timer);
      let delay = 0;
      for (const said of sentencesOf(text)) {
        const match = summaryPointSaid(latest.current, said, from);
        if (match !== null) {
          timers.push(
            window.setTimeout(() => {
              from = match;
              setAt(match);
            }, delay),
          );
        }
        delay += speakingMs(said);
      }
    };
    window.addEventListener(Q_SAID_EVENT, onSaid);
    return () => {
      window.removeEventListener(Q_SAID_EVENT, onSaid);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);
  return at;
}

export function SummaryBody({ block }: { readonly block: QSummaryBlock }) {
  const texts = block.points.map((point) => point.text);
  const spoken = useSpokenPoint(texts);
  return (
    <div className="flex flex-col gap-3" data-q-summary>
      {/* The points are not a sequence: no numbers. The rail at each
          point's edge is what lights when Q says it (frontend-design). */}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {block.points.map((point, index) => {
          const current = spoken === index;
          const truth =
            point.truthClass === "VERIFIED"
              ? null
              : (TRUTH_WORDS[point.truthClass] ?? null);
          return (
            <li
              key={`${String(index)}-${point.text.slice(0, 24)}`}
              aria-current={current ? "true" : undefined}
              data-q-summary-point={index}
              data-q-summary-current={current ? "" : undefined}
              className={`relative flex rounded-(--cq-radius-md) py-2 ps-4 pe-3 transition-[background-color] duration-(--cq-motion-base) ease-(--cq-ease) ${
                current ? "bg-(--cq-surface-subtle)" : ""
              }`}
            >
              {/* The rail is the lit signal: it thickens (shape) as well as
                  darkening (colour), by transform so the text never
                  reflows; the weight of the words stays put
                  (emil-design-eng, accessibility). */}
              <span
                aria-hidden="true"
                className={`absolute inset-y-1 start-0 w-1 rounded-full transition-[transform,background-color] duration-(--cq-motion-base) ease-(--cq-ease) motion-reduce:transition-[background-color] ${
                  current
                    ? "scale-x-100 bg-(--cq-text-primary)"
                    : "scale-x-50 bg-(--cq-border-subtle)"
                }`}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="cq-body text-(--cq-text-primary)">
                  {point.text}
                </span>
                {truth === null ? null : (
                  // What the point is (claim, inference) carries meaning:
                  // secondary text, AA on the lit background too.
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {truth}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {block.missing.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <span className="cq-label text-(--cq-text-secondary)">
            Not on file yet
          </span>
          <ul className="cq-body-sm m-0 flex list-disc flex-col gap-0.5 ps-5 text-(--cq-text-secondary)">
            {block.missing.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
