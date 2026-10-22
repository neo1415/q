"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { classifyStoryTrigger } from "@capital-q/q-pitch";
import { buttonClassName } from "@capital-q/ui/button";

import { useQSessionOptional } from "@/features/q/q-session";

/**
 * "What is Capital Q?" asked alone (plan §4): Q answers briefly (turn
 * reader v57) and, under that answer, offers the story as one tap. Never
 * started unasked; ignoring the chip is declining it.
 *
 * Shown only where Q Pitch is on: the Q Pitch entry, which the server
 * mounts only when CQ_Q_PITCH_TOUR is set, marks the story available.
 */
let available = false;
const listeners = new Set<() => void>();

export function markStoryAvailable(on: boolean): void {
  if (available === on) return;
  available = on;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The story's start, as Q's Q_PITCH destination opens it for an investor. */
export const STORY_START_HREF = "/home?qpitch=story&new=1";

/** The person's turn just before Q's answer `turnId`, if any. */
export function askedBefore(
  turns: readonly {
    readonly kind: string;
    readonly id: string;
    readonly text: string;
  }[],
  turnId: string,
): string | null {
  const at = turns.findIndex((turn) => turn.id === turnId);
  for (let i = at - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.kind === "PERSON") return turn.text;
    if (turn?.kind === "Q") return null;
  }
  return null;
}

export function StoryOffer({ turnId }: { readonly turnId: string }) {
  const on = useSyncExternalStore(
    subscribe,
    () => available,
    () => false,
  );
  const session = useQSessionOptional();
  if (!on || session === null) return null;
  const asked = askedBefore(session.turns, turnId);
  if (asked === null || classifyStoryTrigger(asked)?.kind !== "BRIEF") {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-q-story-offer>
      <Link href={STORY_START_HREF} className={buttonClassName("secondary")}>
        Show me the story · about 7 minutes
      </Link>
    </div>
  );
}
